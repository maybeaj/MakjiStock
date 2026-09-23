"use client";

import { useEffect, useState } from "react";
import { Onboarding } from "./Onboarding";

/* 새로고침할 때마다 온보딩을 보여준다. 스플래시가 사라지면 그 아래 이미
   깔려 있던 온보딩이 드러나고, 마켓은 그 아래 또 깔려 있다.
   마운트를 하이드레이션 이후로 미루는 이유는 SplashGate와 동일 —
   step 진입 CSS 애니메이션이 서버 렌더 시점부터 시작되는 것을 막기 위해서다. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    setShowOnboarding(true);
  }, []);

  return (
    <>
      {children}
      {showOnboarding ? <Onboarding onDone={() => setShowOnboarding(false)} /> : null}
    </>
  );
}
