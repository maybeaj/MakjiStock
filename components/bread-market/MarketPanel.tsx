"use client";

import { useMemo, useState } from "react";
import { RollingNumber } from "./RollingNumber";
import {
  BREADS,
  addDays,
  arrow,
  discMark,
  changeAt,
  cls,
  dirColor,
  fixed,
  fxShownAt,
  isListPriceAt,
  isListPriceDay,
  shortOf,
  fxLabel,
  linePath,
  seriesAt,
  surgeOf,
  makjiIndexAt,
  makjiIndexOf,
  predictBreadOf,
  quoteAt,
  priceSlotAt,
  signed,
  won,
  ymdOf,
} from "@/lib/bread-market/engine";
import { lockPhaseOf } from "@/lib/bread-market/flow";
import { predictionSchedule } from "@/lib/predictions/schedule";
import {
  CONSUMER_REWARD_NOTICE,
  SESSION_LABEL,
  instantRewardPct,
  lockAppliedPriceWon,
  lockOpensOn,
  lockProtection,
} from "@/lib/bread-market/reward-policy";
import { useBreadState, useSession } from "@/lib/bread-market/store";
import { useBreadMarket } from "./context";
import { LockIcon, Photo } from "./sheets";

type Sort = "drop" | "price" | "name";
/* 화면에 뜬 값이 온 슬롯의 이름. 오후가가 없는 날은 오전가가 올라오므로
   요청한 장이 아니라 실제 슬롯으로 붙인다 (engine.ts priceSlotAt). */
const PRICE_SLOT_LABEL: Record<string, string> = { am: "오전가", pm: "오후가", list: "정가" };

const SORTS: { id: Sort; label: string }[] = [
  { id: "drop", label: "할인 많은 순" },
  { id: "price", label: "가격 순" },
  { id: "name", label: "이름 순" },
];

/* 막지지수 91일 추이 — 기획안 백테스트 검증 기간과 같은 길이 */
function IndexDash({
  todayKey,
  compact = false,
}: {
  todayKey: string;
  /** 히어로 박스 안에서는 지수 값이 바로 옆에 이미 있어 머리말을 뺀다. */
  compact?: boolean;
}) {
  const { keys, vals } = useMemo(() => {
    const keys: string[] = [];
    const vals: number[] = [];
    for (let i = 90; i >= 0; i--) {
      const k = addDays(todayKey, -i);
      keys.push(k);
      vals.push(makjiIndexOf(k));
    }
    return { keys, vals };
  }, [todayKey]);
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
  const { openSheet, lock: server } = useBreadMarket();
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
        <span>
          {lockOpensOn(todayKey)
            ? `오후가 오르면 차액 쿠폰, 내리면 더 싸게.${session === "am" ? "" : ` 다음 잠금은 ${session === "pm" ? "내일" : "오늘"} 06:00.`}`
            : "주말은 환율이 쉬어 오후가가 나오지 않아요. 잠금은 월요일 06:00에 다시 열려요."}
        </span>
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
          {/* 쿠폰이 실제로 발급됐는지는 서버만 안다. 가격 차이만 보고 "차액 쿠폰 N원"
              이라고 하면 크론이 늦거나 보류된 날 없는 쿠폰을 약속하게 된다. */}
          {phase === "protecting"
            ? nowPrice > lock.lockedPrice
              ? server.discountCode
                ? `${won(applied)}원에 살 수 있어요 (차액 쿠폰 ${won(server.lock?.lock_code_amount_won ?? nowPrice - lock.lockedPrice)}원) · 02:00 정가 전에 사세요`
                : "오후가가 올랐어요. 차액 쿠폰을 만들고 있어요 — 잠시 후 MY 에서 확인하세요."
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
  const { todayKey, openSheet, predictions, instantRewards } = useBreadMarket();
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
  /* 정가면 퍼센트를 떼고 정가만 보여준다. 02:00–05:59 정가 시간이거나, 오늘 가격이
     아직 안 나온 시간대다 (engine.ts isListPriceAt). */
  const listTime = isListPriceDay(todayKey, session);
  const listHour = session === "list"; // 정가 "시간" 인지, 가격이 없어서 정가인지
  const surge = listTime ? null : surgeOf(todayKey, session);

  const rows = useMemo(() => {
    const arr = BREADS.map((b) => ({ b, q: quoteAt(b, todayKey, session), d: changeAt(b, todayKey, session) }));
    /* 행에 뜨는 숫자가 정가 대비 할인율이므로 정렬도 그 값으로 한다. 어제 대비
       등락(d.pct)으로 줄을 세우면 "많이 내린 순" 인데 퍼센트가 뒤죽박죽이다 —
       어제 많이 내린 빵이 정가 대비로는 할인이 작을 수 있다.
       vsBase 가 작을수록 정가에서 많이 빠진 것이다 (engine.ts topDropOf 와 같은 기준). */
    if (sort === "drop") arr.sort((x, y) => x.q.vsBase - y.q.vsBase);
    if (sort === "price") arr.sort((x, y) => y.q.price - x.q.price);
    if (sort === "name") arr.sort((x, y) => x.b.name.localeCompare(y.b.name, "ko"));
    return arr;
  }, [sort, todayKey, session]);

  const locksOpen = lockOpensOn(todayKey);

  /* 이 카드는 "지금 열려 있는 회차에 참여했나"만 말한다. 지난 회차 결과(적중·무효·
     아쉬움)를 여기 띄우면 날이 바뀌어 다시 참여할 수 있는데도 어제의 적중 배지가
     남는다. 결과는 MY 에 있다. */
  const round = predictionSchedule(todayKey, session === "am" ? 10 : 18);
  const openRound = round.targetDate;
  const joined = predictions.find(
    (p) => p.target_publish_date === openRound && p.target_session === "am",
  );
  /* 회차당 참여는 한 번뿐이고 안정형·공격형이 그 한 번을 나눠 쓴다. 안정형으로
     썼으면 예측은 닫힌다 — 서버도 409 로 막는다(predictions/route.ts).
     만료된 쿠폰도 내려오므로 3시간이 지나도 이 판정은 그대로다. */
  const tookInstant = instantRewards.some((r) => r.roundId === `${todayKey}-am`);
  const predState = tookInstant ? "받기 완료" : joined ? "참여 완료" : "참여 →";

  // 참여했으면 내가 고른 빵을, 아니면 오늘의 추천 빵을 보여준다.
  const joinedBread = joined ? BREADS.find((b) => b.tk === joined.products?.ticker) : undefined;
  const pb = joinedBread ?? predictBreadOf(todayKey);
  const pq = quoteAt(pb, todayKey, session);

  return (
    <section className="panel is-on" aria-label="오늘의 빵 마켓">
      <div className="mkthead">
        <div className="mkthead__k"><span aria-hidden="true">🍞</span> 매일 06:00 · 16:00, 새롭게 구워지는 시세</div>
        <h2 className="mkthead__t">
          맛있는 타이밍,<br />
          <em>오늘의 빵 마켓</em>
          {/* 지금 어느 장인지는 제목 옆에서 한눈에 잡히게 한다. */}
          <b className="mkthead__ses">{SESSION_LABEL[session]}</b>
        </h2>
        <div className="mkthead__row">
          <div>
            <span className="mkthead__v n">{fixed(idxT, 2)}</span>
            <span className="mkthead__u">pt</span>
            <div className="mkthead__d">
              {listTime ? (
                <>
                  <b>{listHour ? "정가 시간" : "가격 준비 중"}</b>
                  <span>{listHour ? "06:00에 오전가가 나와요" : "오늘 가격이 아직 나오지 않았어요"}</span>
                </>
              ) : (
                <>
                  <b className="n"><span className={cls(idxD)}>{arrow(idxD)} {signed(idxD, 2)}pt</span></b>
                  <span>정가 100 기준 {BREADS.length}종 평균 수준</span>
                </>
              )}
            </div>
          </div>
          <IndexDash todayKey={todayKey} compact />
        </div>
        <p className="mkthead__note">
          {listTime ? (
            listHour ? (
              <>지금은 <b>정가 시간</b>이에요(02:00–05:59). 모든 빵이 정가이고, 06:00에 오전가가 나와요.</>
            ) : (
              <>오늘 가격이 아직 나오지 않아 <b>정가</b>로 보여드려요. 준비되는 대로 바뀌어요.</>
            )
          ) : (
            <>
              {session === "pm" ? <><b>02:00부터 정가</b>로 돌아가요 · </> : null}환율 <b className="n">{fxLabel(fx.drop)}</b> ({shortOf(fx.at)} 기준)
            </>
          )}
        </p>
      </div>

      <div className="sect sect--tight">
        <LockCard todayKey={todayKey} />
      </div>

      {/* 숫자와 색이 서로 다른 것을 재기 때문에 한 줄 적어 둔다. */}
      <div className="sect sect--tight">
        <p className="note">
          숫자는 <b>정가 대비 할인율</b>이라 화살표는 늘 <b>▼</b>예요. 색이 <b>전장 대비 등락</b>이고요.
          <br />
          빵값이 오른 장은 <b className="up">빨강</b>, 내린 장은 <b className="down">▼ 파랑</b>,
          전장과 같으면 <b className="flat">— 회색</b>이에요.
        </p>
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
          const rowList = isListPriceAt(b, todayKey, session);
          /* 색은 직전 확정가 대비 등락(상승 빨강·하락 파랑·보합 회색), 숫자는 정가 대비
             할인율이다. 소비자가 결정에 쓰는 값은 "어제보다 얼마 움직였나" 가 아니라
             "정가에서 얼마 빠졌나" 다. 산식 상 판매가가 정가를 넘지 않으므로 0 이상이다.

             화살표는 언제나 ▼ 다(discMark). 숫자가 정가에서 내려온 폭이라 방향이 하나뿐이고,
             가격 방향으로 돌리면 "▲ 6.3%" 가 "6.3% 올랐다" 로 읽혀 할인율이 등락률로
             보인다. 상단 티커(Shell.tsx)도 같은 규칙이다. */
          const offPct = Math.max(0, -q.vsBase);
          const col = rowList ? dirColor("flat") : dirColor(c);
          const p = linePath(seriesAt(b, todayKey, 7, session).map((s) => s.q.price), 54, 26, 3);
          const lock = my.lock;
          const lockedHere = Boolean(lock && lock.dateKey === todayKey && lock.tk === b.tk);
          const lockUsedElsewhere = Boolean(lock && lock.dateKey === todayKey && lock.tk !== b.tk);
          const lockDisabled = session !== "am" || lockUsedElsewhere || !locksOpen;
          /* 지금이 어느 장인지로 통일한다. 잠금이 안 되는 시간대에 "06시" 를 띄우면
             그것만 시각이라 한 줄에 장 이름과 시각이 섞인다. 언제 열리는지는 잠금
             카드와 시트가 따로 말한다. */
          const lockLabel = lockedHere ? "잠금됨" : !locksOpen ? "휴장" : SESSION_LABEL[session];
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
                  <span><em>{b.tk}</em> 정가 {rowList ? <span className="n">{won(b.base)}원</span> : <s className="n">{won(b.base)}원</s>}</span>
                  <svg className="quote__sp" viewBox="0 0 54 26" preserveAspectRatio="none" aria-hidden="true">
                    <path d={p.d} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={p.lx.toFixed(1)} cy={p.ly.toFixed(1)} r="2" fill={col} />
                  </svg>
                </span>
              </button>
              <button className="quote__rt" onClick={() => openSheet({ type: "detail", tk: b.tk })} aria-label={`${b.name} ${won(q.price)}원 상세 보기`}>
                <b className="quote__p n"><RollingNumber value={q.price} /></b>
                {rowList ? (
                  <em className="quote__d flat">정가</em>
                ) : (
                  <em
                    className={`quote__d n ${c}`}
                    title={`정가 ${won(b.base)}원 대비 ${fixed(offPct)}% 할인 · 직전 ${won(d.previousPrice)}원 대비 ${signed(d.amount, 0)}원 (${signed(d.pct)}%)`}
                  >
                    {discMark(d.pct)} {fixed(offPct)}%
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
          <h3 className="predcard__t">{tookInstant ? "오늘 몫은 받으셨어요" : "내일 이 빵, 오를까 내릴까"}</h3>
          <p className="predcard__d">
            {tookInstant
              ? "안정형으로 받으셨어요 · 예측은 다음 장에 · MY 에서 남은 시간 확인"
              : `안정형 ${instantRewardPct(`${todayKey}-am`, round.submitSession)}% 확정 · 공격형 ? · 결과는 06:00 공개`}
          </p>
          <div className="predcard__b">
            <div>
              <b>{pb.name}{joined ? ` · ${joined.direction === "up" ? "오른다" : "내린다"}` : ""}</b>
              {/* 판정이 오전가로만 나므로 지금 값도 어느 장의 가격인지 밝힌다.
                  "지금 N원" 은 그 N 이 오전가인지 오후가인지 말해주지 않는다.
                  서버가 기준가로 쓰는 값과 같은 세션이다 (predictions/route.ts). */}
              <span>
                {joined
                  ? `기준가 ${won(joined.reference_price_won)}원`
                  : `${PRICE_SLOT_LABEL[priceSlotAt(pb, todayKey, session)]} ${won(pq.price)}원`}
                {" · 내일 06:00 오전가로 판정"}
              </span>
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
