import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFxSignals,
  calculateDiscountPct,
  calculatePriceWon,
  simulateProduct,
} from "../scripts/lib/pricing-core.mjs";

const pricing = {
  fxWeight: 0.28,
  searchWeight: 0.1,
  fxScale: 50,
  fxDiscountCapPct: 28,
  fxSurchargeCapPct: 28,
  discountCapPct: 38,
  priceRoundingWon: 10,
};

test("검색 절댓값과 환율 조정으로 계산하고 38% 할인으로 제한한다", () => {
  assert.deepEqual(
    calculateDiscountPct({ searchRatio: 80, fxDeclinePct: 0.5, pricing }),
    {
      searchCouponPct: 8,
      fxRawAdjustmentPct: 7.000000000000001,
      fxAdjustmentPct: 7.000000000000001,
      rawDiscountPct: 15,
      discountPct: 15,
    },
  );
  assert.equal(
    calculateDiscountPct({ searchRatio: 100, fxDeclinePct: 3, pricing })
      .discountPct,
    38,
  );
});

test("환율 할증 조정은 -28%p에서 제한하고 검색 쿠폰을 더한다", () => {
  const result = calculateDiscountPct({
    searchRatio: 50,
    fxDeclinePct: -3,
    pricing,
  });
  assert.equal(result.fxAdjustmentPct, -28);
  assert.equal(result.discountPct, -23);
});

test("판매가는 10원 단위로 반올림한다", () => {
  assert.equal(calculatePriceWon(1234, 0, 10), 1230);
  assert.equal(calculatePriceWon(1235, 0, 10), 1240);
});

test("주말·공휴일에는 환율 하락률을 금요일 종가 기준으로 이월한다", () => {
  const signals = buildFxSignals(
    { "2026-09-10": 1400, "2026-09-11": 1393 },
    ["2026-09-11", "2026-09-12", "2026-09-13"],
  );
  assert.equal(signals["2026-09-11"].fxDeclinePct, 0.5);
  assert.equal(signals["2026-09-12"].fxDeclinePct, 0.5);
  assert.equal(signals["2026-09-12"].carriedForward, true);
  assert.equal(signals["2026-09-13"].carriedForward, true);
});

test("가격은 기준가에서 매일 재계산하고 직전 확정 가격 대비 등락률을 만든다", () => {
  const rows = simulateProduct({
    product: {
      id: "sample",
      ticker: "SMP",
      name: "샘플",
      basePriceWon: 4500,
    },
    pricing,
    signalDates: ["2026-09-10", "2026-09-11"],
    searchRatioByDate: {
      "2026-09-09": 45,
      "2026-09-10": 50,
      "2026-09-11": 40,
    },
    fxSignalsByDate: {
      "2026-09-10": {
        fxDeclinePct: 0.5,
        currentDate: "2026-09-10",
        currentRate: 1393,
        carriedForward: false,
      },
      "2026-09-11": {
        fxDeclinePct: 0,
        currentDate: "2026-09-11",
        currentRate: 1393,
        carriedForward: false,
      },
    },
  });
  assert.equal(rows[0].priceWon, 3960);
  assert.equal(rows[0].publishDate, "2026-09-11");
  assert.equal(rows[1].priceWon, 4320);
  assert.ok(rows[1].priceChangePct > 0);
});

test("선택한 경우에만 전일 대비 가격 변동을 제한한다", () => {
  const rows = simulateProduct({
    product: {
      id: "sample",
      ticker: "SMP",
      name: "샘플",
      basePriceWon: 10000,
    },
    pricing: { ...pricing, dailyPriceMoveCapPct: 5 },
    signalDates: ["2026-09-10", "2026-09-11"],
    searchRatioByDate: {
      "2026-09-09": 0,
      "2026-09-10": 0,
      "2026-09-11": 100,
    },
    fxSignalsByDate: {
      "2026-09-10": {
        fxDeclinePct: 0,
        currentDate: "2026-09-10",
        currentRate: 1400,
        carriedForward: false,
      },
      "2026-09-11": {
        fxDeclinePct: 2,
        currentDate: "2026-09-11",
        currentRate: 1372,
        carriedForward: false,
      },
    },
  });
  assert.equal(rows[0].priceWon, 10000);
  assert.equal(rows[1].targetPriceWon, 6200);
  assert.equal(rows[1].priceWon, 9500);
  assert.equal(rows[1].dailyMoveCapped, true);
});

test("v1.0 산식: 환율이 내리면 ×14, 오르면 ×7 만 반영하고 정가를 넘지 않는다", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(await readFile(new URL("../config/pricing-products.json", import.meta.url), "utf8"));
  const { calculateDay } = await import("../lib/pricing/pricing.mjs");
  const p = config.pricing;
  // 검색 60 (9%) · 환율 0.5% 하락 → +7%p → 16%
  assert.equal(calculateDay({ searchRatio: 60, fxDeclinePct: 0.5, basePriceWon: 10000, pricing: p }).discountPct.toFixed(2), "16.00");
  // 검색 60 (9%) · 환율 0.5% 상승 → −3.5%p (절반만) → 5.5%
  assert.equal(calculateDay({ searchRatio: 60, fxDeclinePct: -0.5, basePriceWon: 10000, pricing: p }).discountPct.toFixed(2), "5.50");
  // 검색 0 · 환율 크게 상승 → 정가에서 멈춤
  assert.equal(calculateDay({ searchRatio: 0, fxDeclinePct: -3, basePriceWon: 3800, pricing: p }).priceWon, 3800);
  // 합계 상한 38%
  assert.equal(calculateDay({ searchRatio: 100, fxDeclinePct: 5, basePriceWon: 10000, pricing: p }).priceWon, 6200);
});
