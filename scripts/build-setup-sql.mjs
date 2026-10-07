import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/* 새 DB 를 한 번에 세팅하는 supabase/setup.sql 을 만든다.
   순서: schema.sql → seed.sql(빵 6종, 004·011 이 이 행을 채운다) → migrations 번호순 → rls.sql
   운영 DB 는 이미 마이그레이션을 번호별로 적용했으므로 이 파일을 다시 돌리지 않는다.
   마이그레이션을 추가하면 `npm run db:setup-sql` 로 다시 만든다 — tests/setup-sql.test.mjs 가 지킨다. */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const supa = path.join(root, "supabase");

export async function buildSetupSql() {
  const migrations = (await readdir(path.join(supa, "migrations"))).filter((f) => f.endsWith(".sql")).sort();
  const parts = [
    ["schema.sql", "기본 테이블·열거형"],
    ["seed.sql", "빵 6종 (아래 004·011 이 이 행을 채운다)"],
    ...migrations.map((f) => [`migrations/${f}`, "마이그레이션"]),
    ["rls.sql", "RLS 잠금 (마지막)"],
  ];
  let out =
    "-- ════════════════════════════════════════════════════════════════\n" +
    "-- 새 DB 처음 세팅용 — 이 파일 하나를 SQL Editor 에서 실행한다.\n" +
    "-- 자동 생성 파일이다. 직접 고치지 말고 `npm run db:setup-sql` 로 다시 만든다 (scripts/build-setup-sql.mjs).\n" +
    "-- 이미 운영 중인 DB 에는 돌리지 않는다 — 그쪽은 supabase/migrations 를 번호순으로 하나씩 적용한다.\n" +
    `-- 포함: ${parts.map(([f]) => f).join(", ")}\n` +
    "-- ════════════════════════════════════════════════════════════════\n";
  for (const [file, note] of parts) {
    const body = (await readFile(path.join(supa, file), "utf8")).trimEnd();
    out += `\n\n-- ┌──────────────────────────────────────────────────────────────\n-- │ ${file} — ${note}\n-- └──────────────────────────────────────────────────────────────\n\n${body}\n`;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await writeFile(path.join(supa, "setup.sql"), await buildSetupSql());
  console.log("supabase/setup.sql 을 만들었습니다.");
}
