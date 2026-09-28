"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { markIntroSeen } from "@/components/introOnce";
import { Splash } from "@/components/Splash";
import { SPLASH_SEEN_TAB_KEY } from "@/components/SplashGate";
import { useHydrated } from "@/components/useHydrated";

/* 첫 화면은 스플래시다. 끝나면 /market 으로 넘어간다.
   /market 의 SplashGate 는 같은 문서에서 이미 본 스플래시를 다시 띄우지 않는다
   (introOnce.ts markIntroSeen). 마운트를 하이드레이션 이후로 미루는 이유는 SplashGate 와 같다. */
export default function HomePage() {
  const router = useRouter();
  const hydrated = useHydrated();

  // 스플래시가 도는 3초 동안 마켓을 미리 받아 둔다. 끝나고 빈 화면이 길게 보이지 않게.
  useEffect(() => {
    router.prefetch("/market");
  }, [router]);

  function done() {
    markIntroSeen(SPLASH_SEEN_TAB_KEY);
    router.replace("/market");
  }

  return hydrated ? <Splash onDone={done} /> : null;
}
