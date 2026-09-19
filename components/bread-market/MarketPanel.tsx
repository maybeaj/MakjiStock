"use client";

import { useMemo, useState } from "react";
import {
  BREADS,
  addDays,
  arrow,
  changeAt,
  cls,
  dirColor,
  fixed,
  fxShownAt,
  shortOf,
  fxLabel,
  linePath,
  seriesAt,
  surgeOf,
  makjiIndexAt,
  makjiIndexOf,
  predictBreadOf,
  quoteAt,
  signed,
  won,
  ymdOf,
} from "@/lib/bread-market/engine";
import { lockPhaseOf } from "@/lib/bread-market/flow";
import {
  CONSUMER_REWARD_NOTICE,
  SESSION_LABEL,
  lockAppliedPriceWon,
  lockProtection,
} from "@/lib/bread-market/reward-policy";
import { useBreadState, useSession } from "@/lib/bread-market/store";
import { useBreadMarket } from "./context";
import { LockIcon, Photo } from "./sheets";

type Sort = "drop" | "price" | "name";
const SORTS: { id: Sort; label: string }[] = [
  { id: "drop", label: "많이 내린 순" },
  { id: "price", label: "가격 순" },
  { id: "name", label: "이름 순" },
];

/* 막지지수 91일 추이 — 기획안 백테스트 검증 기간과 같은 길이 */
function IndexDash({
  todayKey,
  dataVersion,
  compact = false,
}: {
  todayKey: string;
  dataVersion: number;
  /** 히어로 박스 안에서는 지수 값이 바로 옆에 이미 있어 머리말을 뺀다. */
  compact?: boolean;
}) {
  const { keys, vals } = useMemo(() => {
    /* 시세는 engine 의 모듈 저장소에 있어 이 함수의 인자로 들어오지 않는다.
       dataVersion 을 읽어 두어야 실시세가 주입됐을 때 다시 계산된다. */
    void dataVersion;
    const keys: string[] = [];
    const vals: number[] = [];
    for (let i = 90; i >= 0; i--) {
      const k = addDays(todayKey, -i);
      keys.push(k);
      vals.push(makjiIndexOf(k));
    }
    return { keys, vals };
  }, [todayKey, dataVersion]);
  const W = 300;
  const H = compact ? 58 : 86;
  const P = 4;
  const pt = linePath(vals, W, H, P);
  const last = vals[vals.length - 1];
  const dd = last - vals[0];
  const col = dd < 0 ? "var(--down)" : dd > 0 ? "var(--up)" : "var(--ink-3)";

  const line = (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="막지지수 91일 추이">
      <defs>
        <linearGradient id={compact ? "dashGc" : "dashG"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity=".18" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${pt.d} L${W - P} ${H} L${P} ${H} Z`} fill={`url(#${compact ? "dashGc" : "dashG"})`} />
      <path d={pt.d} fill="none" stroke={col} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pt.lx.toFixed(1)} cy={pt.ly.toFixed(1)} r="2.6" fill={col} />
    </svg>
  );

  if (compact) {
    return (
      <div className="hero-spark">
        <div className="hero-spark__c">{line}</div>
        <div className="hero-spark__x n">
          <span>{ymdOf(keys[0])}</span>
          <span>91일</span>
          <span>{ymdOf(keys[keys.length - 1])}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="dash__h">
        <span className="dash__t">
          막지지수 추이 <small style={{ color: "var(--ink-3)", fontWeight: 700 }}>91일</small>
        </span>
        <span className="dash__now">
          <b className="n">{fixed(last, 2)}</b>
          <em className={`n ${cls(dd)}`}>{arrow(dd)} {signed(dd, 2)}</em>
        </span>
      </div>
      <div className="dash__body">
        <div className="dash__c">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="막지지수 91일 추이">
            <defs>
              <linearGradient id="dashG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={col} stopOpacity=".18" />
                <stop offset="100%" stopColor={col} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${pt.d} L${W - P} ${H} L${P} ${H} Z`} fill="url(#dashG)" />
            <path d={pt.d} fill="none" stroke={col} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <circle cx={pt.lx.toFixed(1)} cy={pt.ly.toFixed(1)} r="2.6" fill={col} />
          </svg>
        </div>
        <div className="dash__y">
          <span className="n">{fixed(pt.hi, 1)}</span>
          <span className="n">{fixed(pt.lo, 1)}</span>
        </div>
      </div>
      <div className="dash__x n">
        <span>{ymdOf(keys[0])}</span>
        <span>{ymdOf(keys[keys.length - 1])}</span>
      </div>
      <div className="dash__f">
        정가를 100으로 둔 다섯 종의 평균 가격 수준입니다. 낮을수록 더 싸게 사는 날이고, 이 기간{" "}
        <b className="n">{fixed(pt.lo, 1)}</b>까지 내려간 적이 있습니다.
      </div>
    </div>
  );
}

const PHASE_TEXT = {
  holding: "16:00 오후가가 오르면 오른 만큼 쿠폰을 드려요. 내리면 더 싼 오후가로 사면 돼요.",
  expired: "잠금가 구매 시간이 지났어요. 잠금권은 하루 1개라 내일 06:00부터 다시 잠글 수 있어요.",
};

function LockCard({ todayKey }: { todayKey: string }) {
  const { openSheet } = useBreadMarket();
  const my = useBreadState();
  const now = useSession();
  const session = now.session;
  const lock = my.lock;
  const phase = lockPhaseOf(lock, now, todayKey);
  const lockUsed = Boolean(lock && lock.dateKey === todayKey);
  if (!lock || phase === "none" || (phase === "expired" && !lockUsed)) {
    return (
      <div className="lockcard is-empty">
        <b><LockIcon size={13} /> 오전가 잠금 · 하루 1개</b>
        <span>오후가 오르면 차액 쿠폰, 내리면 더 싸게.{session === "am" ? "" : ` 다음 잠금은 ${session === "pm" ? "내일" : "오늘"} 06:00.`}</span>
      </div>
    );
  }
  const b = BREADS.find((x) => x.tk === lock.tk) ?? BREADS[0];
  const nowPrice = quoteAt(b, todayKey, session).price;
  const applied = lockAppliedPriceWon(lock.lockedPrice, nowPrice);
  const protection = lockProtection(lock.session);
  return (
    <button className="lockcard" onClick={() => openSheet({ type: "locked-detail", tk: b.tk })}>
      <span className="lockcard__ph"><Photo bread={b} /></span>
      <span className="lockcard__t">
        <em><LockIcon size={11} filled /> {SESSION_LABEL[lock.session]} 잠금 · {protection?.label}</em>
        <b>{b.name}</b>
        <span className="n">잠금가 {won(lock.lockedPrice)}원 · 현재 {won(nowPrice)}원</span>
        <small>
          {phase === "protecting"
            ? nowPrice > lock.lockedPrice
              ? `${won(applied)}원에 살 수 있어요 (차액 쿠폰 ${won(nowPrice - lock.lockedPrice)}원) · 02:00 정가 전에 사세요`
              : "오후가가 더 싸요. 02:00 정가로 돌아가기 전에 사세요."
            : phase === "purchased"
              ? `구매 완료 · ${won(applied)}원`
              : PHASE_TEXT[phase]}
        </small>
      </span>
    </button>
  );
}

export function MarketPanel() {
  const { todayKey, openSheet, dataVersion, predictions } = useBreadMarket();
  const now = useSession();
  const { session } = now;
  const my = useBreadState();
  const [sort, setSort] = useState<Sort>("drop");
  const idxT = makjiIndexAt(todayKey, session);
  /* 직전 가격 대비 지수 변화 = 6종 등락(정가 대비 %p)의 평균.
     changeAt 이 이월된 장은 마지막 실제 등락을 돌려주므로 주말 오후·미공개 장도 0 이 아니다. */
  const idxD = (BREADS.reduce((sum, b) => sum + changeAt(b, todayKey, session).amount / b.base, 0) / BREADS.length) * 100;
  const fx = fxShownAt(todayKey, session);
  // 급등주 — 전일 대비 검색지수가 가장 많이 오른 한 종. 아무도 안 올랐으면 없다.
  const listTime = session === "list"; // 02:00–05:59 정가 시간: 퍼센트 없이 정가만
  const surge = listTime ? null : surgeOf(todayKey, session);

  const rows = useMemo(() => {
    void dataVersion; // 실시세가 주입되면 가격·등락이 바뀐다
    const arr = BREADS.map((b) => ({ b, q: quoteAt(b, todayKey, session), d: changeAt(b, todayKey, session) }));
    if (sort === "drop") arr.sort((x, y) => x.d.pct - y.d.pct);
    if (sort === "price") arr.sort((x, y) => y.q.price - x.q.price);
    if (sort === "name") arr.sort((x, y) => x.b.name.localeCompare(y.b.name, "ko"));
    return arr;
  }, [sort, todayKey, session, dataVersion]);

  const pb = predictBreadOf(todayKey);
  const pq = quoteAt(pb, todayKey, session);
  // 예측 상태도 서버가 정본이다. 가장 최근 한 건으로 배지를 정한다.
  const latest = predictions[0];
  const predState = !latest
    ? "참여 →"
    : latest.result === "pending"
      ? "참여 완료"
      : latest.result === "hit"
        ? "적중 🎯"
        : latest.result === "void"
          ? "무효"
          : "아쉬움";

  return (
    <section className="panel is-on" aria-label="오늘의 빵 마켓">
      <div className="mkthead">
        <div className="mkthead__k"><span aria-hidden="true">🍞</span> 매일 06:00 · 16:00, 새롭게 구워지는 시세</div>
        <h2 className="mkthead__t">맛있는 타이밍,<br /><em>오늘의 빵 마켓</em></h2>
        <div className="mkthead__row">
          <div>
            <span className="mkthead__v n">{fixed(idxT, 2)}</span>
            <span className="mkthead__u">pt</span>
            <div className="mkthead__d">
              {listTime ? (
                <>
                  <b>정가 시간</b>
                  <span>06:00에 오전가가 나와요</span>
                </>
              ) : (
                <>
                  <b className="n"><span className={cls(idxD)}>{arrow(idxD)} {signed(idxD, 2)}pt</span></b>
                  <span>직전 가격 대비</span>
                </>
              )}
            </div>
          </div>
          <IndexDash todayKey={todayKey} dataVersion={dataVersion} compact />
        </div>
        <p className="mkthead__note">
          {listTime ? (
            <>지금은 <b>정가 시간</b>이에요(02:00–05:59). 모든 빵이 정가이고, 06:00에 오전가가 나와요.</>
          ) : (
            <>
              {session === "pm" ? <><b>02:00부터 정가</b>로 돌아가요 · </> : null}지금 <b>{SESSION_LABEL[session]}</b> · 정가 100 기준 {BREADS.length}종 평균 가격 수준. 환율 <b className="n">{fxLabel(fx.drop)}</b> ({shortOf(fx.at)} 기준)
            </>
          )}
        </p>
      </div>

      <div className="sect sect--tight">
        <LockCard todayKey={todayKey} />
      </div>

      <div className="sect sect--tight">
      </div>

      <div className="sortbar">
        <span className="sortbar__l">정렬</span>
        <div className="chiprow" role="group" aria-label="정렬">
          {SORTS.map((s) => (
            <button key={s.id} className={`chip${sort === s.id ? " is-on" : ""}`} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mktlist" id="mktlist">
        {rows.map(({ b, q, d }) => {
          const c = cls(d.pct);
          const col = listTime ? dirColor("flat") : dirColor(c);
          const p = linePath(seriesAt(b, todayKey, 7, session).map((s) => s.q.price), 54, 26, 3);
          const lock = my.lock;
          const lockedHere = Boolean(lock && lock.dateKey === todayKey && lock.tk === b.tk);
          const lockUsedElsewhere = Boolean(lock && lock.dateKey === todayKey && lock.tk !== b.tk);
          const lockDisabled = session !== "am" || lockUsedElsewhere;
          const lockLabel = lockedHere ? "잠금됨" : session === "am" ? "오전장" : "06시";
          return (
            <div className="quote" key={b.tk}>
              <button className="quote__main" onClick={() => openSheet({ type: "detail", tk: b.tk })}>
                <span className="quote__ph"><Photo bread={b} /></span>
                <span className="quote__nm">
                  <b>
                    {b.name}
                    {surge && b.tk === surge.b.tk ? (
                      <em
                        className="surge"
                        title={`검색지수 ${fixed(surge.q.searchIdx, 1)} · 전일 대비 ${signed(surge.q.searchChange, 1)}`}
                      >
                        급등주
                      </em>
                    ) : null}
                  </b>
                  <span><em>{b.tk}</em> 정가 {listTime ? <span className="n">{won(b.base)}원</span> : <s className="n">{won(b.base)}원</s>}</span>
                  <svg className="quote__sp" viewBox="0 0 54 26" preserveAspectRatio="none" aria-hidden="true">
                    <path d={p.d} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={p.lx.toFixed(1)} cy={p.ly.toFixed(1)} r="2" fill={col} />
                  </svg>
                </span>
              </button>
              <button className="quote__rt" onClick={() => openSheet({ type: "detail", tk: b.tk })} aria-label={`${b.name} ${won(q.price)}원 상세 보기`}>
                <b className="quote__p n">{won(q.price)}원</b>
                {listTime ? (
                  <em className="quote__d flat">정가</em>
                ) : (
                  <em className={`quote__d n ${c}`} title={`직전 ${won(d.previousPrice)}원 대비 ${signed(d.amount, 0)}원`}>
                    {arrow(d.pct)} {signed(d.pct)}%
                  </em>
                )}
              </button>
              <button
                className={`quote__lock${lockedHere ? " is-locked" : ""}`}
                disabled={lockDisabled && !lockedHere}
                onClick={() => openSheet({ type: lockedHere ? "locked-detail" : "lock", tk: b.tk })}
                aria-label={lockedHere ? `${b.name} 잠금 상세 보기` : `${b.name} ${SESSION_LABEL[session]} 가격 잠금`}
                aria-pressed={lockedHere}
              >
                <LockIcon open={!lockedHere} filled={lockedHere} size={16} />
                <small>{lockLabel}</small>
              </button>
            </div>
          );
        })}
      </div>

      <div className="sect">
        <button className="predcard" onClick={() => openSheet({ type: "predict" })}>
          <div className="predcard__k">TOMORROW&rsquo;S BREAD</div>
          <h3 className="predcard__t">내일 이 빵, 오를까 내릴까</h3>
          <p className="predcard__d">내일 06:00 오전가, 오를까 내릴까? 틀리지만 않으면 5% 쿠폰.<br />결과는 06:00 공개</p>
          <div className="predcard__b">
            <div>
              <b>{pb.name}</b>
              <span>지금 {won(pq.price)}원 · 내일 06:00 오전가로 판정</span>
            </div>
            <em>{predState}</em>
          </div>
        </button>
      </div>


      <div className="sect">
        <p className="note">
          {CONSUMER_REWARD_NOTICE} 가격은 검색 관심만큼 최대 15% 할인되고, 환율이 내리면 그만큼 더 싸지고 오르면 절반만 덜 싸집니다. 합쳐서 최대 38%이고 정가보다 비싸지지 않습니다.
          오전장 06:00, 오후장 16:00에 가격이 바뀌고 02:00~05:59는 정가입니다. 실제 결제는 막지 자사몰에서 진행됩니다.
        </p>
      </div>
    </section>
  );
}
