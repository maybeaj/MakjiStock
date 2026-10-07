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
