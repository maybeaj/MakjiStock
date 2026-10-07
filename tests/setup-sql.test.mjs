import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSetupSql } from "../scripts/build-setup-sql.mjs";

test("supabase/setup.sql 이 스키마·시드·마이그레이션·RLS 최신본과 같다", async () => {
  const saved = await readFile(new URL("../supabase/setup.sql", import.meta.url), "utf8");
  assert.equal(saved, await buildSetupSql(), "마이그레이션을 바꿨다면 npm run db:setup-sql 로 다시 만드세요");
});
