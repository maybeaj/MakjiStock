import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedCouponPct,
  INSTANT_REWARD_MAX_PCT,
  INSTANT_REWARD_MIN_PCT,
  INSTANT_CODE_HOURS,
  PREDICTION_CODE_HOURS,
  PREDICTION_REWARD_MAX_PCT,
  PREDICTION_REWARD_MIN_PCT,
  instantRewardPct,
  INSTANT_REWARD_PCTS,
  rollPredictionRewardPct,
  rewardPctFor,
  instantCodeValidUntil,
  predictionCodeValidUntil,
  lockOpensOn,
  couponAmountWon,
  effectiveDiscountPct,
  finalCouponPct,
  lockAppliedPriceWon,
  lockCodeAmountWon,
  lockProtection,
  resolveDirection,
  rewardMessage,
  sessionOfHour,
  isPublicAt,
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

test("정액 코드 금액은 판매가 기준 10원 내림이고 실효 할인 38%를 넘지 않는다", () => {
  for (const base of [1500, 3800, 4500, 11000, 21000]) {
    for (let price = Math.round(base * 0.62 / 10) * 10; price <= base * 1.28; price += 10) {
      for (const rate of [5, 15, 20]) {
        const amount = couponAmountWon(rate, price, base);
        assert.equal(amount % 10, 0);
        assert.ok(amount <= price * rate / 100 + 1e-9, `${base}/${price}/${rate} 가 판매가의 ${rate}% 를 넘는다`);
        assert.ok(effectiveDiscountPct(price - amount, base) <= 38 + 1e-9, `${base}/${price}/${rate}`);
      }
    }
  }
  // 지금 붙어 있는 판매가에 곱한다 — 상품이 싸진 만큼 쿠폰도 같이 작아진다
  assert.equal(couponAmountWon(5, 4050, 4500), 200); // 모닝롤 4,050 의 5%
  assert.equal(couponAmountWon(5, 9900, 11000), 490); // 테트리스 9,900 의 5%
  assert.equal(couponAmountWon(5, 1360, 1500), 60); // 머핀 1,360 의 5%
  assert.equal(couponAmountWon(5, 6500, 10000), 190); // 35% 할인 중 → 3%p 로 잘리고 6,500 의 3%
});

/* 정가에 곱하던 때는 실효 할인이 딱 38% 에 닿았다. 판매가에 곱하면 두 할인이
   곱으로 쌓여 늘 그 아래에서 멈춘다 — (1−d)(1−r) ≥ 1−d−r. */
test("쿠폰은 판매가 기준이라 상한에 닿기 전에 멈춘다", () => {
  const base = 10000, sale = 8000; // 20% 할인 중 → 쿠폰 여력 18%p
  const amount = couponAmountWon(18, sale, base);
  assert.equal(amount, 1440); // 8,000 의 18%
  const eff = effectiveDiscountPct(sale - amount, base);
  assert.ok(eff < 38, `${eff}% — 곱으로 쌓이면 38% 에 못 미친다`);
  assert.ok(eff > 30, `${eff}% — 그렇다고 너무 적게 주지는 않는다`);
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

test("예측 코드는 발급 시각부터 24시간", () => {
  assert.equal(PREDICTION_CODE_HOURS, 24);
  assert.equal(
    predictionCodeValidUntil("2026-09-20T05:10:00.000Z"),
    "2026-09-21T05:10:00.000Z",
  );
});

/* 기준이 판정일이 아니라 발급 시각이어야 한다. 밀린 판정을 뒤늦게 따라잡을 때
   이미 지나간 만료 시각이 붙으면 발급 즉시 죽은 코드가 나간다. */
test("밀린 판정을 따라잡아도 만료가 미래다", () => {
  const 발급 = "2026-09-20T05:10:00.000Z"; // 09-18 분을 이틀 늦게 판정
  assert.ok(new Date(predictionCodeValidUntil(발급)) > new Date(발급));
});

test("서머타임·월말이 없어도 24시간은 그냥 24시간", () => {
  assert.equal(predictionCodeValidUntil("2026-09-30T16:00:00.000Z"), "2026-10-01T16:00:00.000Z");
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

/* 주말은 외환시장이 쉬어 오후가가 없다. 보호할 가격 변동이 없으므로 잠금을 받지 않는다. */
test("잠금은 평일에만 열린다", () => {
  assert.equal(lockOpensOn("2026-09-18"), true);  // 금
  assert.equal(lockOpensOn("2026-09-19"), false); // 토
  assert.equal(lockOpensOn("2026-09-20"), false); // 일
  assert.equal(lockOpensOn("2026-09-21"), true);  // 월
});

/* 안정형은 고르기 전에 숫자를 보여주므로 흔들리면 안 된다 — 요청마다 새로 뽑으면
   화면에 보인 값과 저장되는 값이 갈리고, 최댓값이 나올 때까지 새로고침할 수 있다. */
test("안정형은 같은 회차·같은 장이면 언제 물어도 같은 값", () => {
  for (const session of ["am", "pm"]) {
    const a = instantRewardPct("2026-09-21-am", session);
    assert.equal(instantRewardPct("2026-09-21-am", session), a);
    assert.equal(instantRewardPct("2026-09-21-am", session), a);
  }
});

test("안정형은 그 장의 표 안에서만 나오고 표의 값을 다 쓴다", () => {
  for (const session of ["am", "pm"]) {
    const table = INSTANT_REWARD_PCTS[session];
    const seen = new Set();
    for (let d = 1; d <= 28; d += 1) {
      const pct = instantRewardPct(`2026-09-${String(d).padStart(2, "0")}-am`, session);
      assert.ok(table.includes(pct), `${session} 장에 ${pct}% — 표(${table}) 밖이다`);
      seen.add(pct);
    }
    assert.equal(seen.size, table.length, `${session} 장: 28회차에 ${seen.size}종만 나왔다 — 한쪽으로 쏠린다`);
  }
});

/* 오전에 오는 쪽이 더 받아야 "오후까지 미룰 이유가 없다" 가 성립한다.
   두 표는 7% 에서 맞닿는다 — 오전 최소가 오후 최대보다 낮지만 않으면 된다. */
test("안정형은 오전장이 오후장보다 후하다", () => {
  const 오전최소 = Math.min(...INSTANT_REWARD_PCTS.am);
  const 오후최대 = Math.max(...INSTANT_REWARD_PCTS.pm);
  assert.ok(오전최소 >= 오후최대, `오전 최소 ${오전최소}% 가 오후 최대 ${오후최대}% 보다 낮다`);
});

/* 화면 문구가 쓰는 전체 폭은 표에서 나온다. 표만 고치면 문구가 따라와야 한다. */
test("전체 폭은 두 장의 표를 합친 값이다", () => {
  assert.equal(INSTANT_REWARD_MIN_PCT, Math.min(...INSTANT_REWARD_PCTS.am, ...INSTANT_REWARD_PCTS.pm));
  assert.equal(INSTANT_REWARD_MAX_PCT, Math.max(...INSTANT_REWARD_PCTS.am, ...INSTANT_REWARD_PCTS.pm));
});

/* 공격형은 걸 때 보이지 않으므로 사람마다 달라도 되고, 다시 뽑게 만들 방법도 없다. */
test("공격형은 5~13% 안에서 매번 새로 뽑는다", () => {
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    const pct = rollPredictionRewardPct();
    assert.ok(pct >= PREDICTION_REWARD_MIN_PCT && pct <= PREDICTION_REWARD_MAX_PCT, `${pct} 가 범위 밖`);
    assert.equal(pct, Math.trunc(pct));
    seen.add(pct);
  }
  assert.equal(seen.size, PREDICTION_REWARD_MAX_PCT - PREDICTION_REWARD_MIN_PCT + 1, "범위를 다 쓰지 않는다");
});

/* 안정형이 공격형 기대값보다 높아야 "미루지 말고 지금" 이 성립한다.
   공격형 기대값 = 평균 보상률 × 적중 확률(실측 52.1%). */
test("안정형이 공격형 기대값보다 높다 — 두 장 모두", () => {
  const 공격 = ((PREDICTION_REWARD_MIN_PCT + PREDICTION_REWARD_MAX_PCT) / 2) * 0.521;
  for (const session of ["am", "pm"]) {
    const table = INSTANT_REWARD_PCTS[session];
    const 안정 = table.reduce((sum, v) => sum + v, 0) / table.length;
    assert.ok(안정 > 공격, `${session} 안정 ${안정}% vs 공격 ${공격.toFixed(1)}% — 미루는 쪽이 이득이면 기획이 뒤집힌다`);
  }
});

/* 약속한 보상률은 적중·무승부에만 준다. 빗나가면 0 이다. */
test("판정은 제출 때 약속한 값을 쓴다", () => {
  assert.equal(rewardPctFor("hit", 17), 17);
  assert.equal(rewardPctFor("void", 17), 17);
  assert.equal(rewardPctFor("miss", 17), 0);
});

test("공개 시각: 오후가는 16:00 전에 내보내지 않는다", () => {
  const d = "2026-09-22";
  // 오후가 크론은 15시대 아무 때나 돈다 — 그때 이미 DB 에 있다.
  assert.equal(isPublicAt(d, "pm", { date: d, hour: 15 }), false);
  assert.equal(isPublicAt(d, "pm", { date: d, hour: 16 }), true);
  // 오전가도 같다. 크론은 05시대에 돈다.
  assert.equal(isPublicAt(d, "am", { date: d, hour: 5 }), false);
  assert.equal(isPublicAt(d, "am", { date: d, hour: 6 }), true);
  // 00~01시는 시장 시계의 24·25시 — 전날 오후가가 보호 구간 끝까지 공개된다.
  assert.equal(isPublicAt(d, "pm", { date: d, hour: 25 }), true);
  // 지난 날짜는 늘 공개, 앞선 날짜는 늘 비공개.
  assert.equal(isPublicAt("2026-09-21", "pm", { date: d, hour: 7 }), true);
  assert.equal(isPublicAt("2026-09-23", "am", { date: d, hour: 7 }), false);
});

/* 안정형은 그 자리에서 받고 그 자리에서 쓰라는 쿠폰이라 3시간으로 끊는다.
   공격형은 내일 06:00 판정을 보고 와야 하므로 하루를 준다. */
test("안정형 쿠폰은 발급 시각 + 3시간", () => {
  assert.equal(INSTANT_CODE_HOURS, 3);
  assert.equal(instantCodeValidUntil("2026-09-22T05:10:00.000Z"), "2026-09-22T08:10:00.000Z");
  // 날짜를 넘겨도 시각만 더한다
  assert.equal(instantCodeValidUntil("2026-09-22T22:30:00.000Z"), "2026-09-23T01:30:00.000Z");
});

test("안정형이 공격형보다 짧다", () => {
  const 발급 = "2026-09-22T05:00:00.000Z";
  assert.ok(
    new Date(instantCodeValidUntil(발급)) < new Date(predictionCodeValidUntil(발급)),
    "안정형이 더 길면 '지금 바로' 라고 말할 이유가 없다",
  );
});
