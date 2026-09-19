import assert from "node:assert/strict";
import test from "node:test";
import { REWARD_RATE_PCT as RATE, resolveDirection } from "../lib/bread-market/reward-policy.ts";
import { predictionSchedule } from "../lib/predictions/schedule.ts";

/* 복사본이 아니라 서버·화면이 쓰는 실제 규칙을 검증한다. */

test("오전장·오후장 제출 모두 다음 날 오전가로 판정한다", () => {
  for (const hour of [6, 10, 15, 16, 20, 23]) {
    const t = predictionSchedule("2026-09-21", hour);
    assert.equal(t.targetDate, "2026-09-22");
    assert.equal(t.targetSession, "am");
    assert.equal(t.submitSession, hour >= 16 ? "pm" : "am");
  }
});

test("월말을 넘어가도 날짜가 맞는다", () => {
  assert.equal(predictionSchedule("2026-09-30", 20).targetDate, "2026-10-01");
});

test("적중·미적중·무승부", () => {
  assert.equal(resolveDirection("up", 4000, 4200), "hit");
  assert.equal(resolveDirection("up", 4000, 3800), "miss");
  assert.equal(resolveDirection("down", 4000, 3800), "hit");
  assert.equal(resolveDirection("down", 4000, 4200), "miss");
  // 가격이 같으면 방향과 무관하게 무승부 (PRD §4.3)
  assert.equal(resolveDirection("up", 4000, 4000), "void");
  assert.equal(resolveDirection("down", 4000, 4000), "void");
});

test("틀리지만 않으면 5% — 적중·무승부 5%, 빗나가면 0%", () => {
  assert.equal(RATE[resolveDirection("up", 4000, 4200)], 5);
  assert.equal(RATE[resolveDirection("up", 4000, 4000)], 5);
  assert.equal(RATE[resolveDirection("up", 4000, 3800)], 0);
});
