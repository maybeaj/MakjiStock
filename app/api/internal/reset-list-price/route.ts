import { cafe24Request, cafe24ShopNo } from "@/lib/cafe24/client";
import { kstToday } from "@/lib/pricing/dates.mjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/* 정가 리셋 — PRD §4.4 · §11.1
   02:00 에 몰 판매가를 정가로 되돌린다. 02:00~05:59 는 정가 구간이다.
   오후장은 16:00 ~ 다음 날 01:59 다.

   GET  /api/internal/reset-list-price          크론용. 실제 반영
   POST /api/internal/reset-list-price          수동. 드라이런이 기본, ?commit=1 로 반영

   잠금은 오전장에만 받고 차액 코드는 16:00 오후가 크론에서 발급한다.
   여기서는 잠금 코드를 만들지 않는다.

   두 번 돌아도 결과가 같다. 크론은 같은 실행을 중복 호출할 수 있다. */

type ProductRow = {
  id: string;
  ticker: string;
  name: string;
  base_price_won: number;
  cafe24_product_no: number | null;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

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

  const commitParam = new URL(request.url).searchParams.get("commit");
  const commit = commitParam === null ? defaultCommit : commitParam === "1";
  const trigger = request.headers.get("x-vercel-cron-schedule") ?? "manual";
  const targetDate = kstToday();
  const db = supabaseAdmin();

  const { data: jobRow } = await db
    .from("job_runs")
    .insert({
      job_kind: "reset_list_price",
      target_date: targetDate,
      price_session: "list",
      status: "applying_cafe24",
      formula_version: "v0.7",
    })
    .select("id")
    .single();
  const jobId = jobRow?.id as string | undefined;

  try {
    const { data, error } = await db
      .from("products")
      .select("id,ticker,name,base_price_won,cafe24_product_no")
      .eq("active", true)
      .order("ticker");
    if (error) throw new Error(error.message);
    const products = (data ?? []) as ProductRow[];

    const shopNo = cafe24ShopNo();
    const applied: Record<string, string>[] = [];

    for (const product of products) {
      if (!product.cafe24_product_no) {
        applied.push({ ticker: product.ticker, result: "skipped", reason: "cafe24_product_no 없음" });
        continue;
      }
      if (!commit) {
        applied.push({
          ticker: product.ticker,
          productNo: String(product.cafe24_product_no),
          listPriceWon: String(product.base_price_won),
          result: "dry-run",
        });
        continue;
      }
      try {
        // Cafe24 는 POST·PUT 에 쿼리스트링을 받지 않는다. shop_no 는 body 로만 보낸다.
        await cafe24Request(`/api/v2/admin/products/${product.cafe24_product_no}`, {
          method: "PUT",
          body: JSON.stringify({
            shop_no: shopNo,
            request: { price: String(product.base_price_won) },
          }),
        });
        applied.push({
          ticker: product.ticker,
          productNo: String(product.cafe24_product_no),
          listPriceWon: String(product.base_price_won),
          result: "applied",
        });
      } catch (cause) {
        applied.push({
          ticker: product.ticker,
          productNo: String(product.cafe24_product_no),
          result: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    const someFailed = applied.some((a) => a.result === "failed");
    if (jobId) {
      await db
        .from("job_runs")
        .update({
          // 실패분만 남기고 성공분은 되돌리지 않는다 (PRD §11.4)
          status: !commit ? "calculated" : someFailed ? "partially_failed" : "completed",
          finished_at: new Date().toISOString(),
          step_log: { trigger, applied },
        })
        .eq("id", jobId);
    }

    return Response.json({
      mode: commit ? "committed" : "dry-run",
      trigger,
      targetDate,
      note: "02:00~05:59 정가 구간.",
      products: applied,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (jobId) {
      await db
        .from("job_runs")
        .update({
          status: "held",
          finished_at: new Date().toISOString(),
          error_code: "reset_list_price",
          error_message: message,
        })
        .eq("id", jobId);
    }
    return Response.json({ error: message, trigger, targetDate }, { status: 502 });
  }
}
