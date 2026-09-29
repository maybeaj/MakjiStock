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
