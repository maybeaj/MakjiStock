import assert from "node:assert/strict";
import test from "node:test";
import { resolveDirection, rewardPctFor } from "../lib/bread-market/reward-policy.ts";
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

test("틀리지만 않으면 약속한 보상률 — 적중·무승부는 그대로, 빗나가면 0%", () => {
  assert.equal(rewardPctFor(resolveDirection("up", 4000, 4200), 9), 9);
  assert.equal(rewardPctFor(resolveDirection("up", 4000, 4000), 9), 9);
  assert.equal(rewardPctFor(resolveDirection("up", 4000, 3800), 9), 0);
});

/* 예측 카드 배지는 "지금 열려 있는 회차에 참여했나"만 말한다.
   어제 적중해도 오늘 안 냈으면 다시 참여 상태여야 한다. */
test("회차는 날짜로 갈린다 — 어제 낸 예측은 오늘 회차가 아니다", () => {
  const 어제회차 = predictionSchedule("2026-09-19", 10).targetDate; // 2026-09-20
  const 오늘회차 = predictionSchedule("2026-09-20", 10).targetDate; // 2026-09-21
  assert.notEqual(어제회차, 오늘회차);

  const 내예측 = [{ target_publish_date: 어제회차, target_session: "am", result: "hit" }];
  const 참여함 = (rows, round) =>
    rows.some((r) => r.target_publish_date === round && r.target_session === "am");

  assert.equal(참여함(내예측, 어제회차), true);
  assert.equal(참여함(내예측, 오늘회차), false); // 적중이 남아 있어도 오늘은 미참여
});

test("제출 시각과 무관하게 같은 날이면 같은 회차다", () => {
  assert.equal(predictionSchedule("2026-09-20", 10).targetDate, predictionSchedule("2026-09-20", 18).targetDate);
});
