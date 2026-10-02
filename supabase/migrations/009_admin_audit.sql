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
