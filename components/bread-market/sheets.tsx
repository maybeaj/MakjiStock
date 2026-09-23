"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  breadOf,
  changeAt,
  isListPriceAt,
  cls,
  dirColor,
  discCls,
  discTxt,
  fixed,
  fxLabel,
  linePath,
  predictBreadOf,
  quoteAt,
  sessionSeries,
  shortOf,
  signed,
  won,
  type Bread,
} from "@/lib/bread-market/engine";
import { lockPhaseOf } from "@/lib/bread-market/flow";
import { predictionSchedule } from "@/lib/predictions/schedule";
import {
  INSTANT_CODE_HOURS,
  INSTANT_REWARD_MAX_PCT,
  INSTANT_REWARD_MIN_PCT,
  PREDICTION_REWARD_MAX_PCT,
  PREDICTION_REWARD_MIN_PCT,
  SESSION_LABEL,
  instantRewardPct,
  lockAppliedPriceWon,
  lockOpensOn,
  lockProtection,
  type Direction,
} from "@/lib/bread-market/reward-policy";
import {
  lockPrice,
  useBreadState,
  useSession,
} from "@/lib/bread-market/store";
import { useBreadMarket, type ServerPrediction } from "./context";

/* ───────── 공통: 잠금 아이콘 (이모지 대신 선 아이콘) ───────── */
export function LockIcon({ open = false, filled = false, size = 14 }: { open?: boolean; filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" fill={filled ? "currentColor" : "none"} />
      <path d={open ? "M5.5 7V5a2.5 2.5 0 0 1 4.8-1" : "M5.5 7V5a2.5 2.5 0 0 1 5 0v2"} />
    </svg>
  );
}

/* ───────── 공통: 상품 사진 ───────── */
export function Photo({ bread }: { bread: Bread }) {
  return (
    <span
      role="img"
      aria-label={bread.name}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        background: `url(${bread.photo}) center/cover no-repeat`,
      }}
    />
  );
}

/* ───────── 공통: 바텀시트 ───────── */
function Sheet({
  title,
  onClose,
  foot,
  hero,
  children,
}: {
  title: string;
  onClose: () => void;
  foot?: React.ReactNode;
  hero?: Bread;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  /* 열릴 때 한 번만 닫기 버튼에 포커스 (입력 중 포커스를 뺏지 않도록 마운트 시점에만).
     preventScroll 없이 부르면 뒤 화면이 밀린다 — 이 시점의 시트는 아직
     translateY(100%) 라 화면 밖에 있고, 브라우저가 그 버튼을 보여주려고
     .device 를 스크롤한다. overflow:hidden 이라 스크롤바가 없을 뿐 밀리기는
     한다. 그래서 한 번 밀리면 되돌아오지도 않는다. */
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet is-on">
      <button className="sheet__veil" onClick={onClose} aria-label="닫기" tabIndex={-1} />
      <div className="sheet__in" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__grab"><i /></div>
        <div className="sheet__bar">
          <h3 className="sheet__ttl">{title}</h3>
          <button className="sheet__x" onClick={onClose} aria-label="닫기" ref={closeRef}>✕</button>
        </div>
        <div className="sheet__body">
          {hero ? <div className="sheet__hero"><Photo bread={hero} /></div> : null}
          {children}
        </div>
        {foot ? <div className="sheet__foot">{foot}</div> : null}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   상품 상세 (원본 openDetail) — 큰 사진 · 세션 가격 · 잠금/구매
   ══════════════════════════════════════════ */
export function DetailSheet({ tk, onClose }: { tk: string; onClose: () => void }) {
  const { todayKey, openSheet } = useBreadMarket();
  const my = useBreadState();
  const now = useSession();
  const session = now.session;
  const b = breadOf(tk);
  const q = quoteAt(b, todayKey, session);
  const ch = changeAt(b, todayKey, session);
  const listTime = isListPriceAt(b, todayKey, session);
  const ser = sessionSeries(b, todayKey, 14, session);
  const p = linePath(ser.map((s) => s.q.price), 300, 96, 6);
  const [hover, setHover] = useState<number | null>(null);
  const pointAt = (i: number) => {
    const n = ser.length - 1 || 1;
    const span = p.hi - p.lo || 1;
    return { x: 6 + (i * (300 - 12)) / n, y: 96 - 6 - ((ser[i].q.price - p.lo) / span) * (96 - 12) };
  };
  const shown = hover ?? ser.length - 1;
  const shownPt = pointAt(shown);
  function onChartMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(t * (ser.length - 1)));
  }
  const col = dirColor(cls(q.vsBase));
  /* 환율 먼저, 검색 할인 다음 — 두 번에 걸쳐 가격이 바뀌어 보이게 한다.
     환율이 오른 날은 절반만 반영한 중간가가 정가보다 조금 높게 나온다(11,000 → 11,060).
     정가를 넘지 않는 건 최종가이고, 중간가는 계산 과정이라 그대로 보여준다. */
  const fxRose = q.fxDisc < 0;
  const fxOnlyPriceWon = Math.round((b.base * (1 - q.fxDisc / 100)) / 10) * 10;
  // 할인 합이 음수면 정가에서 멈춘다 (할증 없음)
  const stoppedAtBase = q.searchDisc + q.fxDisc < 0;
  const gid = `g${b.tk}`;

  const lock = my.lock;
  const phase = lockPhaseOf(lock, now, todayKey);
  const lockUsed = Boolean(lock && lock.dateKey === todayKey);
  const lockBlocked = lockUsed
    ? "오늘 잠금 사용 완료"
    : !lockOpensOn(todayKey)
      ? "주말 휴장 · 월요일 06:00"
      : session !== "am"
        ? "잠금은 06:00부터"
        : null;
  const lockHere = lock && lock.tk === b.tk && phase === "protecting";

  /* 구매는 Cafe24 에서 일어난다. 여기서 "구매했다"고 기록하지 않는다.
     구매 후 기준가 예측은 Cafe24 주문과 방문자를 잇는 다리가 생긴
     뒤에 연다 — 1차 범위 밖이다. */
  function goBuy() {
    window.open(`/api/out/cafe24/${b.tk}`, "_blank", "noopener");
  }

  const foot = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn--ghost btn--sm" style={{ flex: 1 }} disabled={Boolean(lockBlocked)} onClick={() => openSheet({ type: "lock", tk: b.tk })}>
          {lockBlocked ?? `${SESSION_LABEL[session]} 가격 잠금`}
        </button>
        <button className="btn btn--sm" style={{ flex: 1.4 }} onClick={goBuy}>
          {lockHere && lock ? `잠금가 ${won(lockAppliedPriceWon(lock.lockedPrice, q.price))}원 구매` : "막지 자사몰에서 구매"}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 11, fontWeight: 700 }}>
        {/* 구매 버튼과 같은 경로를 쓴다. 어느 몰로 갈지는 서버가 정한다. */}
        <a href={`/api/out/cafe24/${b.tk}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-3)" }}>이 상품 보러 가기 →</a>
      </div>
    </div>
  );

  return (
    <Sheet title={b.name} onClose={onClose} foot={foot} hero={b}>
      <div className="detail__nm" style={{ marginBottom: 10 }}>
        <b>{b.name}</b>
        <span>{b.tk} · {b.full}</span>
      </div>
      <div className="detail__pr">
        <span className="detail__now n">{won(q.price)}원</span>
        {listTime ? null : <span className="detail__base n">{won(b.base)}원</span>}
      </div>
      <div className="detail__sub">
        {/* 정가 시간에는 퍼센트를 보여주지 않는다 — 정가 그대로다 */}
        {listTime ? (
          <span className="flat">정가 시간 · 06:00에 오전가가 나와요</span>
        ) : (
          <>
            <span className={cls(q.vsBase)}>{SESSION_LABEL[session]} · 정가 대비 {signed(q.vsBase)}%</span>
            {" · "}
            <span className={cls(ch.pct)}>
              직전가 대비 {ch.amount > 0 ? "+" : ch.amount < 0 ? "−" : ""}{won(Math.abs(ch.amount))}원 ({signed(ch.pct)}%)
            </span>
          </>
        )}
      </div>

      <div className="chart">
        <div className="chart__h">
          <b>최근 14일 오전·오후가 추이</b>
          <span className="n">{won(p.lo)} ~ {won(p.hi)}원</span>
        </div>
        {/* 마우스·손가락을 대면 그 장의 가격을 보여준다. 기본은 가장 최근 가격. */}
        <div
          className="chart__plot"
          onPointerMove={onChartMove}
          onPointerDown={onChartMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          role="slider"
          aria-label={`${b.name} 최근 14일 오전·오후가`}
          aria-valuemin={0}
          aria-valuemax={ser.length - 1}
          aria-valuenow={shown}
          aria-valuetext={`${shortOf(ser[shown].key)} ${ser[shown].s === "am" ? "오전가" : "오후가"} ${won(ser[shown].q.price)}원`}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover(Math.max(0, shown - 1));
            if (e.key === "ArrowRight") setHover(Math.min(ser.length - 1, shown + 1));
          }}
        >
          <svg viewBox="0 0 300 96" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={col} stopOpacity=".2" />
                <stop offset="100%" stopColor={col} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${p.d} L${p.lx.toFixed(1)} 96 L6 96 Z`} fill={`url(#${gid})`} />
            <path d={p.d} fill="none" stroke={col} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="chart__vline" style={{ left: `${(shownPt.x / 300) * 100}%` }} />
          <span className="chart__dot" style={{ left: `${(shownPt.x / 300) * 100}%`, top: shownPt.y + 26, background: col }} />
          <span
            className={`chart__tip n${shownPt.x > 230 ? " is-left" : shownPt.x < 70 ? " is-right" : ""}`}
            style={{ left: `${(shownPt.x / 300) * 100}%` }}
          >
            {shortOf(ser[shown].key)} {ser[shown].s === "am" ? "오전" : "오후"} <b>{won(ser[shown].q.price)}원</b>
          </span>
        </div>
        <div className="chart__x n">
          <span>{shortOf(ser[0].key)}</span>
          <span>{shortOf(ser[Math.floor(ser.length / 2)].key)}</span>
          <span>지금</span>
        </div>
      </div>

      {/* 정가 → 환율 반영 → 검색 할인까지 적용한 최종가.
          퍼센트만 보여주면 얼마가 깎였는지 와닿지 않는다. 단계마다 금액을 찍는다. */}
{listTime ? null : (
      <div className="calc">
        <div className="calc__step">
          <span className="calc__step-l">정가</span>
          <b className="n calc__step-p is-struck">{won(b.base)}원</b>
        </div>
        <div className="calc__step">
          <span className="calc__step-l">
            <i className="calc__k" style={{ background: "#3C7CB8" }} />환율 반영{" "}
            <small className={discCls(q.fxDisc)}>{discTxt(q.fxDisc)}</small>
            <small style={{ color: "var(--ink-3)" }}> · {fxLabel(q.fxDrop)}{fxRose ? " · 오른 폭은 절반만" : ""}</small>
          </span>
          <b className="n calc__step-p is-struck">{won(fxOnlyPriceWon)}원</b>
        </div>
        <div className="calc__step is-final">
          <span className="calc__step-l">
            <i className="calc__k" style={{ background: "#BE9540" }} />검색 할인{" "}
            <small className={discCls(q.searchDisc)}>{discTxt(q.searchDisc)}</small>
            <small style={{ color: "var(--ink-3)" }}>
              {" "}· 검색지수 {fixed(q.searchIdx, 1)}
              {stoppedAtBase ? " · 정가에서 멈춤" : ""}
            </small>
          </span>
          <b className="n calc__step-p">{won(q.price)}원</b>
        </div>
        <div className="calc__r is-total">
          <span>최종 <small style={{ fontWeight: 600, color: "var(--ink-3)" }}>할인 38%까지 · 정가보다 비싸지지 않아요</small></span>
          <b className={`n ${discCls(q.total)}`}>{discTxt(q.total)}</b>
        </div>
      </div>
      )}
    </Sheet>
  );
}

type LockServerState = {
  lock: {
    lock_code_amount_won: number | null;
    current_price_won_at_protect: number | null;
  } | null;
  discountCode: string | null;
  validUntil: string | null;
};

/* ══════════════════════════════════════════
   잠금 상세 — 잠금가와 보호 장 가격 비교 · 차액 코드 · 구매
   ══════════════════════════════════════════ */
export function LockedDetailSheet({ tk, onClose }: { tk: string; onClose: () => void }) {
  const { todayKey, toast } = useBreadMarket();
  const my = useBreadState();
  const now = useSession();
  const b = breadOf(tk);
  const lock = my.lock?.tk === tk ? my.lock : null;
  const phase = lockPhaseOf(lock, now, todayKey);
  const current = quoteAt(b, todayKey, now.session).price;
  const [server, setServer] = useState<LockServerState>({ lock: null, discountCode: null, validUntil: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/locks")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: LockServerState | null) => {
        if (alive && payload) setServer(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!lock) {
    return (
      <Sheet title="가격 잠금 상세" onClose={onClose}>
        <p className="note">잠금 기록을 찾지 못했어요. 마켓에서 오늘의 가격을 다시 확인해주세요.</p>
      </Sheet>
    );
  }

  /* 서버가 이미 발급한 차액 코드가 정본이다. 화면 시세와 발급 시점 가격이
     어긋나도 받은 쿠폰은 그대로 보여준다. */
  const issued = server.lock?.lock_code_amount_won ?? null;
  const difference = issued ?? Math.max(0, current - lock.lockedPrice);
  const applied = issued ? lock.lockedPrice : lockAppliedPriceWon(lock.lockedPrice, current);
  const issuedAmount = difference;
  const couponNeeded = phase === "protecting" && difference > 0;
  const canBuy = phase === "protecting" && (!couponNeeded || Boolean(server.discountCode));

  function goBuy() {
    if (!canBuy) return;
    window.open(`/api/out/cafe24/${b.tk}`, "_blank", "noopener");
  }

  async function copyCode() {
    if (!server.discountCode) return;
    try {
      await navigator.clipboard.writeText(server.discountCode);
      toast("✓", "쿠폰번호를 복사했어요", "자사몰 로그인 후 쿠폰번호를 등록해주세요");
    } catch {
      toast("⚠️", "복사하지 못했어요", "쿠폰번호를 길게 눌러 직접 복사해주세요");
    }
  }

  const statusText = phase === "holding"
      ? `${lockProtection(lock.session)?.label}에 가격을 비교해요`
      : phase === "protecting"
        ? difference > 0
          ? `${won(issuedAmount)}원 차액 쿠폰 발급 · 02:00 정가 전에 사세요`
          : "오후가가 더 낮아요 · 02:00 정가 전에 사세요"
        : phase === "purchased"
          ? "잠금 혜택으로 구매를 완료했어요"
          : "잠금가 구매 시간이 끝났어요";

  return (
    <Sheet
      title="가격 잠금 상세"
      onClose={onClose}
      hero={b}
      foot={
        canBuy ? (
          <button className="btn btn--blue" onClick={goBuy}>적용가 {won(applied)}원으로 사러 가기</button>
        ) : (
          /* 잠금가 적용 전·후에도 몰에는 갈 수 있다. 지금 가격으로 산다. */
          <div style={{ display: "grid", gap: 6 }}>
            <button className="btn btn--blue" onClick={() => window.open(`/api/out/cafe24/${b.tk}`, "_blank", "noopener")}>
              지금 {won(current)}원으로 구매하러 가기
            </button>
            <p className="note" style={{ margin: 0, textAlign: "center" }}>
              {phase === "holding"
                ? `잠금가 적용은 ${lockProtection(lock.session)?.label}부터예요`
                : phase === "protecting"
                  ? loading ? "차액 쿠폰 확인 중…" : "차액 쿠폰 발급 준비 중이에요"
                  : "잠금가 구매 시간이 끝났어요"}
            </p>
          </div>
        )
      }
    >
      <div className="lockdetail__head">
        <span className="lockdetail__badge"><LockIcon size={12} /> {SESSION_LABEL[lock.session]} 잠금 완료</span>
        <h4>{b.name}</h4>
        <p>{statusText}</p>
      </div>

      <div className="lockcompare" aria-label="잠금 가격 비교">
        <div>
          <span>{SESSION_LABEL[lock.session]} 잠금가</span>
          <b className="n">{won(lock.lockedPrice)}원</b>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span>{SESSION_LABEL[now.session]} 현재가</span>
          <b className="n">{won(current)}원</b>
        </div>
      </div>

      {phase === "protecting" ? (
        <div className={`lockbenefit${difference > 0 ? " is-issued" : ""}`}>
          <span>{difference > 0 ? "차액만큼 쿠폰 발급" : "더 낮은 가격 자동 적용"}</span>
          <b className="n">{difference > 0 ? `${won(issuedAmount)}원` : `${won(current)}원`}</b>
          {difference > 0 ? (
            server.discountCode ? (
              <button type="button" onClick={copyCode}>
                <span className="n">{server.discountCode}</span>
                <em>복사</em>
              </button>
            ) : (
              <small>오후가 확정 뒤 할인코드를 만들고 있어요. 잠시 후 다시 열어주세요.</small>
            )
          ) : null}
        </div>
      ) : null}

      <p className="note lockdetail__note">
        오전 잠금가보다 오후가가 오르면 오른 차액만큼 정액 쿠폰을 드려요. 가격이 내리면 더 낮은 오후가로 구매합니다.
        쿠폰과 오후가는 새벽 01:59까지, 02:00부터는 정가예요.
        쿠폰은 막지 자사몰 회원가입·로그인 후 쿠폰번호를 등록해야 적용돼요.
      </p>
    </Sheet>
  );
}

/* ══════════════════════════════════════════
   가격 잠금 — 하루 1회 · 오전가 또는 오후가 · 빵 한 개
   ══════════════════════════════════════════ */
export function LockSheet({ tk, onClose }: { tk: string; onClose: () => void }) {
  const { todayKey, toast } = useBreadMarket();
  const { session } = useSession();
  const b = breadOf(tk);
  const q = quoteAt(b, todayKey, session);
  const protection = lockProtection(session);
  /* 정가 → 오전장 → 오후장. 각 단계는 바로 앞 단계와 비교한다.
     아직 공개 전인 장은 가격 대신 공개 시각을 보여준다. */
  const ladder: { label: string; time: string; price: number | null; current?: boolean; base?: boolean }[] = [
    { label: "정가", time: "기준", price: b.base, base: true },
    { label: "오전장", time: "06:00", price: session === "list" ? null : quoteAt(b, todayKey, "am").price, current: session === "am" },
    { label: "오후장", time: "16:00", price: session === "pm" ? quoteAt(b, todayKey, "pm").price : null, current: session === "pm" },
  ];

  const [pending, setPending] = useState(false);

  /* 잠금은 서버가 확정한다. 하루 1회 제한을 브라우저에서 막으면 쿠키만 지워도
     뚫린다. 잠금가도 서버가 daily_prices 에서 읽는다 — 값을 보내게 하면
     원하는 가격에 잠글 수 있다.
     localStorage 는 서버가 받아준 뒤에만 따라 쓴다. */
  async function confirm() {
    if (!protection || pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: b.tk }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast("⚠️", "잠금하지 못했어요", payload.error ?? "잠시 후 다시 시도해주세요");
        return;
      }
      const lockedPrice = payload.lock.locked_price_won as number;
      lockPrice({ tk: b.tk, lockedPrice, session, dateKey: todayKey });
      toast("🔒", `${b.name} ${won(lockedPrice)}원 잠금`, `${protection.label} 잠금가로 살 수 있어요`);
      onClose();
    } catch {
      toast("⚠️", "잠금하지 못했어요", "네트워크 상태를 확인해주세요");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      title="이 가격을 잠그시겠어요?"
      onClose={onClose}
      hero={b}
      foot={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => window.open(`/api/out/cafe24/${b.tk}`, "_blank", "noopener")}>
            구매하러 가기
          </button>
          <button className="btn btn--blue" style={{ flex: 1.4 }} disabled={!protection || pending} onClick={confirm}>
            {pending ? "잠그는 중…" : `${SESSION_LABEL[session]} 가격 잠금`}
          </button>
        </div>
      }
    >
      <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div className="eyebrow">{SESSION_LABEL[session]} 가격</div>
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.045em" }}>{b.name}</div>
        <div className="n" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.05em", marginTop: 4 }}>{won(q.price)}원</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 3 }}>
          {protection ? `${protection.label} 이 가격 이하로 구매` : "잠금은 오전장(06:00–15:59)에만 할 수 있어요"}
        </div>
      </div>
      <ol className="ladder" aria-label="오늘 가격 흐름">
        {ladder.map((step, i) => {
          const prev = i > 0 ? ladder[i - 1].price : null;
          const pct = step.price !== null && prev ? (step.price / prev - 1) * 100 : null;
          return (
            <li key={step.label} className={`ladder__r${step.current ? " is-current" : ""}${step.price === null ? " is-pending" : ""}`}>
              <span className="ladder__l">
                {step.label}
                <small>{step.time}</small>
              </span>
              {step.price === null ? (
                <span className="ladder__wait">{step.time} 공개</span>
              ) : (
                <span className="ladder__v">
                  {pct !== null ? <em className={`n ${cls(pct)}`}>{signed(pct)}%</em> : null}
                  <b className={`n${step.base ? " is-base" : ""}`}>{won(step.price)}원</b>
                </span>
              )}
              {step.current && protection ? <span className="ladder__tag"><LockIcon size={11} />잠금</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="note" style={{ textAlign: "center", margin: "12px 0 14px" }}>
        가격은 16:00에 바뀌어요. 오후가가 오르면 차액만큼 쿠폰을 드리고, 내리면 더 싼 오후가로 사면 돼요. 02:00부터는 정가예요.
        <br />막지 자사몰에서는 가입 후 쿠폰번호를 등록해야 혜택이 적용돼요.
      </p>
    </Sheet>
  );
}

/* ══════════════════════════════════════════
   가격 예측 — 일반: 오늘 확정가 대비
   ══════════════════════════════════════════ */
export function PredictSheet({ onClose }: { onClose: () => void }) {
  const { todayKey, toast, predictions, refreshPredictions, instantRewards } = useBreadMarket();
  const { session } = useSession();
  const [voting, setVoting] = useState<Direction | null>(null);
  const [taking, setTaking] = useState(false);
  /* 리스크/리워드 중 고르게 한다. null 이면 아직 고르는 중, "predict" 면 방향 선택. */
  const [mode, setMode] = useState<"predict" | null>(null);
  const router = useRouter();
  /* 이번 회차 참여 여부는 서버가 안다. localStorage 만 보면 기록을 지운
     사람에게 참여 화면을 보여주고, 누르면 409 가 난다. */
  const submitted = predictions.find((p) => p.result === "pending") ?? null;
  /* 회차의 한 번을 안정형으로 썼으면 예측은 닫힌다. 서버도 409 로 막으므로
     (predictions/route.ts) 고르는 화면을 열어두면 눌렀을 때 실패만 한다. */
  const taken = instantRewards.find((r) => r.roundId === `${todayKey}-am`) ?? null;
  const b = predictBreadOf(todayKey);
  const q = quoteAt(b, todayKey, session);
  const ref = q.price;
  const round = predictionSchedule(todayKey, session === "am" ? 10 : 18);
  const targetLabel = round.label;
  /* 회차 보상률. 서버와 같은 함수·같은 장으로 뽑아 화면에 보인 값이 그대로
     저장된다 — 요청마다 새로 뽑으면 큰 값이 나올 때까지 새로고침할 수 있다. */
  const roundId = `${todayKey}-am`;
  /* 안정형만 숫자를 보여준다. 공격형은 걸 때 "?" 이고 결과가 나와야 안다 —
     그래서 화면이 뽑지 않고 서버가 제출할 때 뽑는다. */
  const safePct = instantRewardPct(roundId, round.submitSession);


  /* 예측도 서버가 확정한다. 한 회차 1회 제한과 기준가를 브라우저가 정하면
     쿠키만 지워도 뚫리고, 원하는 기준가로 참여할 수 있다.
     구매 후 기준가 예측은 1차 출시 범위 밖이다. */
  async function vote(direction: Direction) {
    if (voting) return;
    setVoting(direction);
    try {
      const response = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: b.tk, direction }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast("⚠️", "예측하지 못했어요", payload.error ?? "잠시 후 다시 시도해주세요");
        return;
      }
      // 서버가 정본이다. 로컬에 따로 쓰지 않고 목록을 다시 받는다.
      refreshPredictions();
      toast("🧭", "예측 참여 완료", `${payload.targetLabel ?? targetLabel}로 판정해요`);
    } catch {
      toast("⚠️", "예측하지 못했어요", "네트워크 상태를 확인해주세요");
    } finally {
      setVoting(null);
    }
  }

  /* 바로 받기 — 오늘 예측을 넘기고 확정 쿠폰을 받는다. 구매 여부는 확인할 수
     없으므로 "지금 사면" 이라고 말하지 않는다. */
  async function takeNow() {
    if (taking) return;
    setTaking(true);
    try {
      const response = await fetch("/api/predictions/instant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: b.tk }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast("⚠️", "받지 못했어요", payload.error ?? "잠시 후 다시 시도해주세요");
        return;
      }
      /* instantRewards 는 서버 prop 이라 라우터 갱신으로 내려온다. */
      router.refresh();
      refreshPredictions();
      toast(
        "⏳",
        `${payload.ratePct}% 할인코드 · ${payload.validHours ?? INSTANT_CODE_HOURS}시간 안에 쓰세요`,
        `${b.name} · MY 에서 남은 시간을 볼 수 있어요`,
      );
      onClose();
    } catch {
      toast("⚠️", "받지 못했어요", "네트워크 상태를 확인해주세요");
    } finally {
      setTaking(false);
    }
  }

  /* 1) 안정형으로 받았다 — 이 회차는 끝났다 */
  if (taken) {
    return (
      <Sheet title="내일 가격 예측" onClose={onClose} hero={b}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div className="eyebrow">받기 완료</div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.045em" }}>
            안정형 {taken.ratePct}% 할인코드
          </div>
          <div className="n" style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 4 }}>
            {taken.code ? `받은 뒤 ${INSTANT_CODE_HOURS}시간 안에 사용` : "사용 기간이 지났어요"}
          </div>
        </div>
        <p className="note" style={{ textAlign: "center" }}>
          {taken.code
            ? `쿠폰번호와 남은 시간은 MY 에서 볼 수 있어요. ${INSTANT_CODE_HOURS}시간이 지나면 사라져요.`
            : "이번 회차 몫은 안정형으로 받으셨어요."}
          {" "}예측은 다음 날에 다시 열려요 < br/>회차당 한 번, 둘 중 하나만이에요.
        </p>
      </Sheet>
    );
  }

  /* 2) 참여 전 (서버 확인 중이면 참여 화면을 먼저 보여준다) */
  if (!submitted || voting) {
    return (
      <Sheet title="내일 가격 예측" onClose={onClose} hero={b}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="eyebrow">오늘의 예측 종목</div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.045em" }}>{b.name}</div>
          <div className="n" style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 700, marginTop: 5 }}>
            지금 가격 {won(ref)}원 기준
          </div>
        </div>
        {mode === null ? (
          <>
            <p className="lead" style={{ textAlign: "center", fontSize: 16 }}>
              지금 받을까요, 내일 걸어볼까요?
              <small>둘 중 하나만 · 하루 한 번 · 이 빵에만 쓸 수 있어요</small>
            </p>
            <div className="riskpick">
              <button className="riskpick__b" onClick={takeNow} disabled={taking}>
                <em>안정형 투자</em>
                <b className="n">{safePct}%</b>
                <span>{taking ? "받는 중…" : `지금 받고 ${INSTANT_CODE_HOURS}시간 안에`}</span>
              </button>
              <button className="riskpick__b riskpick__b--bet" onClick={() => setMode("predict")} disabled={taking}>
                <em>공격형 투자</em>
                <b className="n">?</b>
                <span>내일 맞히기</span>
              </button>
            </div>
            <ul className="riskpick__x">
              <li>
                <b>안정형</b> 매일 {INSTANT_REWARD_MIN_PCT}~{INSTANT_REWARD_MAX_PCT}% 중 하나예요.
                오늘은 <strong className="n">{safePct}%</strong>이고, 누르면 그 자리에서 받아요.
                <strong>받은 뒤 {INSTANT_CODE_HOURS}시간 안에 구매를 마쳐야</strong> 쓸 수 있어요 — 그 뒤에는 사라져요.
              </li>
              <li>
                <b>공격형</b> {PREDICTION_REWARD_MIN_PCT}~{PREDICTION_REWARD_MAX_PCT}% 중 하나가 걸려요.
                몇 %인지는 <strong>내일 결과가 나와야</strong> 알 수 있어요. 틀리지만 않으면 받고,
                가격이 같아도 무승부로 받아요.
              </li>
              <li>둘 중 하나만 · 하루 한 번 · 이 빵에만 쓸 수 있어요.</li>
            </ul>
          </>
        ) : (
        <>
        <p className="lead" style={{ textAlign: "center", fontSize: 16 }}>
          {targetLabel}, 오를까요 내릴까요?
          <small>공격형 · 맞히면 {PREDICTION_REWARD_MIN_PCT}~{PREDICTION_REWARD_MAX_PCT}% 중 하나 · 하루 한 번</small>
        </p>
        <div className="vote">
          {(["up", "down"] as const).map((v) => (
            <button
              key={v}
              className={`voteb ${v}${voting === v ? " is-on" : voting ? " is-off" : ""}`}
              onClick={() => vote(v)}
              aria-pressed={voting === v}
            >
              <i aria-hidden="true">{v === "up" ? "▲" : "▼"}</i>
              <b>{v === "up" ? "오른다" : "내린다"}</b>
              <span>{v === "up" ? `${won(ref)}원보다 비싸진다` : `${won(ref)}원보다 싸진다`}</span>
            </button>
          ))}
        </div>
        <p className="note" style={{ textAlign: "center" }}>
          몇 %인지는 내일 결과와 함께 알려드려요. 가격이 같아도 무승부로 받아요. 막지 자사몰 가입 후 쿠폰번호를 등록해야 주문에 적용돼요.
        </p>
        <button className="btn btn--ghost btn--sm" style={{ width: "100%" }} onClick={() => setMode(null)}>
          다시 고르기
        </button>
        </>
        )}
      </Sheet>
    );
  }

  /* 3) 참여 후 — 판정은 가격 산정 크론이 한다. 결과와 할인코드는 MY 에서 본다. */
  const chosen = submitted.direction === "up" ? "오른다" : "내린다";
  return (
    <Sheet title="내일 가격 예측" onClose={onClose} hero={b}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div className="eyebrow">참여 완료</div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.045em" }}>
          {submitted.products?.name ?? b.name} · {chosen}
        </div>
        <div className="n" style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 4 }}>
          기준가 {won(submitted.reference_price_won)}원 · {submitted.target_publish_date}{" "}
          {submitted.target_session === "am" ? "오전가" : "오후가"}로 판정
        </div>
      </div>
      <p className="note" style={{ textAlign: "center" }}>
        결과는 06:00에 MY 에서 확인할 수 있어요. 틀리지만 않으면 할인코드를 드려요 —
        몇 %인지는 그때 함께 알려드려요. 가격이 같아도 무승부로 드려요.
      </p>
    </Sheet>
  );
}

/* ══════════════════════════════════════════
   내 기록 — MY 상단 통계를 누르면 열린다.

   다른 "누르면 자세히" 가 전부 시트로 열리는데 여기만 아래로 펼치면 같은 동작이
   화면마다 다르게 보인다. 목록도 길어져 아래 내용을 밀어낸다.
   ══════════════════════════════════════════ */
const HISTORY_LABEL: Record<string, { title: string; tone: string }> = {
  pending: { title: "판정 대기", tone: "flat" },
  hit: { title: "적중", tone: "down" },
  miss: { title: "미적중", tone: "flat" },
  void: { title: "무승부", tone: "flat" },
};

/** 결과 옆 꼬리표. 맞혔는데 코드가 없을 때만 왜인지 한 단어로 덧붙인다. */
function tagOf(p: ServerPrediction): string {
  if (p.result !== "hit" && p.result !== "void") return "";
  if (p.reward?.code) return " · 코드";
  if (p.reward_rate_pct === 0) return " · 보상 0%";
  if (p.reward) return " · 만료";
  return " · 발급 중";
}

export function HistorySheet({ onClose }: { onClose: () => void }) {
  const { predictions, instantRewards } = useBreadMarket();
  const plays = predictions.length + instantRewards.length;
  const hits = predictions.filter((p) => p.result === "hit" || p.result === "void").length;
  /* reward_rate_pct 는 제출할 때 박히므로 판정 전에도 0 이 아니다. 판정된 것만 센다. */
  const codes =
    predictions.filter((p) => (p.result === "hit" || p.result === "void") && p.reward_rate_pct > 0).length +
    instantRewards.length;

  return (
    <Sheet title="내 기록" onClose={onClose}>
      <div className="histsum">
        <div><b className="n">{plays}</b><span>참여</span></div>
        <div><b className="n">{hits}</b><span>적중</span></div>
        <div><b className="n">{codes}</b><span>받은 코드</span></div>
      </div>

      {plays === 0 ? (
        <p className="note" style={{ textAlign: "center", marginTop: 18 }}>
          아직 기록이 없어요.
        </p>
      ) : (
        <ul className="histlist">
          {instantRewards.map((r) => (
            <li className="histrow" key={`i-${r.roundId}`}>
              <div>
                <b>{r.product?.name ?? "바로 받기"}</b>
                <span className="n">{r.roundId.slice(0, 10)} · 안정형으로 바로 받음</span>
              </div>
              <em className="down">{r.ratePct}%</em>
            </li>
          ))}
          {predictions.map((p) => {
            const label = HISTORY_LABEL[p.result] ?? HISTORY_LABEL.pending;
            const diff = p.result_price_won !== null ? p.result_price_won - p.reference_price_won : null;
            return (
              <li className="histrow" key={p.id}>
                <div>
                  <b>{p.products?.name ?? ""} · {p.direction === "up" ? "오른다" : "내린다"}</b>
                  <span className="n">
                    {p.target_publish_date} 오전가 · 기준가 {won(p.reference_price_won)}원
                    {diff !== null
                      ? ` → ${won(p.result_price_won!)}원 (${diff > 0 ? "+" : diff < 0 ? "−" : ""}${won(Math.abs(diff))}원)`
                      : ""}
                  </span>
                </div>
                <em className={label.tone}>{label.title}{tagOf(p)}</em>
              </li>
            );
          })}
        </ul>
      )}

      <p className="note" style={{ marginTop: 14 }}>이 브라우저 기준 · 최근 100회</p>
    </Sheet>
  );
}
