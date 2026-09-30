/* ══════════════════════════════════════════════════════════
   MY 상태 저장소 (비로그인 · 이 브라우저에만 저장) — PRD v0.6
   - 가격 잠금: 하루 1회, 오전가 또는 오후가 중 하나, 빵 한 개
   - 보상: Cafe24 1회용 정액 할인코드 (reward-policy.ts)
   useSyncExternalStore 로 /market 과 /me 가 같은 상태를 봅니다.
   ══════════════════════════════════════════════════════════ */
"use client";

import { useSyncExternalStore } from "react";
import { addDays, kstHour, kstTodayKey } from "./engine";
import { sessionOfHour, type Session } from "./reward-policy";

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
  lock: PriceLock | null;
};

const STORAGE_KEY = "makji-bread-market.my-v2";
const EMPTY: BreadState = { lock: null };

let state: BreadState | null = null;
const listeners = new Set<() => void>();

function load(): BreadState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    // 예전 데모 시계(clock: "am" 등)가 남아 있어도 읽지 않는다 — 세션은 실제 시각으로만 정한다
    const stored = JSON.parse(raw) as Partial<BreadState>;
    return { lock: stored.lock ?? null };
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
  commit({ ...EMPTY });
}

/* ───────── 오늘 날짜·시각 (KST) ─────────
   서버 렌더가 자기 시각을 심고(seedClock), SSR 과 하이드레이션이 같은 값을 봅니다.
   심지 않으면 화면은 날짜를 모른 채 "불러오는 중"만 그리고, 하이드레이션이
   끝난 다음에야 목록이 뜹니다 — 그 한 박자가 시드 값이 보이던 구간입니다.
   심은 값은 모든 요청이 Date.now() 로 똑같이 계산한 값이라 서로 덮어써도 같습니다. */
let ssrTodayKey: string | null = null;
let ssrHour = 10;

export function seedClock(todayKey: string, hour: number) {
  ssrTodayKey = todayKey;
  ssrHour = hour;
}

function subscribeMinute(fn: () => void) {
  let interval: number | undefined;
  const delay = 60_000 - (Date.now() % 60_000) + 50;
  const timeout = window.setTimeout(() => {
    fn();
    interval = window.setInterval(fn, 60_000);
  }, delay);
  /* 모바일은 화면이 꺼지거나 앱을 옮기면 타이머를 멈춘다. 돌아왔을 때 다음 틱을
     기다리면 15:59 에 멈춘 시계가 한동안 오전장을 말한다. 보이는 순간 다시 읽는다. */
  const onVisible = () => {
    if (document.visibilityState === "visible") fn();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  return () => {
    window.clearTimeout(timeout);
    if (interval !== undefined) window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onVisible);
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
        const day = new Date(`${today}T00:00:00Z`).getUTCDay();
        if (preview === "weekday") return day === 0 ? addDays(today, -2) : day === 6 ? addDays(today, -1) : today;
        if (preview === "sunday") return addDays(today, -day);
      }
      return today;
    },
    () => ssrTodayKey,
  );
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
    () => ssrHour,
  );
}

/** 현재 가격 세션 — 실제 KST 시각으로만 정한다. */
export function useSession() {
  return { session: sessionOfHour(useKstHour()) };
}
