import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedCouponPct,
  codeExpiry,
  couponAmountWon,
  effectiveDiscountPct,
  finalCouponPct,
  lockAppliedPriceWon,
  lockCodeAmountWon,
  lockProtection,
  resolveDirection,
  rewardMessage,
  sessionOfHour,
} from "../lib/bread-market/reward-policy.ts";

test("세션: 06–15 오전장, 16–23 오후장, 00–05 정가", () => {
  assert.equal(sessionOfHour(6), "am");
  assert.equal(sessionOfHour(15), "am");
  assert.equal(sessionOfHour(16), "pm");
  assert.equal(sessionOfHour(23), "pm");
  assert.equal(sessionOfHour(0), "pm"); // 오후장은 01:59 까지
  assert.equal(sessionOfHour(1), "pm");
  assert.equal(sessionOfHour(25), "pm"); // 시장 시계의 01시
  assert.equal(sessionOfHour(2), "list");
  assert.equal(sessionOfHour(5), "list");
});

test("허용 쿠폰율 = 38 − D (정가 기준 %p)", () => {
  assert.equal(allowedCouponPct(6500, 10000), 3); // 할인 35% → 쿠폰 3%p 까지
  assert.equal(finalCouponPct(5, 9200, 10000), 5);
  assert.equal(finalCouponPct(5, 6500, 10000), 3);
  assert.equal(finalCouponPct(5, 6200, 10000), 0); // 이미 38%
});

test("정액 코드 금액은 정가 기준 10원 내림이고 실효 할인 38%를 넘지 않는다", () => {
  for (const base of [1500, 3800, 4500, 11000, 21000]) {
    for (let price = Math.round(base * 0.62 / 10) * 10; price <= base * 1.28; price += 10) {
      for (const rate of [5]) {
        const amount = couponAmountWon(rate, price, base);
        assert.equal(amount % 10, 0);
        assert.ok(amount <= base * rate / 100 + 1e-9);
        assert.ok(effectiveDiscountPct(price - amount, base) <= 38 + 1e-9, `${base}/${price}/${rate}`);
      }
    }
  }
  // 정가 기준이라 빵마다 금액이 고정된다
  assert.equal(couponAmountWon(5, 4050, 4500), 220); // 모닝롤
  assert.equal(couponAmountWon(5, 9900, 11000), 550); // 테트리스
  assert.equal(couponAmountWon(5, 1360, 1500), 70); // 머핀
  assert.equal(couponAmountWon(5, 6500, 10000), 300); // 35% 할인 중 → 3%p 만
});

test("예측 판정과 메시지", () => {
  assert.equal(resolveDirection("up", 3000, 3100), "hit");
  assert.equal(resolveDirection("down", 3000, 3100), "miss");
  assert.equal(resolveDirection("up", 3000, 3000), "void");
  assert.equal(rewardMessage("hit").title, "예측 적중!");
  assert.equal(rewardMessage("miss").ratePct, 0);
  assert.equal(rewardMessage("void").ratePct, 5);
  assert.equal(rewardMessage("hit").ratePct, 5);
});

test("예측 코드는 오후장 끝(다음 날 01:59)까지 — 저녁 구매자가 쓸 수 있다", () => {
  assert.deepEqual(codeExpiry(), { dayOffset: 1, time: "01:59", label: "새벽 01:59까지" });
});

test("잠금: 오전장에만, 오후장(~01:59)에 보호, 하락 시 현재가", () => {
  assert.equal(lockProtection("am")?.protectSession, "pm");
  assert.equal(lockProtection("am")?.until, "01:59");
  assert.equal(lockProtection("pm"), null);
  assert.equal(lockProtection("list"), null);
  assert.equal(lockAppliedPriceWon(3000, 3200), 3000);
  assert.equal(lockAppliedPriceWon(3000, 2800), 2800);
  assert.equal(lockCodeAmountWon(3000, 3200), 200);
  assert.equal(lockCodeAmountWon(3000, 2800), 0);
});
