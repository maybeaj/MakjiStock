import pricingConfig from "@/config/pricing-products.json";
import { cafe24Request, cafe24ShopNo } from "@/lib/cafe24/client";
import { codeExpiry } from "@/lib/bread-market/reward-policy";
import { issueLockCodes, type IssueResult } from "@/lib/locks/lock-codes";
import { resolvePredictions, type ResolveResult } from "@/lib/predictions/resolve";
import { addDays, kstToday } from "@/lib/pricing/dates.mjs";
import { fetchUsdKrwOpenCloseRates } from "@/lib/pricing/fx.mjs";
import { fetchTrendsSeparately } from "@/lib/pricing/naver.mjs";
import {
  buildSessionFxSignals,
  calculateDay,
  resolveSearchRatio,
  type PricingConfig,
} from "@/lib/pricing/pricing.mjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/* 일일 가격 산정 — PRD §11
   POST /api/internal/daily-pricing?session=am|pm&date=YYYY-MM-DD&commit=1

   백테스트(backtest/run.mjs)와 lib/pricing/ 의 같은 코드를 쓴다. 검증한 숫자와
   운영에서 나오는 숫자가 갈라지지 않게 하려는 것이다.

   commit 없이는 계산과 저장까지만 하고 Cafe24 는 건드리지 않는다. */

const SEARCH_WINDOW_DAYS = 90; // 백테스트와 같은 정규화 구간 (PRD §10.2)

/* 주말에도 가격을 만든다. 검색지수는 매일 새로 반영하고, 환율은 외환시장이
   쉬어 금요일 종가 기준 하락률을 이월한다(buildSessionFxSignals 의 carriedForward).
   가격은 매번 정가에서 새로 계산하므로 이월해도 환율 효과가 누적되지 않는다.
   주말 오후장은 당일 시가가 없어 오전가를 유지한다. */
const FX_LOOKBACK_DAYS = 12; // 연휴를 건너뛰고 직전 두 영업일을 찾기 위한 여유

type ProductRow = {
  id: string;
  ticker: string;
  name: string;
  base_price_won: number;
  cafe24_product_no: number | null;
  keywords: string[];
  list_margin_pct: number | null;
  min_margin_pct: number | null;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

function kstHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
}

/* 어느 장의 가격을 만들지 정한다.
   1) ?session= 이 있으면 그대로
   2) Vercel 크론이면 x-vercel-cron-schedule 헤더로 판별한다.
      Hobby 는 지정 시각이 아니라 그 시간대 안 아무 때나 실행하므로
      (05:55 로 걸어도 05:00~05:59 사이) 현재 시각으로는 구분할 수 없다.
   3) 그 외에는 KST 시각으로 추정한다 */
function resolveSession(request: Request, param: string | null): "am" | "pm" {
  if (param === "am" || param === "pm") return param;

  const schedule = request.headers.get("x-vercel-cron-schedule");
  if (schedule) {
    // UTC 시(hour) 필드. 20시대=05시대 KST(오전장 준비), 6시대=15시대 KST(오후장 준비)
    const utcHour = Number(schedule.trim().split(/\s+/)[1]);
    if (Number.isFinite(utcHour)) return utcHour === 6 ? "pm" : "am";
  }

  const hour = kstHour();
  return hour >= 15 && hour < 24 ? "pm" : "am";
}

/* 마진이 허용하는 최대 할인율.
   Dmargin = (정가마진 - 최소마진) / (1 - 최소마진)
   뺄셈이 아니다. docs/가격정책-마진연동-계산안.md §4 */
function marginCapPct(product: ProductRow, policyCap: number): number {
  const m0 = product.list_margin_pct;
  const mMin = product.min_margin_pct;
  if (m0 === null || mMin === null) return policyCap;
  const d = ((m0 - mMin) / (100 - mMin)) * 100;
  return Math.min(policyCap, d);
}

/* Vercel 크론은 GET 으로 호출하고 CRON_SECRET 을 Authorization 헤더로 보낸다.
   크론 호출은 반영까지 하는 것이 목적이므로 commit 을 기본값으로 둔다. */
export async function GET(request: Request) {
  return run(request, { defaultCommit: true });
}

export async function POST(request: Request) {
  return run(request, { defaultCommit: false });
}

async function run(request: Request, { defaultCommit }: { defaultCommit: boolean }) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const publishDate: string = url.searchParams.get("date") ?? kstToday();
  const session = resolveSession(request, url.searchParams.get("session"));
  const commitParam = url.searchParams.get("commit");
  const commit = commitParam === null ? defaultCommit : commitParam === "1";

  const { formulaVersion = "v0.7", ...pricing } = pricingConfig.pricing as PricingConfig & {
    formulaVersion?: string;
  };
  const db = supabaseAdmin();
  const startedAt = new Date().toISOString();

  const { data: jobRow } = await db
    .from("job_runs")
    .insert({
      job_kind: "daily_pricing",
      target_date: publishDate,
      price_session: session,
      status: "collecting",
      formula_version: formulaVersion,
    })
    .select("id")
    .single();
  const jobId = jobRow?.id as string | undefined;

  const fail = async (stage: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (jobId) {
      await db
        .from("job_runs")
        .update({ status: "held", finished_at: new Date().toISOString(), error_code: stage, error_message: message })
        .eq("id", jobId);
    }
    return Response.json({ error: message, stage, publishDate, session }, { status: 502 });
  };

  try {
    // ── 상품 ────────────────────────────────────────────────
    const { data: products, error: productError } = await db
      .from("products")
      .select("id,ticker,name,base_price_won,cafe24_product_no,keywords,list_margin_pct,min_margin_pct")
      .eq("active", true)
      .order("ticker");
    if (productError) throw new Error(productError.message);
    const rows = (products ?? []) as ProductRow[];
    if (rows.length === 0) throw new Error("활성 상품이 없습니다.");

    // ── 수집 ────────────────────────────────────────────────
    const signalDate: string = addDays(publishDate, -1);
    const searchStart: string = addDays(signalDate, -(SEARCH_WINDOW_DAYS - 1));

    const trends = await fetchTrendsSeparately({
      products: rows.map((r) => ({ id: r.id, ticker: r.ticker, keywords: r.keywords })),
      startDate: searchStart,
      endDate: signalDate,
      log: () => {},
    });

    const fx = await fetchUsdKrwOpenCloseRates({
      startDate: addDays(publishDate, -FX_LOOKBACK_DAYS),
      endDate: publishDate,
      log: () => {},
    });

    const signals = buildSessionFxSignals({
      closesByDate: fx.closesByDate,
      opensByDate: fx.opensByDate,
      publishDates: [publishDate],
    });
    const fxSignal = session === "am" ? signals[publishDate]?.morning : signals[publishDate]?.afternoon;

    if (!fxSignal) {
      // 주말·공휴일 오후에는 당일 시가가 없다. 오전 확정가를 유지한다 (PRD §9.3).
      if (jobId) {
        await db
          .from("job_runs")
          .update({ status: "held", finished_at: new Date().toISOString(), error_code: "fx_unavailable" })
          .eq("id", jobId);
      }
      return Response.json({
        mode: "held",
        trigger: request.headers.get("x-vercel-cron-schedule") ?? "manual",
        reason:
          session === "pm"
            ? "당일 시가가 없습니다(비영업일). 오전 확정가를 유지합니다."
            : "직전 두 영업일 종가를 찾지 못했습니다.",
        publishDate,
        session,
      });
    }

    // D-1 검색지수가 없거나 0 이면 직전 관측치를 이월한다 (lib/pricing/pricing.mjs).
    const searchRatioOf = (productId: string) =>
      resolveSearchRatio(trends.seriesByProduct[productId] ?? {}, signalDate);

    // ── 계산 ────────────────────────────────────────────────
    const results = rows.map((product) => {
      const search = searchRatioOf(product.id);
      if (!search) {
        // 90일 창 전체에 관측치가 없다. 이월할 값조차 없어 보류한다.
        return { product, status: "held" as const, reason: "검색지수 관측 이력 없음" };
      }
      const cap = marginCapPct(product, pricing.discountCapPct);
      const calc = calculateDay({
        searchRatio: search.ratio,
        fxDeclinePct: fxSignal.declinePct,
        basePriceWon: product.base_price_won,
        pricing: { ...pricing, discountCapPct: cap },
      });
      return { product, status: "calculated" as const, calc, search };
    });

    // ── 저장 ────────────────────────────────────────────────
    await db.from("fx_rates").upsert(
      [
        { rate_date: fxSignal.previousDate, item_code: "0000003", rate_type: "close", usd_krw: fxSignal.previousRate },
        {
          rate_date: fxSignal.currentDate,
          item_code: session === "am" ? "0000003" : "0000002",
          rate_type: session === "am" ? "close" : "open",
          usd_krw: fxSignal.currentRate,
        },
      ],
      { onConflict: "rate_date,item_code" },
    );

    await db.from("trend_snapshots").upsert(
      results
        .filter((r) => r.status === "calculated")
        .map(({ product: p, search }) => ({
          product_id: p.id,
          signal_date: search!.sourceDate,
          ratio: search!.ratio,
          request_start_date: searchStart,
          request_end_date: signalDate,
          keyword_group_version: formulaVersion,
          provider: process.env.NAVER_PROVIDER || "hub",
        })),
      { onConflict: "product_id,signal_date,request_start_date,request_end_date,keyword_group_version" },
    );

    const calculated = results.filter((r) => r.status === "calculated");
    const { data: previous } = await db
      .from("daily_prices")
      .select("product_id,price_won,publish_date,price_session")
      .lt("publish_date", publishDate)
      .order("publish_date", { ascending: false })
      .limit(rows.length * 2);
    const prevByProduct = new Map<string, number>();
    for (const row of previous ?? []) {
      if (!prevByProduct.has(row.product_id)) prevByProduct.set(row.product_id, row.price_won);
    }

    const priceRows = calculated.map(({ product, calc, search }) => {
      const prev = prevByProduct.get(product.id) ?? null;
      return {
        product_id: product.id,
        publish_date: publishDate,
        price_session: session,
        // 이월된 경우 실제로 쓴 날짜가 들어간다. D-1 이 아니면 이월이다.
        signal_date: search!.sourceDate,
        formula_version: formulaVersion,
        search_ratio: search!.ratio,
        search_discount_pct: calc!.searchCouponPct,
        fx_previous_date: fxSignal.previousDate,
        fx_current_date: fxSignal.currentDate,
        fx_previous_rate: fxSignal.previousRate,
        fx_current_rate: fxSignal.currentRate,
        fx_decline_pct: fxSignal.declinePct,
        fx_discount_pct: calc!.fxAdjustmentPct,
        discount_pct: calc!.discountPct,
        base_price_won: product.base_price_won,
        price_won: calc!.priceWon,
        previous_price_won: prev,
        price_change_pct: prev ? (calc!.priceWon / prev - 1) * 100 : null,
        status: "calculated",
        cafe24_apply_status: "pending",
      };
    });

    const { error: priceError } = await db
      .from("daily_prices")
      .upsert(priceRows, { onConflict: "product_id,publish_date,price_session,formula_version" });
    if (priceError) throw new Error(`daily_prices 저장 실패: ${priceError.message}`);

    // ── Cafe24 반영 ─────────────────────────────────────────
    const shopNo = cafe24ShopNo();
    const applied: Record<string, string>[] = [];

    if (commit) {
      for (const { product, calc } of calculated) {
        if (!product.cafe24_product_no) {
          applied.push({ ticker: product.ticker, result: "skipped", reason: "cafe24_product_no 없음" });
          continue;
        }
        /* Cafe24 는 POST·PUT 에 쿼리스트링을 허용하지 않는다.
           400 "Query String is not available for POST, PUT Method."
           shop_no 는 body 로만 보낸다. */
        const path = `/api/v2/admin/products/${product.cafe24_product_no}`;
        try {
          /* 계산된 가격을 항상 PUT 한다. GET 으로 현재가를 먼저 보던 방식은
             호출이 2번이고, 같은 값이면 PUT 이 어차피 무해하다.
             대신 Cafe24 쪽 변경 전 가격은 남지 않는다. 우리 직전 가격은
             daily_prices.previous_price_won 에 이미 있다. */
          await cafe24Request(path, {
            method: "PUT",
            body: JSON.stringify({ shop_no: shopNo, request: { price: String(calc!.priceWon) } }),
          });
          await db
            .from("daily_prices")
            .update({ cafe24_apply_status: "applied", applied_at: new Date().toISOString() })
            .eq("product_id", product.id)
            .eq("publish_date", publishDate)
            .eq("price_session", session)
            .eq("formula_version", formulaVersion);
          applied.push({
            ticker: product.ticker,
            productNo: String(product.cafe24_product_no),
            previousWon: String(prevByProduct.get(product.id) ?? "-"),
            appliedWon: String(calc!.priceWon),
            result: "applied",
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          await db
            .from("daily_prices")
            .update({ cafe24_apply_status: "failed" })
            .eq("product_id", product.id)
            .eq("publish_date", publishDate)
            .eq("price_session", session)
            .eq("formula_version", formulaVersion);
          applied.push({ ticker: product.ticker, result: "failed", reason: message });
        }
      }
    }

    const priceByProduct = new Map(calculated.map(({ product, calc }) => [product.id, calc!.priceWon]));

    /* 오후가가 확정되면 오전 잠금자의 보호가 16:00 에 시작된다.
       잠금가와 오후가의 차액을 할인코드로 발급한다 (PRD §4.4). */
    let lockCodes: IssueResult[] = [];
    if (session === "pm") {
      lockCodes = await issueLockCodes({
        lockSession: "am",
        lockDate: publishDate,
        priceOf: (productId) => priceByProduct.get(productId) ?? null,
        commit,
      });
    }

    /* 가격이 확정되는 순간이 예측 판정 시점이다 (PRD §13.3).
       예측은 모두 다음 날 06:00 오전가로 판정한다 — 오전가 확정 때 전날 제출분을 판정.
       쿠폰은 다음 날 새벽 01:59(오후장 끝)까지 쓸 수 있다. */
    const expiry = codeExpiry();
    const expiryDate = addDays(publishDate, expiry.dayOffset);
    const predictions: ResolveResult[] = await resolvePredictions({
      targetDate: publishDate,
      targetSession: session,
      priceOf: (productId) => priceByProduct.get(productId) ?? null,
      validUntil: `${expiryDate}T${expiry.time}:59+09:00`,
      commit,
    });

    const someFailed = applied.some((a) => a.result === "failed");
    if (jobId) {
      await db
        .from("job_runs")
        .update({
          status: commit ? (someFailed ? "partially_failed" : "completed") : "calculated",
          finished_at: new Date().toISOString(),
          step_log: { startedAt, collected: rows.length, calculated: calculated.length, applied, lockCodes, predictions },
        })
        .eq("id", jobId);
    }

    return Response.json({
      mode: commit ? "committed" : "dry-run",
      trigger: request.headers.get("x-vercel-cron-schedule") ?? "manual",
      publishDate,
      session,
      formulaVersion,
      fx: {
        reference: fxSignal.reference,
        previous: `${fxSignal.previousDate} ${fxSignal.previousRate}`,
        current: `${fxSignal.currentDate} ${fxSignal.currentRate}`,
        declinePct: Number(fxSignal.declinePct.toFixed(4)),
      },
      makjiIndex:
        calculated.length > 0
          ? Number((calculated.reduce((sum, r) => sum + r.calc!.discountPct, 0) / calculated.length).toFixed(2))
          : null,
      products: results.map((r) =>
        r.status === "calculated"
          ? {
              ticker: r.product.ticker,
              name: r.product.name,
              basePriceWon: r.product.base_price_won,
              searchRatio: Number(r.search!.ratio.toFixed(2)),
              ...(r.search!.carried
                ? { searchCarriedFrom: r.search!.sourceDate }
                : {}),
              discountPct: Number(r.calc!.discountPct.toFixed(2)),
              priceWon: r.calc!.priceWon,
            }
          : { ticker: r.product.ticker, name: r.product.name, status: "held", reason: r.reason },
      ),
      cafe24: commit ? applied : "드라이런 — Cafe24 를 호출하지 않았습니다. ?commit=1 로 반영합니다.",
      lockCodes: session === "pm" ? lockCodes : "오전장에는 발급하지 않습니다 (16:00 보호 시작 시점에 발급)",
      predictions,
    });
  } catch (cause) {
    return fail("pipeline", cause);
  }
}
