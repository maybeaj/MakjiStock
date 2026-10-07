import {
  couponAmountWon,
  predictionCodeValidUntil,
  resolveDirection,
  rewardPctFor,
} from "@/lib/bread-market/reward-policy";
import { encryptSecret } from "@/lib/crypto";
import { currentPriceOf } from "@/lib/pricing/current-price";
import { CAFE24_CALL_GAP_MS, createDiscountCode } from "@/lib/rewards/discount-code";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 예측 판정과 보상 발급 — PRD §4.3 · §13.3

   가격이 확정되는 순간이 곧 판정 시점이다. 그래서 새 크론을 두지 않고
   가격 산정 크론에 붙인다. 모든 참여가 target_session='am' 이므로
   (lib/predictions/schedule.ts) 실제 판정은 오전가 확정(05시대)에서만
   일어난다 — 오후가 크론은 대상이 없어 빈 결과를 돌려준다.

   판정 대상은 "오늘 확정한 날짜"만이 아니라 그 이전의 pending 전부다. 크론이
   한 번이라도 건너뛰면 그 날짜는 두 번 다시 오지 않아, 딱 그 날짜만 보면
   영원히 판정 대기로 남는다. 지난 날짜분은 확정가를 DB 에서 읽어 따라잡는다.

   적중·무승부는 참여 때 정한 보상률(reward_rate_pct), 빗나감 0% (rewardPctFor).
   쿠폰율은 상품 할인과 합쳐 38%를 넘지 않게 발급 시점 판매가로 깎는다. */

type EntryRow = {
  id: string;
  visitor_hash: string;
  product_id: string;
  direction: "up" | "down";
  reference_price_won: number;
  reward_rate_pct: number;
  target_publish_date: string;
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
 * @param targetDate     방금 확정한 가격의 공개일. 이 날짜 이하의 pending 을 모두 판정한다.
 * @param targetSession  판정 기준 가격의 세션
 * @param priceOf        상품별 확정가
 *
 * 코드 유효 기간은 발급 시각 + 24시간이다 (reward-policy.ts predictionCodeValidUntil).
 * 호출자가 정하지 않는다 — 밀린 판정을 따라잡을 때 지나간 만료 시각이 붙는 것을 막는다.
 */
export async function resolvePredictions({
  targetDate,
  targetSession,
  priceOf,
  commit,
  productCapPct,
}: {
  /** 운영 중인 상품 할인 상한. 쿠폰 천장(정가 × (38 − 상한)%)을 정한다. */
  productCapPct?: number;
  targetDate: string;
  targetSession: "am" | "pm";
  priceOf: (productId: string) => number | null;
  commit: boolean;
}): Promise<ResolveResult[]> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("prediction_entries")
    .select(
      "id,visitor_hash,product_id,direction,reference_price_won,reward_rate_pct,target_publish_date,products(ticker,base_price_won,cafe24_product_no)",
    )
    .eq("role", "general")
    .eq("result", "pending")
    .lte("target_publish_date", targetDate)
    .eq("target_session", targetSession)
    .order("target_publish_date");

  if (error) throw new Error(`예측 조회 실패: ${error.message}`);
  const entries = (data ?? []) as unknown as EntryRow[];
  const out: ResolveResult[] = [];

  for (const entry of entries) {
    const ticker = entry.products?.ticker ?? entry.product_id;
    /* 오늘 확정분은 방금 계산한 값을, 밀린 날짜분은 그날 확정가를 읽는다.
       밀린 건수만큼만 조회한다 — 평소에는 0 건이다. */
    const resultPrice =
      entry.target_publish_date === targetDate
        ? priceOf(entry.product_id)
        : ((await currentPriceOf(entry.product_id, entry.target_publish_date, targetSession))?.priceWon ?? null);
    if (resultPrice === null) continue; // 그 상품만 보류. 다음 실행에서 다시 본다.

    const outcome = resolveDirection(entry.direction, entry.reference_price_won, resultPrice);
    /* 제출 때 약속한 보상률을 쓴다. 회차마다 다르므로 지금 다시 뽑으면 안 된다. */
    const ratePct = rewardPctFor(outcome, entry.reward_rate_pct);
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
    const amount = ratePct > 0 ? couponAmountWon(ratePct, resultPrice, basePriceWon, productCapPct) : 0;

    if (!commit) {
      out.push({ ...base, amountWon: amount, code: "none", reason: "dry-run" });
      continue;
    }

    const { error: updateError } = await db
      .from("prediction_entries")
      .update({
        result: outcome,
        result_price_won: resultPrice,
        reward_rate_pct: ratePct,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", entry.id);
    // 판정이 저장되지 않았으면 쿠폰도 내지 않는다. pending 으로 남아 다음 실행에서 다시 본다.
    if (updateError) {
      out.push({ ...base, amountWon: 0, code: "none", reason: `판정 저장 실패: ${updateError.message}` });
      continue;
    }

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
      const issuedAt = new Date().toISOString();
      const validUntil = predictionCodeValidUntil(issuedAt);
      const { code, codeNo } = await createDiscountCode({
        name: `막지 예측보상 ${ticker} ${targetDate}`,
        amountWon: amount,
        cafe24ProductNo: entry.products.cafe24_product_no,
        validFrom: issuedAt,
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
        valid_from: issuedAt,
        valid_until: validUntil,
        status: "issued",
        sent_at: issuedAt,
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
