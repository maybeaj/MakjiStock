"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { markIntroSeen } from "@/components/introOnce";
import { Onboarding } from "@/components/Onboarding";
import { ONBOARDING_SEEN_TAB_KEY } from "@/components/OnboardingGate";
import { Splash } from "@/components/Splash";
import { SPLASH_SEEN_TAB_KEY } from "@/components/SplashGate";
import { useHydrated } from "@/components/useHydrated";

/* 첫 화면은 스플래시 → 온보딩이다. 온보딩을 마치거나 건너뛰면 /market 으로 넘어간다.
   /market 의 두 게이트는 같은 문서에서 이미 본 것을 다시 띄우지 않는다 (introOnce.ts).

   온보딩은 처음부터 스플래시 아래 깔아 두고, 스플래시가 페이드아웃하며 드러낸다.
   온보딩은 끝나도 내리지 않는다 — 이동이 끝나 /market 이 그려지는 순간 이 페이지가
   통째로 교체되므로, 그 사이에 빈 화면이 없다.
   마운트를 하이드레이션 이후로 미루는 이유는 SplashGate 와 같다. */
export default function HomePage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [splashDone, setSplashDone] = useState(false);

  // 스플래시와 온보딩이 도는 동안 마켓을 미리 받아 둔다.
  useEffect(() => {
    router.prefetch("/market");
  }, [router]);

  function finishSplash() {
    markIntroSeen(SPLASH_SEEN_TAB_KEY);
    setSplashDone(true);
  }

  function finishOnboarding() {
    markIntroSeen(ONBOARDING_SEEN_TAB_KEY);
    router.replace("/market");
  }

  if (!hydrated) return null;
  return (
    <>
      <Onboarding onDone={finishOnboarding} navigateOnFinish={false} />
      {splashDone ? null : <Splash onDone={finishSplash} />}
    </>
  );
}
