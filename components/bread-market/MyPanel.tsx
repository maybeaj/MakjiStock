"use client";

import { breadOf, quoteAt, won } from "@/lib/bread-market/engine";
import { lockPhaseOf } from "@/lib/bread-market/flow";
import { CONSUMER_REWARD_NOTICE, SESSION_LABEL, lockProtection } from "@/lib/bread-market/reward-policy";
import Link from "next/link";
import { useEffect, useState } from "react";
import { resetBreadState, useBreadState, useSession } from "@/lib/bread-market/store";
import { useBreadMarket } from "./context";
import { Photo } from "./sheets";

/* MY: 비로그인 · 이 브라우저 기준. 가격 잠금 → 구매 → 예측 → 할인코드 순서로 보여줍니다. */
type ServerLock = {
  lock: {
    lock_session: "am" | "pm";
    locked_price_won: number;
    lock_code_amount_won: number | null;
    status: string;
    products: { ticker: string; name: string } | null;
  } | null;
  discountCode: string | null;
  validUntil: string | null;
};

/* 잠금 차액 할인코드는 이메일로 보내지 않고 MY 에서 바로 보여준다.
   비로그인이라 visitor_token 쿠키가 본인 확인을 대신한다. */
function useLockCode(): ServerLock {
  const [state, setState] = useState<ServerLock>({ lock: null, discountCode: null, validUntil: null });
  useEffect(() => {
    let alive = true;
    fetch("/api/locks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ServerLock | null) => {
        if (alive && data) setState(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

const RESULT_LABEL: Record<string, { title: string; tone: string }> = {
  pending: { title: "판정 대기", tone: "flat" },
  hit: { title: "적중", tone: "down" },
  miss: { title: "미적중", tone: "flat" },
  void: { title: "무효 · 가격 동일", tone: "flat" },
};

export function MyPanel() {
  const { todayKey, openSheet, predictions: preds } = useBreadMarket();
  const server = useLockCode();

  const my = useBreadState();
  const now = useSession();
  const session = now.session;
  const codes = preds.filter((p) => p.reward?.code).length + (server.discountCode ? 1 : 0);
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
  const activity = preds.length + (lock ? 1 : 0);
  const lead = activity === 0 ? "시작해볼까요" : codes > 0 ? "할인코드 도착" : "기록 중";

  return (
    <section className="panel is-on" aria-label="MY">
      <div className="myhead">
        <div className="myhead__k">MY MAKJI</div>
        <h2 className="myhead__t">오늘도 한 조각,<br /><em>{lead}</em></h2>
        <div className="myhead__st">
          <div className="mystat"><b className="n">{preds.length}</b><span>예측 참여</span></div>
          <div className="mystat"><b className="n">{codes}</b><span>할인코드</span></div>
        </div>
      </div>

      <div className="sect">
        <div className="sect__h"><h3 className="sect__t">오늘의 가격 잠금</h3></div>
        <div className="mylist">
          {lock && lockBread ? (
            <div className="myrow">
              <div className="myrow__i myrow__i--ph"><Photo bread={lockBread} /></div>
              <div className="myrow__t">
                <b>{lockBread.name}</b>
                <span>
                  {SESSION_LABEL[lock.session]} 잠금 {won(lock.lockedPrice)}원 · {lockProtection(lock.session)?.label} 사용
                  {server.discountCode ? (
                    <>
                      <br />오후가가 올라 <strong className="myrow__em">차액 쿠폰{server.lock?.lock_code_amount_won ? ` ${won(server.lock.lock_code_amount_won)}원` : ""}</strong>이 발급됐어요
                      <br />쿠폰번호 <strong className="myrow__em n">{server.discountCode}</strong> · 새벽 01:59까지
                      <br />막지 자사몰 가입 후 쿠폰번호를 등록하면 잠금가로 살 수 있어요.
                    </>
                  ) : null}
                </span>
              </div>
              <div className="myrow__v">
                <b className={phase === "protecting" ? "down" : "flat"}>
                  {phase === "holding" ? "보관 중" : phase === "protecting" ? "사용 가능" : phase === "purchased" ? "구매 완료" : "종료"}
                </b>
                <span>현재 {won(quoteAt(lockBread, todayKey, session).price)}원</span>
              </div>
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
          {preds.length === 0 ? (
            <div className="empty">
              <i aria-hidden="true">🧭</i>
              <b>아직 예측 기록이 없어요</b>
              <span>틀리지만 않으면 5% 할인코드를 드려요<br />가격이 같아도 무승부로 드려요</span>
              <br />
              <button className="empty__cta" onClick={() => openSheet({ type: "predict" })}>내일 가격 예측하기</button>
            </div>
          ) : (
            preds.map((p) => {
              const b = p.products?.ticker ? breadOf(p.products.ticker) : null;
              const label = RESULT_LABEL[p.result] ?? RESULT_LABEL.pending;
              const diff = p.result_price_won !== null ? p.result_price_won - p.reference_price_won : null;
              return (
                <div className="myrow myrow--stack" key={p.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {b ? <div className="myrow__i myrow__i--ph"><Photo bread={b} /></div> : null}
                    <div className="myrow__t">
                      <b>{p.products?.name ?? ""} · {p.direction === "up" ? "오른다" : "내린다"}</b>
                      <span>
                        기준가 {won(p.reference_price_won)}원 · {p.target_publish_date}{" "}
                        {p.target_session === "am" ? "오전가" : "오후가"}로 판정
                        {diff !== null ? (
                          <>
                            <br />결과 {won(p.result_price_won!)}원 · 기준가 대비{" "}
                            {diff > 0 ? "+" : diff < 0 ? "−" : ""}{won(Math.abs(diff))}원
                          </>
                        ) : null}
                        {p.reward?.code ? (
                          <>
                            <br />할인코드 <b className="n">{p.reward.code}</b>
                            {p.reward.amountWon ? ` · ${won(p.reward.amountWon)}원 할인` : null}
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  <div className="myrow__v">
                    <b className={label.tone}>{label.title}</b>
                    {p.reward_rate_pct > 0 ? <span>{p.reward_rate_pct}% 보상</span> : null}
                  </div>
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
