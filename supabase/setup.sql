-- ════════════════════════════════════════════════════════════════
-- 새 DB 처음 세팅용 — 이 파일 하나를 SQL Editor 에서 실행한다.
-- 자동 생성 파일이다. 직접 고치지 말고 `npm run db:setup-sql` 로 다시 만든다 (scripts/build-setup-sql.mjs).
-- 이미 운영 중인 DB 에는 돌리지 않는다 — 그쪽은 supabase/migrations 를 번호순으로 하나씩 적용한다.
-- 포함: schema.sql, seed.sql, migrations/001_cafe24_tokens.sql, migrations/002_encrypt_cafe24_tokens.sql, migrations/003_lock_discount_codes.sql, migrations/004_shop_url.sql, migrations/005_no_surcharge_reward5.sql, migrations/006_prediction_risk_reward.sql, migrations/007_reward_claim_product.sql, migrations/008_cafe24_orders.sql, migrations/009_admin_audit.sql, migrations/010_pricing_versions.sql, migrations/011_product_catalog.sql, rls.sql
-- ════════════════════════════════════════════════════════════════


-- ┌──────────────────────────────────────────────────────────────
-- │ schema.sql — 기본 테이블·열거형
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ seed.sql — 빵 6종 (아래 004·011 이 이 행을 채운다)
-- └──────────────────────────────────────────────────────────────

-- 상품 6종 시드. config/pricing-products.json 이 원본이다.
-- cafe24_product_no 는 Cafe24 관리자에서 확인해 채운다. null 이면 가격 반영이 건너뛰어진다.

insert into products (id, ticker, name, base_price_won, cafe24_product_no, keywords) values
  ('morning_roll', 'MRL', '막지 제로 모닝롤', 4500, null, array['막지모닝롤','막지제로모닝롤','무설탕모닝롤','제로모닝롤','저당모닝롤','설탕무첨가모닝롤','모닝롤','모닝빵','모닝롤빵','모닝빵추천','막지모닝빵','막지제로모닝빵','무설탕모닝빵','제로모닝빵','저당모닝빵','설탕무첨가모닝빵']),
  ('tetris_bread', 'TTR', '막지 테트리스 브레드', 11000, null, array['막지테트리스브레드','막지테트리스식빵','테트리스브레드','테트리스식빵','통식빵','무첨가식빵','수제식빵','우유식빵']),
  ('english_muffin', 'MUF', '막지 잉글리시 머핀', 1500, null, array['막지잉글리시머핀','막지비건머핀','비건잉글리시머핀','비건머핀','잉글리시머핀','잉글리쉬머핀','영국머핀','햄치즈머핀','햄치즈잉글리시머핀']),
  ('gluten_free_scone', 'SCN', '막지 글루텐프리 스콘', 3800, null, array['막지스콘','막지글루텐프리스콘','글루텐프리스콘','스콘','버터스콘','단짠스콘','수제스콘','플레인스콘','스콘추천','스콘선물']),
  ('gluten_free_financier', 'FNC', '막지 글루텐프리 휘낭시에', 3800, null, array['막지휘낭시에','막지글루텐프리휘낭시에','글루텐프리휘낭시에','피칸휘낭시에','초코휘낭시에','코코넛휘낭시에','버터휘낭시에','휘낭시에','피낭시에','수제휘낭시에','휘낭시에선물','휘낭시에추천']),
  ('gluten_free_frozen_dough_set', 'GFD', '막지 글루텐프리 냉동생지 3종', 21000, null, array['막지냉동생지','막지글루텐프리냉동생지','막지냉동생지3종','막지글루텐프리냉동생지3종','글루텐프리냉동생지','글루텐프리냉동생지3종','냉동생지','냉동생지3종','비건냉동생지','쌀빵냉동생지','글루텐프리빵생지','냉동빵생지','홈베이킹생지','냉동생지추천','에어프라이어생지','빵생지','냉동베이커리','글루텐프리빵','홈베이킹빵','생지빵'])
on conflict (id) do update set
  name            = excluded.name,
  base_price_won  = excluded.base_price_won,
  keywords        = excluded.keywords;


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/001_cafe24_tokens.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- Cafe24 Admin API OAuth 토큰 보관
-- access_token 2시간 · refresh_token 2주. 하루 2번 도는 작업이라 갱신이 필수다.
-- 몰 하나당 한 행. RLS 를 켜고 정책을 두지 않아 service_role 만 접근한다.

create table if not exists cafe24_tokens (
  mall_id                  text primary key,
  access_token             text not null,
  refresh_token            text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  scopes                   text[] not null default '{}',
  updated_at               timestamptz not null default now()
);

-- 정책을 만들지 않으므로 RLS 만으로 anon·authenticated 는 차단된다.
alter table cafe24_tokens enable row level security;

-- anon/authenticated 는 Supabase 에만 있는 역할이다. 로컬 Postgres 검증에서도
-- 돌도록 존재할 때만 회수한다.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cafe24_tokens from anon, authenticated;
  end if;
end $$;


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/002_encrypt_cafe24_tokens.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 토큰을 평문으로 두지 않는다. 컬럼 이름도 암호문임이 드러나게 바꾼다.
-- 평문 컬럼명을 남겨두면 나중에 누군가 그대로 쓴다.
--
-- 기존 행은 평문이라 새 키로 복호화할 수 없다. 지우고 재인증한다.
-- (/api/auth/cafe24/start 접속 한 번)

delete from cafe24_tokens;

alter table cafe24_tokens rename column access_token  to access_token_ciphertext;
alter table cafe24_tokens rename column refresh_token to refresh_token_ciphertext;


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/003_lock_discount_codes.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 잠금 차액 할인코드를 MY 화면에 바로 띄우려면 코드 원문을 다시 읽어야 한다.
-- PRD §16.7 은 "코드 원문은 저장하지 않거나 암호화"를 요구하므로 암호화해서 둔다.
-- lib/crypto.ts 의 AES-256-GCM, TOKEN_ENCRYPTION_KEY 를 그대로 쓴다.

alter table reward_claims
  add column if not exists discount_code_ciphertext text;

-- 잠금 차액 코드는 비율 보상이 아니라 정액이다. 0 을 넣으면 "0% 보상"으로
-- 읽혀 오해를 만든다. 예측 보상만 rate_pct 를 채운다.
alter table reward_claims
  alter column rate_pct drop not null;

-- 한 잠금당 코드 1회는 이미 유니크 인덱스가 막는다 (schema.sql).
-- 크론이 같은 실행을 중복 호출해도 두 번 발급되지 않는다.


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/004_shop_url.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 실제 자사몰(makji.kr) 상품 주소를 저장해 둔다. 지금은 쓰지 않는다.
--
-- 몰이 둘이다.
--   rabbit3456 데모몰 : 가격 PUT 을 시험하는 곳. cafe24_product_no 가 가리킨다
--   makji.kr 자사몰   : 손님이 실제로 사는 곳. shop_url 이 가리킨다
--
-- 구매 버튼이 어디로 갈지는 환경변수 SHOP_TARGET 이 정한다.
--   demo (기본) → 데모몰 상품 상세
--   live        → shop_url
-- 실제 자사몰로 넘길 때 코드를 고치지 않고 값 하나만 바꾼다.
--
-- 주소에 슬러그가 들어 있어 상품번호만으로는 만들 수 없다. 전체를 저장한다.
-- icid 추적 파라미터는 뺐다. 자사몰 메인 목록에서 온 것처럼 집계되면 안 된다.

alter table products
  add column if not exists shop_url text;

comment on column products.shop_url is
  '실제 자사몰(makji.kr) 상품 상세 주소. SHOP_TARGET=live 일 때 구매 버튼이 여기로 간다.';

update products set shop_url = 'https://makji.kr/product/%EB%A7%89%EC%A7%80-%EA%B8%80%EB%A3%A8%ED%85%90%ED%94%84%EB%A6%AC-%EB%83%89%EB%8F%99%EC%83%9D%EC%A7%80-3%EC%A2%85/33/category/1/display/2/' where id = 'gluten_free_frozen_dough_set';
update products set shop_url = 'https://makji.kr/product/%EB%8B%B4%EB%B0%B1%ED%8F%AD%EC%8B%A0-%EB%A7%89%EC%A7%80-%EC%A0%9C%EB%A1%9C-%EB%AC%B4%EC%84%A4%ED%83%95-%EB%AA%A8%EB%8B%9D%EB%A1%A4/32/category/1/display/2/' where id = 'morning_roll';
update products set shop_url = 'https://makji.kr/product/%ED%8F%AD%EC%8B%A0%ED%95%9C-%ED%86%B5%EC%8B%9D%EB%B9%B5-%EB%A7%89%EC%A7%80-%ED%85%8C%ED%8A%B8%EB%A6%AC%EC%8A%A4-%EB%B8%8C%EB%A0%88%EB%93%9C/31/category/1/display/2/' where id = 'tetris_bread';
update products set shop_url = 'https://makji.kr/product/%EB%A7%89%EC%A7%80-%EB%B9%84%EA%B1%B4-%EC%9E%89%EA%B8%80%EB%A6%AC%EC%8B%9C-%EB%A8%B8%ED%95%80%ED%96%84%EC%B9%98%EC%A6%88%EB%B9%84%EA%B1%B4/30/category/1/display/2/' where id = 'english_muffin';
update products set shop_url = 'https://makji.kr/product/%EA%B2%89%EB%B0%94%EC%86%8D%EC%AB%80-%EB%A7%89%EC%A7%80-%EA%B8%80%EB%A3%A8%ED%85%90%ED%94%84%EB%A6%AC-%ED%9C%98%EB%82%AD%EC%8B%9C%EC%97%90/28/category/1/display/2/' where id = 'gluten_free_financier';
update products set shop_url = 'https://makji.kr/product/%ED%99%98%EC%83%81%EC%9D%98-%EB%8B%A8%EC%A7%9C-%EC%A1%B0%ED%95%A9-%EB%A7%89%EC%A7%80-%EA%B8%80%EB%A3%A8%ED%85%90%ED%94%84%EB%A6%AC-%EC%8A%A4%EC%BD%98/25/category/1/display/2/' where id = 'gluten_free_scone';

select ticker, name, cafe24_product_no as demo_no, shop_url is not null as has_shop_url
from products order by ticker;


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/005_no_surcharge_reward5.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 산식 v1.0 에 DB 제약을 맞춘다.
--   1. 할인율 하한 -10 → 0. v1.0 은 정가를 넘지 않는다(할증 없음).
--   2. 예측 보상률 (0,3,7) → (0,5). 예측 쿠폰이 5% 로 바뀌었는데 제약이 남아
--      판정 결과(reward_rate_pct = 5) 저장이 거부되고 있었다.
-- 기존 행은 모두 새 범위 안이라 그대로 통과한다.

alter table daily_prices drop constraint if exists daily_prices_discount_pct_check;
alter table daily_prices add constraint daily_prices_discount_pct_check
  check (discount_pct between 0 and 38);

alter table prediction_entries drop constraint if exists prediction_entries_reward_rate_pct_check;
alter table prediction_entries add constraint prediction_entries_reward_rate_pct_check
  check (reward_rate_pct in (0,5));


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/006_prediction_risk_reward.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 예측에 리스크/리워드 선택을 붙인다.
--   ① 안정형 투자(바로 받기)  — 10~15% 중 오늘 값. 고르기 전에 숫자가 보인다
--   ② 공격형 투자(내일 맞히기) —  5~20% 중 하나. 걸 때는 "?" 이고 결과가 나와야 안다
--
-- 1. 보상률 범위를 넓힌다. (0,5) 고정이던 것을 0~20 으로 연다.
--    예측 제출 시점에 그 회차의 약속 보상률을 저장하고, 판정 때 그 값을 쓴다.
--    빗나가면 0 이라 하한은 그대로 0 이다.
--
-- 2. 즉시 수령을 reward_claims 에 직접 남긴다. prediction_entries 에 넣지 않는
--    이유는 그 행이 예측이 아니기 때문이다 — direction 도 판정 결과도 없다.
--    대신 round_id 를 달아 "이 회차에서 한 선택" 임을 표시하고, 부분 유니크
--    인덱스로 회차당 1회를 DB 가 막게 한다. prediction_entries 의
--    (round_id, visitor_hash) 유니크와 같은 역할이다.
--
-- 둘의 상호 배타(즉시 받고 예측까지 하는 것)는 애플리케이션이 막는다 —
-- 서로 다른 테이블이라 한 인덱스로는 걸 수 없다.

alter table prediction_entries drop constraint if exists prediction_entries_reward_rate_pct_check;
alter table prediction_entries add constraint prediction_entries_reward_rate_pct_check
  check (reward_rate_pct between 0 and 20);

alter table reward_claims add column if not exists round_id text references prediction_rounds(id);

create unique index if not exists reward_claims_instant_round_visitor
  on reward_claims (round_id, visitor_hash)
  where round_id is not null;

-- 3. 쿠폰의 출처가 셋이 된다. 기존 제약은 예측·잠금 둘만 허용했다.
alter table reward_claims drop constraint if exists reward_claims_check;
alter table reward_claims drop constraint if exists reward_claims_source_check;
alter table reward_claims add constraint reward_claims_source_check
  check (prediction_entry_id is not null or price_lock_id is not null or round_id is not null);

comment on column reward_claims.round_id is
  '즉시 수령(바로 받기)으로 발급된 쿠폰의 회차. 예측 보상·잠금 차액은 null.';


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/007_reward_claim_product.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 바로 받기 쿠폰이 어느 빵 것인지 남긴다.
--
-- 쿠폰은 Cafe24 에서 available_product 로 그 빵 하나에만 묶여 발급되는데
-- (lib/rewards/discount-code.ts), 우리 DB 에는 그 사실이 없었다. 그래서 MY 의
-- 쿠폰 줄이 상품 없이 "바로 받기 · 10% 할인코드" 로만 떠서 아무 빵에나 쓸 수
-- 있는 것처럼 보였다.
--
-- 예측 보상은 prediction_entry_id, 잠금 차액은 price_lock_id 를 타고 가면
-- 상품을 알 수 있어 null 이어도 된다. 바로 받기만 탈 곳이 없었다.
alter table reward_claims add column if not exists product_id text references products(id);

comment on column reward_claims.product_id is
  '쿠폰이 묶인 상품. 바로 받기는 이 값으로만 상품을 알 수 있다. 예측 보상·잠금 차액은 entry·lock 을 타고 가면 되므로 null 이어도 된다.';


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/008_cafe24_orders.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 008: Cafe24 주문 동기화와 KPI 뷰
-- 주문은 lib/cafe24/order-sync.ts 가 채운다(크론 /api/internal/sync-orders).
-- 이름·연락처·주소는 저장하지 않는다. 주문번호는 sha256(mall_id:order_id) 로만 남긴다.
-- 장일(trade_day): KST 02:00 에 하루가 바뀐다(오후장이 01:59 까지).

create table if not exists cafe24_orders (
  order_hash  text primary key,
  mall_id     text not null,
  ordered_at  timestamptz,
  paid_at     timestamptz,
  paid        boolean not null default false,
  canceled    boolean not null default false,
  total_won   integer,
  synced_at   timestamptz not null default now()
);
create index if not exists cafe24_orders_ordered_at on cafe24_orders (ordered_at desc);

create table if not exists cafe24_order_items (
  order_hash  text not null references cafe24_orders(order_hash) on delete cascade,
  line_no     integer not null,
  product_no  integer,
  product_id  text references products(id),
  quantity    integer not null default 1,
  price_won   integer,
  primary key (order_hash, line_no)
);

alter table reward_claims add column if not exists used_order_hash text references cafe24_orders(order_hash);

alter table cafe24_orders      enable row level security;
alter table cafe24_order_items enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cafe24_orders, cafe24_order_items from anon, authenticated;
  end if;
end $$;


-- 막지스톡 6종이 들어간 유효 주문(결제됨·취소 아님)
create or replace view kpi_orders as
select
  o.order_hash,
  coalesce(o.paid_at, o.ordered_at)                                                    as at,
  ((coalesce(o.paid_at, o.ordered_at) at time zone 'Asia/Seoul') - interval '2 hours')::date as trade_day,
  extract(hour from coalesce(o.paid_at, o.ordered_at) at time zone 'Asia/Seoul')::int  as hour_kst,
  o.total_won,
  exists (select 1 from reward_claims rc where rc.used_order_hash = o.order_hash)      as attributed
from cafe24_orders o
where o.paid and not o.canceled
  and exists (select 1 from cafe24_order_items i where i.order_hash = o.order_hash and i.product_id is not null);


-- 장일별 스코어
create or replace view kpi_daily as
with days as (
  select generate_series(
    (select least(
       coalesce(min(((occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date), current_date),
       coalesce((select min(trade_day) from kpi_orders), current_date))
     from events),
    ((now() at time zone 'Asia/Seoul') - interval '2 hours')::date,
    interval '1 day')::date as trade_day
),
ev as (
  select ((occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date as trade_day, event_name, visitor_hash
  from events
),
codes as (
  select ((created_at at time zone 'Asia/Seoul') - interval '2 hours')::date as trade_day,
         count(*) as issued, count(*) filter (where status = 'used') as used
  from reward_claims where coalesce(amount_won, 0) > 0 group by 1
),
ord as (
  select trade_day,
         count(*)                                         as orders,
         count(*) filter (where hour_kst between 6 and 15) as am_orders,
         count(*) filter (where attributed)               as attributed_orders
  from kpi_orders group by 1
)
select
  d.trade_day,
  (select count(distinct visitor_hash) from ev where ev.trade_day = d.trade_day and event_name = 'page_view')           as visitors,
  (select count(distinct visitor_hash) from ev where ev.trade_day = d.trade_day and event_name = 'purchase_link_click') as clickers,
  coalesce(c.issued, 0)             as codes_issued,
  coalesce(c.used, 0)               as codes_used,
  coalesce(o.orders, 0)             as orders,
  coalesce(o.am_orders, 0)          as am_orders,
  coalesce(o.attributed_orders, 0)  as attributed_orders
from days d
left join codes c using (trade_day)
left join ord   o using (trade_day)
order by d.trade_day desc;


-- 주간 스코어카드 — 대시보드(/admin/kpi)가 읽는다
--   코드 사용률          = 사용된 코드 ÷ 발급 코드 (발급 주 기준)
--   잠금 후 당일 구매율   = 잠금 차액 코드가 보호 구간(당일 16:00~01:59) 안에 쓰인 비율
--   이동 대비 구매전환    = 코드 귀속 주문 ÷ 구매 링크 누른 방문자
--   판매 증분            = 6종 주문 수 ÷ 도입 전 주 평균 − 1 (도입 = 첫 page_view)
create or replace view kpi_weekly as
with launch as (
  select min(occurred_at) as at from events where event_name = 'page_view'
),
wk as (
  select date_trunc('week', trade_day)::date as week_start, * from kpi_daily
),
agg as (
  select week_start,
         sum(visitors)          as visitors_day_sum,
         sum(clickers)          as clickers_day_sum,
         sum(codes_issued)      as codes_issued,
         sum(codes_used)        as codes_used,
         sum(orders)            as orders,
         sum(am_orders)         as am_orders,
         sum(attributed_orders) as attributed_orders
  from wk group by 1
),
locks as (
  select date_trunc('week', pl.lock_date)::date as week_start,
         count(*) filter (where rc.id is not null) as lock_codes,
         count(*) filter (where rc.status = 'used' and rc.used_at >= pl.protect_from and rc.used_at < pl.protect_until) as lock_codes_used_same_day
  from price_locks pl
  left join reward_claims rc on rc.price_lock_id = pl.id
  where pl.status <> 'cancelled'
  group by 1
),
baseline as (
  select avg(orders) as weekly_orders
  from agg, launch
  where launch.at is not null and agg.week_start < date_trunc('week', launch.at at time zone 'Asia/Seoul')::date
)
select
  a.week_start,
  (select count(distinct visitor_hash) from events
    where event_name = 'page_view' and date_trunc('week', (occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date = a.week_start) as visitors,
  (select count(distinct visitor_hash) from events
    where event_name = 'purchase_link_click' and date_trunc('week', (occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date = a.week_start) as clickers,
  a.codes_issued,
  a.codes_used,
  round(100.0 * a.codes_used / nullif(a.codes_issued, 0), 1)                         as code_use_pct,
  coalesce(l.lock_codes, 0)                                                            as lock_codes,
  round(100.0 * l.lock_codes_used_same_day / nullif(l.lock_codes, 0), 1)              as lock_same_day_pct,
  a.attributed_orders,
  round(100.0 * a.attributed_orders / nullif((select count(distinct visitor_hash) from events
    where event_name = 'purchase_link_click' and date_trunc('week', (occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date = a.week_start), 0), 1) as click_to_order_pct,
  a.orders,
  round(100.0 * a.am_orders / nullif(a.orders, 0), 1)                                  as am_order_pct,
  round(b.weekly_orders, 1)                                                            as baseline_weekly_orders,
  round(100.0 * (a.orders / nullif(b.weekly_orders, 0) - 1), 1)                        as sales_lift_pct
from agg a
left join locks l using (week_start)
cross join baseline b
order by a.week_start desc;


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/009_admin_audit.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 009: 어드민 변경 기록
-- 가격·쿠폰에 영향을 주는 변경은 모두 남기고 지우지 않는다. 고치거나 지우려 하면 막는다.
-- 쓰는 곳: app/admin/products/[id]/actions.ts (서버 service_role). 브라우저는 직접 읽지 않는다.

create table if not exists admin_audit_log (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('formula','coupon','product')),
  target  text not null,
  change  text not null,
  actor   text not null default 'admin'
);
create index if not exists admin_audit_log_at on admin_audit_log (at desc);

create or replace function admin_audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'admin_audit_log 는 추가만 할 수 있습니다';
end $$;

drop trigger if exists admin_audit_log_no_change on admin_audit_log;
create trigger admin_audit_log_no_change
  before update or delete on admin_audit_log
  for each row execute function admin_audit_log_append_only();

-- 행 트리거는 TRUNCATE 에 안 걸린다.
drop trigger if exists admin_audit_log_no_truncate on admin_audit_log;
create trigger admin_audit_log_no_truncate
  before truncate on admin_audit_log
  for each statement execute function admin_audit_log_append_only();

alter table admin_audit_log enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on admin_audit_log from anon, authenticated;
  end if;
end $$;

-- 어드민 이전의 변경을 docs/산식-버전.md 에서 옮겨 둔다. 날짜는 KST 기준 그날 자정.
insert into admin_audit_log (at, kind, target, change, actor)
select * from (values
  ('2026-09-22 00:00+09'::timestamptz, 'formula', 'v1.0 → v1.1', '오전장 환율 구간: 전전영업일 종가→전영업일 종가 를 전영업일 시가→전영업일 종가 로', '기록 이관'),
  ('2026-09-23 00:00+09'::timestamptz, 'formula', 'v1.1 → v1.2', '상품 할인 상한 38% → 28%', '기록 이관'),
  ('2026-09-23 00:00+09'::timestamptz, 'coupon',  '안정형·공격형', '안정형 오전 13~15% → 7~10%, 오후 10~12% → 5~7%, 공격형 5~20% → 5~13%', '기록 이관'),
  ('2026-09-27 00:00+09'::timestamptz, 'formula', 'v1.2 → v1.3', '상품 할인 상한 28% → 25%, 쿠폰 금액 min(판매가 × R, 정가의 13%)', '기록 이관'),
  ('2026-09-28 00:00+09'::timestamptz, 'formula', 'v1.3 → v1.4', '환율 상승 반영 50% → 100%, 상승 쪽 상한 14%p → 28%p', '기록 이관')
) as v(at, kind, target, change, actor)
where not exists (select 1 from admin_audit_log where actor = '기록 이관');


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/010_pricing_versions.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 010: 산식·쿠폰 정책 버전
-- 가장 최근 행이 운영값이다. 가격 크론(daily-pricing), 쿠폰 발급(predictions·instant·resolve),
-- 사용자 화면이 모두 이 행을 읽는다 (lib/bread-market/policy-server.ts).
-- 한 번 만든 버전은 고치지 않는다 — daily_prices.formula_version 이 이 이름을 가리키므로
-- 같은 이름의 값이 바뀌면 "그날 어떤 산식으로 계산했나"를 되짚을 수 없다.
-- 어드민 /admin/pricing 이 저장할 때 새 행을 추가한다.

create table if not exists pricing_versions (
  version     text primary key,
  formula     jsonb not null,  -- lib/pricing/pricing.d.mts PricingConfig
  coupons     jsonb not null,  -- lib/bread-market/policy.ts CouponPolicy
  note        text,
  actor       text not null default 'admin',
  created_at  timestamptz not null default now()
);
create index if not exists pricing_versions_created_at on pricing_versions (created_at desc);

create or replace function pricing_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'pricing_versions 는 추가만 할 수 있습니다. 바꾸려면 새 버전을 만드세요';
end $$;

drop trigger if exists pricing_versions_no_change on pricing_versions;
create trigger pricing_versions_no_change
  before update or delete on pricing_versions
  for each row execute function pricing_versions_append_only();
drop trigger if exists pricing_versions_no_truncate on pricing_versions;
create trigger pricing_versions_no_truncate
  before truncate on pricing_versions
  for each statement execute function pricing_versions_append_only();

alter table pricing_versions enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on pricing_versions from anon, authenticated;
  end if;
end $$;

-- 지금 운영 중인 v1.4 (config/pricing-products.json + reward-policy.ts 의 값 그대로)
insert into pricing_versions (version, formula, coupons, note, actor, created_at)
values (
  'v1.4',
  '{"fxWeight":0.28,"searchWeight":0.15,"fxScale":50,"fxDiscountCapPct":28,"fxSurchargeCapPct":28,"fxRisePassThroughPct":100,"discountCapPct":25,"dailyPriceMoveCapPct":null,"priceRoundingWon":10,"discountFloorPct":0}',
  '{"instantAm":{"min":7,"max":10},"instantPm":{"min":5,"max":7},"prediction":{"min":5,"max":13}}',
  '어드민 이전 운영값 (docs/산식-버전.md v1.4)',
  '기록 이관',
  '2026-09-28 00:00+09'
)
on conflict (version) do nothing;


-- ┌──────────────────────────────────────────────────────────────
-- │ migrations/011_product_catalog.sql — 마이그레이션
-- └──────────────────────────────────────────────────────────────

-- 011: 빵 목록을 DB 로 — 화면 이름·상세 이름·사진
-- 지금까지 화면용 이름과 사진은 코드(lib/bread-market/engine.ts BREADS)에만 있었다.
-- 어드민에서 빵을 추가하려면 DB 가 정본이어야 한다. products.name 은 그대로 몰(Cafe24) 상품명이다
-- (sync-products 가 이 이름으로 Cafe24 상품을 찾는다).

alter table products add column if not exists display_name text;  -- 화면 이름 (예: 휘낭시에)
alter table products add column if not exists full_name    text;  -- 상세 이름 (예: 겉바속쫀 막지 글루텐프리 휘낭시에)
alter table products add column if not exists photo_url    text;  -- 사진 주소. 기존 6종은 /images/..., 새 빵은 Storage 공개 주소

-- 기존 6종: 코드에 있던 값을 옮긴다. 이미 채운 값은 건드리지 않는다.
update products p set
  display_name = coalesce(p.display_name, v.display_name),
  full_name    = coalesce(p.full_name, v.full_name),
  photo_url    = coalesce(p.photo_url, v.photo_url)
from (values
  ('MUF', '비건 잉글리시 머핀', '막지 비건 잉글리시 머핀(햄치즈/비건)',   '/images/bread-market/muf-large.jpg'),
  ('FNC', '휘낭시에',           '겉바속쫀 막지 글루텐프리 휘낭시에',       '/images/bread-market/fnc-large.jpg'),
  ('SCN', '글루텐프리 스콘',    '환상의 단짠 조합, 막지 글루텐프리 스콘',  '/images/bread-market/scn-large.jpg'),
  ('MRL', '모닝롤',             '담백폭신 막지 제로 무설탕 모닝롤',        '/images/bread-market/mrl-large.jpg'),
  ('TTR', '테트리스 브레드',    '폭신한 통식빵, 막지 테트리스 브레드',     '/images/bread-market/ttr-large.jpg'),
  ('GFD', '냉동생지 3종',       '집에서 굽는 막지 글루텐프리 냉동생지 3종', '/images/bread-market/gfd-large.png')
) as v(ticker, display_name, full_name, photo_url)
where p.ticker = v.ticker;

-- 사진 버킷. 공개 읽기(화면이 그대로 <url> 로 쓴다), 쓰기는 서버(service_role)만.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bread-photos', 'bread-photos', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'storage 스키마가 없어 bread-photos 버킷을 만들지 못했습니다. Storage 를 켠 뒤 다시 실행하세요.';
  end if;
end $$;


-- ┌──────────────────────────────────────────────────────────────
-- │ rls.sql — RLS 잠금 (마지막)
-- └──────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════
-- RLS 잠금 — schema.sql · seed.sql 다음에 실행한다.
--
-- 이 서비스는 브라우저가 Supabase 를 직접 부르지 않는다. 모든 읽기·쓰기가
-- Next.js 서버 라우트를 지나며, 서버는 service_role 키를 쓴다.
-- service_role 은 RLS 를 통과하므로 정책을 하나도 만들지 않는다.
-- 정책이 없는 상태에서 RLS 를 켜면 anon·authenticated 는 전부 차단된다.
--
-- 나중에 브라우저가 직접 읽어야 할 테이블이 생기면 그 테이블에만
-- select 정책을 추가한다. 쓰기 정책은 열지 않는다.
-- ════════════════════════════════════════════════════════════════

alter table products           enable row level security;
alter table trend_snapshots    enable row level security;
alter table fx_rates           enable row level security;
alter table daily_prices       enable row level security;
alter table job_runs           enable row level security;
alter table anonymous_visitors enable row level security;
alter table price_locks        enable row level security;
alter table prediction_rounds  enable row level security;
alter table prediction_entries enable row level security;
alter table reward_claims      enable row level security;
alter table events             enable row level security;

-- 혹시 모를 직접 접근도 막는다. PostgREST 는 anon 역할로 들어온다.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 확인용. 이 파일의 11개는 rowsecurity = true 여야 한다. 마이그레이션이 더한 테이블은 각 마이그레이션이 RLS 를 켠다.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
