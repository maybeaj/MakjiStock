/* ══════════════════════════════════════════════════════════
   MY 상태 저장소 (비로그인 · 이 브라우저에만 저장) — PRD v0.6
   - 가격 잠금: 하루 1회, 오전가 또는 오후가 중 하나, 빵 한 개
   - 보상: Cafe24 1회용 정액 할인코드 (reward-policy.ts)
   useSyncExternalStore 로 /market 과 /me 가 같은 상태를 봅니다.
   ══════════════════════════════════════════════════════════ */
"use client";

import { useSyncExternalStore } from "react";
import { kstTodayKey } from "./engine";
import { sessionOfHour, type Session } from "./reward-policy";

export type Clock = "live" | Session;

export type PriceLock = {
  tk: string;
  lockedPrice: number;
  session: Session;
  dateKey: string;
  lockedAt: string;
  status: "active" | "purchased";
  lockCode?: { code: string; amount: number };
};

export type BreadState = {
  clock: Clock;
  lock: PriceLock | null;
};

const STORAGE_KEY = "makji-bread-market.my-v2";
const EMPTY: BreadState = { clock: "live", lock: null };

let state: BreadState | null = null;
const listeners = new Set<() => void>();

function load(): BreadState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<BreadState>) };
  } catch {
    return EMPTY;
  }
}

function getSnapshot() {
  if (state === null) state = load();
  return state;
}

function getServerSnapshot() {
  return EMPTY;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function commit(next: BreadState) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 사생활 보호 모드 등에서 저장이 막혀도 화면은 계속 동작합니다. */
  }
  listeners.forEach((fn) => fn());
}

export function useBreadState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ───────── 액션 ───────── */
export function setClock(clock: Clock) {
  commit({ ...getSnapshot(), clock });
}

export function lockPrice(lock: Omit<PriceLock, "lockedAt" | "status">) {
  const s = getSnapshot();
  commit({ ...s, lock: { ...lock, lockedAt: new Date().toISOString(), status: "active" } });
}

/** 서버 잠금을 정본으로 맞춘다. 다른 기기이거나 브라우저 기록을 지워도
    마켓 화면이 MY 와 같은 잠금을 보게 한다. 서버에 없으면 로컬 잠금도 지운다. */
export function syncLockFromServer(
  row: { lock_date: string; lock_session: Session; locked_price_won: number; status: string; products: { ticker: string } | null } | null,
) {
  const s = getSnapshot();
  if (!row?.products) {
    if (s.lock) commit({ ...s, lock: null });
    return;
  }
  commit({
    ...s,
    lock: {
      tk: row.products.ticker,
      lockedPrice: row.locked_price_won,
      session: row.lock_session,
      dateKey: row.lock_date,
      lockedAt: s.lock?.lockedAt ?? "",
      status: row.status === "purchased" ? "purchased" : "active",
    },
  });
}

export function resetBreadState() {
  commit({ ...EMPTY, clock: getSnapshot().clock });
}

/* ───────── 오늘 날짜·시각 (KST) ─────────
   서버 렌더 시점엔 null → 브라우저에서 확정. 정적 빌드 날짜로 고정되는 것을 막습니다. */
function subscribeMinute(fn: () => void) {
  let interval: number | undefined;
  const delay = 60_000 - (Date.now() % 60_000) + 50;
  const timeout = window.setTimeout(() => {
    fn();
    interval = window.setInterval(fn, 60_000);
  }, delay);
  return () => {
    window.clearTimeout(timeout);
    if (interval !== undefined) window.clearInterval(interval);
  };
}

export function useTodayKey() {
  return useSyncExternalStore(
    subscribeMinute,
    () => {
      const today = kstTodayKey();
      if (process.env.NODE_ENV !== "production") {
        const preview = new URLSearchParams(window.location.search).get("preview");
        if (preview && /^\d{4}-\d{2}-\d{2}$/.test(preview)) return preview;
      }
      return today;
    },
    () => null,
  );
}

function kstHour() {
  return new Date(Date.now() + 9 * 3600000).getUTCHours();
}

function useKstHour() {
  return useSyncExternalStore(
    subscribeMinute,
    () => {
      if (process.env.NODE_ENV !== "production") {
        const preview = new URLSearchParams(window.location.search).get("session");
        if (preview === "am") return 10;
        if (preview === "pm") return 18;
        if (preview === "list") return 3;
      }
      return kstHour();
    },
    () => 10,
  );
}

/** 현재 가격 세션. 데모 시각을 고르면 그 세션으로 덮어씁니다. */
export function useSession() {
  const { clock } = useBreadState();
  const hour = useKstHour();
  const h = clock === "live" ? hour : clock === "am" ? 10 : clock === "pm" ? 18 : 3;
  return { session: sessionOfHour(h), demo: clock !== "live" };
}
