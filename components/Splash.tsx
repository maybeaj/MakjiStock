"use client";

import { useEffect, useState } from "react";

export const SPLASH_SEEN_KEY = "makji_splash_seen";

/* 원본: 01. 스플래시 V12-html/MAKJI_SPLASH_FINAL.html
   셔터가 닫힌 채 0.5초 대기 → 2.5초에 걸쳐 열리며 로고 노출 → 캡션 페이드인 → 0.8초 뒤 종료.
   동작 축소 설정이거나 건너뛰기를 누르면 즉시 종료한다. */
export function Splash({ onDone }: { onDone: () => void }) {
  const [shutterVisible, setShutterVisible] = useState(true);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  function finish() {
    setLeaving(true);
    setTimeout(() => {
      try {
        localStorage.setItem(SPLASH_SEEN_KEY, "1");
      } catch {}
      setGone(true);
      onDone();
    }, 250);
  }

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setShutterVisible(false);
      setCaptionOpen(true);
      finish();
      return;
    }
    const revealTimer = setTimeout(() => setCaptionOpen(true), 1450);
    const fallback = setTimeout(() => setShutterVisible(false), 3100);
    return () => {
      clearTimeout(revealTimer);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!captionOpen) return;
    const t = setTimeout(finish, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionOpen]);

  function handleSkip() {
    setShutterVisible(false);
    setCaptionOpen(true);
    finish();
  }

  if (gone) return null;

  return (
    <div className="overlay">
      <div className={`splash${leaving ? " leaving" : ""}`}>
        <main className={`logo${captionOpen ? " open" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/splash/makji-logo.png" alt="Makji Stock" />
          <p className="caption">오늘의 빵 마켓이 열렸어요</p>
        </main>
        {shutterVisible ? (
          <div className="shutter" role="region" aria-label="막지 웰니스 베이커리 오프닝">
            <div
              className="shutterPanel"
              onAnimationEnd={(e) => {
                if (e.animationName === "shutterOpen") setShutterVisible(false);
              }}
            >
              <div className="brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/splash/makji-brand.png" alt="Makji" />
              </div>
              <span className="handle" aria-hidden="true" />
            </div>
          </div>
        ) : null}
        <button className="skip" type="button" hidden={leaving} onClick={handleSkip}>
          건너뛰기 <span aria-hidden="true">↗</span>
        </button>
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          background: #101319;
        }
        .splash {
          position: relative;
          width: min(390px, 100vw, calc(100vh * 390 / 844));
          aspect-ratio: 390 / 844;
          overflow: hidden;
          background: #fbf8f3;
          border-radius: 34px;
          box-shadow: 0 24px 80px rgba(4, 10, 18, 0.28);
          opacity: 1;
          transition: opacity 200ms ease-out;
          isolation: isolate;
        }
        .splash.leaving {
          opacity: 0;
          pointer-events: none;
        }
        .logo {
          width: 100%;
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 18px;
          padding: 32px;
        }
        .caption {
          position: relative;
          top: -5px;
          margin: 0;
          color: #4b5055;
          font: 500 13px/1.6 "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: -0.02em;
          text-align: center;
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 400ms ease-out, transform 400ms ease-out;
        }
        .logo.open .caption {
          opacity: 1;
          transform: translateY(0);
        }
        .logo :global(img) {
          display: block;
          width: clamp(164px, 52vw, 220px);
          max-width: 100%;
          height: auto;
        }
        .shutter {
          position: absolute;
          inset: 0;
          z-index: 9999;
          overflow: hidden;
          pointer-events: none;
          font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .shutterPanel {
          position: absolute;
          inset: 0;
          pointer-events: auto;
          background: repeating-linear-gradient(180deg, #e3e9ee 0px, #e3e9ee 27px, #d1dbe3 28px, #eaf0f4 30px);
          border-bottom: 5px solid #c7d3dd;
          box-shadow: 0 6px 16px #213b5114;
          will-change: transform;
          animation: shutterOpen 2500ms cubic-bezier(0.4, 0, 0.2, 1) 500ms both;
        }
        .shutterPanel::before {
          content: "";
          position: absolute;
          top: calc(100% - 3px);
          left: -12%;
          width: 124%;
          height: clamp(80px, 18vh, 160px);
          background: radial-gradient(
            ellipse at 50% 0%,
            rgba(255, 228, 177, 0.68) 0%,
            rgba(255, 237, 201, 0.38) 35%,
            rgba(255, 244, 222, 0.12) 58%,
            rgba(255, 244, 222, 0) 76%
          );
          filter: blur(7px);
          transform-origin: center top;
          pointer-events: none;
          animation: warmLight 2500ms ease-in-out 500ms both;
        }
        .shutterPanel::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: -2px;
          height: 2px;
          background: #f3e4c9;
          box-shadow: 0 3px 12px 2px rgba(245, 215, 164, 0.3);
          pointer-events: none;
          animation: lightEdge 2500ms ease-in-out 500ms both;
        }
        .brand {
          position: absolute;
          z-index: 1;
          top: 50%;
          left: 50%;
          width: clamp(128px, 35vw, 150px);
          transform: translate(-50%, -55%);
          isolation: isolate;
        }
        .brand::before {
          content: "";
          position: absolute;
          z-index: -1;
          inset: -20% -25%;
          background: radial-gradient(
            ellipse at center,
            rgba(250, 252, 253, 0.88) 0%,
            rgba(244, 248, 251, 0.52) 48%,
            rgba(235, 242, 247, 0) 76%
          );
          filter: blur(7px);
          pointer-events: none;
        }
        .brand :global(img) {
          display: block;
          width: 100%;
          height: auto;
          opacity: 0.94;
          filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.88)) drop-shadow(0 4px 10px rgba(45, 91, 127, 0.1));
        }
        .handle {
          position: absolute;
          bottom: 25px;
          left: 50%;
          transform: translateX(-50%);
          width: 49px;
          height: 6px;
          border: 1px solid #9aafbf;
          border-radius: 5px;
          background: #dce5ec;
          box-shadow: 0 2px 2px #516f8220;
        }
        .skip {
          position: absolute;
          z-index: 10000;
          top: max(18px, env(safe-area-inset-top));
          right: 20px;
          min-height: 44px;
          padding: 12px 4px;
          border: 0;
          background: transparent;
          color: #607486;
          font-weight: 400;
          font-family: inherit;
          font-size: 11px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .skip:focus-visible {
          outline: 2px solid #2c6199;
          outline-offset: 2px;
          border-radius: 3px;
        }
        @keyframes shutterOpen {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(-101%);
          }
        }
        @keyframes warmLight {
          0% {
            opacity: 0.15;
            transform: scaleY(0.3);
          }
          25% {
            opacity: 0.9;
            transform: scaleY(0.8);
          }
          50% {
            opacity: 0.7;
            transform: scaleY(1);
          }
          80% {
            opacity: 0.15;
            transform: scaleY(1.2);
          }
          100% {
            opacity: 0;
            transform: scaleY(1.25);
          }
        }
        @keyframes lightEdge {
          0% {
            opacity: 0.4;
          }
          30% {
            opacity: 1;
          }
          75% {
            opacity: 0.4;
          }
          100% {
            opacity: 0;
          }
        }
        @media (max-width: 430px) {
          .overlay {
            display: block;
            background: #fbf8f3;
          }
          .splash {
            width: 100vw;
            height: 100svh;
            aspect-ratio: auto;
            border-radius: 0;
            box-shadow: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .splash {
            transition: none;
          }
          .shutter {
            display: none;
          }
          .shutterPanel,
          .shutterPanel::before,
          .shutterPanel::after {
            animation: none;
          }
          .caption {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
