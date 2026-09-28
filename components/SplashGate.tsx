"use client";

import { useState } from "react";
import { markIntroSeen, shouldShowIntro } from "./introOnce";
import { Splash } from "./Splash";
import { useHydrated } from "./useHydrated";

/* 새로고침할 때마다 스플래시를 보여준다. 마켓/MY 는 이미 서버에서 렌더된 채로
   아래 깔려 있고, 스플래시는 그 위를 덮었다가 사라진다.
   마운트를 하이드레이션 이후로 미루는 건 최초 1회 게이팅이 아니라, 셔터의
   CSS 애니메이션이 서버 렌더 시점부터 카운트다운을 시작해 하이드레이션 전에
   끝나버리는 것을 막기 위해서다 — 두 값 모두 같은 시점(마운트)에서 출발해야 한다.
   Next 가 스스로 문서를 다시 연 경우에는 건너뛴다(introOnce.ts). */
export const SPLASH_SEEN_TAB_KEY = "makji_splash_seen_tab";
const SEEN_KEY = SPLASH_SEEN_TAB_KEY;
export function SplashGate({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && !shouldShowIntro(SEEN_KEY));

  function dismiss() {
    markIntroSeen(SEEN_KEY);
    setDismissed(true);
  }

  return (
    <>
      {children}
      {hydrated && !dismissed ? <Splash onDone={dismiss} /> : null}
    </>
  );
}
