-- ════════════════════════════════════════════════════════════════
-- MAKJI Bread Market — Supabase 스키마
-- 기준: docs/PRD-브레드마켓.md §16, docs/기획-정리-2026-09-19.md 부록 A
-- 범위: 1차 출시 (가격 자동화 → Cafe24 반영 → 일반 예측 → 쿠폰)
--
-- 1차 범위 밖이라 의도적으로 넣지 않은 것:
--   visitor_sessions(§16.10)        분석 심화 단계에서 추가
--   purchase_attributions(§16.12)   구매자 예측을 붙일 때 추가
--   notification_deliveries(§16.14) 이메일 발송 단계에서 추가
--   price_alerts                    지정가 알림은 기획에서 삭제됨
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 열거형 ──────────────────────────────────────────────────────
create type price_session   as enum ('am', 'pm', 'list');
create type price_status    as enum ('scheduled','collecting','calculated','applying_cafe24','published','completed','partially_failed','held');
create type cafe24_status   as enum ('pending','skipped_same_price','applied','failed');
create type lock_status     as enum ('pending_verification','active','protecting','purchased','expired','cancelled');
create type round_status    as enum ('open','closed','resolved','void');
create type entry_role      as enum ('general','buyer');
create type entry_direction as enum ('up','down');
create type entry_result    as enum ('pending','hit','miss','void');
create type claim_status    as enum ('pending_email','issued','used','expired','reissued');
create type consent_state   as enum ('unknown','granted','denied');

-- ── 상품 (§16.1) ────────────────────────────────────────────────
create table products (
  id                 text primary key,
  ticker             text not null unique,
  name               text not null,
  base_price_won     integer not null check (base_price_won > 0),
  cafe24_product_no  integer,
  cafe24_shop_no     integer not null default 1,
  keywords           text[] not null default '{}',
  -- 마진 하한. 둘 다 null 이면 운영 정책의 상품 할인 상한(discountCapPct)을 그대로 쓴다.
  -- 최대 할인율 = (list_margin_pct - min_margin_pct) / (1 - min_margin_pct)
  -- 뺄셈이 아니다. 자세한 근거는 docs/가격정책-마진연동-계산안.md §4
  list_margin_pct    numeric(5,2) check (list_margin_pct between 0 and 100),
  min_margin_pct     numeric(5,2) check (min_margin_pct  between 0 and 100),
  active             boolean not null default true,
  valid_from         date,
  valid_to           date,
  created_at         timestamptz not null default now()
);

-- ── 네이버 검색 지수 원본 (§16.2, §10.2) ────────────────────────
-- ratio 는 요청 구간 안에서 재정규화되므로 요청 조건을 반드시 함께 남긴다.
create table trend_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  product_id            text not null references products(id),
  signal_date           date not null,
  ratio                 numeric(6,3) not null check (ratio >= 0),
  request_start_date    date not null,
  request_end_date      date not null,
  keyword_group_version text not null,
  provider              text not null,
  fetched_at            timestamptz not null default now(),
  raw_payload           jsonb,
  raw_object_path       text,
  unique (product_id, signal_date, request_start_date, request_end_date, keyword_group_version)
);
create index on trend_snapshots (product_id, signal_date desc);

-- ── 원/달러 환율 (§16.3, §9) ────────────────────────────────────
-- ECOS 731Y003. item_code 0000002=시가, 0000003=종가.
create table fx_rates (
  rate_date       date not null,
  item_code       text not null,
  rate_type       text not null check (rate_type in ('open','close')),
  usd_krw         numeric(10,2) not null check (usd_krw > 0),
  stat_code       text not null default '731Y003',
  fetched_at      timestamptz not null default now(),
  raw_payload     jsonb,
  raw_object_path text,
  primary key (rate_date, item_code)
);

-- ── 일별 확정 가격 (§16.4, §11.3) ───────────────────────────────
create table daily_prices (
  id                  uuid primary key default gen_random_uuid(),
  product_id          text not null references products(id),
  publish_date        date not null,
  price_session       price_session not null,
  signal_date         date not null,
  formula_version     text not null,

  search_ratio        numeric(6,3) not null,
  search_discount_pct numeric(6,3) not null,

  fx_previous_date    date not null,
  fx_current_date     date not null,
  fx_previous_rate    numeric(10,2) not null,
  fx_current_rate     numeric(10,2) not null,
  fx_decline_pct      numeric(8,5) not null,
  fx_discount_pct     numeric(6,3) not null,

  -- 산식 v1.0: 0~38. 정가를 넘지 않는다(할증 없음).
  discount_pct        numeric(6,3) not null check (discount_pct between 0 and 38),
  base_price_won      integer not null,
  price_won           integer not null check (price_won > 0 and price_won % 10 = 0),
  previous_price_won  integer,
  price_change_pct    numeric(8,4),

  status              price_status  not null default 'scheduled',
  cafe24_apply_status cafe24_status not null default 'pending',
  created_at          timestamptz not null default now(),
  published_at        timestamptz,
  applied_at          timestamptz,

  unique (product_id, publish_date, price_session, formula_version)
);
create index on daily_prices (publish_date desc, price_session);

-- ── 자동화 실행 이력 (§16.8, §11.2) ─────────────────────────────
create table job_runs (
  id              uuid primary key default gen_random_uuid(),
  job_kind        text not null,
  target_date     date not null,
  price_session   price_session,
  status          price_status not null default 'scheduled',
  formula_version text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  attempt_count   integer not null default 1,
  step_log        jsonb not null default '[]'::jsonb,
  error_code      text,
  error_message   text
);
create index on job_runs (target_date desc, job_kind);

-- ── 익명 방문자 (§16.9, §13.4) ──────────────────────────────────
-- visitor_token 원문은 저장하지 않는다. HMAC 해시만 남긴다.
create table anonymous_visitors (
  visitor_hash       text primary key,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  analytics_consent  consent_state not null default 'unknown',
  consent_version    text,
  consented_at       timestamptz,
  first_utm_source   text,
  first_utm_medium   text,
  first_utm_campaign text
);

-- ── 가격 잠금 (§16.13, §4.4) ────────────────────────────────────
create table price_locks (
  id                          uuid primary key default gen_random_uuid(),
  visitor_hash                text not null references anonymous_visitors(visitor_hash),
  product_id                  text not null references products(id),
  lock_date                   date not null,
  lock_session                price_session not null check (lock_session in ('am','pm')),
  locked_price_won            integer not null check (locked_price_won % 10 = 0),
  -- 오전 잠금은 당일 16:00~23:59, 오후 잠금은 다음 날 00:00~04:59 보호
  protect_from                timestamptz not null,
  protect_until               timestamptz not null,
  email_ciphertext            bytea,
  email_hash                  text,
  status                      lock_status not null default 'pending_verification',
  verification_token_hash     text,
  verification_expires_at     timestamptz,
  current_price_won_at_protect integer,
  lock_code_amount_won        integer,
  reward_claim_id             uuid,
  formula_version             text not null,
  consent_version             text,
  consented_at                timestamptz,
  locked_at                   timestamptz not null default now(),
  verified_at                 timestamptz,
  cancelled_at                timestamptz,
  check (protect_until > protect_from),
  -- 하루 1회 · 빵 1개 제한을 DB가 강제한다. 해지해도 복구되지 않는다.
  unique (visitor_hash, lock_date)
);
create index on price_locks (lock_date desc, status);

-- ── 예측 라운드 (§16.5) ─────────────────────────────────────────
create table prediction_rounds (
  id                  text primary key,
  round_date          date not null,
  target_publish_date date not null,
  target_session      price_session not null,
  status              round_status not null default 'open',
  closes_at           timestamptz not null,
  resolution_version  text,
  void_reason         text,
  unique (round_date, target_session)
);

-- ── 예측 참여 (§16.6, §4.3) ─────────────────────────────────────
-- 1차 출시는 role='general' 만 사용한다. buyer 는 Cafe24 주문 연결이
-- 붙은 뒤 2차에서 연다. 그때 purchase_id 를 채운다.
create table prediction_entries (
  id                  uuid primary key default gen_random_uuid(),
  round_id            text references prediction_rounds(id),
  purchase_id         uuid,
  role                entry_role not null default 'general',
  visitor_hash        text not null references anonymous_visitors(visitor_hash),
  product_id          text not null references products(id),
  direction           entry_direction not null,
  reference_price_won integer not null,
  target_publish_date date not null,
  target_session      price_session not null,
  submitted_at        timestamptz not null default now(),
  result_price_won    integer,
  result              entry_result not null default 'pending',
  -- 적중·무승부 5, 빗나감 0 (lib/bread-market/reward-policy.ts)
  reward_rate_pct     smallint not null default 0 check (reward_rate_pct in (0,5)),
  resolved_at         timestamptz,
  check ((role = 'general' and round_id is not null)
      or (role = 'buyer'   and purchase_id is not null))
);
-- 일반 예측: 한 라운드·방문자당 1회
create unique index on prediction_entries (round_id, visitor_hash) where role = 'general';
-- 구매자 예측: 한 구매당 1회
create unique index on prediction_entries (purchase_id) where role = 'buyer';

-- ── 쿠폰 보상 (§16.7, §12.4) ────────────────────────────────────
-- 쿠폰 코드 원문은 저장하지 않는다.
create table reward_claims (
  id                       uuid primary key default gen_random_uuid(),
  prediction_entry_id      uuid references prediction_entries(id),
  price_lock_id            uuid references price_locks(id),
  visitor_hash             text not null references anonymous_visitors(visitor_hash),
  email_ciphertext         bytea,
  email_hash               text,
  email_verified_at        timestamptz,
  consent_version          text,
  rate_pct                 smallint not null,
  final_coupon_pct         numeric(5,2),
  sale_price_won_at_issue  integer,
  amount_won               integer,
  cafe24_discount_code_no  text,
  discount_code_hash       text,
  valid_from               timestamptz,
  valid_until              timestamptz,
  status                   claim_status not null default 'pending_email',
  sent_at                  timestamptz,
  used_at                  timestamptz,
  created_at               timestamptz not null default now(),
  check (prediction_entry_id is not null or price_lock_id is not null)
);
-- 한 적중 예측당 보상 1회, 한 잠금당 잠금 할인코드 1회 (§13.5)
create unique index on reward_claims (prediction_entry_id) where prediction_entry_id is not null;
create unique index on reward_claims (price_lock_id)       where price_lock_id is not null;

alter table price_locks
  add constraint price_locks_reward_claim_fk
  foreign key (reward_claim_id) references reward_claims(id);

-- ── 분석 이벤트 (§16.11, §21) ───────────────────────────────────
-- id 를 클라이언트가 만들어 재전송 중복을 막는다.
-- properties 에 이메일·쿠폰번호·원문 쿠키·전체 IP 를 넣지 않는다.
create table events (
  id              uuid primary key,
  visitor_hash    text references anonymous_visitors(visitor_hash),
  session_id      uuid,
  event_name      text not null,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null default now(),
  path            text,
  product_id      text references products(id),
  round_id        text references prediction_rounds(id),
  formula_version text,
  properties      jsonb not null default '{}'::jsonb,
  source          text not null default 'client' check (source in ('client','server','cafe24'))
);
create index on events (occurred_at desc);
create index on events (event_name, occurred_at desc);
