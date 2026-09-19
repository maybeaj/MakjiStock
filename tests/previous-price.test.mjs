import assert from "node:assert/strict";
import test from "node:test";
import { BREADS, changeAt, hydrateQuotes } from "../lib/bread-market/engine.ts";

/* 직전가: 오전장 ← 전날 오후가, 오후장 ← 오늘 오전가, 정가 시간 ← 전날 오후가 */
const b = BREADS.find((x) => x.tk === "TTR");
const row = (publishDate, session, priceWon) => ({
  ticker: "TTR", publishDate, session, priceWon, basePriceWon: b.base,
  searchRatio: 50, searchDiscountPct: 5, fxDeclinePct: 0, fxDiscountPct: 0, discountPct: 5, fxCurrentDate: publishDate,
});
hydrateQuotes([row("2026-09-17", "am", 10500), row("2026-09-17", "pm", 10600), row("2026-09-18", "am", 10400), row("2026-09-18", "pm", 10700)]);

test("18일 오전가는 17일 오후가와 비교한다", () => {
  assert.equal(changeAt(b, "2026-09-18", "am").previousPrice, 10600);
});

test("18일 오후가는 18일 오전가와 비교한다", () => {
  assert.equal(changeAt(b, "2026-09-18", "pm").previousPrice, 10400);
});

test("정가 시간(02:00~)은 아직 없는 오늘 오후가가 아니라 전날 오후가와 비교한다", () => {
  assert.equal(changeAt(b, "2026-09-18", "list").previousPrice, 10600);
});

test("아직 확정 안 된 장은 가장 최근 확정가를 이월해 보여준다", async () => {
  const { quoteAt } = await import("../lib/bread-market/engine.ts");
  // 19일 행이 아직 없다 → 18일 오후가
  assert.equal(quoteAt(b, "2026-09-19", "am").price, 10700);
  assert.equal(quoteAt(b, "2026-09-19", "pm").price, 10700);
  // 18일 오후 행은 있다
  assert.equal(quoteAt(b, "2026-09-18", "pm").price, 10700);
});

test("이월된 가격은 0% 가 아니라 마지막 실제 등락을 보여준다", async () => {
  const { changeAt, signed } = await import("../lib/bread-market/engine.ts");
  // 19일 행이 없다 → 18일 오후 등락(10400 → 10700)을 그대로
  const c = changeAt(b, "2026-09-19", "am");
  assert.equal(c.previousPrice, 10400);
  assert.equal(c.amount, 300);
  assert.equal(signed(-0.02), "0.0");
  assert.equal(signed(-0.06), "−0.1");
});
