-- 방문·재방문 집계 — events.page_view (app/api/events/route.ts) 기준
-- Supabase SQL Editor 에 붙여 넣어 실행한다. 읽기만 한다.
--
-- "방문자" = 같은 브라우저(익명 쿠키). 기기를 바꾸거나 쿠키를 지우면 새 사람으로 센다.
-- 날짜는 KST 로 자른다.

-- 1) 일별 방문자 수 · 그중 처음 온 사람 · 다시 온 사람
with visits as (
  select distinct visitor_hash, (occurred_at at time zone 'Asia/Seoul')::date as day
  from events where event_name = 'page_view' and visitor_hash is not null
),
first_day as (
  select visitor_hash, min(day) as first_day from visits group by visitor_hash
)
select
  v.day,
  count(*)                                        as visitors,
  count(*) filter (where v.day = f.first_day)     as new_visitors,
  count(*) filter (where v.day > f.first_day)     as returning_visitors
from visits v join first_day f using (visitor_hash)
group by v.day
order by v.day desc;


-- 2) 첫 방문일 코호트별 D1 · D7 재방문율
--    D1 = 다음 날 다시 옴, D7 = 2~7일 안에 한 번이라도 다시 옴
--    아직 7일이 안 지난 코호트는 D7 이 낮게 나온다(끝까지 안 채워짐).
with visits as (
  select distinct visitor_hash, (occurred_at at time zone 'Asia/Seoul')::date as day
  from events where event_name = 'page_view' and visitor_hash is not null
),
first_day as (
  select visitor_hash, min(day) as first_day from visits group by visitor_hash
),
flags as (
  select
    f.visitor_hash,
    f.first_day,
    bool_or(v.day = f.first_day + 1)                              as d1,
    bool_or(v.day between f.first_day + 1 and f.first_day + 7)    as d7
  from first_day f join visits v using (visitor_hash)
  group by f.visitor_hash, f.first_day
)
select
  first_day                                            as cohort,
  count(*)                                             as new_visitors,
  round(100.0 * count(*) filter (where d1) / count(*), 1) as d1_pct,
  round(100.0 * count(*) filter (where d7) / count(*), 1) as d7_pct
from flags
group by first_day
order by first_day desc;


-- 3) PRD §3.3 "7일 안에 3번 이상 재방문" — 최근 7일(오늘 포함) 동안 3일 이상 온 사람 비율
with visits as (
  select distinct visitor_hash, (occurred_at at time zone 'Asia/Seoul')::date as day
  from events where event_name = 'page_view' and visitor_hash is not null
),
last7 as (
  select visitor_hash, count(*) as days
  from visits
  where day > (now() at time zone 'Asia/Seoul')::date - 7
  group by visitor_hash
)
select
  count(*)                                               as visitors_7d,
  count(*) filter (where days >= 3)                      as visited_3plus_days,
  round(100.0 * count(*) filter (where days >= 3) / nullif(count(*), 0), 1) as pct
from last7;


-- 4) 가격이 바뀌는 시각 직후에 몰리는지 — 시간대별 방문(KST, 최근 14일)
select
  extract(hour from occurred_at at time zone 'Asia/Seoul')::int as hour_kst,
  count(distinct visitor_hash)                                    as visitors
from events
where event_name = 'page_view'
  and occurred_at > now() - interval '14 days'
group by 1
order by 1;


-- 5) 막지몰 이동률 — 일별 방문자 중 구매 링크를 누른 사람 (purchase_link_click, 서버 기록)
--    같은 날 page_view 쿠키가 있는 사람만 잇는다. 쿠키 없이 누른 클릭은 clicks_total 에만 들어간다.
--    GA4 의 utm_source=makjistock 세션 수와 clicks_total 차이 = 넘어가다 빠진 몫.
with days as (
  select (occurred_at at time zone 'Asia/Seoul')::date as day, event_name, visitor_hash
  from events where event_name in ('page_view', 'purchase_link_click')
)
select
  day,
  count(distinct visitor_hash) filter (where event_name = 'page_view')           as visitors,
  count(distinct visitor_hash) filter (where event_name = 'purchase_link_click') as clickers,
  count(*) filter (where event_name = 'purchase_link_click')                     as clicks_total,
  round(100.0 * count(distinct visitor_hash) filter (where event_name = 'purchase_link_click')
    / nullif(count(distinct visitor_hash) filter (where event_name = 'page_view'), 0), 1) as click_pct
from days
group by day
order by day desc;
