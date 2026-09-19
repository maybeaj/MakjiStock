import assert from "node:assert/strict";
import test from "node:test";
import { calculateDay, resolveSearchRatio } from "../lib/pricing/pricing.mjs";

const PRICING = {
  searchWeight: 0.145, fxWeight: 0.28, fxScale: 50,
  fxDiscountCapPct: 28, fxSurchargeCapPct: 28,
  discountCapPct: 38, discountFloorPct: -10, priceRoundingWon: 10,
};

test("D-1 지수가 있으면 그대로 쓴다", () => {
  const r = resolveSearchRatio({ "2026-09-17": 50, "2026-09-18": 87.09 }, "2026-09-18");
  assert.deepEqual(r, { ratio: 87.09, sourceDate: "2026-09-18", carried: false });
});

test("D-1 지수가 없으면 직전 관측치를 이월한다", () => {
  const r = resolveSearchRatio({ "2026-09-16": 80, "2026-09-17": 87.09 }, "2026-09-18");
  assert.equal(r.ratio, 87.09);
  assert.equal(r.sourceDate, "2026-09-17");
  assert.equal(r.carried, true);
});

test("이월해도 환율은 오늘 값으로 가격이 움직인다", () => {
  const series = { "2026-09-17": 87.09 }; // D-1(09-18) 누락
  const s = resolveSearchRatio(series, "2026-09-18");
  const flat = calculateDay({ searchRatio: s.ratio, fxDeclinePct: 0, basePriceWon: 3800, pricing: PRICING });
  const drop = calculateDay({ searchRatio: s.ratio, fxDeclinePct: 0.5, basePriceWon: 3800, pricing: PRICING });
  assert.ok(drop.priceWon < flat.priceWon, "환율이 내리면 가격도 내려야 한다");
});

test("0 으로 대체하면 가격이 정가 위로 튄다 — 그래서 안 쓴다", () => {
  const real = calculateDay({ searchRatio: 87.09, fxDeclinePct: -0.0796, basePriceWon: 3800, pricing: PRICING });
  const zero = calculateDay({ searchRatio: 0, fxDeclinePct: -0.0796, basePriceWon: 3800, pricing: PRICING });
  assert.equal(real.priceWon, 3360);
  assert.ok(zero.priceWon > 3800, `0 대체 시 ${zero.priceWon}원으로 정가를 넘는다`);
});

test("90일 창에 관측치가 하나도 없으면 이월할 값이 없다", () => {
  assert.equal(resolveSearchRatio({}, "2026-09-18"), null);
  // 미래 날짜만 있는 경우도 쓰면 안 된다
  assert.equal(resolveSearchRatio({ "2026-09-20": 50 }, "2026-09-18"), null);
});

test("D-1 지수가 0 이면 직전 양수 관측치를 이월한다", () => {
  const r = resolveSearchRatio({ "2026-09-16": 0, "2026-09-17": 72.5, "2026-09-18": 0 }, "2026-09-18");
  assert.deepEqual(r, { ratio: 72.5, sourceDate: "2026-09-17", carried: true });
});

test("창 전체가 0 이면 이월할 값이 없다", () => {
  assert.equal(resolveSearchRatio({ "2026-09-17": 0, "2026-09-18": 0 }, "2026-09-18"), null);
});
