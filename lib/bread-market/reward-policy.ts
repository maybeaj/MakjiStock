/* ══════════════════════════════════════════════════════════
   가격 잠금 · 예측 보상 정책 (PRD v0.6)
   - 세션: 오전장 06:00–15:59 · 오후장 16:00–다음 날 01:59 · 정가 02:00–05:59
   - 잠금: 오전장에만, 하루 1회, 빵 1개 (docs/가격-잠금-1회-사유.md)
   - 보상률: 예측이 틀리지만 않으면 5% (적중·가격 동일 5%, 빗나감 0%)
   - 쿠폰은 Cafe24 할인코드(정액)로 발급하고, 정가 대비 실효 할인 38%를 넘지 않게
     발급 시점 판매가로 min(R, 허용 쿠폰율)을 계산합니다.
   - 할인코드는 다음 가격 하락 가능 시점 전까지만 유효합니다.
   이 파일은 서버·클라이언트·테스트가 함께 쓰는 순수 함수만 둡니다.
   ══════════════════════════════════════════════════════════ */

export const TOTAL_CAP_PCT = 38;

export type Session = "am" | "pm" | "list";
export type Direction = "up" | "down";
export type Outcome = "hit" | "miss" | "void";

export const SESSION_LABEL: Record<Session, string> = {
  am: "오전장",
  pm: "오후장",
  list: "정가",
};

export const SESSION_RANGE: Record<Session, string> = {
  am: "06:00–15:59",
  pm: "16:00–01:59",
  list: "02:00–05:59",
};

/** KST 시로 가격 세션을 판정합니다. 00–01시(또는 시장 시계의 24–25시)는 전날 오후장입니다. */
export function sessionOfHour(hour: number): Session {
  if (hour >= 6 && hour < 16) return "am";
  if (hour >= 16 || hour < 2) return "pm";
  return "list";
}

export const REWARD_RATE_PCT: Record<Outcome, number> = { hit: 5, miss: 0, void: 5 };

/** 판매가 할인율 D(%) — 10원 반올림 후 실제 판매가로 다시 계산합니다. 할증이면 음수. */
export function saleDiscountPct(salePriceWon: number, basePriceWon: number) {
  return (1 - salePriceWon / basePriceWon) * 100;
}

/** 허용 쿠폰율(%p, 정가 기준) = 38 − D. 상품 할인과 쿠폰을 합쳐 정가의 38% 를 넘지 않는다. */
export function allowedCouponPct(salePriceWon: number, basePriceWon: number) {
  return Math.max(0, TOTAL_CAP_PCT - saleDiscountPct(salePriceWon, basePriceWon));
}

/** 최종 쿠폰율(%) = min(R, 허용 쿠폰율), 0.1% 단위 내림 */
export function finalCouponPct(ratePct: number, salePriceWon: number, basePriceWon: number) {
  const pct = Math.min(ratePct, allowedCouponPct(salePriceWon, basePriceWon));
  return Math.max(0, Math.floor(pct * 10 + 1e-9) / 10);
}

/**
 * 정액 할인코드 금액(원) — 정가 × 최종 쿠폰율, 10원 단위 내림.
 * 정가 기준이라 빵마다 금액이 고정된다(모닝롤 5% = 220원). 발급 시점 할인율이 높아
 * 합계가 38% 를 넘으면 그만큼 줄어든다. 결제가가 정가의 62% 아래로 내려가지 않게 한 번 더 보정한다.
 */
export function couponAmountWon(ratePct: number, salePriceWon: number, basePriceWon: number) {
  const pct = finalCouponPct(ratePct, salePriceWon, basePriceWon);
  let amount = Math.floor((basePriceWon * pct) / 100 / 10) * 10;
  const floorPrice = basePriceWon * (1 - TOTAL_CAP_PCT / 100);
  while (amount > 0 && salePriceWon - amount < floorPrice) amount -= 10;
  return Math.max(0, amount);
}

export function effectiveDiscountPct(payWon: number, basePriceWon: number) {
  return (1 - payWon / basePriceWon) * 100;
}

/** 예측 판정: 기준가와 결과가가 같으면 무효 */
export function resolveDirection(direction: Direction, referencePriceWon: number, resultPriceWon: number): Outcome {
  if (resultPriceWon === referencePriceWon) return "void";
  const rose = resultPriceWon > referencePriceWon;
  return (direction === "up") === rose ? "hit" : "miss";
}

/** 일반 예측 결과 메시지·배지. */
export function rewardMessage(outcome: Outcome) {
  const rate = REWARD_RATE_PCT[outcome];
  if (outcome === "void") return { badge: "무승부", title: "가격이 같아 무승부예요", ratePct: rate };
  if (outcome === "hit") return { badge: "적중", title: "예측 적중!", ratePct: rate };
  return { badge: "미적중", title: "아쉽게 빗나갔어요", ratePct: rate };
}

/**
 * 예측 할인코드 유효 종료 — 발급된 시장일의 오후장 끝(다음 날 새벽 01:59)까지.
 * 아침에 확인하고 저녁 늦게 사는 사람이 쓸 수 있어야 한다. 잠금 쿠폰과 끝나는 시각이 같다.
 * 오후 할인율이 올라 합계가 38% 를 살짝 넘는 드문 경우(3개월 기준 1.5% 미만)는 받아들인다.
 */
export function codeExpiry() {
  return { dayOffset: 1, time: "01:59", label: "새벽 01:59까지" };
}

/* ───────── 가격 잠금 ───────── */

/**
 * 잠금 보호 구간 — 잠금은 오전장에만 받습니다.
 * 오전가로 고정하고, 오후장(16:00–다음 날 01:59)에 오후가가 더 높으면 차액 쿠폰으로 잠금가를 맞춥니다.
 * 오후장·정가 시간에는 잠금을 받지 않습니다 — 다음에 올 가격이 정가로 정해져 있어 보호할 불확실성이 없습니다.
 */
export function lockProtection(lockSession: Session) {
  if (lockSession === "am") return { protectSession: "pm" as Session, label: "오늘 16:00–새벽 01:59", until: "01:59" };
  return null;
}

/** 잠금 적용가: 손해 보지 않도록 잠금가와 현재가 중 낮은 값 */
export function lockAppliedPriceWon(lockedPriceWon: number, currentPriceWon: number) {
  return Math.min(lockedPriceWon, currentPriceWon);
}

/** 잠금가 할인코드 금액: 현재가가 잠금가보다 높을 때만 차액. 낮으면 더 싼 현재가로 구매(코드 없음). */
export function lockCodeAmountWon(lockedPriceWon: number, currentPriceWon: number) {
  return Math.max(0, currentPriceWon - lockedPriceWon);
}

export const CONSUMER_REWARD_NOTICE =
  "예측이 틀리지만 않으면 5% 할인코드를 드려요. 상품 할인과 합쳐 최종 혜택은 최대 38%입니다.";
