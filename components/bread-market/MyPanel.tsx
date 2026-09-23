"use client";

import { breadOf, quoteAt, won } from "@/lib/bread-market/engine";
import { lockPhaseOf } from "@/lib/bread-market/flow";
import {
  CONSUMER_REWARD_NOTICE,
  INSTANT_CODE_HOURS,
  INSTANT_REWARD_MAX_PCT,
  INSTANT_REWARD_MIN_PCT,
  SESSION_LABEL,
  lockCodeRatePct,
  lockProtection,
} from "@/lib/bread-market/reward-policy";
import Link from "next/link";
import { useEffect, useState } from "react";
import { resetBreadState, useBreadState, useSession } from "@/lib/bread-market/store";
import { useBreadMarket } from "./context";
import type { InstantReward } from "@/lib/bread-market/visitor-data";
import { Photo } from "./sheets";

/* MY: 비로그인 · 이 브라우저 기준. 가격 잠금 → 구매 → 예측 → 할인코드 순서로 보여줍니다.
   잠금·예측·할인코드는 서버가 첫 HTML 에 이미 실어 보낸다(page-data.ts).
   여기서 다시 받아오지 않는다 — 그러면 "기록 없음"을 먼저 그렸다가 덮어쓴다. */

const RESULT_LABEL: Record<string, { title: string; tone: string }> = {
  pending: { title: "판정 대기", tone: "flat" },
  hit: { title: "적중", tone: "down" },
  miss: { title: "미적중", tone: "flat" },
  void: { title: "무효 · 가격 동일", tone: "flat" },
};

/* 안정형 쿠폰의 남은 시간. 3시간짜리라 분 단위로는 급한 게 안 보여서 초까지 센다.

   서버는 만료된 쿠폰을 아예 내려보내지 않지만(visitor-data.ts loadInstantRewards),
   페이지는 서버 렌더라 열어둔 탭에서는 그 필터가 다시 돌지 않는다. 0 이 되면
   여기서 남은 줄을 직접 치운다.

   valid_until 이 비어 있으면(옛 쿠폰) 카운트다운을 붙이지 않고 그냥 보여준다. */
function useRemaining(validUntil: string | null) {
  const end = validUntil ? new Date(validUntil).getTime() : null;
  /* 남은 시간을 담지 않고 시계만 돌려 파생시킨다. 담아 두면 만료 시각이 바뀔 때
     한 틱 동안 옛 값이 남고, effect 안에서 setState 를 다시 불러야 한다. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [end]);
  return end === null ? null : end - now;
}

function Countdown({ validUntil }: { validUntil: string | null }) {
  const left = useRemaining(validUntil);
  if (left === null) return null;
  const sec = Math.max(0, Math.floor(left / 1000));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  /* 처음부터 끝까지 빨갛다. 3시간뿐인 쿠폰이라 어느 구간도 여유롭지 않다. */
  return (
    <span className="cdown">
      <span className="cdown__l">남은 시간</span>
      <b className="n" aria-label={`남은 시간 ${hh}시간 ${mm}분 ${ss}초`}>
        {pad(hh)}:{pad(mm)}:{pad(ss)}
      </b>
    </span>
  );
}

/* 할인쿠폰 — 코드와 보상만 담는다. 발급 이유는 쿠폰 밖 본문에 쓴다. */
function CouponCode({ code, note }: { code: string; note?: string }) {
  const { toast } = useBreadMarket();
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast("✓", "쿠폰번호를 복사했어요", "자사몰 로그인 후 쿠폰번호를 등록해주세요");
    } catch {
      toast("⚠️", "복사하지 못했어요", "쿠폰번호를 길게 눌러 직접 복사해주세요");
    }
  }
  return (
    <button type="button" className="coupon" onClick={copy} aria-label={`할인코드 ${code} 복사`}>
      <span className="coupon__code n">{code}</span>
      {note ? <span className="coupon__r">{note}</span> : null}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="12" height="12" rx="2.5" />
        <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
      </svg>
    </button>
  );
}

/* 바로 받기 쿠폰 한 줄. 3시간이 지나면 이 줄이 통째로 사라진다. */
function InstantRow({ reward }: { reward: InstantReward }) {
  const left = useRemaining(reward.validUntil);
  /* 만료된 쿠폰은 받았다는 표시로만 내려온다 — 줄로는 그리지 않는다.
     열어둔 탭에서 카운트다운이 0 에 닿는 순간도 같다. */
  if (!reward.code || (left !== null && left <= 0)) return null;
  /* 쿠폰은 Cafe24 에서 이 빵 하나에만 묶여 나간다. 이름을 빼면 아무 빵에나
     쓸 수 있는 것처럼 보인다. 007 마이그레이션 전 쿠폰은 상품이 없다. */
  const bread = reward.product?.ticker ? breadOf(reward.product.ticker) : null;
  return (
    <div className="myrow myrow--stack">
      <div className="myrow__top">
        {bread ? <div className="myrow__i myrow__i--ph"><Photo bread={bread} /></div> : null}
        <div className="myrow__t">
          <b>{reward.product?.name ?? "바로 받기"} · {reward.ratePct}% 할인코드</b>
          <span>
            {bread ? <><strong>이 빵에만</strong> 쓸 수 있어요 · </> : null}
            발급 후 <strong>{INSTANT_CODE_HOURS}시간</strong> 안에
          </span>
        </div>
        <div className="myrow__v"><Countdown validUntil={reward.validUntil} /></div>
      </div>
      <CouponCode code={reward.code} note={`${reward.ratePct}%`} />
      {bread ? (
        <button
          className="btn btn--blue btn--sm"
          onClick={() => window.open(`/api/out/cafe24/${bread.tk}`, "_blank", "noopener")}
        >
          {bread.name} 사러 가기
        </button>
      ) : null}
    </div>
  );
}

export function MyPanel() {
  const { todayKey, openSheet, predictions: preds, lock: server, instantRewards } = useBreadMarket();

  const my = useBreadState();
  const now = useSession();
  const session = now.session;
  /* 이 목록은 지금 할 일만 담는다 — 결과를 기다리는 예측과 아직 쓸 수 있는 코드.
     판정이 끝났고 쓸 코드도 없는 줄은 기록이지 할 일이 아니다. 그건 내 기록
     시트(sheets.tsx HistorySheet)가 전부 보여준다. 상단 통계를 누르면 열린다. */
  const live = preds.filter((p) => p.result === "pending" || p.reward?.code);
  /* 만료된 안정형 쿠폰도 내려온다(참여 여부 판정용). 세는 건 쓸 수 있는 것만. */
  const liveInstant = instantRewards.filter((r) => r.code);

  /* 상단 두 숫자는 누적이다. 지금 화면에 뜬 개수를 세면 어제 것이 사라진 순간
     0 으로 돌아가 "오늘 처음 온 사람" 처럼 보인다. 쌓이는 맛이 이 게임의 동기다.
     쿠폰은 만료돼도 받았다는 사실은 남으므로 instantRewards 전체를 센다. */
  const totalPlays = preds.length + instantRewards.length;
  const totalHits = preds.filter((p) => p.result === "hit" || p.result === "void").length;
  /* reward_rate_pct 는 제출할 때 박히므로(rollPredictionRewardPct) 판정 전에도 0 이
     아니다. 그것만 보면 아직 받지 않은 코드까지 센다. 판정이 난 것만 센다. */
  const totalCodes =
    preds.filter((p) => (p.result === "hit" || p.result === "void") && p.reward_rate_pct > 0).length +
    instantRewards.length;
  /* 회차의 한 번을 안정형으로 썼나. 쿠폰이 3시간 뒤 사라져도 이 사실은 남는다 —
     모르면 빈 상태가 "내일 가격 예측하기" 를 다시 권하고, 눌러도 서버가 막는다
     (predictions/route.ts). 마켓 카드와 같은 판정이다. */
  const tookInstant = instantRewards.some((r) => r.roundId === `${todayKey}-am`);
  const codes = live.filter((p) => p.reward?.code).length + (server.discountCode ? 1 : 0) + liveInstant.length;
  /* 잠금은 서버가 정본이다. localStorage 는 서버 응답이 오기 전에만 쓴다.
     브라우저 기록을 지워도 쿠키가 남아 서버에는 잠금이 그대로 있다.
     로컬만 보면 "잠근 빵이 없어요"라고 해놓고 다시 잠글 때 409 가 난다. */
  const lock = server.lock
    ? {
        tk: server.lock.products?.ticker ?? "",
        lockedPrice: server.lock.locked_price_won,
        session: server.lock.lock_session,
        dateKey: todayKey,
        status: server.lock.status === "purchased" ? ("purchased" as const) : ("active" as const),
        lockedAt: "",
      }
    : my.lock;
  const phase = lockPhaseOf(lock, now, todayKey);
  const lockBread = lock?.tk ? breadOf(lock.tk) : null;

  /* 보호 구간에 들어갔다고 다 "사용 가능" 이 아니다. 오후가가 잠금가 이하면
     차액이 없어 쿠폰이 발급되지 않는다(lock-codes.ts amount <= 0) — 그냥 지금
     가격으로 사면 된다. 그걸 "사용 가능" 이라고만 쓰면 없는 쿠폰을 찾게 된다.
     마켓의 LockCard 와 같은 판정이다. 둘이 어긋나면 화면끼리 다른 말을 한다. */
  const lockNowPrice = lockBread ? quoteAt(lockBread, todayKey, session).price : 0;
  const risen = Boolean(lock && lockNowPrice > lock.lockedPrice);
  /* 오후가 크론이 아직 안 돌았거나 보류된 날은 quoteAt 이 오전가로 떨어져
     현재가와 잠금가가 정확히 같아진다. 그때 "더 싸요" 는 없는 이득을 말하는 것이다. */
  const cheaper = Boolean(lock && lockNowPrice < lock.lockedPrice);
  const lockState =
    phase === "holding"
      ? { label: "보관 중", tone: "flat" }
      : phase === "purchased"
        ? { label: "구매 완료", tone: "flat" }
        : phase !== "protecting"
          ? { label: "종료", tone: "flat" }
          : !risen
            ? cheaper
              ? { label: "지금 더 싸요", tone: "down" }
              : { label: "잠금가와 같아요", tone: "flat" }
            : server.discountCode
              ? { label: "사용 가능", tone: "down" }
              : { label: "쿠폰 준비 중", tone: "flat" };
  /* 보호 구간에는 쿠폰이 있든 없든 왜 그런지 한 줄 붙는다. */
  const activity = live.length + (lock ? 1 : 0) + liveInstant.length;
  const lead = activity === 0 ? "시작해볼까요" : codes > 0 ? "할인코드 도착" : "기록 중";

  return (
    <section className="panel is-on" aria-label="MY">
      <div className="myhead">
        <div className="myhead__k">MY MAKJI</div>
        <h2 className="myhead__t">오늘도 한 조각,<br /><em>{lead}</em></h2>
        <div className="myhead__st">
          {/* 누르면 기록 시트가 열린다. 다른 "누르면 자세히" 와 같은 방식이다 —
              아래로 펼치면 여기만 동작이 다르고 목록이 길어져 뒷내용을 민다. */}
          <button type="button" className="mystat" onClick={() => openSheet({ type: "history" })}>
            <b className="n">{totalPlays}</b>
            <span>참여 누적 {totalPlays > 0 ? `· 적중 ${totalHits}` : ""}</span>
          </button>
          <button type="button" className="mystat" onClick={() => openSheet({ type: "history" })}>
            <b className="n">{totalCodes}</b>
            {/* 누적만 쓰면 만료된 것까지 세어 "1 인데 왜 없지" 가 된다. 지금 쓸 수
                있는 수를 0 이어도 함께 적는다. */}
            <span>받은 코드 · 지금 {codes}</span>
          </button>
        </div>
      </div>

      <div className="sect">
        <div className="sect__h"><h3 className="sect__t">오늘의 가격 잠금</h3></div>
        <div className="mylist">
          {lock && lockBread ? (
            <div className={`myrow${server.discountCode || phase === "protecting" ? " myrow--stack" : ""}`}>
              <div className="myrow__top">
                <div className="myrow__i myrow__i--ph"><Photo bread={lockBread} /></div>
                <div className="myrow__t">
                  <b>{lockBread.name}</b>
                  <span>
                    {SESSION_LABEL[lock.session]} 잠금 {won(lock.lockedPrice)}원 · {lockProtection(lock.session)?.label} 사용
                  </span>
                </div>
                <div className="myrow__v">
                  <b className={lockState.tone}>{lockState.label}</b>
                  <span>현재 {won(lockNowPrice)}원</span>
                </div>
              </div>
              {server.discountCode ? (
                <>
                  <CouponCode
                    code={server.discountCode}
                    note={
                      server.lock?.lock_code_amount_won
                        ? `차액 ${lockCodeRatePct(server.lock.lock_code_amount_won, lock.lockedPrice + server.lock.lock_code_amount_won)}%`
                        : undefined
                    }
                  />
                  <p className="myrow__why">
                    오후가가 올라 차액만큼 쿠폰이 발급됐어요 · 새벽 01:59까지<br />
                    막지 자사몰 가입 후 쿠폰번호를 등록하면 잠금가로 살 수 있어요.
                  </p>
                </>
              ) : phase === "protecting" && !risen ? (
                /* 쿠폰이 없는 건 지금 가격이 이미 잠금가 이하라서다. 할 일이 하나뿐이니 버튼만 둔다. */
                <button
                  className="btn btn--blue btn--sm"
                  onClick={() => window.open(`/api/out/cafe24/${lock.tk}`, "_blank", "noopener")}
                >
                  지금 {won(lockNowPrice)}원으로 사러 가기
                </button>
              ) : null}
            </div>
          ) : (
            <div className="empty">
              <i aria-hidden="true">🔒</i>
              <b>오늘 잠근 빵이 없어요</b>
              <span>하루 한 번, 오전장(06:00–15:59)에<br />빵 한 개의 가격을 잠가둘 수 있어요</span>
              <br />
              {/* 첫 상품 상세를 여는 건 이상하다. 목록에서 직접 고르게 보낸다. */}
              <Link className="empty__cta" href="/market#mktlist">빵 고르러 가기</Link>
            </div>
          )}
        </div>
      </div>

      <div className="sect">
        <div className="sect__h"><h3 className="sect__t">예측과 할인코드</h3></div>
        <div className="mylist">
          {/* 바로 받기 쿠폰. 예측이 아니라 회차에 묶여 있어 목록과 출처가 다르다. */}
          {liveInstant.map((r) => (
            <InstantRow key={r.roundId} reward={r} />
          ))}
          {live.length === 0 && liveInstant.length === 0 ? (
            tookInstant ? (
              /* 안정형으로 받았고 3시간이 지났다. 회차는 이미 썼으니 다시 권하지 않는다. */
              <div className="empty">
                <i aria-hidden="true">🎟️</i>
                <b>오늘 쿠폰을 받았어요</b>
                <span>안정형으로 받으셔서 오늘 예측은 끝났어요<br />{INSTANT_CODE_HOURS}시간이 지나 쿠폰은 사라졌어요</span>
                <br />
                <Link className="empty__cta" href="/market#mktlist">내일 다시 만나요</Link>
              </div>
            ) : (
              <div className="empty">
                <i aria-hidden="true">🧭</i>
                {/* 지난 기록이 있는 사람에게 "없어요" 라고 하면 기록이 날아간 줄 안다. */}
                <b>{totalPlays > 0 ? "지금 기다리는 건 없어요" : "아직 예측 기록이 없어요"}</b>
                <span>안정형은 {INSTANT_REWARD_MIN_PCT}~{INSTANT_REWARD_MAX_PCT}% 확정 · {INSTANT_CODE_HOURS}시간 안에 사용<br />공격형은 맞히면 더 크게</span>
                <br />
                <button className="empty__cta" onClick={() => openSheet({ type: "predict" })}>내일 가격 예측하기</button>
              </div>
            )
          ) : (
            live.map((p) => {
              const b = p.products?.ticker ? breadOf(p.products.ticker) : null;
              const label = RESULT_LABEL[p.result] ?? RESULT_LABEL.pending;
              const diff = p.result_price_won !== null ? p.result_price_won - p.reference_price_won : null;
              return (
                <div className="myrow myrow--stack" key={p.id}>
                  <div className="myrow__top">
                    {b ? <div className="myrow__i myrow__i--ph"><Photo bread={b} /></div> : null}
                    <div className="myrow__t">
                      <b>{p.products?.name ?? ""} · {p.direction === "up" ? "오른다" : "내린다"}</b>
                      <span>
                        {p.target_publish_date} {p.target_session === "am" ? "오전가" : "오후가"}로 판정
                      </span>
                    </div>
                    <div className="myrow__v">
                      <b className={label.tone}>{label.title}</b>
                    </div>
                  </div>
                  {p.reward?.code ? (
                    <CouponCode
                      code={p.reward.code}
                      note={p.reward_rate_pct > 0 ? `${p.reward_rate_pct}% 보상` : undefined}
                    />
                  ) : null}
                  <p className="myrow__why">
                    기준가 {won(p.reference_price_won)}원
                    {diff !== null ? (
                      <>
                        {" · "}결과 {won(p.result_price_won!)}원 · 기준가 대비{" "}
                        {diff > 0 ? "+" : diff < 0 ? "−" : ""}{won(Math.abs(diff))}원
                      </>
                    ) : null}
                  </p>
                </div>
              );
            })
          )}
        </div>
        <p className="note" style={{ marginTop: 10 }}>{CONSUMER_REWARD_NOTICE} 막지 자사몰 가입 후 쿠폰번호를 등록해야 주문에 적용돼요. 한 주문에는 할인코드를 하나만 쓸 수 있어요 — 여러 개라면 금액이 큰 코드를 쓰세요.</p>
      </div>


      <footer className="footer">
        <span className="blogo" role="img" aria-label="막지" />
        <div className="footer__sns">
          {["makji_official", "makjibakery"].map((h) => (
            <a className="snsb" key={h} href={`https://www.instagram.com/${h}/`} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
                <circle cx="12" cy="12" r="4.2" />
                <circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
              </svg>
              @{h}
            </a>
          ))}
        </div>
        <p className="footer__t">
          <b>MAKJI STOCK</b><br />
          비로그인 · 이 브라우저 기준 기록입니다. 쿠키를 지우면 기록이 사라져요.<br />
          시세는 네이버 검색 트렌드와 한국은행 원/달러 환율로 매일 06:00·16:00에 다시 계산합니다.<br />실제 주문과 결제는 막지 자사몰에서 진행됩니다.
        </p>
        {activity > 0 ? (
          <button className="footer__reset" onClick={resetBreadState}>이 브라우저 기록 지우기</button>
        ) : null}
      </footer>
    </section>
  );
}
