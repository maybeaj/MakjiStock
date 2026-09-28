"use client";

import { useState } from "react";
import { markIntroSeen, shouldShowIntro } from "./introOnce";
import { Onboarding } from "./Onboarding";
import { useHydrated } from "./useHydrated";

/* 새로고침할 때마다 온보딩을 보여준다. 스플래시가 사라지면 그 아래 이미
   깔려 있던 온보딩이 드러나고, 마켓은 그 아래 또 깔려 있다.
   마운트를 하이드레이션 이후로 미루는 이유는 SplashGate와 동일 —
   step 진입 CSS 애니메이션이 서버 렌더 시점부터 시작되는 것을 막기 위해서다.
   Next 가 스스로 문서를 다시 연 경우에는 건너뛴다(introOnce.ts). */
export const ONBOARDING_SEEN_TAB_KEY = "makji_onboarding_seen_tab";
const SEEN_KEY = ONBOARDING_SEEN_TAB_KEY;
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && !shouldShowIntro(SEEN_KEY));

  function dismiss() {
    markIntroSeen(SEEN_KEY);
    setDismissed(true);

    /* 마켓은 window가 아니라 .scroll이 실제 스크롤 영역이다. 브라우저가
       복원한 위치를 온보딩 뒤에도 유지하지 않도록, 오버레이가 사라지는
       프레임까지 맨 위를 다시 확정한다. */
    if (window.location.pathname !== "/market") return;
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", "/market");
    }
    const reset = () => {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>(".scroll")?.scrollTo(0, 0);
    };
    reset();
    requestAnimationFrame(() => {
      reset();
      requestAnimationFrame(reset);
    });
  }

  return (
    <>
      {children}
      {hydrated && !dismissed ? <Onboarding onDone={dismiss} /> : null}
    </>
  );
}
