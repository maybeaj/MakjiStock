/* ══════════════════════════════════════════════════════════
   가격 잠금 · 예측 보상 정책 (PRD v0.6)
   - 세션: 오전장 06:00–15:59 · 오후장 16:00–다음 날 01:59 · 정가 02:00–05:59
   - 잠금: 오전장에만, 하루 1회, 빵 1개 (docs/가격-잠금-1회-사유.md)
   - 보상률: 안정형 오전 7~10% · 오후 5~7%, 공격형 5~13% (빗나가면 0%)
   - 상품 할인은 최대 25%(config/pricing-products.json discountCapPct)
   - 쿠폰은 Cafe24 할인코드(정액)로 발급합니다. 금액은 발급 시점 판매가 × R 이고,
     정가의 13%(= 38 − 25)를 넘지 않습니다. 그래서 언제 써도 실효 할인이 38%를 넘지 않습니다.
   이 파일은 서버·클라이언트·테스트가 함께 쓰는 순수 함수만 둡니다.
   ══════════════════════════════════════════════════════════ */

export const TOTAL_CAP_PCT = 38;

/** 상품 할인 상한(%). config/pricing-products.json 의 discountCapPct 와 같아야 한다 — 테스트가 지킨다. */
export const PRODUCT_DISCOUNT_CAP_PCT = 25;

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

/** 이 확정가를 지금 내보내도 되는가.

    Hobby 크론은 분을 무시하고 시간대 안 아무 때나 돈다(docs/네이버-검색지수-도착시각.md).
    그래서 오전가는 05시대, 오후가는 15시대에 daily_prices 에 쓰이는데, 쓰인 순간
    내보내면 06:00·16:00 공개가 매일 다른 시각에 새어 나간다. 저장 시각이 아니라
    세션이 약속한 시각으로 판정한다.

    hour 는 시장 시계다 — 00~01시는 전날 24·25시로 들어오므로 전날 오후가가
    보호 구간 끝까지 그대로 공개된 상태로 남는다. */
export function isPublicAt(
  publishDate: string,
  session: "am" | "pm",
  now: { date: string; hour: number },
) {
  if (publishDate !== now.date) return publishDate < now.date;
  return now.hour >= (session === "pm" ? 16 : 6);
}

/* 예측에 리스크/리워드를 붙인다. 둘 다 랜덤이지만 보이는 방식이 다르다.

     안정형 투자 — 오전 7~10% · 오후 5~7% 중 하나. 회차마다 정해지고 고르기 전에 숫자를 보여준다.
     공격형 투자 — 5~13% 중 하나. 걸 때는 "?" 이고 결과가 나와야 알 수 있다.

   안정형은 얼마를 받는지 알고 고르는 대신 폭이 좁고, 공격형은 폭이 넓은 대신
   금액도 성공 여부도 모른 채 건다. */

/* 안정형 보상률은 장마다 다르다 — 오전장이 후하다.
   오후장은 이미 그날 두 번째 가격이라 잠금·차액 쿠폰과 겹치는 기회가 많다.
   먼저 온 사람에게 더 주고, 오후에 오는 사람에게는 폭을 낮춘다. */
export const INSTANT_REWARD_PCTS: Record<"am" | "pm", readonly number[]> = {
  am: [7, 8, 9, 10],
  pm: [5, 6, 7],
};

/* 화면 문구가 말하는 전체 폭. 표에서 뽑아야 표를 고칠 때 문구가 따라온다. */
const ALL_INSTANT_PCTS = [...INSTANT_REWARD_PCTS.am, ...INSTANT_REWARD_PCTS.pm];
export const INSTANT_REWARD_MIN_PCT = Math.min(...ALL_INSTANT_PCTS);
export const INSTANT_REWARD_MAX_PCT = Math.max(...ALL_INSTANT_PCTS);

/* 장마다의 폭. 오전장이 후하다는 것을 화면이 숫자로 말하게 한다. */
const rangeOf = (pcts: readonly number[]) => `${Math.min(...pcts)}~${Math.max(...pcts)}%`;
export const INSTANT_REWARD_AM_RANGE = rangeOf(INSTANT_REWARD_PCTS.am);
export const INSTANT_REWARD_PM_RANGE = rangeOf(INSTANT_REWARD_PCTS.pm);
/** "오전장 7~10% · 오후장 5~7%" */
export const INSTANT_REWARD_RANGE_LABEL = `오전장 ${INSTANT_REWARD_AM_RANGE} · 오후장 ${INSTANT_REWARD_PM_RANGE}`;
export const PREDICTION_REWARD_MIN_PCT = 5;
export const PREDICTION_REWARD_MAX_PCT = 13;

/* 운영자가 특정 회차·장의 안정형 보상률을 직접 정한 값. 키는 `${roundId}@${session}`.
   그 회차가 지나면 쓰이지 않으니 지난 줄은 지워도 된다. 이미 발급된 코드는
   reward_claims.rate_pct 에 박혀 있어 바뀌지 않는다. */
export const INSTANT_REWARD_OVERRIDES: Record<string, number> = {
  "2026-09-30-am@am": 10, // 2026-09-30 오전장 이벤트
};

/* 회차 id 로 결정론적으로 뽑는다. 요청마다 새로 뽑으면 화면에 보인 값과 저장되는
   값이 달라지고, 최댓값이 나올 때까지 새로고침할 수 있다. 서버와 화면이 같은
   함수를 써서 같은 값을 말하고, 서버는 발급 시점에 다시 계산해 쓴다. */
function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 안정형(바로 받기) 보상률(%). 같은 회차·같은 장이면 누가 언제 물어도 같은
 * 값이다 — 고르기 전에 보여주는 숫자이므로 흔들리면 안 된다.
 *
 * 16:00 에는 바뀐다. 판정은 하루 한 회차뿐이라 roundId 만으로는 장이 갈리지
 * 않아 제출하는 장을 따로 받는다. 그래서 "화면에 보인 값이 그대로 저장된다"는
 * 장이 넘어가는 그 순간에만 깨진다 — 화면은 분마다 시계를 다시 읽고(store.ts
 * subscribeMinute) 장이 바뀌면 다시 그리므로 어긋남은 1분 안에 닫힌다.
 *
 * @param roundId `prediction_rounds.id` — `${시장날짜}-${판정세션}`
 * @param session 제출하는 장. predictionSchedule 의 submitSession 을 쓴다.
 */
export function instantRewardPct(roundId: string, session: "am" | "pm") {
  const override = INSTANT_REWARD_OVERRIDES[`${roundId}@${session}`];
  if (override !== undefined) return override;
  const table = INSTANT_REWARD_PCTS[session];
  return table[seedOf(`instant@${roundId}@${session}`) % table.length];
}

/**
 * 공격형(내일 맞히기) 보상률(%)을 뽑는다. 사람마다 다르게 걸리고, 건 사람은
 * 결과가 나올 때까지 모른다 — 그래서 회차로 고정하지 않고 제출할 때마다 뽑는다.
 * 화면에 보이지 않으니 다시 뽑게 만들 방법도 없다.
 *
 * 서버에서만 부른다. 뽑은 값은 prediction_entries.reward_rate_pct 에 박아
 * 나중에 규칙이 바뀌어도 이미 건 사람의 조건이 그대로이게 한다.
 */
export function rollPredictionRewardPct() {
  const span = PREDICTION_REWARD_MAX_PCT - PREDICTION_REWARD_MIN_PCT + 1;
  return PREDICTION_REWARD_MIN_PCT + Math.floor(Math.random() * span);
}

/**
 * 판정 결과에 실제로 줄 보상률. 약속한 값은 적중·무승부에만 주고 빗나가면 0 이다.
 */
export function rewardPctFor(outcome: Outcome, promisedPct: number) {
  return outcome === "miss" ? 0 : promisedPct;
}

/**
 * 쿠폰 금액(원) — 지금 붙어 있는 판매가에 보상률을 곱하고 10원 단위로 내린다.
 * 단, 정가의 (38 − 25)% = 13% 를 넘지 않는다.
 *
 * 쿠폰은 "이 가격에서 N% 더" 라는 약속이다. 정가에 곱하면 상품이 이미 싸진 날에
 * 정가 시절 기준의 금액이 나가 실제 체감보다 크게 깎인다.
 *
 * Cafe24 할인코드는 정액만 받으므로(discount-code.ts discount_value_unit "W")
 * 퍼센트를 여기서 원으로 바꿔 보낸다. 쓰인 판매가는 reward_claims 의
 * sale_price_won_at_issue 에 남는다.
 *
 * 13% 천장은 쓰는 시점 때문이다. 공격형은 24시간, 안정형은 3시간 유효라 받은 뒤
 * 오후가가 더 내려간 장에서도 쓰인다. 그 가격은 발급할 때 모르므로 판매가가 하한
 * (정가의 75%)까지 내려간다고 보고 자른다. 그러면 결제가 ≥ 정가 × (75% − 13%) = 62%.
 * 보상률은 최대 13% 이고 판매가는 정가 이하라 지금 표로는 어떤 쿠폰도 잘리지 않는다.
 * 보상률 표를 13% 위로 올릴 때만 걸리는 안전장치다 (docs/산식과-쿠폰-공부노트.md §5).
 */
export function couponAmountWon(ratePct: number, salePriceWon: number, basePriceWon: number) {
  const amount = Math.floor((salePriceWon * ratePct) / 100 / 10) * 10;
  const maxWon = Math.floor((basePriceWon * (TOTAL_CAP_PCT - PRODUCT_DISCOUNT_CAP_PCT)) / 100 / 10) * 10;
  return Math.max(0, Math.min(amount, maxWon));
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

/** 공격형 할인코드 유효 기간 — 발급 시점부터 24시간.
    내일 06:00 판정을 보고 와야 하므로 하루를 준다. */
export const PREDICTION_CODE_HOURS = 24;

/** 안정형(바로 받기) 할인코드 유효 기간 — 발급 시점부터 3시간.

    공격형과 달리 기다릴 이유가 없는 쿠폰이다. 그 자리에서 받고 그 자리에서
    쓰라는 것이라 짧게 끊는다. 짧은 만큼 화면이 남은 시간을 분·초까지 보여준다
    (MyPanel Countdown).

    장과 무관하게 발급 시각 기준이다. 오후장 15:50 에 받아도 3시간이 온전히
    남는다 — 16:00 에 장이 넘어가도 이미 나간 쿠폰의 조건은 바뀌지 않는다. */
export const INSTANT_CODE_HOURS = 3;

/**
 * 예측 할인코드 유효 종료 — 발급 시각 + 24시간.
 *
 * 기준이 판정한 시장일이 아니라 발급 시각이다. 그래서 크론이 밀렸다가 뒤늦게
 * 따라잡아도 이미 지나간 만료 시각이 붙지 않는다 (resolvePredictions 는 지난
 * 날짜의 pending 도 판정한다).
 *
 * 잠금 쿠폰은 이 함수를 쓰지 않는다 — 보호 구간(16:00~다음 날 01:59)이 곧
 * 유효 기간이라 lock_price_locks 의 protect_from/protect_until 을 그대로 쓴다.
 */
export function predictionCodeValidUntil(issuedAtIso: string) {
  return new Date(new Date(issuedAtIso).getTime() + PREDICTION_CODE_HOURS * 3_600_000).toISOString();
}

/** 안정형 할인코드 유효 종료 — 발급 시각 + 3시간. */
export function instantCodeValidUntil(issuedAtIso: string) {
  return new Date(new Date(issuedAtIso).getTime() + INSTANT_CODE_HOURS * 3_600_000).toISOString();
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

/**
 * 잠금을 받는 날인가 — 주말에는 받지 않습니다.
 *
 * 주말은 외환시장이 쉬어 당일 시가가 없습니다. 그래서 오후가 크론이 오후가를
 * 만들지 않고(daily-pricing 의 fx_unavailable 보류), 오후가가 없으면 잠금가와
 * 비교할 값도 차액 쿠폰도 없습니다. 실데이터 3개월에서 주말 잠금 156건의 보상은
 * 예외 없이 0건이었습니다 — 하루 한 번뿐인 잠금을 확정적으로 버리게 됩니다.
 *
 * 공휴일도 같은 이유로 오후가가 없지만, 휴장일 달력이 없어 여기서는 가리지 못합니다.
 */
export function lockOpensOn(dateKey: string) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** 잠금 적용가: 손해 보지 않도록 잠금가와 현재가 중 낮은 값 */
export function lockAppliedPriceWon(lockedPriceWon: number, currentPriceWon: number) {
  return Math.min(lockedPriceWon, currentPriceWon);
}

/** 잠금가 할인코드 금액: 현재가가 잠금가보다 높을 때만 차액. 낮으면 더 싼 현재가로 구매(코드 없음). */
export function lockCodeAmountWon(lockedPriceWon: number, currentPriceWon: number) {
  return Math.max(0, currentPriceWon - lockedPriceWon);
}
