/* 잠금·예측 화면 공통 로직 — 정책 수치는 reward-policy.ts */
import type { Session } from "./reward-policy";
import type { PriceLock } from "./store";

export type LockPhase = "none" | "holding" | "protecting" | "purchased" | "expired";

/**
 * 잠금 단계 — 하루 잠금권 1개, 오전장에만 잠급니다.
 * 잠근 날(시장 날짜) 오전장 동안 보관, 오후장(16:00–다음 날 01:59)에 잠금가로 구매.
 * todayKey 는 02:00 에 바뀌는 시장 날짜라 자정을 넘어도 같은 날로 본다.
 */
export function lockPhaseOf(lock: PriceLock | null, now: { session: Session }, todayKey: string): LockPhase {
  if (!lock) return "none";
  if (lock.status === "purchased") return "purchased";
  if (lock.session !== "am" || todayKey !== lock.dateKey) return "expired";
  if (now.session === "am") return "holding";
  if (now.session === "pm") return "protecting";
  return "expired";
}
