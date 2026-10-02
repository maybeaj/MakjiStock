import { kstHour, kstTodayKey } from "./engine";
import { loadMarketData, type MarketData } from "./market-data";
import type { Policy } from "./policy";
import { loadActivePolicy } from "./policy-server";
import {
  EMPTY_LOCK,
  loadInstantRewards,
  loadLock,
  loadPredictions,
  loadRewardTotalWon,
  type InstantReward,
  type LockData,
  type ServerPredictionRow,
} from "./visitor-data";

/* 화면이 첫 렌더에 필요한 것 전부. 페이지 둘이 같은 껍데기를 쓰므로 여기 모은다.

   하나가 실패해도 나머지는 그린다. 시세가 없으면 시드로 돌고, 잠금·예측이
   없으면 없는 대로 보인다 — 아무것도 안 보이는 것보다 낫다. */
export type ShellData = {
  clock: { todayKey: string; hour: number };
  market: MarketData | null;
  lock: LockData;
  predictions: ServerPredictionRow[];
  /** 바로 받기로 받은, 아직 쓸 수 있는 쿠폰. */
  instantRewards: InstantReward[];
  /** 지금까지 받은 할인코드 금액의 합(원). */
  rewardTotalWon: number;
  /** 운영 중인 산식·쿠폰 정책. 화면이 말하는 보상률이 서버가 발급하는 값과 같아야 한다. */
  policy: Policy;
};

export async function loadShellData(): Promise<ShellData> {
  const [market, lock, predictions, instantRewards, rewardTotalWon, policy] = await Promise.all([
    loadMarketData().catch((cause) => {
      // 삼키되 흔적은 남긴다. 이게 없으면 실서비스에서 시세가 빈 이유를 알 수 없다.
      console.error("[market] 시세를 불러오지 못했습니다", cause);
      return null;
    }),
    loadLock().catch(() => EMPTY_LOCK),
    loadPredictions().catch(() => []),
    loadInstantRewards().catch(() => []),
    loadRewardTotalWon().catch(() => 0),
    loadActivePolicy().then((p) => ({ version: p.version, formula: p.formula, coupons: p.coupons })),
  ]);
  return { clock: { todayKey: kstTodayKey(), hour: kstHour() }, market, lock, predictions, instantRewards, rewardTotalWon, policy };
}
