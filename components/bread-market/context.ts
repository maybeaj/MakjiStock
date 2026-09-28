"use client";

import { createContext, useContext } from "react";
import type { InstantReward, LockData, ServerPredictionRow } from "@/lib/bread-market/visitor-data";

export type SheetState =
  | { type: "detail"; tk: string }
  | { type: "locked-detail"; tk: string }
  | { type: "predict" }
  | { type: "lock"; tk: string }
  | { type: "history" }
  | null;

/* 서버 로더가 내려주는 모양 그대로다. 두 벌로 두면 한쪽만 고쳐져 어긋난다. */
export type ServerPrediction = ServerPredictionRow;

export type BreadMarketCtx = {
  todayKey: string;
  /* 예측은 서버가 정본이다. Shell 이 한 번 받아 내려보낸다.
     화면마다 따로 받으면 요청이 늘고 상태가 갈라진다. */
  predictions: ServerPrediction[];
  refreshPredictions: () => void;
  /* 이 브라우저의 오늘 잠금. 서버가 정본이고 첫 HTML 에 이미 들어 있다. */
  lock: LockData;
  /** 바로 받기로 받은, 아직 쓸 수 있는 쿠폰. 예측 목록과 출처가 달라 따로 온다. */
  instantRewards: InstantReward[];
  openSheet: (s: SheetState) => void;
  toast: (icon: string, title: string, desc?: string) => void;
};

export const BreadMarketContext = createContext<BreadMarketCtx | null>(null);

export function useBreadMarket() {
  const ctx = useContext(BreadMarketContext);
  if (!ctx) throw new Error("useBreadMarket must be used inside <BreadMarketShell>");
  return ctx;
}
