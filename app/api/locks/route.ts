import { lockOpensOn } from "@/lib/bread-market/reward-policy";
import { loadActivePolicy } from "@/lib/bread-market/policy-server";
import { currentPriceOf } from "@/lib/pricing/current-price";
import { kstNow } from "@/lib/market/calendar";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadLock } from "@/lib/bread-market/visitor-data";
import { issueLockCodes } from "@/lib/locks/lock-codes";
import { getOrCreateVisitorHash } from "@/lib/visitor";

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

/* 화면은 이제 페이지 렌더에서 loadLock 을 직접 부른다(page-data.ts).
   이 경로는 같은 값을 밖에서 들여다보기 위해 남겨 둔다. */
export async function GET() {
  try {
    return Response.json({ ...(await loadLock()) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
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
  /* 주말은 외환시장이 쉬어 오후가가 나오지 않는다. 보호할 가격 변동이 없으므로
     하루 한 번뿐인 잠금을 쓰게 두지 않는다 (reward-policy.ts lockOpensOn). */
  if (!lockOpensOn(date)) {
    return Response.json(
      { error: "주말에는 오후가가 나오지 않아 가격 잠금을 받지 않습니다. 월요일 06:00에 다시 열려요." },
      { status: 409 },
    );
  }
  const session = "am" as const;

  const db = supabaseAdmin();
  const formulaVersion = (await loadActivePolicy()).version;

  // 화면은 티커로 생각한다. 상품 id 는 서버가 찾는다.
  const productId = body.productId ?? (await tickerToProductId(body.ticker!));
  if (!productId) {
    return Response.json({ error: `상품을 찾을 수 없습니다: ${body.ticker}` }, { status: 404 });
  }

  // 잠금가는 서버가 정한다 — 화면에 떠 있는 값과 같아야 한다
  /* 오늘 오전가가 아직 안 나온 시간대다. 그동안 몰은 02:00 리셋 그대로 정가이고
     화면도 정가를 보여준다(engine.ts quoteAt). 정가를 잠그는 것은 보호할 할인이
     없다는 뜻이라 받지 않는다. */
  const price = await currentPriceOf(productId, date, session);
  if (!price) {
    return Response.json(
      { error: "오늘 가격이 아직 나오지 않았어요. 잠시 뒤 다시 시도해주세요." },
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

  /* 오후가가 이미 나와 있으면 그 자리에서 차액 코드를 발급한다.

     오후가 크론은 15시대 아무 때나 돌고(Hobby, ±59분) 그 순간의 명단만
     집어간다. 그 뒤 15:59 까지 걸린 잠금은 다시 도는 회차가 없어 쿠폰 없이
     보호 구간에 들어갔다. issueLockCodes 는 reward_claim_id 가 빈 것만 보므로
     크론과 겹쳐도 두 번 발급되지 않는다.

     폴백으로 올라온 오전가는 발급 대상이 아니다(session 을 직접 본다) —
     주말처럼 오후가가 없는 날은 몰 가격이 그대로라 차액도 없다. */
  const pmPrice = await currentPriceOf(productId, date, "pm");
  if (pmPrice?.session === "pm") {
    try {
      await issueLockCodes({
        lockSession: session,
        lockDate: date,
        lockId: inserted.id,
        priceOf: () => pmPrice.priceWon,
        commit: true,
      });
    } catch (cause) {
      /* 잠금은 이미 저장됐다. 발급이 실패해도 되돌리지 않는다 — 크론이 돌기 전과
         같은 상태이고, 그건 원래도 쿠폰이 아직 없는 상태다. */
      console.error("[locks] 차액 코드 즉시 발급 실패", cause);
    }
  }

  return Response.json({ lock: inserted, protectLabel: window.label }, { status: 201 });
}
