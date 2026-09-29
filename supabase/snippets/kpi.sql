-- ════════════════════════════════════════════════════════════════
-- MAKJI STOCK — KPI 집계 (베타 판정용)
-- Supabase SQL Editor 에 붙여 넣어 실행한다. 읽기만 한다.
--
-- 북극성(NSM) = 코드 귀속 주문 수 / 주
--   "막지스톡 할인코드가 쓰인 자사몰 주문". 회원·비회원 무관(available_user A).
--   사용 여부는 아직 Cafe24 관리자 화면에서 확인한다(주문 조회 권한 없음).
--   → ① 번 쿼리로 이번 주 발급 코드 목록을 뽑고, Cafe24 할인코드 사용 내역과
--     코드번호(cafe24_discount_code_no)로 맞춰 사용 건수를 센다.
--
-- 장일(trade_day): KST 02:00 에 하루가 바뀐다. 오후장(16:00~01:59)이 자정을 넘기 때문이다.
--   오전장 06:00~15:59 · 오후장 16:00~01:59 · 정가 02:00~05:59
-- 방문자 = 같은 브라우저(익명 쿠키). 쿠키를 지우거나 기기를 바꾸면 새 사람으로 센다.
-- 방문 집계의 기본(일별 방문자·D1/D7·시간대·이동률)은 retention.sql 에 있다.
-- ════════════════════════════════════════════════════════════════


-- ① NSM 준비 — 최근 7일 발급 코드 목록 (Cafe24 사용 내역과 대조용)
--    used 열은 비워 두고, Cafe24 에서 사용된 코드번호를 확인해 센다.
select
  (rc.created_at at time zone 'Asia/Seoul')                           as issued_at_kst,
  case when rc.round_id is not null           then '안정형'
       when rc.prediction_entry_id is not null then '공격형'
       when rc.price_lock_id is not null       then '잠금'
  end                                                                  as reward_type,
  coalesce(rc.product_id, pl.product_id, pe.product_id)               as product_id,
  rc.cafe24_discount_code_no,
  rc.amount_won,
  (rc.valid_until at time zone 'Asia/Seoul')                          as valid_until_kst
from reward_claims rc
left join price_locks        pl on pl.id = rc.price_lock_id
left join prediction_entries pe on pe.id = rc.prediction_entry_id
where rc.created_at > now() - interval '7 days'
  and coalesce(rc.amount_won, 0) > 0
order by rc.created_at;


-- ② 코드 발급 요약 — 주별 · 유형별 건수와 금액 (코드 사용률의 분모)
select
  date_trunc('week', rc.created_at at time zone 'Asia/Seoul')::date   as week_start,
  case when rc.round_id is not null           then '안정형'
       when rc.prediction_entry_id is not null then '공격형'
       when rc.price_lock_id is not null       then '잠금'
  end                                                                  as reward_type,
  count(*)                                                             as codes_issued,
  sum(rc.amount_won)                                                   as discount_won
from reward_claims rc
where coalesce(rc.amount_won, 0) > 0
group by 1, 2
order by 1 desc, 2;


-- ③ 오전·오후 재방문율 — 오전장에 온 사람 중 같은 장일 오후장에 다시 온 비율
with v as (
  select
    visitor_hash,
    ((occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date  as trade_day,
    extract(hour from occurred_at at time zone 'Asia/Seoul')::int        as h
  from events
  where event_name = 'page_view' and visitor_hash is not null
),
per_visitor as (
  select trade_day, visitor_hash,
         bool_or(h between 6 and 15)   as am,
         bool_or(h >= 16 or h < 2)     as pm
  from v group by 1, 2
)
select
  trade_day,
  count(*) filter (where am)                                            as am_visitors,
  count(*) filter (where am and pm)                                     as am_to_pm,
  round(100.0 * count(*) filter (where am and pm)
        / nullif(count(*) filter (where am), 0), 1)                     as am_to_pm_pct
from per_visitor
group by trade_day
order by trade_day desc;


-- ④ 가격 잠금 설정자 — 당일 오후장 재방문율 · 같은 빵 구매 링크 클릭률 · 상승일 비율
--    오전 잠금의 보호 구간은 lock_date 16:00 ~ 다음 날 01:59 (KST)
--    가격이 내린 날은 코드 없이 사므로 "구매"는 클릭까지만 확정된다.
with locks as (
  select
    pl.id, pl.visitor_hash, pl.product_id, pl.lock_date,
    ((pl.lock_date + time '16:00') at time zone 'Asia/Seoul')           as win_from,
    ((pl.lock_date + 1 + time '02:00') at time zone 'Asia/Seoul')       as win_to,
    coalesce(pl.lock_code_amount_won, 0) > 0                            as price_rose
  from price_locks pl
  where pl.lock_session = 'am' and pl.status <> 'cancelled'
),
flags as (
  select l.*,
    exists (select 1 from events e
            where e.visitor_hash = l.visitor_hash and e.event_name = 'page_view'
              and e.occurred_at >= l.win_from and e.occurred_at < l.win_to)           as revisited,
    exists (select 1 from events e
            where e.visitor_hash = l.visitor_hash and e.event_name = 'purchase_link_click'
              and e.product_id = l.product_id
              and e.occurred_at >= l.win_from and e.occurred_at < l.win_to)           as clicked
  from locks l
)
select
  lock_date,
  count(*)                                                              as locks,
  round(100.0 * count(*) filter (where revisited) / count(*), 1)        as pm_revisit_pct,
  round(100.0 * count(*) filter (where clicked)   / count(*), 1)        as same_day_click_pct,
  count(*) filter (where price_rose)                                    as rose_days_codes
from flags
group by lock_date
order by lock_date desc;


-- ⑤ 예측(공격형) 참여자 — 다음 날 방문율 vs 같은 날 미참여 방문자 (uplift)
--    결과는 target_publish_date 06:00 에 나온다. 그 장일 안(06:00~다음 날 01:59)에 오면 방문.
with v as (
  select distinct visitor_hash,
         ((occurred_at at time zone 'Asia/Seoul') - interval '2 hours')::date as trade_day
  from events where event_name = 'page_view' and visitor_hash is not null
),
participants as (
  select distinct pe.visitor_hash,
         ((pe.submitted_at at time zone 'Asia/Seoul') - interval '2 hours')::date as trade_day,
         pe.target_publish_date
  from prediction_entries pe
  where pe.role = 'general'
),
p_flag as (
  select p.trade_day,
         exists (select 1 from v where v.visitor_hash = p.visitor_hash
                 and v.trade_day = p.target_publish_date)                          as came_back
  from participants p
),
nonp_flag as (
  select v.trade_day,
         exists (select 1 from v v2 where v2.visitor_hash = v.visitor_hash
                 and v2.trade_day = v.trade_day + 1)                               as came_back
  from v
  where not exists (select 1 from participants p
                    where p.visitor_hash = v.visitor_hash and p.trade_day = v.trade_day)
)
select
  d.trade_day,
  (select count(*) from p_flag where trade_day = d.trade_day)                     as predictors,
  (select round(100.0 * count(*) filter (where came_back) / nullif(count(*), 0), 1)
     from p_flag where trade_day = d.trade_day)                                   as predictor_next_day_pct,
  (select round(100.0 * count(*) filter (where came_back) / nullif(count(*), 0), 1)
     from nonp_flag where trade_day = d.trade_day)                                as others_next_day_pct
from (select distinct trade_day from v) d
order by d.trade_day desc;


-- ⑥ 주간 스코어카드 — 자동 집계 값. Cafe24 값(코드 사용 건수 · 주문 수)은 옆에 손으로 적는다.
--    코드 사용률      = Cafe24 사용 건수 ÷ codes_issued
--    이동 대비 구매전환 = Cafe24 사용 건수 ÷ clickers
with wk as (
  select date_trunc('week', now() at time zone 'Asia/Seoul')::date as start_day
)
select
  (select start_day from wk)                                                      as week_start,
  (select count(distinct visitor_hash) from events, wk
    where event_name = 'page_view'
      and (occurred_at at time zone 'Asia/Seoul')::date >= wk.start_day)          as visitors,
  (select count(distinct visitor_hash) from events, wk
    where event_name = 'purchase_link_click' and visitor_hash is not null
      and (occurred_at at time zone 'Asia/Seoul')::date >= wk.start_day)          as clickers,
  (select count(*) from events, wk
    where event_name = 'purchase_link_click'
      and (occurred_at at time zone 'Asia/Seoul')::date >= wk.start_day)          as clicks_total,
  (select count(*) from reward_claims, wk
    where coalesce(amount_won, 0) > 0
      and (created_at at time zone 'Asia/Seoul')::date >= wk.start_day)           as codes_issued,
  (select coalesce(sum(amount_won), 0) from reward_claims, wk
    where (created_at at time zone 'Asia/Seoul')::date >= wk.start_day)           as discount_won_issued;
