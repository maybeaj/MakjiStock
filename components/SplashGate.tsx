"use client";

import { useState } from "react";
import { Splash } from "./Splash";

/* 새로고침할 때마다 스플래시를 보여준다. 마켓/MY 는 이미 서버에서 렌더된 채로
   아래 깔려 있고, 스플래시는 그 위를 덮었다가 사라진다. */
export function SplashGate({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <>
      {children}
      {showSplash ? <Splash onDone={() => setShowSplash(false)} /> : null}
    </>
  );
}
