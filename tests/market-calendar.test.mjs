import assert from "node:assert/strict";
import test from "node:test";
import { marketClockOf } from "../lib/market/calendar.ts";

test("시장 하루는 02:00 에 바뀐다 — 00~01시는 전날 오후장(24·25시)", () => {
  assert.deepEqual(marketClockOf("2026-09-18", 0), { date: "2026-09-17", hour: 24 });
  assert.deepEqual(marketClockOf("2026-09-18", 1), { date: "2026-09-17", hour: 25 });
  assert.deepEqual(marketClockOf("2026-09-18", 2), { date: "2026-09-18", hour: 2 });
  // 금요일 오후장은 토요일 01:59 까지
  assert.deepEqual(marketClockOf("2026-09-19", 1), { date: "2026-09-18", hour: 25 });
});

test("월말·연말을 넘어도 전날로 돌아간다", () => {
  assert.deepEqual(marketClockOf("2026-10-01", 1), { date: "2026-09-30", hour: 25 });
  assert.deepEqual(marketClockOf("2027-01-01", 0), { date: "2026-12-31", hour: 24 });
});
