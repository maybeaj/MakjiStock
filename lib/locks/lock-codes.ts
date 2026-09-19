import { encryptSecret } from "@/lib/crypto";
import { CAFE24_CALL_GAP_MS, createDiscountCode } from "@/lib/rewards/discount-code";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 잠금 차액 할인코드 — PRD §4.4 · §12.4

   몰 판매가는 보호 구간에 들어가도 잠금가로 내려가지 않는다. 대신
   `잠금가 - 현재가` 만큼 정액 할인코드를 발급해 잠금가를 실현한다.

   발급 시점
     16:00  오전 잠금자  → 현재가는 오후가        (오후가 크론에 붙는다)
     잠금은 오전장에만 받는다. 코드는 보호 구간(16:00~다음 날 01:59) 동안 유효하다.

   차액이 0 이하면 코드를 만들지 않는다. 이미 잠금가보다 싸다.

   코드는 이메일로 보내지 않고 MY 화면에 바로 띄운다. 비로그인이라
   visitor_token 쿠키가 본인 확인을 대신한다. 그래서 원문을 다시 읽어야 하고,
   PRD §16.7 에 따라 암호화해서 저장한다. */

type LockRow = {
  id: string;
  visitor_hash: string;
  product_id: string;
  lock_session: "am" | "pm";
  locked_price_won: number;
  protect_from: string;
  protect_until: string;
  products: { ticker: string; name: string; cafe24_product_no: number | null } | null;
};

export type IssueResult = {
  ticker: string;
  lockId: string;
  lockedPriceWon: number;
  currentPriceWon: number;
  amountWon: number;
  result: "issued" | "skipped" | "failed";
  reason?: string;
};

/**
 * 보호 구간에 들어가는 잠금들에 차액 코드를 발급한다.
 * @param lockSession  보호가 시작되는 잠금의 세션. 지금은 am(16:00 발급)만 쓴다.
 * @param lockDate     잠금이 걸린 시장 날짜(KST).
 * @param priceOf      상품별 현재 판매가를 돌려준다.
 */
export async function issueLockCodes({
  lockSession,
  lockDate,
  priceOf,
  commit,
}: {
  lockSession: "am" | "pm";
  lockDate: string;
  priceOf: (productId: string) => number | null;
  commit: boolean;
}): Promise<IssueResult[]> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("price_locks")
    .select(
      "id,visitor_hash,product_id,lock_session,locked_price_won,protect_from,protect_until,products(ticker,name,cafe24_product_no)",
    )
    .eq("lock_date", lockDate)
    .eq("lock_session", lockSession)
    .eq("status", "active")
    .is("reward_claim_id", null);

  if (error) throw new Error(`잠금 조회 실패: ${error.message}`);
  const locks = (data ?? []) as unknown as LockRow[];
  const out: IssueResult[] = [];

  for (const lock of locks) {
    const ticker = lock.products?.ticker ?? lock.product_id;
    const current = priceOf(lock.product_id);
    const base = {
      ticker,
      lockId: lock.id,
      lockedPriceWon: lock.locked_price_won,
      currentPriceWon: current ?? 0,
    };

    if (current === null) {
      out.push({ ...base, amountWon: 0, result: "skipped", reason: "현재가를 찾을 수 없음" });
      continue;
    }

    // 10원 단위로 내린다. 판매가가 10원 단위라 차액도 10원 단위다.
    const amount = Math.floor((current - lock.locked_price_won) / 10) * 10;
    if (amount <= 0) {
      out.push({ ...base, amountWon: 0, result: "skipped", reason: "이미 잠금가 이하" });
      continue;
    }
    if (!lock.products?.cafe24_product_no) {
      out.push({ ...base, amountWon: amount, result: "skipped", reason: "cafe24_product_no 없음" });
      continue;
    }
    if (!commit) {
      out.push({ ...base, amountWon: amount, result: "skipped", reason: "dry-run" });
      continue;
    }

    try {
      const { code, codeNo } = await createDiscountCode({
        name: `막지 잠금가 ${ticker} ${lockDate}`,
        amountWon: amount,
        cafe24ProductNo: lock.products.cafe24_product_no,
        validFrom: lock.protect_from,
        validUntil: lock.protect_until,
      });

      const { data: claim, error: claimError } = await db
        .from("reward_claims")
        .insert({
          price_lock_id: lock.id,
          visitor_hash: lock.visitor_hash,
          amount_won: amount,
          sale_price_won_at_issue: current,
          cafe24_discount_code_no: codeNo,
          discount_code_ciphertext: encryptSecret(code),
          valid_from: lock.protect_from,
          valid_until: lock.protect_until,
          status: "issued",
          sent_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (claimError) throw new Error(`보상 저장 실패: ${claimError.message}`);

      await db
        .from("price_locks")
        .update({
          reward_claim_id: claim.id,
          lock_code_amount_won: amount,
          current_price_won_at_protect: current,
          status: "protecting",
        })
        .eq("id", lock.id);

      out.push({ ...base, amountWon: amount, result: "issued" });
    } catch (cause) {
      out.push({
        ...base,
        amountWon: amount,
        result: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, CAFE24_CALL_GAP_MS));
  }

  return out;
}
