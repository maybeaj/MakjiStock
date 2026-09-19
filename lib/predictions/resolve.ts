import { REWARD_RATE_PCT, couponAmountWon, resolveDirection } from "@/lib/bread-market/reward-policy";
import { encryptSecret } from "@/lib/crypto";
import { CAFE24_CALL_GAP_MS, createDiscountCode } from "@/lib/rewards/discount-code";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 예측 판정과 보상 발급 — PRD §4.3 · §13.3

   가격이 확정되는 순간이 곧 판정 시점이다. 그래서 새 크론을 두지 않고
   가격 산정 크론에 붙인다.
     오전가 확정(05시대) → 전날 오후장 제출분 판정
     오후가 확정(15시대) → 오늘 오전장 제출분 판정

   적중 5%, 동일가는 무승부로 5%, 빗나감 0% (PRD §4.3).
   쿠폰율은 상품 할인과 합쳐 38%를 넘지 않게 발급 시점 판매가로 깎는다. */

type EntryRow = {
  id: string;
  visitor_hash: string;
  product_id: string;
  direction: "up" | "down";
  reference_price_won: number;
  products: { ticker: string; base_price_won: number; cafe24_product_no: number | null } | null;
};

export type ResolveResult = {
  ticker: string;
  entryId: string;
  direction: "up" | "down";
  referencePriceWon: number;
  resultPriceWon: number;
  outcome: "hit" | "miss" | "void";
  ratePct: number;
  amountWon: number;
  code: "issued" | "none" | "failed";
  reason?: string;
};

/**
 * 방금 확정된 가격으로 예측을 판정한다.
 * @param targetDate     판정 기준 가격의 공개일
 * @param targetSession  판정 기준 가격의 세션
 * @param priceOf        상품별 확정가
 * @param validUntil     보상 코드 유효 종료 시각(ISO). 판매가가 다시 내려가기 전까지.
 */
export async function resolvePredictions({
  targetDate,
  targetSession,
  priceOf,
  validUntil,
  commit,
}: {
  targetDate: string;
  targetSession: "am" | "pm";
  priceOf: (productId: string) => number | null;
  validUntil: string;
  commit: boolean;
}): Promise<ResolveResult[]> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("prediction_entries")
    .select(
      "id,visitor_hash,product_id,direction,reference_price_won,products(ticker,base_price_won,cafe24_product_no)",
    )
    .eq("role", "general")
    .eq("result", "pending")
    .eq("target_publish_date", targetDate)
    .eq("target_session", targetSession);

  if (error) throw new Error(`예측 조회 실패: ${error.message}`);
  const entries = (data ?? []) as unknown as EntryRow[];
  const out: ResolveResult[] = [];

  for (const entry of entries) {
    const ticker = entry.products?.ticker ?? entry.product_id;
    const resultPrice = priceOf(entry.product_id);
    if (resultPrice === null) continue; // 그 상품만 보류. 다음 실행에서 다시 본다.

    const outcome = resolveDirection(entry.direction, entry.reference_price_won, resultPrice);
    const ratePct = REWARD_RATE_PCT[outcome];
    const base = {
      ticker,
      entryId: entry.id,
      direction: entry.direction,
      referencePriceWon: entry.reference_price_won,
      resultPriceWon: resultPrice,
      outcome,
      ratePct,
    };

    const basePriceWon = entry.products?.base_price_won ?? resultPrice;
    const amount = ratePct > 0 ? couponAmountWon(ratePct, resultPrice, basePriceWon) : 0;

    if (!commit) {
      out.push({ ...base, amountWon: amount, code: "none", reason: "dry-run" });
      continue;
    }

    await db
      .from("prediction_entries")
      .update({
        result: outcome,
        result_price_won: resultPrice,
        reward_rate_pct: ratePct,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", entry.id);

    if (amount <= 0 || !entry.products?.cafe24_product_no) {
      out.push({
        ...base,
        amountWon: amount,
        code: "none",
        reason: amount <= 0 ? "보상 없음" : "cafe24_product_no 없음",
      });
      continue;
    }

    try {
      const { code, codeNo } = await createDiscountCode({
        name: `막지 예측보상 ${ticker} ${targetDate}`,
        amountWon: amount,
        cafe24ProductNo: entry.products.cafe24_product_no,
        validFrom: new Date().toISOString(),
        validUntil,
      });

      const { error: claimError } = await db.from("reward_claims").insert({
        prediction_entry_id: entry.id,
        visitor_hash: entry.visitor_hash,
        rate_pct: ratePct,
        amount_won: amount,
        sale_price_won_at_issue: resultPrice,
        cafe24_discount_code_no: codeNo,
        discount_code_ciphertext: encryptSecret(code),
        valid_from: new Date().toISOString(),
        valid_until: validUntil,
        status: "issued",
        sent_at: new Date().toISOString(),
      });
      if (claimError) throw new Error(claimError.message);

      out.push({ ...base, amountWon: amount, code: "issued" });
    } catch (cause) {
      out.push({
        ...base,
        amountWon: amount,
        code: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, CAFE24_CALL_GAP_MS));
  }

  return out;
}
