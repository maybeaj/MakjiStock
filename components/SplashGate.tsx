"use client";

import { useEffect, useState } from "react";
import { Splash } from "./Splash";

/* 새로고침할 때마다 스플래시를 보여준다. 마켓/MY 는 이미 서버에서 렌더된 채로
   아래 깔려 있고, 스플래시는 그 위를 덮었다가 사라진다.
   마운트를 하이드레이션 이후로 미루는 건 최초 1회 게이팅이 아니라, 셔터의
   CSS 애니메이션이 서버 렌더 시점부터 카운트다운을 시작해 하이드레이션 전에
   끝나버리는 것을 막기 위해서다 — 두 값 모두 같은 시점(마운트)에서 출발해야 한다. */
export function SplashGate({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    setShowSplash(true);
  }, []);

  return (
    <>
      {children}
      {showSplash ? <Splash onDone={() => setShowSplash(false)} /> : null}
    </>
  );
}
