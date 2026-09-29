"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/* 화면이 열릴 때마다 /api/events 에 page_view 를 남긴다(재방문율 집계용).
   실패해도 화면에는 아무 영향이 없게 조용히 버린다.
   같은 경로를 두 번 보내지 않는다 — 개발 모드는 effect 를 두 번 돌린다. */
export function PageView() {
  const pathname = usePathname();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || sent.current === pathname) return;
    sent.current = pathname;
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "page_view", path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
