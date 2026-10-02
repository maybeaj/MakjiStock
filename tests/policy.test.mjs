import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_POLICY, checkPolicy, describePolicyChanges, nextVersion, pctTable } from "../lib/bread-market/policy.ts";
import { couponAmountWon, instantRewardPct, rollPredictionRewardPct } from "../lib/bread-market/reward-policy.ts";

test("대비 정책은 설정 파일·010 마이그레이션의 v1.4 와 같다", async () => {
  const config = JSON.parse(await readFile(new URL("../config/pricing-products.json", import.meta.url), "utf8"));
  const { formulaVersion, dailyPriceMoveCapPct, ...formula } = config.pricing;
  assert.equal(DEFAULT_POLICY.version, formulaVersion);
  assert.equal(dailyPriceMoveCapPct, null);
  assert.deepEqual(DEFAULT_POLICY.formula, formula);
  const sql = await readFile(new URL("../supabase/migrations/010_pricing_versions.sql", import.meta.url), "utf8");
  const seeded = JSON.parse(sql.match(/'(\{"fxWeight".*?\})'/)[1]);
  delete seeded.dailyPriceMoveCapPct;
  assert.deepEqual(seeded, formula);
  assert.deepEqual(JSON.parse(sql.match(/'(\{"instantAm".*?\})'/)[1]), DEFAULT_POLICY.coupons);
});

test("지금 운영값은 저장 전 검사를 모두 통과한다", () => {
  for (const c of checkPolicy(DEFAULT_POLICY)) assert.ok(c.ok, c.text);
});

test("저장 전 검사는 한도·순서·범위 위반을 잡는다", () => {
  const bad = (patch) => {
    const p = structuredClone(DEFAULT_POLICY);
    patch(p);
    return checkPolicy(p).some((c) => !c.ok);
  };
  assert.ok(bad((p) => (p.formula.discountCapPct = 26))); // 26 + 13 > 38
  assert.ok(bad((p) => (p.coupons.instantAm.max = 13))); // 안정형 최대 = 공격형 최대
  assert.ok(bad((p) => (p.formula.discountFloorPct = -5))); // 정가 초과
  assert.ok(bad((p) => (p.coupons.instantPm = { min: 8, max: 6 })));
  assert.ok(bad((p) => (p.coupons.prediction.min = 2.5)));
  assert.ok(bad((p) => (p.formula.searchWeight = Number.NaN)));
  assert.ok(!bad((p) => ((p.formula.discountCapPct = 24), (p.coupons.prediction.max = 14))));
});

test("버전 번호와 변경 설명", () => {
  assert.equal(nextVersion("v1.4"), "v1.5");
  assert.equal(nextVersion("v1.9"), "v1.10");
  const next = structuredClone(DEFAULT_POLICY);
  next.formula.discountCapPct = 24;
  next.formula.fxWeight = 12 / 50;
  next.coupons.prediction = { min: 5, max: 14 };
  const d = describePolicyChanges(DEFAULT_POLICY, next);
  assert.deepEqual(d.formula, ["상품 할인 상한 25% → 24%", "환율 배율 14 → 12"]);
  assert.deepEqual(d.coupons, ["공격형 5~13% → 5~14%"]);
});

test("쿠폰 함수는 넘겨받은 정책을 따른다", () => {
  const p = structuredClone(DEFAULT_POLICY);
  p.coupons.instantAm = { min: 3, max: 4 };
  p.coupons.prediction = { min: 20, max: 20 };
  for (let i = 0; i < 50; i += 1) {
    assert.ok(pctTable(p.coupons.instantAm).includes(instantRewardPct(`2026-10-${10 + (i % 18)}-am`, "am", p)));
    assert.equal(rollPredictionRewardPct(p), 20);
  }
  // 상품 할인 상한을 20% 로 낮추면 쿠폰 천장은 정가의 18%
  assert.equal(couponAmountWon(30, 10000, 10000, 20), 1800);
  assert.equal(couponAmountWon(30, 10000, 10000), 1300);
});

test("상한을 낮춘 날 옛 상한으로 나간 가격 위에도 쿠폰이 38% 를 넘지 않는다", () => {
  // 06:00 에 25% 할인(7,500원)으로 나갔고, 10:00 에 상한 20% · 공격형 최대 18% 로 바뀌었다
  for (const rate of [5, 12, 17, 18]) {
    const amount = couponAmountWon(rate, 7500, 10000, 20);
    assert.ok((1 - (7500 - amount) / 10000) * 100 <= 38 + 1e-9, `${rate}% → ${amount}원`);
  }
  assert.equal(couponAmountWon(18, 7500, 10000, 20), 1300); // 판매가 쪽 천장 7,500 − 6,200
  assert.equal(couponAmountWon(5, 6000, 10000, 20), 0); // 이미 40% 할인된 가격엔 쿠폰을 안 얹는다
});
