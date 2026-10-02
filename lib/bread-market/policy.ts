import type { PricingConfig } from "../pricing/pricing.mjs";

/* ══════════════════════════════════════════════════════════
   운영 정책 한 벌 — 산식(상품 할인) + 쿠폰 보상률.
   정본은 DB pricing_versions 의 가장 최근 행이다 (어드민 /admin/pricing 에서 저장).
   여기 DEFAULT_POLICY 는 DB 를 못 읽을 때만 쓰는 대비값이고, 010 마이그레이션의 첫 행(v1.4)과 같다.

   서버·화면·테스트가 같이 쓰는 순수 함수만 둔다. DB 읽기는 policy-server.ts.
   ══════════════════════════════════════════════════════════ */

/** 쿠폰과 상품 할인을 합친 주문당 최대 할인(%). 정책의 바깥 한도라 어드민에서 바꾸지 않는다. */
export const TOTAL_CAP_PCT = 38;

export type PctRange = { min: number; max: number };

export type CouponPolicy = {
  /** 안정형 · 오전장 제출 */
  instantAm: PctRange;
  /** 안정형 · 오후장 제출 */
  instantPm: PctRange;
  /** 공격형 */
  prediction: PctRange;
};

export type Policy = {
  version: string;
  formula: PricingConfig;
  coupons: CouponPolicy;
};

/* config/pricing-products.json(백테스트 스크립트가 읽는 값)과 같아야 한다 — tests/policy.test.mjs 가 지킨다.
   JSON 을 직접 import 하지 않는 건 node --test 가 이 파일을 그대로 읽기 때문이다. */
export const DEFAULT_POLICY: Policy = {
  version: "v1.4",
  formula: {
    fxWeight: 0.28,
    searchWeight: 0.15,
    fxScale: 50,
    fxDiscountCapPct: 28,
    fxSurchargeCapPct: 28,
    fxRisePassThroughPct: 100,
    discountCapPct: 25,
    priceRoundingWon: 10,
    discountFloorPct: 0,
  },
  coupons: {
    instantAm: { min: 7, max: 10 },
    instantPm: { min: 5, max: 7 },
    prediction: { min: 5, max: 13 },
  },
};

/** 7~10 → [7, 8, 9, 10]. 안정형은 회차마다 이 표에서 하나를 뽑는다. */
export function pctTable(r: PctRange): number[] {
  const out: number[] = [];
  for (let p = r.min; p <= r.max; p += 1) out.push(p);
  return out;
}

export const rangeText = (r: PctRange) => (r.min === r.max ? `${r.min}%` : `${r.min}~${r.max}%`);

/** "오전장 7~10% · 오후장 5~7%" */
export function instantRangeLabel(c: CouponPolicy) {
  return `오전장 ${rangeText(c.instantAm)} · 오후장 ${rangeText(c.instantPm)}`;
}

/** v1.4 → v1.5. 형식이 다르면 뒤에 .1 을 붙인다. */
export function nextVersion(v: string) {
  const m = /^v(\d+)\.(\d+)$/.exec(v);
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : `${v}.1`;
}

export type PolicyCheck = { ok: boolean; text: string };

const isInt = (n: number) => Number.isInteger(n);
const between = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

/**
 * 저장 전 검사. 하나라도 실패하면 저장하지 않는다 — 어드민 화면과 서버 액션이 같은 함수를 쓴다.
 * 앞의 셋은 정책 불변식이고, 나머지는 값이 말이 되는지(범위·정수)다.
 */
export function checkPolicy(p: Pick<Policy, "formula" | "coupons">): PolicyCheck[] {
  const f = p.formula;
  const c = p.coupons;
  const ranges: [string, PctRange][] = [
    ["안정형 오전", c.instantAm],
    ["안정형 오후", c.instantPm],
    ["공격형", c.prediction],
  ];
  const instantMax = Math.max(c.instantAm.max, c.instantPm.max);
  const orderMax = f.discountCapPct + c.prediction.max;
  return [
    { ok: orderMax <= TOTAL_CAP_PCT, text: `주문당 최대 ${f.discountCapPct}% + ${c.prediction.max}% = ${orderMax}% (한도 ${TOTAL_CAP_PCT}%)` },
    { ok: instantMax < c.prediction.max, text: `안정형 최대 ${instantMax}% < 공격형 최대 ${c.prediction.max}%` },
    { ok: (f.discountFloorPct ?? 0) >= 0, text: "판매가는 정가를 넘지 않음 (할인 하한 ≥ 0)" },
    {
      ok: ranges.every(([, r]) => isInt(r.min) && isInt(r.max) && r.min >= 1 && r.min <= r.max && r.max <= TOTAL_CAP_PCT),
      text: "쿠폰 폭은 1% 이상 정수, 최소 ≤ 최대",
    },
    {
      ok:
        between(f.searchWeight, 0, 1) &&
        between(f.fxWeight * f.fxScale, 0, 100) &&
        between(f.fxDiscountCapPct, 0, TOTAL_CAP_PCT) &&
        between(f.fxSurchargeCapPct, 0, TOTAL_CAP_PCT) &&
        between(f.fxRisePassThroughPct ?? 100, 0, 100) &&
        between(f.discountCapPct, 0, TOTAL_CAP_PCT) &&
        between(f.discountFloorPct ?? 0, 0, f.discountCapPct),
      text: "산식 값이 허용 범위 안 (가중치 0~1, 배율 0~100, 상한 0~38%)",
    },
  ];
}

/** 두 정책의 차이를 사람이 읽는 줄로. 변경 기록에 남긴다. */
export function describePolicyChanges(before: Policy, after: Pick<Policy, "formula" | "coupons">) {
  const formula: string[] = [];
  const fields: [keyof PricingConfig, string, string][] = [
    ["searchWeight", "검색 가중치", ""],
    ["fxDiscountCapPct", "환율 할인 상한", "%p"],
    ["fxSurchargeCapPct", "환율 할증 상한", "%p"],
    ["fxRisePassThroughPct", "환율 상승 반영", "%"],
    ["discountCapPct", "상품 할인 상한", "%"],
    ["discountFloorPct", "상품 할인 하한", "%"],
  ];
  for (const [key, label, unit] of fields) {
    const a = before.formula[key];
    const b = after.formula[key];
    if (a !== b) formula.push(`${label} ${a ?? "없음"}${unit} → ${b ?? "없음"}${unit}`);
  }
  const multA = before.formula.fxWeight * before.formula.fxScale;
  const multB = after.formula.fxWeight * after.formula.fxScale;
  if (Math.abs(multA - multB) > 1e-9) formula.push(`환율 배율 ${round2(multA)} → ${round2(multB)}`);

  const coupons: string[] = [];
  const names: [keyof CouponPolicy, string][] = [
    ["instantAm", "안정형 오전"],
    ["instantPm", "안정형 오후"],
    ["prediction", "공격형"],
  ];
  for (const [key, label] of names) {
    const a = before.coupons[key];
    const b = after.coupons[key];
    if (a.min !== b.min || a.max !== b.max) coupons.push(`${label} ${rangeText(a)} → ${rangeText(b)}`);
  }
  return { formula, coupons };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
