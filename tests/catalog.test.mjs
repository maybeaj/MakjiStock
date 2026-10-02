import assert from "node:assert/strict";
import test from "node:test";
import { BREADS, breadOf, hydrateMarket } from "../lib/bread-market/engine.ts";

const db = (over = {}) =>
  ["MUF", "FNC", "SCN", "MRL", "TTR", "GFD"].map((tk) => ({
    ticker: tk,
    basePriceWon: 1000,
    active: true,
    displayName: null,
    fullName: null,
    photoUrl: null,
    ...(over[tk] ?? {}),
  }));
const quote = (ticker) => ({
  ticker, publishDate: "2026-10-01", session: "am", searchRatio: 50, searchDiscountPct: 7.5,
  fxDeclinePct: 0, fxDiscountPct: 0, discountPct: 7.5, basePriceWon: 1000, priceWon: 930, fxCurrentDate: "2026-09-30",
});
const quotesFor = (tks) => tks.map(quote);
const six = ["MUF", "FNC", "SCN", "MRL", "TTR", "GFD"];

test("멈춘 빵은 목록에서 빠지지만 breadOf 로는 찾는다", () => {
  hydrateMarket({ quotes: quotesFor(six), indexSeries: [], products: db({ SCN: { active: false } }) });
  assert.ok(!BREADS.some((b) => b.tk === "SCN"));
  assert.equal(breadOf("SCN").tk, "SCN");
  assert.equal(breadOf("SCN").name, "글루텐프리 스콘"); // DB 이름이 비면 코드 이름
});

test("새 빵은 첫 시세가 생겨야 목록에 나오고, DB 이름·사진을 쓴다", () => {
  const products = [...db(), { ticker: "BAG", basePriceWon: 3000, active: true, displayName: "베이글", fullName: "막지 베이글", photoUrl: "https://x/bag.jpg" }];
  hydrateMarket({ quotes: quotesFor(six), indexSeries: [], products });
  assert.ok(!BREADS.some((b) => b.tk === "BAG"));
  assert.equal(breadOf("BAG").name, "베이글");
  hydrateMarket({ quotes: quotesFor([...six, "BAG"]), indexSeries: [], products });
  const bag = BREADS.at(-1);
  assert.deepEqual([bag.tk, bag.name, bag.full, bag.photo, bag.base], ["BAG", "베이글", "막지 베이글", "https://x/bag.jpg", 3000]);
});

test("판매 중이 하나도 안 맞으면 목록을 비우지 않는다", () => {
  hydrateMarket({ quotes: quotesFor(six), indexSeries: [], products: db() });
  hydrateMarket({ quotes: quotesFor(six), indexSeries: [], products: db(Object.fromEntries(six.map((t) => [t, { active: false }]))) });
  assert.equal(BREADS.length, 6);
});
