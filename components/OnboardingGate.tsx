"use client";

import { useState } from "react";
import { Onboarding } from "./Onboarding";

/* 새로고침할 때마다 온보딩을 보여준다. 스플래시가 사라지면 그 아래 이미
   깔려 있던 온보딩이 드러나고, 마켓은 그 아래 또 깔려 있다. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const [showOnboarding, setShowOnboarding] = useState(true);

  return (
    <>
      {children}
      {showOnboarding ? <Onboarding onDone={() => setShowOnboarding(false)} /> : null}
    </>
  );
}
