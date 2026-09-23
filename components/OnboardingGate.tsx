"use client";

import { useEffect, useState } from "react";
import { Onboarding, ONBOARDING_SEEN_KEY } from "./Onboarding";

/* 첫 방문에만 온보딩을 보여준다. 스플래시가 사라지면 그 아래 이미
   깔려 있던 온보딩이 드러나고, 마켓은 그 아래 또 깔려 있다. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
    } catch {}
    setShowOnboarding(!seen);
  }, []);

  return (
    <>
      {children}
      {showOnboarding ? <Onboarding onDone={() => setShowOnboarding(false)} /> : null}
    </>
  );
}
