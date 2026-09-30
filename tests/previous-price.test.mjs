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

/* 그날 확정가가 없으면 전날 값을 끌어오지 않고 정가를 보여준다.
   몰은 02:00 에 정가로 되돌아가고 그날 가격이 만들어져야 할인가가 다시 올라간다.
   전날 가격을 이월하면 몰은 정가로 받는데 화면만 싼 값을 말한다.
   docs/네이버-검색지수-도착시각.md */
test("그날 확정가가 없으면 전날 값이 아니라 정가다", async () => {
  const { quoteAt } = await import("../lib/bread-market/engine.ts");
  // 19일 행이 아직 없다 → 전날(10700)이 아니라 정가
  assert.equal(quoteAt(b, "2026-09-19", "am").price, b.base);
  assert.equal(quoteAt(b, "2026-09-19", "pm").price, b.base);
  // 18일 오후 행은 있다
  assert.equal(quoteAt(b, "2026-09-18", "pm").price, 10700);
});

test("오후가만 없는 날은 같은 날 오전가로 떨어진다 — 주말은 몰이 오전가를 들고 있다", async () => {
  const { hydrateQuotes, quoteAt } = await import("../lib/bread-market/engine.ts");
  hydrateQuotes([row("2026-09-19", "am", 10900)]); // 19일 오전만 있다
  assert.equal(quoteAt(b, "2026-09-19", "pm").price, 10900);
});

test("정가로 떨어진 장에는 지난 장의 등락을 붙이지 않는다", async () => {
  const { changeAt, signed } = await import("../lib/bread-market/engine.ts");
  // 20일 행이 없다 → 정가. 18일 오후 등락(+300)을 끌어오면 정가에 엉뚱한 %가 붙는다.
  const c = changeAt(b, "2026-09-20", "am");
  assert.notEqual(c.amount, 300);
  assert.equal(signed(-0.02), "0.0");
  assert.equal(signed(-0.06), "−0.1");
});

/* 정가에는 등락을 붙이지 않는다. 퍼센트를 붙이면 정가 복귀가 가격 인상으로 읽힌다 —
   2026-09-21 오전에 실제로 "▲ +8.7%" 가 세 시간 넘게 떠 있었다. */
test("그날 확정가가 없으면 정가로 본다 — 등락을 감추는 기준", async () => {
  const { isListPriceAt, isListPriceDay } = await import("../lib/bread-market/engine.ts");
  // 행이 있는 날
  assert.equal(isListPriceAt(b, "2026-09-18", "am"), false);
  // 행이 없는 날 → 정가
  assert.equal(isListPriceAt(b, "2026-09-30", "am"), true);
  assert.equal(isListPriceDay("2026-09-30", "am"), true);
});

test("로컬 시드 미리보기는 실시세가 일부 있어도 정가로 떨어지지 않는다", async () => {
  const { isListPriceAt, priceSlotAt, quoteAt, setSeedPricePreview } = await import("../lib/bread-market/engine.ts");
  setSeedPricePreview(true);
  try {
    assert.equal(isListPriceAt(b, "2026-09-30", "pm"), false);
    assert.equal(priceSlotAt(b, "2026-09-30", "pm"), "pm");
    assert.notEqual(quoteAt(b, "2026-09-30", "pm").price, b.base);
  } finally {
    setSeedPricePreview(false);
  }
});

test("02:00~05:59 정가 시간은 행이 있어도 정가다", async () => {
  const { isListPriceAt } = await import("../lib/bread-market/engine.ts");
  assert.equal(isListPriceAt(b, "2026-09-18", "list"), true);
});
