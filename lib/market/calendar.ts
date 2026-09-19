const DAY_MS = 86_400_000;

function utcMs(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoDateOf(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 시장 하루는 02:00 에 바뀐다. 00:00–01:59 는 전날 오후장이다.
    그 두 시간은 전날 날짜 + 24·25시로 돌려준다 — 오후장(≥16) 판정이 그대로 먹는다. */
export function marketClockOf(kstDate: string, kstHour: number) {
  if (kstHour >= 2) return { date: kstDate, hour: kstHour };
  return { date: isoDateOf(utcMs(kstDate) - DAY_MS), hour: kstHour + 24 };
}

/** 서버 기준 시장 날짜·시(KST). 개발 모드에서는 DEV_KST_DATE / DEV_KST_HOUR 로 덮어쓴다. */
export function kstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  let date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = Number(get("hour")) % 24;
  if (process.env.NODE_ENV !== "production") {
    if (process.env.DEV_KST_DATE) date = process.env.DEV_KST_DATE;
    if (process.env.DEV_KST_HOUR) hour = Number(process.env.DEV_KST_HOUR);
  }
  return marketClockOf(date, hour);
}
