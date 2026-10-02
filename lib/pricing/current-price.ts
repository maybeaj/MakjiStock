/* 경로 별칭(@/) 대신 상대경로다 — tests/current-price.test.mjs 가 node 로 직접
   불러온다. daily-job.ts 를 떼어낸 이유와 같다. */
import { supabaseAdmin } from "../supabase/admin.ts";

/* 지금 화면에 떠 있는 확정가를 돌려준다.

   그날 확정가만 본다. 전날로 거슬러 올라가지 않는다 — 몰은 02:00 에 정가로
   되돌아가고(reset-list-price) 그날 가격이 만들어져야 할인가가 다시 올라간다.
   오전가가 보류된 아침에 전날 가격을 끌어오면 몰은 정가로 받는데 잠금·예측은
   더 싼 값으로 잡힌다. 그 시간대에는 확정가가 "없는" 게 맞고, 잠금·예측은
   거절된다(app/api/locks · app/api/predictions).

   오후가가 없는 날(주말)은 다르다. 오후 PUT 자체가 없어 몰이 오전가를 그대로
   들고 있으므로 같은 날 오전 확정가로 떨어진다 (PRD §9.3).

   화면(engine.ts quoteAt)도 같은 규칙을 쓴다. 둘이 어긋나면 화면에 뜬 가격과
   서버가 잠그는 가격이 달라진다. docs/네이버-검색지수-도착시각.md */

export type CurrentPrice = {
  productId: string;
  priceWon: number;
  /** 실제로 사용한 세션. 요청한 세션과 다르면 오후→오전 폴백이 일어난 것이다. */
  session: "am" | "pm";
  /** 실제로 사용한 공개일. 항상 요청한 날짜다. */
  publishDate: string;
};

/**
 * 확정가를 찾을 슬롯 — 그날 것만, 최근 것부터.
 * 오전장 ← 그날 오전가.
 * 오후장 ← 그날 오후가 → 그날 오전가(주말·비영업일).
 * engine.ts 의 quoteAt 과 같은 순서다. 둘이 어긋나면 화면과 서버가 다른 가격을 말한다.
 */
export function priceSlots(publishDate: string, session: "am" | "pm") {
  const slots: { date: string; session: "am" | "pm" }[] = [{ date: publishDate, session }];
  if (session === "pm") slots.push({ date: publishDate, session: "am" });
  return slots;
}

export async function currentPriceOf(
  productId: string,
  publishDate: string,
  session: "am" | "pm",
): Promise<CurrentPrice | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("daily_prices")
    .select("price_won,price_session,publish_date")
    .eq("product_id", productId)
    .eq("publish_date", publishDate)
    // 같은 장을 다른 산식 버전으로 다시 계산한 행이 있으면 나중 것이 이긴다 (Map 에 나중에 들어간 값)
    .order("created_at");

  if (error) throw new Error(error.message);
  const bySlot = new Map((data ?? []).map((r) => [r.price_session as string, r]));

  for (const { session: slot } of priceSlots(publishDate, session)) {
    const row = bySlot.get(slot);
    if (row) {
      return {
        productId,
        priceWon: row.price_won,
        session: row.price_session as "am" | "pm",
        publishDate: row.publish_date,
      };
    }
  }
  return null;
}
