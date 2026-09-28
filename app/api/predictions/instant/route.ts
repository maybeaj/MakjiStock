import { INSTANT_CODE_HOURS, couponAmountWon, instantCodeValidUntil, instantRewardPct } from "@/lib/bread-market/reward-policy";
import { encryptSecret } from "@/lib/crypto";
import { kstNow } from "@/lib/market/calendar";
import { predictionSchedule } from "@/lib/predictions/schedule";
import { currentPriceOf } from "@/lib/pricing/current-price";
import { createDiscountCode } from "@/lib/rewards/discount-code";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateVisitorHash } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/* 안정형 투자(바로 받기) — 예측을 포기하고 회차·장 보상률(오전 7~10%·오후 5~7%)을 그 자리에서 받는다.

   POST /api/predictions/instant  { ticker }

   예측과 같은 회차를 쓰고 같은 "하루 한 번" 을 나눠 쓴다. 둘 다 하면 하루에
   쿠폰이 두 장 나가므로 서로를 막는다 — 예측 기록이 있으면 여기서 거절하고,
   여기서 받았으면 예측 쪽이 거절한다. 회차당 1회는 reward_claims 의
   (round_id, visitor_hash) 부분 유니크가 DB 에서 막는다.

   "지금 사면" 이라고 말하지 않는다. 구매를 확인할 방법이 없다 — Cafe24 주문과
   방문자를 잇는 다리가 아직 없다. 실제로 하는 일은 "오늘 예측을 넘기고 확정
   쿠폰을 받는 것" 이고 문구도 그렇게 간다. */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ticker?: string; productId?: string };
  if (!body.ticker && !body.productId) {
    return Response.json({ error: "ticker 또는 productId 가 필요합니다." }, { status: 400 });
  }

  const { date, hour } = kstNow();
  if (hour < 6) {
    return Response.json(
      { error: "정가 시간에는 받을 수 없습니다. 06:00 오전가부터 가능합니다." },
      { status: 409 },
    );
  }

  const db = supabaseAdmin();
  const target = predictionSchedule(date, hour);
  const roundId = `${date}-${target.targetSession}`;

  const { data: product } = await db
    .from("products")
    .select("id,name,base_price_won,cafe24_product_no")
    .eq(body.productId ? "id" : "ticker", body.productId ?? body.ticker!)
    .eq("active", true)
    .maybeSingle();
  if (!product) {
    return Response.json({ error: `상품을 찾을 수 없습니다: ${body.ticker ?? body.productId}` }, { status: 404 });
  }
  if (!product.cafe24_product_no) {
    return Response.json({ error: "이 상품은 아직 쿠폰을 발급할 수 없어요." }, { status: 409 });
  }

  /* 쿠폰 금액의 기준은 지금 화면에 떠 있는 확정가다. 없으면 몰도 정가 상태라
     깎아줄 기준이 없다 (lib/pricing/current-price.ts). */
  const price = await currentPriceOf(product.id, target.referenceDate, target.submitSession);
  if (!price) {
    return Response.json(
      { error: "오늘 가격이 아직 나오지 않았어요. 잠시 뒤 다시 시도해주세요." },
      { status: 409 },
    );
  }

  const visitorHash = await getOrCreateVisitorHash();

  // 이 회차에 이미 예측했으면 바로 받기를 줄 수 없다. 하루 한 번을 나눠 쓴다.
  const { data: predicted } = await db
    .from("prediction_entries")
    .select("id")
    .eq("round_id", roundId)
    .eq("visitor_hash", visitorHash)
    .maybeSingle();
  if (predicted) {
    return Response.json(
      { error: "이번 회차에는 이미 예측했어요. 결과는 내일 06:00에 나와요." },
      { status: 409 },
    );
  }

  /* 화면이 보여준 그 값이다. 회차에서 결정론적으로 뽑으므로 서버가 다시 계산해도 같다. */
  const ratePct = instantRewardPct(roundId, target.submitSession);
  const amountWon = couponAmountWon(ratePct, price.priceWon, product.base_price_won);
  if (amountWon <= 0) {
    return Response.json({ error: "지금은 할인 여력이 없어요. 잠시 뒤 다시 시도해주세요." }, { status: 409 });
  }

  /* 라운드는 예측과 같은 것을 쓴다. 바로 받기가 그날의 첫 참여일 수 있으므로
     여기서도 만들어 둔다 (예측 쪽과 같은 upsert). */
  const { error: roundError } = await db.from("prediction_rounds").upsert(
    {
      id: roundId,
      round_date: date,
      target_publish_date: target.targetDate,
      target_session: target.targetSession,
      closes_at: target.closesAt,
      status: "open",
    },
    { onConflict: "id" },
  );
  if (roundError) return Response.json({ error: roundError.message }, { status: 502 });

  const issuedAt = new Date().toISOString();
  const validUntil = instantCodeValidUntil(issuedAt);
  let code: string;
  let codeNo: string | null;
  try {
    ({ code, codeNo } = await createDiscountCode({
      name: `막지 바로받기 ${body.ticker ?? product.id} ${date}`,
      amountWon,
      cafe24ProductNo: product.cafe24_product_no,
      validFrom: issuedAt,
      validUntil,
    }));
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "쿠폰을 만들지 못했어요." },
      { status: 502 },
    );
  }

  const { error: claimError } = await db.from("reward_claims").insert({
    round_id: roundId,
    /* 쿠폰은 Cafe24 에서 이 빵 하나에만 묶여 나간다(discount-code.ts
       available_product). 어느 빵인지 여기 남기지 않으면 화면이 말할 수 없다. */
    product_id: product.id,
    visitor_hash: visitorHash,
    rate_pct: ratePct,
    amount_won: amountWon,
    sale_price_won_at_issue: price.priceWon,
    cafe24_discount_code_no: codeNo,
    discount_code_ciphertext: encryptSecret(code),
    valid_from: issuedAt,
    valid_until: validUntil,
    status: "issued",
    sent_at: issuedAt,
  });
  if (claimError) {
    // (round_id, visitor_hash) 부분 유니크 — 회차당 1회
    if (claimError.code === "23505") {
      return Response.json({ error: "이번 회차에는 이미 받았어요." }, { status: 409 });
    }
    return Response.json({ error: claimError.message }, { status: 502 });
  }

  return Response.json(
    { code, amountWon, ratePct, validUntil, validHours: INSTANT_CODE_HOURS, productName: product.name },
    { status: 201 },
  );
}
