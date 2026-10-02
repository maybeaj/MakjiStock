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
