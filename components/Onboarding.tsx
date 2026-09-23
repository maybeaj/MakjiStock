"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export const ONBOARDING_SEEN_KEY = "makji_onboarding_seen";

const STEPS = ["가격", "잠금", "예측"] as const;

function withBreaks(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  function finish() {
    try {
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    } catch {}
    onDone();
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    finish();
    router.push("/market#mktlist");
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
              <div className="priceCard">
                <div className="priceHalf priceHalf--am">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#173a5e" strokeWidth="1.6" strokeLinecap="round">
                    <circle cx="12" cy="12" r="4.5" />
                    <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
                  </svg>
                  <span className="priceHalf__label">오전가</span>
                  <span className="priceHalf__time">06:00</span>
                </div>
                <div className="priceHalf priceHalf--pm">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#bcd3e8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
                  </svg>
                  <span className="priceHalf__label">오후가</span>
                  <span className="priceHalf__time">16:00</span>
                </div>
              </div>
              <div className="priceTimeline">
                <span>06:00</span>
                <span>16:00</span>
                <span>다음날 06:00</span>
              </div>
              <div className="headline">{withBreaks("가격이 하루 두 번\n바뀌어요")}</div>
              <div className="desc">{withBreaks("운 좋게 타이밍만 맞으면,\n최대 38%까지 싸게 살 수 있어요.")}</div>
            </div>
          ) : step === 1 ? (
            <div key="lock" className="step">
              <div className="iconCircle iconCircle--lock">
                <svg width="88" height="88" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="9" rx="2" stroke="#173a5e" strokeWidth="1.5" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#173a5e" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="badgeRow">
                <span className="obBadge obBadge--lock">오전 3,220원 · 이 값 보장</span>
              </div>
              <div className="headline">{withBreaks("잠가두면,\n손해 볼 일이 없어요")}</div>
              <div className="desc">{withBreaks("올라도 차액은 쿠폰으로 드리고,\n내리면 그 가격 그대로예요.")}</div>
            </div>
          ) : (
            <div key="predict" className="step">
              <div className="iconCircle iconCircle--predict">
                <div className="iconCircle__inner">
                  <span className="crystalBall">🔮</span>
                </div>
              </div>
              <div className="badgeRow">
                <span className="obBadge obBadge--noPredict">예측 없이 10–15%</span>
                <span className="obBadge obBadge--predict">맞히면 5–20%</span>
              </div>
              <div className="headline">{withBreaks("내일 오를지 내릴지\n맞히면 할인코드를 드려요")}</div>
              <div className="desc">{withBreaks("둘 중 하나만, 하루 한 번\n참여할 수 있어요.")}</div>
            </div>
          )}
        </div>
        <div className="obFooter">
          <button type="button" className="cta" onClick={handleNext}>
            {step < STEPS.length - 1 ? "다음" : "마켓 둘러보기"}
          </button>
        </div>
      </div>

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
          color: #c7ccd8;
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
        .priceCard {
          width: 270px;
          display: flex;
          height: 130px;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 14px 30px rgba(21, 23, 30, 0.16);
        }
        .priceHalf {
          position: relative;
          width: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
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
          letter-spacing: 0.02em;
        }
        .priceHalf--am .priceHalf__label {
          color: #173a5e;
        }
        .priceHalf--pm .priceHalf__label {
          color: #bcd3e8;
        }
        .priceHalf__time {
          font-size: 11px;
          font-weight: 800;
        }
        .priceHalf--am .priceHalf__time {
          color: #173a5e;
        }
        .priceHalf--pm .priceHalf__time {
          color: #fff;
        }
        .priceTimeline {
          width: 270px;
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          padding: 0 4px;
          font-size: 9.5px;
          font-weight: 600;
          color: #9da3b0;
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
        .iconCircle--lock {
          background: #f2f8fd;
          box-shadow: 0 16px 36px rgba(23, 58, 94, 0.18);
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
        .badgeRow {
          margin-top: 16px;
          display: flex;
          gap: 8px;
        }
        .obBadge {
          font-size: 11px;
          font-weight: 800;
          padding: 6px 12px;
          border-radius: 100px;
        }
        .obBadge--lock {
          background: #f6f0e5;
          color: #8a6a2e;
        }
        .obBadge--noPredict {
          background: #ffd666;
          color: #6b4f14;
        }
        .obBadge--predict {
          background: #e9f1f9;
          color: #173a5e;
        }
        .headline {
          margin-top: 26px;
          font-size: 21px;
          font-weight: 800;
          color: #15171e;
          line-height: 1.4;
          letter-spacing: -0.01em;
          text-align: center;
        }
        .desc {
          margin-top: 10px;
          font-size: 13px;
          line-height: 1.7;
          color: #5b6170;
          text-align: center;
        }
        .obFooter {
          flex: none;
          padding: 20px 28px 32px 28px;
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
