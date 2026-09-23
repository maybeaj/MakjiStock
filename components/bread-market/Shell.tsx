"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BREADS,
  discMark,
  changeAt,
  isListPriceAt,
  cls,
  fixed,
  fxShownAt,
  hasRealData,
  hydrateMarket,
  SEED_PRICES_ALLOWED,
  labelOf,
  makjiIndexAt,
  quoteAt,
  shortOf,
  won,
} from "@/lib/bread-market/engine";
import type { ShellData } from "@/lib/bread-market/page-data";
import { SESSION_LABEL, SESSION_RANGE, type Session } from "@/lib/bread-market/reward-policy";
import { seedClock, useSession, useTodayKey, syncLockFromServer } from "@/lib/bread-market/store";
import {
  BreadMarketContext,
  type BreadMarketCtx as Ctx,
  type ServerPrediction,
  type SheetState,
} from "./context";
import { DetailSheet, HistorySheet, LockedDetailSheet, LockSheet, PredictSheet } from "./sheets";

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/splash/makji-logo.png" alt="Makji Stock" className="brandmark__word" />
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
    return { b, q, d, listPrice: isListPriceAt(b, todayKey, session) };
  });
  const seg = (k: string) =>
    items.map(({ b, q, d, listPrice }) => (
      <span className="tape__i" key={`${k}-${b.tk}`}>
        <b>{b.tk}</b>
        <s className="n">{won(q.price)}</s>
        {/* 정가에는 등락을 붙이지 않는다 — 오늘 가격이 아직 없다는 뜻이다.
            색은 직전 확정가 대비 등락, 숫자는 정가 대비 할인율, 화살표는 언제나 ▼ 다
            (시세표와 같다. engine.ts discMark 참고). */}
        {listPrice ? null : (
          <em className={`${cls(d.pct)} n`}>
            {discMark(d.pct)} {fixed(Math.max(0, -q.vsBase))}%
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

export function BreadMarketShell({
  clock,
  market,
  lock,
  predictions: initialPredictions,
  instantRewards,
  children,
}: ShellData & { children: React.ReactNode }) {
  /* 자식이 읽기 전에 심는다. 렌더 중 호출이지만 같은 값을 다시 넣는 것뿐이라
     몇 번 돌아도 결과가 같다. effect 로 미루면 그 사이 한 프레임 동안 시드
     값이 보인다 — 그게 없애려던 것이다. */
  seedClock(clock.todayKey, clock.hour);
  if (market) hydrateMarket(market);

  /* 실시세가 하나도 없으면 가격을 그리지 않는다. 시드는 로컬 개발에서만 쓴다 —
     지어낸 숫자를 보고 잠그면 서버가 읽는 실제 가격과 달라진다. */
  const noPrices = !hasRealData() && !SEED_PRICES_ALLOWED;

  const todayKey = useTodayKey() ?? clock.todayKey;
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSession();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* 서버가 준 값으로 시작한다. 빈 배열로 시작하면 첫 화면이 "기록 없음"이었다가
     응답이 와서 뒤늦게 채워진다 — 그 한 박자가 늦게 그려지던 것이다. */
  const [predictions, setPredictions] = useState<ServerPrediction[]>(initialPredictions);

  const refreshPredictions = useCallback(() => {
    fetch("/api/predictions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { predictions?: ServerPrediction[] } | null) => {
        if (data?.predictions) setPredictions(data.predictions);
      })
      .catch(() => {});
  }, []);

  /* 장이 넘어가면 서버 데이터를 다시 받는다. 오후가는 16:00 전까지 내려오지
     않으므로(market-data.ts isPublicAt), 열어둔 탭은 시계만 pm 으로 넘어가고
     값이 없어 정가로 떨어진다. 첫 렌더는 서버가 같은 장으로 그려준 것이라
     건너뛴다 — 아니면 열 때마다 한 번씩 더 받아온다. */
  const seenSession = useRef(session);
  useEffect(() => {
    if (seenSession.current === session) return;
    seenSession.current = session;
    router.refresh();
  }, [session, router]);

  /* 잠금도 서버가 정본이다. 마켓 화면이 localStorage 만 보면 MY 와 어긋난다.
     값은 이미 props 로 와 있으니 받아올 것은 없고, localStorage 만 맞춰 둔다. */
  useEffect(() => {
    syncLockFromServer(lock.lock);
  }, [lock]);

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
        ? { todayKey, predictions, refreshPredictions, lock, instantRewards, openSheet: setSheet, toast }
        : null,
    [todayKey, predictions, refreshPredictions, lock, instantRewards, toast],
  );

  const activeIdx = Math.max(0, TABS.findIndex((t) => pathname?.startsWith(t.href)));
  const couponCount = predictions.filter((p) => p.reward?.code).length;

  return (
    <div className="stage">
      <div className="device">
        <div className="app">
          <AppBar todayKey={todayKey} session={session} />
          {todayKey && !noPrices ? <Tape todayKey={todayKey} session={session} /> : null}

          <div className="scroll" ref={scrollRef}>
            {noPrices ? (
              <p className="boot" role="alert">
                시세를 불러오지 못했어요.
                <br />
                잠시 후 다시 열어 주세요.
              </p>
            ) : ctx ? (
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

        {ctx && sheet && !noPrices ? (
          <BreadMarketContext.Provider value={ctx}>
            {sheet.type === "detail" ? <DetailSheet key={`d-${sheet.tk}`} tk={sheet.tk} onClose={closeSheet} /> : null}
            {sheet.type === "locked-detail" ? <LockedDetailSheet key={`ld-${sheet.tk}`} tk={sheet.tk} onClose={closeSheet} /> : null}
            {sheet.type === "predict" ? <PredictSheet key="p" onClose={closeSheet} /> : null}
            {sheet.type === "lock" ? <LockSheet key={`l-${sheet.tk}`} tk={sheet.tk} onClose={closeSheet} /> : null}
            {sheet.type === "history" ? <HistorySheet key="h" onClose={closeSheet} /> : null}
          </BreadMarketContext.Provider>
        ) : null}
      </div>
    </div>
  );
}
