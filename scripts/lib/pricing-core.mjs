import { calculateDay } from "../../lib/pricing/pricing.mjs";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value, unit = 10) {
  return Math.round(value / unit) * unit;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateRange(startDate, endDate) {
  const dates = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/* 산식은 lib/pricing/pricing.mjs 한 곳에만 둔다 — 서버·백테스트·시뮬레이션이 같은 결과를 내야 한다. */
export function calculateDiscountPct({ searchRatio, fxDeclinePct, pricing }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { priceWon, ...rest } = calculateDay({ searchRatio, fxDeclinePct, basePriceWon: 0, pricing });
  return rest;
}

export function calculatePriceWon(basePriceWon, discountPct, roundingWon = 10) {
  return roundTo(basePriceWon * (1 - discountPct / 100), roundingWon);
}

export function buildFxSignals(fxRatesByDate, signalDates) {
  const publishedRates = Object.entries(fxRatesByDate)
    .filter(([, rate]) => Number.isFinite(rate) && rate > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  return Object.fromEntries(
    signalDates.map((signalDate) => {
      const available = publishedRates.filter(([date]) => date <= signalDate);
      if (available.length < 2) return [signalDate, null];

      const [previousDate, previousRate] = available.at(-2);
      const [currentDate, currentRate] = available.at(-1);
      const fxDeclinePct = ((previousRate - currentRate) / previousRate) * 100;

      return [
        signalDate,
        {
          previousDate,
          currentDate,
          previousRate,
          currentRate,
          fxDeclinePct,
          carriedForward: currentDate !== signalDate,
        },
      ];
    }),
  );
}

export function simulateProduct({
  product,
  pricing,
  signalDates,
  searchRatioByDate,
  fxSignalsByDate,
}) {
  let previousPriceWon = null;

  return signalDates.map((signalDate) => {
    const searchRatio = searchRatioByDate[signalDate];
    const previousSearchRatio = searchRatioByDate[addDays(signalDate, -1)];
    const searchChangePoint =
      Number.isFinite(searchRatio) && Number.isFinite(previousSearchRatio)
        ? searchRatio - previousSearchRatio
        : null;
    const fxSignal = fxSignalsByDate[signalDate];
    const complete = Number.isFinite(searchRatio) && fxSignal !== null;

    if (!complete) {
      return {
        signalDate,
        publishDate: addDays(signalDate, 1),
        productId: product.id,
        ticker: product.ticker,
        productName: product.name,
        basePriceWon: product.basePriceWon,
        status: previousPriceWon === null ? "unavailable" : "held",
        reason: !Number.isFinite(searchRatio) ? "missing-search" : "missing-fx",
        priceWon: previousPriceWon,
        previousPriceWon,
        priceChangePct: previousPriceWon === null ? null : 0,
      };
    }

    const discount = calculateDiscountPct({
      searchRatio,
      fxDeclinePct: fxSignal.fxDeclinePct,
      pricing,
    });
    const targetPriceWon = calculatePriceWon(
      product.basePriceWon,
      discount.discountPct,
      pricing.priceRoundingWon,
    );
    let priceWon = targetPriceWon;
    let dailyMoveCapped = false;
    if (previousPriceWon !== null && Number.isFinite(pricing.dailyPriceMoveCapPct)) {
      const lower =
        Math.ceil(
          (previousPriceWon * (1 - pricing.dailyPriceMoveCapPct / 100)) /
            pricing.priceRoundingWon,
        ) * pricing.priceRoundingWon;
      const upper =
        Math.floor(
          (previousPriceWon * (1 + pricing.dailyPriceMoveCapPct / 100)) /
            pricing.priceRoundingWon,
        ) * pricing.priceRoundingWon;
      priceWon = clamp(targetPriceWon, lower, upper);
      dailyMoveCapped = priceWon !== targetPriceWon;
    }
    const priceChangePct =
      previousPriceWon === null
        ? null
        : ((priceWon - previousPriceWon) / previousPriceWon) * 100;

    const row = {
      signalDate,
      publishDate: addDays(signalDate, 1),
      productId: product.id,
      ticker: product.ticker,
      productName: product.name,
      basePriceWon: product.basePriceWon,
      status: "calculated",
      searchRatio,
      previousSearchRatio,
      searchChangePoint,
      fxDeclinePct: fxSignal.fxDeclinePct,
      fxRateDate: fxSignal.currentDate,
      fxRate: fxSignal.currentRate,
      fxCarriedForward: fxSignal.carriedForward,
      ...discount,
      targetPriceWon,
      priceWon,
      dailyMoveCapped,
      previousPriceWon,
      priceChangePct,
    };

    previousPriceWon = priceWon;
    return row;
  });
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function round(value, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function summarizeKeywordSeries(keyword, ratioByDate, expectedDates) {
  const values = expectedDates.map((date) => ratioByDate[date] ?? null);
  const observed = values.filter(Number.isFinite);
  const nonZero = observed.filter((value) => value > 0);
  const consecutiveChanges = [];

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      consecutiveChanges.push(Math.abs(current - previous));
    }
  }

  const coveragePct = (observed.length / expectedDates.length) * 100;
  const nonZeroPct = (nonZero.length / expectedDates.length) * 100;
  const uniqueCount = new Set(observed.map((value) => value.toFixed(4))).size;
  const flatPct =
    consecutiveChanges.length === 0
      ? 100
      : (consecutiveChanges.filter((value) => value === 0).length /
          consecutiveChanges.length) *
        100;

  let grade = "sparse";
  if (coveragePct >= 90 && uniqueCount >= 12 && flatPct <= 75) grade = "strong";
  else if (coveragePct >= 60 && uniqueCount >= 6 && flatPct <= 90) grade = "usable";

  return {
    keyword,
    grade,
    coveragePct: round(coveragePct),
    nonZeroPct: round(nonZeroPct),
    uniqueCount,
    flatPct: round(flatPct),
    medianAbsPointChange: round(percentile(consecutiveChanges, 0.5), 4),
    p95AbsPointChange: round(percentile(consecutiveChanges, 0.95), 4),
    maxRatio: round(observed.length ? Math.max(...observed) : null, 4),
  };
}

export function summarizeSimulation(rows, pricing) {
  const calculated = rows.filter((row) => row.status === "calculated");
  const changes = calculated
    .map((row) => row.priceChangePct)
    .filter(Number.isFinite);
  const discounts = calculated.map((row) => row.discountPct);

  return {
    observations: rows.length,
    calculated: calculated.length,
    held: rows.filter((row) => row.status === "held").length,
    unavailable: rows.filter((row) => row.status === "unavailable").length,
    upDays: changes.filter((value) => value > 0).length,
    downDays: changes.filter((value) => value < 0).length,
    flatDays: changes.filter((value) => value === 0).length,
    meanAbsDailyPriceChangePct: round(
      changes.length
        ? changes.reduce((sum, value) => sum + Math.abs(value), 0) / changes.length
        : null,
    ),
    p95AbsDailyPriceChangePct: round(
      percentile(changes.map(Math.abs), 0.95),
    ),
    maxAbsDailyPriceChangePct: round(
      changes.length ? Math.max(...changes.map(Math.abs)) : null,
    ),
    meanDiscountPct: round(
      discounts.length
        ? discounts.reduce((sum, value) => sum + value, 0) / discounts.length
        : null,
    ),
    capHits: discounts.filter((value) => value === pricing.discountCapPct).length,
    surchargeCount: discounts.filter((value) => value < 0).length,
    fxDiscountCapHits: calculated.filter(
      (row) => row.fxAdjustmentPct === pricing.fxDiscountCapPct,
    ).length,
    fxSurchargeCapHits: calculated.filter(
      (row) => row.fxAdjustmentPct === -pricing.fxSurchargeCapPct,
    ).length,
    minPriceWon: calculated.length
      ? Math.min(...calculated.map((row) => row.priceWon))
      : null,
    maxPriceWon: calculated.length
      ? Math.max(...calculated.map((row) => row.priceWon))
      : null,
  };
}
