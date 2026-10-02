import { kstNow } from "@/lib/market/calendar";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isPublicAt } from "./reward-policy";

/* 화면이 쓰는 시세. daily_prices 를 그대로 내보낸다.
   클라이언트에서 다시 계산하지 않는다 — 화면 숫자와 Cafe24 에 보낸 값이
   갈라지면 안 된다.

   페이지가 렌더 전에 직접 부르고, /api/market 도 같은 걸 감싼다. 두 벌로
   두면 화면과 API 가 다른 시세를 말하게 된다. */

const HISTORY_DAYS = 91; // 차트가 그리는 구간

export type CatalogProduct = {
  id: string;
  ticker: string;
  name: string;
  basePriceWon: number;
  active: boolean;
  displayName: string | null;
  fullName: string | null;
  photoUrl: string | null;
};

export type MarketData = {
  source: "supabase";
  latestDate: string | null;
  days: number;
  /** 판매를 멈춘 빵도 담는다 — 그 빵의 잠금·쿠폰·기록을 보여줘야 해서. 시세(quotes)는 판매 중인 것만. */
  products: CatalogProduct[];
  quotes: {
    ticker: string;
    publishDate: string;
    session: "am" | "pm";
    searchRatio: number;
    searchDiscountPct: number;
    fxDeclinePct: number;
    fxDiscountPct: number;
    discountPct: number;
    basePriceWon: number;
    priceWon: number;
    fxCurrentDate: string;
  }[];
  indexSeries: { publishDate: string; session: "am" | "pm"; index: number; products: number }[];
};

export async function loadMarketData(): Promise<MarketData> {
  const db = supabaseAdmin();

  const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const [{ data: products, error: productError }, { data: prices, error: priceError }] = await Promise.all([
    db.from("products").select("id,ticker,name,base_price_won,active,display_name,full_name,photo_url").order("ticker"),
    db
      .from("daily_prices")
      .select(
        "product_id,publish_date,price_session,search_ratio,search_discount_pct,fx_decline_pct,fx_discount_pct,fx_current_date,discount_pct,base_price_won,price_won",
      )
      .gte("publish_date", since)
      .order("publish_date")
      // 같은 장의 다른 버전 행은 나중 것이 이기게 (hydrateQuotes 가 덮어쓴다)
      .order("created_at"),
  ]);

  const error = productError ?? priceError;
  if (error) throw new Error(error.message);

  const tickerById = new Map((products ?? []).filter((p) => p.active).map((p) => [p.id, p.ticker]));

  /* 공개 시각 전의 행은 내보내지 않는다. 화면은 시계로 세션을 골라 멀쩡해 보여도
     이 배열이 그대로 /api/market 과 첫 HTML 에 실려 나간다 (page-data.ts). */
  const now = kstNow();
  const quotes = (prices ?? [])
    .filter((row) => tickerById.has(row.product_id))
    .filter((row) => isPublicAt(row.publish_date, row.price_session as "am" | "pm", now))
    .map((row) => ({
      ticker: tickerById.get(row.product_id)!,
      publishDate: row.publish_date,
      session: row.price_session as "am" | "pm",
      searchRatio: Number(row.search_ratio),
      searchDiscountPct: Number(row.search_discount_pct),
      fxDeclinePct: Number(row.fx_decline_pct),
      fxDiscountPct: Number(row.fx_discount_pct),
      discountPct: Number(row.discount_pct),
      basePriceWon: row.base_price_won,
      priceWon: row.price_won,
      fxCurrentDate: row.fx_current_date,
    }));

  /* 막지지수를 서버에서 계산해 내려보낸다.
     화면에서 평균을 내면 어떤 상품이 빠졌는지에 따라 값이 달라지고, 그러면
     같은 날짜에 대해 서버와 화면이 다른 지수를 말하게 된다.
     지수 = 정가 대비 판매가 비율의 평균 × 100. 정가면 100, 10% 할인이면 90. */
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const q of quotes) {
    const key = `${q.publishDate}|${q.session}`;
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += q.priceWon / q.basePriceWon;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const indexSeries = [...buckets.entries()]
    .map(([key, { sum, count }]) => {
      const [publishDate, session] = key.split("|");
      return {
        publishDate,
        session: session as "am" | "pm",
        index: (sum / count) * 100,
        products: count,
      };
    })
    .sort((a, b) => (a.publishDate === b.publishDate ? (a.session < b.session ? -1 : 1) : a.publishDate < b.publishDate ? -1 : 1));

  return {
    source: "supabase",
    latestDate: quotes.at(-1)?.publishDate ?? null,
    days: new Set(quotes.map((q) => q.publishDate)).size,
    products: (products ?? []).map((p) => ({
      id: p.id,
      ticker: p.ticker,
      name: p.name,
      basePriceWon: p.base_price_won,
      active: p.active,
      displayName: p.display_name,
      fullName: p.full_name,
      photoUrl: p.photo_url,
    })),
    quotes,
    indexSeries,
  };
}
