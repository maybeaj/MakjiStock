"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BREADS,
  arrow,
  changeAt,
  cls,
  fixed,
  fxShownAt,
  hydrateQuotes,
  labelOf,
  makjiIndexAt,
  quoteAt,
  shortOf,
  signed,
  won,
  type RealQuoteRow,
} from "@/lib/bread-market/engine";
import { SESSION_LABEL, SESSION_RANGE, type Session } from "@/lib/bread-market/reward-policy";
import { useSession, useTodayKey, syncLockFromServer } from "@/lib/bread-market/store";
import {
  BreadMarketContext,
  type BreadMarketCtx as Ctx,
  type ServerPrediction,
  type SheetState,
} from "./context";
import { DetailSheet, LockedDetailSheet, LockSheet, PredictSheet } from "./sheets";

const NEXT_PUBLISH: Record<Session, string> = { am: "16:00 오후가", pm: "02:00 정가", list: "06:00 오전가" };

type Toast = { id: number; icon: string; title: string; desc?: string; out?: boolean };

let toastSeq = 0;

/* ───────── 탭 ───────── */
const TABS = [
  {
    href: "/market",
    label: "마켓",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17.5 9 11l4 3.6 7.2-8.1" />
        <path d="M20.4 10.4V6.5h-3.9" />
        <path d="M3 21h18" />
      </svg>
    ),
  },
  {
    href: "/me",
    label: "MY",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.6" />
      </svg>
    ),
  },
] as const;

function AppBar({ todayKey, session }: { todayKey: string | null; session: Session }) {
  const idx = todayKey ? makjiIndexAt(todayKey, session) : null;
  const fx = todayKey ? fxShownAt(todayKey, session) : null;
  return (
    <header className="appbar">
      <div className="appbar__row">
        <Link href="/market" className="brandmark" aria-label="막지 Bread Market 홈">
          <span className="blogo" role="img" aria-label="막지 MAKJI" />
          <span className="brandmark__div" />
          <span className="brandmark__t">STOCK</span>
        </Link>
        <div className="idxpill">
          <i>MAKJI</i>
          <b className="n">{idx === null ? "--.--" : fixed(idx, 2)}</b>
        </div>
      </div>
      <div className="appbar__date">
        <span className="livedot" />
        <span>{todayKey ? labelOf(todayKey) : "—"}</span>
        <span>·</span>
        <span>
          {SESSION_LABEL[session]} {SESSION_RANGE[session]} · 다음 {NEXT_PUBLISH[session]}
          {fx && session !== "list" ? ` · 환율 ${shortOf(fx.at)} 기준` : ""}
        </span>
      </div>
    </header>
  );
}

function Tape({ todayKey, session }: { todayKey: string; session: Session }) {
  const items = BREADS.map((b) => {
    const q = quoteAt(b, todayKey, session);
    const d = changeAt(b, todayKey, session);
    return { b, q, d };
  });
  const seg = (k: string) =>
    items.map(({ b, q, d }) => (
      <span className="tape__i" key={`${k}-${b.tk}`}>
        <b>{b.tk}</b>
        <s className="n">{won(q.price)}</s>
        {/* 정가 시간에는 등락을 보여주지 않는다 — 모든 빵이 정가다 */}
        {session === "list" ? null : (
          <em className={`${cls(d.pct)} n`}>
            {arrow(d.pct)} {signed(d.pct)}%
          </em>
        )}
      </span>
    ));
  return (
    <div className="tape" aria-hidden="true">
      <div className="tape__track">
        {seg("a")}
        {seg("b")}
      </div>
    </div>
  );
}

export function BreadMarketShell({ children }: { children: React.ReactNode }) {
  const todayKey = useTodayKey();
  const pathname = usePathname();
  const { session } = useSession();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [predictions, setPredictions] = useState<ServerPrediction[]>([]);

  const refreshPredictions = useCallback(() => {
    fetch("/api/predictions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { predictions?: ServerPrediction[] } | null) => {
        if (data?.predictions) setPredictions(data.predictions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPredictions();
    // 잠금도 서버가 정본이다. 마켓 화면이 localStorage 만 보면 MY 와 어긋난다.
    fetch("/api/locks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) syncLockFromServer(data.lock ?? null);
      })
      .catch(() => {});
  }, [refreshPredictions]);

  /* Supabase 에 저장된 실제 시세를 받아 engine 에 주입한다.
     받기 전에는 시드 값이 보이고, 받은 뒤 리렌더되며 실값으로 바뀐다.
     실패해도 화면은 시드로 계속 돈다 — 시세가 안 보이는 것보다 낫다. */
  useEffect(() => {
    let alive = true;
    fetch("/api/market")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { quotes?: RealQuoteRow[] }) => {
        if (!alive || !data.quotes?.length) return;
        hydrateQuotes(data.quotes);
        setDataVersion((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* 탭 이동 시 스크롤 맨 위로. 단 #앵커로 왔으면 그 자리로 보낸다.
     스크롤 컨테이너가 따로 있어 브라우저 기본 해시 이동이 듣지 않는다.
     offsetTop 은 컨테이너가 아니라 .device 기준이라 못 쓴다. scrollIntoView 가
     컨테이너를 알아서 찾는다. 목록이 아직 안 그려졌을 수 있어 한 프레임 미룬다. */
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const hash = window.location.hash.slice(1);
    if (!hash) {
      box.scrollTop = 0;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = box.querySelector(`#${CSS.escape(hash)}`);
      if (target instanceof HTMLElement) target.scrollIntoView({ block: "start" });
      else box.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const toast = useCallback((icon: string, title: string, desc?: string) => {
    toastSeq += 1;
    const id = toastSeq;
    setToasts((t) => [...t, { id, icon, title, desc }]);
    window.setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x)));
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 360);
    }, 2600);
  }, []);

  const closeSheet = useCallback(() => setSheet(null), []);

  const ctx = useMemo<Ctx | null>(
    () =>
      todayKey
        ? { todayKey, dataVersion, predictions, refreshPredictions, openSheet: setSheet, toast }
        : null,
    [todayKey, dataVersion, predictions, refreshPredictions, toast],
  );

  const activeIdx = Math.max(0, TABS.findIndex((t) => pathname?.startsWith(t.href)));
  const couponCount = predictions.filter((p) => p.reward?.code).length;

  return (
    <div className="stage">
      <div className="device">
        <div className="app">
          <AppBar todayKey={todayKey} session={session} />
          {todayKey ? <Tape todayKey={todayKey} session={session} /> : null}

          <div className="scroll" ref={scrollRef}>
            {ctx ? (
              <BreadMarketContext.Provider value={ctx}>{children}</BreadMarketContext.Provider>
            ) : (
              <p className="boot">오늘의 빵값을 불러오는 중…</p>
            )}
          </div>

          <nav className="tabbar" aria-label="주요 메뉴">
            <div className="tabbar__ink" style={{ left: `calc(${activeIdx * 50}% + 16.5%)` }} />
            {TABS.map((t, i) => (
              <Link
                key={t.href}
                href={t.href}
                className={`tab${i === activeIdx ? " is-on" : ""}`}
                aria-current={i === activeIdx ? "page" : undefined}
              >
                <span className="tab__i">
                  {t.icon}
                  {t.href === "/me" && couponCount > 0 ? (
                    <span className="tab__dot is-on n" aria-label={`할인코드 ${couponCount}개`}>
                      {couponCount}
                    </span>
                  ) : null}
                </span>
                <span className="tab__l">{t.label}</span>
              </Link>
            ))}
          </nav>

          <div className="toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div className={`toast${t.out ? " is-out" : ""}`} key={t.id}>
                <div className="toast__i" aria-hidden="true">{t.icon}</div>
                <div className="toast__t">
                  <b>{t.title}</b>
                  {t.desc ? <span>{t.desc}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {ctx && sheet ? (
          <BreadMarketContext.Provider value={ctx}>
            {sheet.type === "detail" ? <DetailSheet key={`d-${sheet.tk}`} tk={sheet.tk} onClose={closeSheet} /> : null}
            {sheet.type === "locked-detail" ? <LockedDetailSheet key={`ld-${sheet.tk}`} tk={sheet.tk} onClose={closeSheet} /> : null}
            {sheet.type === "predict" ? <PredictSheet key="p" onClose={closeSheet} /> : null}
            {sheet.type === "lock" ? <LockSheet key={`l-${sheet.tk}`} tk={sheet.tk} onClose={closeSheet} /> : null}
          </BreadMarketContext.Provider>
        ) : null}
      </div>
    </div>
  );
}
