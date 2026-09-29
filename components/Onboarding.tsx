"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export const ONBOARDING_SEEN_KEY = "makji_onboarding_seen";

const STEPS = ["가격·잠금", "예측"] as const;

function withBreaks(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

/* navigateOnFinish — 마지막 단계에서 스스로 /market 으로 보낼지. 이동을 직접 맡는
   쪽(app/page.tsx)은 false 로 두어 이동이 두 번 쌓이지 않게 한다. */
export function Onboarding({ onDone, navigateOnFinish = true }: { onDone: () => void; navigateOnFinish?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [step, setStep] = useState(0);

  function finish() {
    try {
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    } catch {
      // 비공개 브라우징 등 저장소를 쓸 수 없는 환경에서도 종료는 계속한다.
    }
    onDone();
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    finish();
    if (navigateOnFinish && pathname !== "/market") router.push("/market");
  }

  return (
    <div className="overlay">
      <div className="frame">
        <div className="header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/splash/makji-logo.png" alt="Makji Stock" className="wordmark" />
          <button type="button" className="skip" onClick={finish}>
            건너뛰기
          </button>
        </div>
        <div className="body">
          {step === 0 ? (
            <div key="price" className="step">
              {/* 예시 숫자 — 오전가로 잠가두고 오후에 오른 차액을 쿠폰으로 받는 흐름을 보여준다. */}
              <div className="visual visual--price">
                <div className="priceCard">
                  <div className="priceHalf priceHalf--am">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#173a5e" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="4.5" />
                      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
                    </svg>
                    <span className="priceHalf__label">오전가 06:00</span>
                    <span className="priceHalf__value">3,220원</span>
                  </div>
                  <div className="priceHalf priceHalf--pm">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#bcd3e8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
                    </svg>
                    <span className="priceHalf__label">오후가 16:00</span>
                    <span className="priceHalf__value">
                      3,500원<span className="priceHalf__up"> ▲</span>
                    </span>
                  </div>
                </div>
                <span className="cutLine" aria-hidden="true" />
                <div className="flagPill">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>02:00 할인 끝</span>
                </div>
                <div className="lockPill">
                  <span className="lockPill__icon">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="9" rx="2" stroke="#ffffff" strokeWidth="2.4" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span>잠금</span>
                </div>
                <div className="notePill notePill--price">오른 280원은 쿠폰으로</div>
              </div>
              <div className="headline headline--price">{withBreaks("가격은 하루 두 번 바뀌어요\n오전가로 잠가두세요")}</div>
              <div className="desc">
                오후에 오르면 차액은 쿠폰으로 드려요.
                <br />
                <b>새벽 2시부터는 정가 3,800원</b>이라, 그 전에 사세요.
              </div>
            </div>
          ) : (
            <div key="predict" className="step">
              <div className="iconCircle iconCircle--predict">
                <div className="iconCircle__inner">
                  <span className="crystalBall">🔮</span>
                </div>
              </div>
              <div className="headline headline--predict">{withBreaks("내일 오를지 내릴지\n맞히면 할인코드를 드려요")}</div>
              <div className="desc">{withBreaks("둘 중 하나만, 하루 한 번\n참여할 수 있어요.")}</div>
            </div>
          )}
        </div>
        <div className="obFooter">
          <div className="dots" aria-label={`${STEPS.length}단계 중 ${step + 1}단계`}>
            {STEPS.map((label, i) => (
              <span key={label} className={i === step ? "dot dot--on" : "dot"} />
            ))}
          </div>
          <button type="button" className="cta" onClick={handleNext}>
            {step < STEPS.length - 1 ? "다음" : "마켓 둘러보기"}
          </button>
        </div>
      </div>

      {/* Next.js가 지원하는 styled-jsx 전용 속성이다. */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 9998;
          display: grid;
          place-items: center;
          background: #101319;
        }
        .frame {
          width: min(390px, 100vw, calc(100vh * 390 / 844));
          aspect-ratio: 390 / 844;
          background: #fbf8f3;
          border-radius: 34px;
          box-shadow: 0 24px 80px rgba(4, 10, 18, 0.28);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .header {
          flex: none;
          padding: 18px 20px 0 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .wordmark {
          height: 25px;
          width: 141px;
          object-fit: contain;
          margin-left: -6px;
        }
        .skip {
          font-size: 11px;
          font-weight: 700;
          color: #9da3b0;
        }
        .body {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0 32px;
        }
        .step {
          display: flex;
          flex-direction: column;
          align-items: center;
          animation: step-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes step-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .visual {
          position: relative;
        }
        .visual--price {
          width: 300px;
          padding-top: 24px;
        }
        .priceCard {
          width: 282px;
          display: flex;
          height: 132px;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 14px 30px rgba(21, 23, 30, 0.16);
        }
        .priceHalf {
          width: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .priceHalf--am {
          background: #f2f8fd;
        }
        .priceHalf--pm {
          background: #173a5e;
        }
        .priceHalf__label {
          font-size: 10px;
          font-weight: 800;
        }
        .priceHalf--am .priceHalf__label {
          color: #173a5e;
        }
        .priceHalf--pm .priceHalf__label {
          color: #bcd3e8;
        }
        .priceHalf__value {
          margin-top: 2px;
          font-size: 19px;
          font-weight: 800;
        }
        .priceHalf--am .priceHalf__value {
          color: #15171e;
        }
        .priceHalf--pm .priceHalf__value {
          color: #fff;
        }
        .priceHalf__up {
          font-size: 12px;
          color: #ff9686;
        }
        .cutLine {
          position: absolute;
          left: 287px;
          top: 18px;
          height: 150px;
          border-left: 2px dashed #15171e;
        }
        .flagPill {
          position: absolute;
          right: -18px;
          top: -6px;
          display: flex;
          align-items: center;
          gap: 5px;
          background: #15171e;
          color: #fff;
          border-radius: 100px;
          padding: 6px 11px 6px 9px;
          box-shadow: 0 6px 14px rgba(21, 23, 30, 0.22);
          white-space: nowrap;
          font-size: 11px;
          font-weight: 800;
        }
        .lockPill {
          position: absolute;
          top: 0;
          left: 25%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 5px;
          background: #fff;
          border-radius: 100px;
          padding: 6px 11px 6px 8px;
          box-shadow: 0 6px 16px rgba(23, 58, 94, 0.18);
          white-space: nowrap;
          font-size: 11.5px;
          font-weight: 800;
          color: #173a5e;
        }
        .lockPill__icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #173a5e;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .notePill {
          position: absolute;
          bottom: -16px;
          background: #f6f0e5;
          color: #6b4f14;
          font-size: 11px;
          font-weight: 800;
          padding: 7px 12px;
          border-radius: 100px;
          box-shadow: 0 4px 12px rgba(21, 23, 30, 0.1);
          white-space: nowrap;
        }
        .notePill--price {
          left: 66%;
          transform: translateX(-50%);
        }
        .headline {
          font-size: 21px;
          font-weight: 800;
          color: #15171e;
          line-height: 1.4;
          letter-spacing: -0.01em;
          text-align: center;
        }
        .headline--price {
          margin-top: 44px;
        }
        .headline--predict {
          margin-top: 26px;
        }
        .iconCircle {
          width: 200px;
          height: 200px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .iconCircle--predict {
          background: conic-gradient(from 180deg, #f4efe6 0%, #f4efe6 50%, #e9f1f9 50%, #e9f1f9 100%);
          box-shadow: 0 16px 36px rgba(21, 23, 30, 0.18);
        }
        .iconCircle__inner {
          width: 150px;
          height: 150px;
          border-radius: 50%;
          background: #fbf8f3;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 2px 8px rgba(21, 23, 30, 0.06);
        }
        .crystalBall {
          font-size: 64px;
          line-height: 1;
        }
        .desc {
          margin-top: 10px;
          font-size: 13px;
          line-height: 1.7;
          color: #5b6170;
          text-align: center;
        }
        .desc b {
          color: #15171e;
        }
        .obFooter {
          flex: none;
          padding: 12px 28px 32px 28px;
        }
        .dots {
          display: flex;
          justify-content: center;
          gap: 6px;
          margin-bottom: 16px;
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 3px;
          background: #d6d0c4;
          transition: width 0.2s ease;
        }
        .dot--on {
          width: 18px;
          background: #15171e;
        }
        .cta {
          display: block;
          width: 100%;
          text-align: center;
          background: #15171e;
          color: #fbf8f3;
          font-size: 14px;
          font-weight: 800;
          padding: 15px;
          border-radius: 100px;
          box-shadow: 0 6px 16px rgba(21, 23, 30, 0.22);
          transition: transform 0.14s cubic-bezier(0.2, 1.25, 0.4, 1);
        }
        .cta:active {
          transform: scale(0.975);
        }
        @media (max-width: 430px) {
          .overlay {
            display: block;
            background: #fbf8f3;
          }
          .frame {
            width: 100vw;
            height: 100svh;
            aspect-ratio: auto;
            border-radius: 0;
            box-shadow: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .step {
            animation: none;
          }
          .cta {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
