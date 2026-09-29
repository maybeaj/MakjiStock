-- ════════════════════════════════════════════════════════════════
-- MAKJI STOCK — 가드레일 지수 (매일 1회 실행, 오후장 반영 뒤 16:30 이후 권장)
-- Supabase SQL Editor 에 붙여 넣어 실행한다. 읽기만 한다.
--
-- 가드레일 지수 = 통과 항목 ÷ 8 × 100 · 목표 100
--   레드(R) 3개: 하나라도 실패하면 지수 0 → 즉시 중단(정가 복귀) 검토
--   옐로(Y) 5개: 실패하면 주간 리뷰에서 원인·조치
--
-- 기준일 = 오늘(KST). 월 코드 예산은 아래 params 에서 바꾼다(결정 요청 ② 확정 후).
-- 로컬·프리뷰는 Cafe24 반영을 건너뛰어 cafe24_apply_status 가 pending 으로 남는다.
-- R2·Y3 는 운영(CAFE24 쓰기 켜짐) 데이터에서만 의미가 있다.
-- ════════════════════════════════════════════════════════════════

with params as (
  select
    300000::numeric                                   as monthly_budget_won,  -- 월 코드 예산 (가정값)
    (now() at time zone 'Asia/Seoul')::date           as today,
    (now() at time zone 'Asia/Seoul')                 as now_kst
),
-- 코드별 발급 시점 총혜택률 = 1 - (발급 시 판매가 - 코드 금액) / 정가
claims as (
  select
    rc.created_at,
    rc.amount_won,
    1 - (rc.sale_price_won_at_issue - rc.amount_won)::numeric / nullif(p.base_price_won, 0) as total_benefit
  from reward_claims rc
  left join price_locks        pl on pl.id = rc.price_lock_id
  left join prediction_entries pe on pe.id = rc.prediction_entry_id
  join products p on p.id = coalesce(rc.product_id, pl.product_id, pe.product_id)
  where coalesce(rc.amount_won, 0) > 0 and rc.sale_price_won_at_issue is not null
),
today_prices as (
  select dp.*,
    ((dp.publish_date + case dp.price_session when 'am' then time '06:00' else time '16:00' end)
      at time zone 'Asia/Seoul')                                         as session_open
  from daily_prices dp, params
  where dp.publish_date = params.today and dp.price_session in ('am', 'pm')
),
checks as (
  -- R1 총혜택 38% 초과 (최근 24시간 발급 코드)
  select 1 as ord, 'R' as tier, '총혜택 38% 초과' as item,
         count(*) filter (where total_benefit > 0.38)::numeric as value, '0건' as rule,
         count(*) filter (where total_benefit > 0.38) = 0 as pass
  from claims where created_at > now() - interval '24 hours'

  union all
  -- R2 표시가 ≠ Cafe24 판매가: 앱에 계산된 가격이 Cafe24 반영에 실패한 행
  select 2, 'R', '표시가 ≠ Cafe24 판매가',
         count(*)::numeric, '반영 실패 0건',
         count(*) = 0
  from today_prices where cafe24_apply_status = 'failed'

  union all
  -- R3 정가 초과 · 계산 오류 (v1.4: 할인 0~25%, 10원 단위)
  select 3, 'R', '정가 초과 · 계산 오류',
         count(*)::numeric, '0건',
         count(*) = 0
  from today_prices
  where price_won > base_price_won or discount_pct < 0 or discount_pct > 25 or price_won % 10 <> 0

  union all
  -- Y1 코드 예산 소진 속도: 이번 달 발급액 ÷ 예산 ≤ 경과일 ÷ 월 일수
  select 4, 'Y', '코드 예산 소진 속도',
         round(100 * coalesce(sum(rc.amount_won), 0) / p.monthly_budget_won, 1),
         '≤ ' || round(100.0 * extract(day from p.today)
                  / extract(day from (date_trunc('month', p.today) + interval '1 month - 1 day')), 1) || '%',
         coalesce(sum(rc.amount_won), 0) / p.monthly_budget_won
           <= extract(day from p.today)
              / extract(day from (date_trunc('month', p.today) + interval '1 month - 1 day'))
  from params p
  left join reward_claims rc
    on date_trunc('month', rc.created_at at time zone 'Asia/Seoul') = date_trunc('month', p.today)
  group by p.monthly_budget_won, p.today

  union all
  -- Y2 일 발급 급증: 오늘 발급 수 ≤ max(직전 7일 평균 × 3, 10)  — 비회원 쿠키 재발급 남용 신호
  select 5, 'Y', '일 발급 급증',
         t.today_cnt::numeric,
         '≤ ' || greatest(round(3 * b.avg7, 1), 10),
         t.today_cnt <= greatest(3 * b.avg7, 10)
  from
    (select count(*) as today_cnt from reward_claims, params
      where (created_at at time zone 'Asia/Seoul')::date = params.today) t,
    (select coalesce(count(*) / 7.0, 0) as avg7 from reward_claims, params
      where (created_at at time zone 'Asia/Seoul')::date between params.today - 7 and params.today - 1) b

  union all
  -- Y3 Cafe24 가격 반영 지연: 개장 10분 안에 반영 (이미 연 장만 본다)
  select 6, 'Y', 'Cafe24 반영 10분 내',
         count(*) filter (where applied_at is null or applied_at > session_open + interval '10 minutes')::numeric,
         '지연 0건',
         count(*) filter (where applied_at is null or applied_at > session_open + interval '10 minutes') = 0
  from today_prices where session_open <= now()

  union all
  -- Y4 데이터 지연: 오늘 오전장 가격이 10시까지 없거나, 가격 작업이 보류(held)·부분 실패
  select 7, 'Y', '데이터 지연 · 작업 보류',
         (case when p.now_kst >= p.today + time '10:00'
                and not exists (select 1 from daily_prices d
                                where d.publish_date = p.today and d.price_session = 'am')
               then 1 else 0 end
          + (select count(*) from job_runs j
             where j.job_kind = 'daily_pricing' and j.target_date = p.today
               and j.status in ('held', 'partially_failed')))::numeric,
         '0건',
         (case when p.now_kst >= p.today + time '10:00'
                and not exists (select 1 from daily_prices d
                                where d.publish_date = p.today and d.price_session = 'am')
               then 1 else 0 end
          + (select count(*) from job_runs j
             where j.job_kind = 'daily_pricing' and j.target_date = p.today
               and j.status in ('held', 'partially_failed'))) = 0
  from params p

  union all
  -- Y5 평균 총혜택률 (발급 기준, 최근 7일) ≤ 20% — 마진 방어선
  select 8, 'Y', '평균 총혜택률 (7일)',
         round(100 * coalesce(avg(total_benefit), 0), 1), '≤ 20%',
         coalesce(avg(total_benefit), 0) <= 0.20
  from claims where created_at > now() - interval '7 days'
)
select ord, tier, item, value, rule, case when pass then '통과' else '실패' end as result
from checks
union all
select 9, '=', '가드레일 지수',
       case when bool_and(pass) filter (where tier = 'R') then round(100.0 * count(*) filter (where pass) / 8) else 0 end,
       '100', case when bool_and(pass) filter (where tier = 'R') then '레드 통과' else '레드 실패 → 중단 검토' end
from checks
order by ord;
