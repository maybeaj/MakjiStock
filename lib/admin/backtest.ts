import { marginCapPct } from "@/lib/pricing/daily-job";
import { calculateDay, type PricingConfig } from "@/lib/pricing/pricing.mjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 90일 백테스트 — daily_prices 에 장마다 저장된 입력(검색지수, 환율 변화율, 그날 정가)을
   그대로 두고 산식만 바꿔 다시 계산한다. 가격 크론과 같은 calculateDay 를 쓰므로
   "운영 값으로 다시 계산" 한 줄은 실제 발행가와 같아야 한다 (예전 버전으로 나간 날은 다를 수 있다).
   검색지수 재수집·환율 재조회는 하지 않는다 — 입력이 같아야 산식 차이만 보인다. */

export type BacktestStats = {
  sessions: number;
  avgDiscountPct: number;
  capHitPct: number;
  listPricePct: number;
  /** 같은 빵의 직전 장 대비 가격 변동(%) 중 가장 큰 것 */
  maxMovePct: number;
};

type InputRow = {
  productId: string;
  key: string; // publish_date|session — 시간순 정렬용 (am < pm)
  searchRatio: number;
  fxDeclinePct: number;
  basePriceWon: number;
  /** 마진 하한. 크론은 상품마다 min(정책 상한, 마진 상한)을 쓴다 (daily-job.ts marginCapPct). */
  margin: { list_margin_pct: number | null; min_margin_pct: number | null };
};

export async function loadBacktestInputs(days = 90): Promise<InputRow[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const db = supabaseAdmin();
  const { data: products, error: productError } = await db.from("products").select("id,list_margin_pct,min_margin_pct");
  if (productError) throw new Error(productError.message);
  const margins = new Map(
    (products ?? []).map((p) => [
      p.id,
      {
        list_margin_pct: p.list_margin_pct === null ? null : Number(p.list_margin_pct),
        min_margin_pct: p.min_margin_pct === null ? null : Number(p.min_margin_pct),
      },
    ]),
  );
  const { data, error } = await db
    .from("daily_prices")
    .select("product_id,publish_date,price_session,search_ratio,fx_decline_pct,base_price_won,created_at")
    .gte("publish_date", since)
    .neq("price_session", "list")
    .order("created_at")
    // 6종 × 2장 × 91일 = 1,092행. PostgREST 기본 1,000행에 잘리지 않게 넉넉히.
    .range(0, 4999);
  if (error) throw new Error(error.message);

  // 같은 장을 다른 버전으로 다시 계산한 행이 있으면 나중 것만 (created_at 순이라 덮어쓴다)
  const byKey = new Map<string, InputRow>();
  for (const r of data ?? []) {
    // 입력이 빈 행은 다시 계산할 수 없다. Number(null) 이 0 이 되어 할인 0 으로 섞이지 않게 뺀다.
    if (r.search_ratio === null || r.fx_decline_pct === null || !r.base_price_won) continue;
    const key = `${r.publish_date}|${r.price_session}`;
    byKey.set(`${r.product_id}|${key}`, {
      productId: r.product_id,
      key,
      searchRatio: Number(r.search_ratio),
      fxDeclinePct: Number(r.fx_decline_pct),
      basePriceWon: r.base_price_won,
      margin: margins.get(r.product_id) ?? { list_margin_pct: null, min_margin_pct: null },
    });
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function backtest(rows: InputRow[], pricing: PricingConfig): BacktestStats {
  let sum = 0;
  let capHit = 0;
  let listPrice = 0;
  let maxMove = 0;
  const last = new Map<string, number>();
  for (const r of rows) {
    const cap = marginCapPct(r.margin, pricing.discountCapPct);
    const day = calculateDay({
      searchRatio: r.searchRatio,
      fxDeclinePct: r.fxDeclinePct,
      basePriceWon: r.basePriceWon,
      pricing: { ...pricing, discountCapPct: cap },
    });
    sum += day.discountPct;
    if (day.discountPct >= cap - 1e-9) capHit += 1;
    if (day.discountPct <= 1e-9) listPrice += 1;
    const prev = last.get(r.productId);
    if (prev) maxMove = Math.max(maxMove, (Math.abs(day.priceWon - prev) / prev) * 100);
    last.set(r.productId, day.priceWon);
  }
  const n = rows.length || 1;
  return {
    sessions: rows.length,
    avgDiscountPct: sum / n,
    capHitPct: (capHit / n) * 100,
    listPricePct: (listPrice / n) * 100,
    maxMovePct: maxMove,
  };
}
