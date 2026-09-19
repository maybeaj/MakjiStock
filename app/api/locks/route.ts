import pricingConfig from "@/config/pricing-products.json";
import { decryptSecret } from "@/lib/crypto";
import { currentPriceOf } from "@/lib/pricing/current-price";
import { kstNow } from "@/lib/market/calendar";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateVisitorHash, readVisitorHash } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/* 가격 잠금 — PRD §4.4 · §13.5
   POST /api/locks   { ticker } 또는 { productId }   현재 장의 확정가로 잠근다
   GET  /api/locks                   오늘 내 잠금을 돌려준다

   하루 1회·빵 1개 제한은 DB 유니크 제약이 강제한다 (visitor_hash, lock_date).
   해지해도 같은 날 잠금권은 복구하지 않는다.

   잠금가는 클라이언트가 보내지 않는다. 서버가 daily_prices 에서 읽는다 —
   값을 받으면 원하는 가격에 잠글 수 있다. */

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


/* 보호 구간 — 오전 잠금만 받는다. 오후장 16:00 ~ 다음 날 01:59 (KST).
   02:00 부터는 정가다. */
function protectionWindow(lockDate: string) {
  const next = new Date(`${lockDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return {
    from: `${lockDate}T16:00:00+09:00`,
    until: `${nextDate}T01:59:59+09:00`,
    label: "오늘 16:00–새벽 01:59",
  };
}

export async function GET() {
  const visitorHash = await readVisitorHash();
  if (!visitorHash) return Response.json({ lock: null });

  const { date } = kstNow();
  const db = supabaseAdmin();

  // date 는 02:00 에 바뀌는 시장 날짜라 자정 뒤 보호 구간도 같은 날 잠금이다.
  const { data, error } = await db
    .from("price_locks")
    .select(
      "id,product_id,lock_date,lock_session,locked_price_won,protect_from,protect_until,status,lock_code_amount_won,current_price_won_at_protect,reward_claim_id,products(ticker,name)",
    )
    .eq("visitor_hash", visitorHash)
    .eq("lock_date", date)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 502 });

  const lock = data;
  if (!lock) return Response.json({ lock: null });

  /* 차액 할인코드는 이메일로 보내지 않고 여기서 바로 내려준다.
     쿠키가 본인 확인을 대신하므로 자기 잠금의 코드만 볼 수 있다. */
  let discountCode: string | null = null;
  let validUntil: string | null = null;
  if (lock.reward_claim_id) {
    const { data: claim } = await db
      .from("reward_claims")
      .select("discount_code_ciphertext,valid_until,status")
      .eq("id", lock.reward_claim_id)
      .maybeSingle();
    if (claim?.discount_code_ciphertext) {
      try {
        discountCode = decryptSecret(claim.discount_code_ciphertext);
        validUntil = claim.valid_until;
      } catch {
        // 키가 바뀌었거나 값이 깨진 경우. 잠금 정보는 그대로 보여준다.
        discountCode = null;
      }
    }
  }

  return Response.json({ lock, discountCode, validUntil });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    productId?: string;
    ticker?: string;
  };
  if (!body.productId && !body.ticker) {
    return Response.json({ error: "ticker 또는 productId 가 필요합니다." }, { status: 400 });
  }

  const { date, hour } = kstNow();
  // 잠금은 오전장(06:00~15:59)에만 받는다. docs/가격-잠금-1회-사유.md
  if (hour < 6 || hour >= 16) {
    return Response.json(
      { error: "가격 잠금은 오전장(06:00~15:59)에만 할 수 있습니다." },
      { status: 409 },
    );
  }
  const session = "am" as const;

  const db = supabaseAdmin();
  const formulaVersion =
    (pricingConfig.pricing as { formulaVersion?: string }).formulaVersion ?? "v0.7";

  // 화면은 티커로 생각한다. 상품 id 는 서버가 찾는다.
  const productId = body.productId ?? (await tickerToProductId(body.ticker!));
  if (!productId) {
    return Response.json({ error: `상품을 찾을 수 없습니다: ${body.ticker}` }, { status: 404 });
  }

  // 잠금가는 서버가 정한다 — 화면에 떠 있는 값과 같아야 한다
  const price = await currentPriceOf(productId, date, session);
  if (!price) {
    return Response.json(
      { error: "오늘 이 상품의 확정가가 아직 없습니다." },
      { status: 409 },
    );
  }

  const visitorHash = await getOrCreateVisitorHash();
  const window = protectionWindow(date);

  const { data: inserted, error } = await db
    .from("price_locks")
    .insert({
      visitor_hash: visitorHash,
      product_id: price.productId,
      lock_date: date,
      lock_session: session,
      locked_price_won: price.priceWon,
      protect_from: window.from,
      protect_until: window.until,
      // 이메일 인증은 쿠폰 발급 단계에서 받는다. 잠금 자체는 바로 유효하다.
      status: "active",
      formula_version: formulaVersion,
    })
    .select("id,product_id,lock_session,locked_price_won,protect_from,protect_until,status")
    .single();

  if (error) {
    // (visitor_hash, lock_date) 유니크 — 하루 1회 제한에 걸린 경우
    if (error.code === "23505") {
      return Response.json(
        { error: "오늘은 이미 잠금을 사용했습니다. 하루에 한 번, 빵 한 개만 잠글 수 있습니다." },
        { status: 409 },
      );
    }
    return Response.json({ error: error.message }, { status: 502 });
  }

  return Response.json({ lock: inserted, protectLabel: window.label }, { status: 201 });
}
