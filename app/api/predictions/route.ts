import { decryptSecret } from "@/lib/crypto";
import { currentPriceOf } from "@/lib/pricing/current-price";
import { kstNow } from "@/lib/market/calendar";
import { predictionSchedule } from "@/lib/predictions/schedule";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateVisitorHash, readVisitorHash } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/* 가격 예측 — PRD §4.3 · §13
   POST /api/predictions  { ticker, direction: "up" | "down" }
   GET  /api/predictions

   1차 출시는 일반 예측만 받는다. 구매 후 기준가 예측은 Cafe24 주문과
   방문자를 잇는 다리가 생긴 뒤에 별도 범위로 판단한다.

   판정 기준은 제출 시점이 정한다. 가격이 하루 두 번 바뀌므로 "내일"만으로는
   어느 가격인지 정해지지 않는다.
     오전장 제출 → 오늘 오후가로 판정
     오후장 제출 → 내일 오전가로 판정
   잠금과 같은 리듬이라 사용자가 규칙을 한 번만 배우면 된다.

   기준가는 클라이언트가 보내지 않는다. 서버가 daily_prices 에서 읽는다. */

const RATE_HIT_PCT = 3; // 일반 적중 (PRD §4.3)

/** 화면은 티커로 생각한다. 상품 id 는 서버가 찾는다. */
async function tickerToProductId(ticker: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("products")
    .select("id")
    .eq("ticker", ticker)
    .eq("active", true)
    .maybeSingle();
  return data?.id ?? null;
}


export async function GET() {
  const visitorHash = await readVisitorHash();
  if (!visitorHash) return Response.json({ predictions: [] });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("prediction_entries")
    .select(
      "id,product_id,direction,reference_price_won,target_publish_date,target_session,result,result_price_won,reward_rate_pct,submitted_at,resolved_at,products(ticker,name)",
    )
    .eq("visitor_hash", visitorHash)
    .eq("role", "general")
    .order("submitted_at", { ascending: false })
    .limit(20);
  if (error) return Response.json({ error: error.message }, { status: 502 });

  const entries = data ?? [];
  const hitIds = entries.filter((e) => e.result === "hit" || e.result === "void").map((e) => e.id);

  /* 보상 코드는 이메일로 보내지 않고 여기서 바로 내려준다.
     쿠키가 본인 확인을 대신하므로 자기 예측의 코드만 보인다. */
  const codes = new Map<string, { code: string; amountWon: number | null; validUntil: string | null }>();
  if (hitIds.length > 0) {
    const { data: claims } = await db
      .from("reward_claims")
      .select("prediction_entry_id,discount_code_ciphertext,amount_won,valid_until")
      .in("prediction_entry_id", hitIds);
    for (const claim of claims ?? []) {
      if (!claim.discount_code_ciphertext || !claim.prediction_entry_id) continue;
      try {
        codes.set(claim.prediction_entry_id, {
          code: decryptSecret(claim.discount_code_ciphertext),
          amountWon: claim.amount_won,
          validUntil: claim.valid_until,
        });
      } catch {
        // 키가 바뀌었거나 값이 깨진 경우. 예측 기록은 그대로 보여준다.
      }
    }
  }

  return Response.json({
    predictions: entries.map((e) => ({ ...e, reward: codes.get(e.id) ?? null })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ticker?: string;
    productId?: string;
    direction?: string;
  };
  const direction = body.direction === "up" || body.direction === "down" ? body.direction : null;
  if (!direction) {
    return Response.json({ error: "direction 은 up 또는 down 이어야 합니다." }, { status: 400 });
  }
  if (!body.ticker && !body.productId) {
    return Response.json({ error: "ticker 또는 productId 가 필요합니다." }, { status: 400 });
  }

  const { date, hour } = kstNow();
  if (hour < 6) {
    return Response.json(
      { error: "정가 시간에는 예측할 수 없습니다. 06:00 오전가부터 가능합니다." },
      { status: 409 },
    );
  }

  const db = supabaseAdmin();
  const target = predictionSchedule(date, hour);

  const productId = body.productId ?? (await tickerToProductId(body.ticker!));
  if (!productId) {
    return Response.json({ error: `상품을 찾을 수 없습니다: ${body.ticker}` }, { status: 404 });
  }

  // 기준가는 서버가 정한다 — 지금 화면에 떠 있는 확정가
  const price = await currentPriceOf(productId, target.referenceDate, target.submitSession);
  if (!price) {
    return Response.json({ error: "지금 이 상품의 확정가가 아직 없습니다." }, { status: 409 });
  }

  // 라운드는 첫 제출 때 만든다. 따로 크론을 두지 않는다.
  const roundId = `${date}-${target.targetSession}`;
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

  const visitorHash = await getOrCreateVisitorHash();
  const { data: entry, error } = await db
    .from("prediction_entries")
    .insert({
      round_id: roundId,
      role: "general",
      visitor_hash: visitorHash,
      product_id: productId,
      direction,
      reference_price_won: price.priceWon,
      target_publish_date: target.targetDate,
      target_session: target.targetSession,
      result: "pending",
      reward_rate_pct: 0,
    })
    .select("id,product_id,direction,reference_price_won,target_publish_date,target_session,result")
    .single();

  if (error) {
    // (round_id, visitor_hash) 부분 유니크 — 한 라운드 1회 (PRD §13.5)
    if (error.code === "23505") {
      return Response.json(
        { error: "이번 회차에는 이미 예측했습니다. 다음 장에 다시 참여할 수 있어요." },
        { status: 409 },
      );
    }
    return Response.json({ error: error.message }, { status: 502 });
  }

  return Response.json(
    { entry, targetLabel: target.label, rewardOnHitPct: RATE_HIT_PCT },
    { status: 201 },
  );
}
