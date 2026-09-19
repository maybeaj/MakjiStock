import assert from "node:assert/strict";
import test from "node:test";
import { predictionSchedule } from "../lib/predictions/schedule.ts";

test("주말도 쉬지 않는다 — 금·토·일 모두 다음 날 06:00 오전가로 판정한다", () => {
  assert.equal(predictionSchedule("2026-09-18", 18).targetDate, "2026-09-19");
  assert.equal(predictionSchedule("2026-09-19", 10).targetDate, "2026-09-20");
  assert.equal(predictionSchedule("2026-09-20", 10).targetDate, "2026-09-21");
  assert.equal(predictionSchedule("2026-09-20", 10).referenceDate, "2026-09-20");
});

test("평일 오전 예측도 다음 날 06:00 오전가를 판정한다 — 잠금과 같은 사건에 걸지 않는다", () => {
  const schedule = predictionSchedule("2026-09-17", 10);
  assert.equal(schedule.referenceDate, "2026-09-17");
  assert.equal(schedule.submitSession, "am");
  assert.equal(schedule.targetDate, "2026-09-18");
  assert.equal(schedule.targetSession, "am");
  assert.equal(schedule.label, "내일 06:00 오전가");
});

test("자정 뒤 오후장(시장 시계 24시)은 오후 제출이다", () => {
  const schedule = predictionSchedule("2026-09-17", 24);
  assert.equal(schedule.submitSession, "pm");
  assert.equal(schedule.targetDate, "2026-09-18");
});
