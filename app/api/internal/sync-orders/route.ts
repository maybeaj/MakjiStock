import pricingConfig from "@/config/pricing-products.json";
import { syncOrders } from "@/lib/cafe24/order-sync";
import { kstToday } from "@/lib/pricing/dates.mjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/* Cafe24 주문 동기화 — KPI 자동 집계 (lib/cafe24/order-sync.ts)

   GET  /api/internal/sync-orders                       크론용(02:30, 장이 끝난 직후). 최근 3일
   POST /api/internal/sync-orders?from=2026-09-01&to=…  수동. 도입 전 기준 주문을 채울 때 쓴다
                                                         (Cafe24 는 한 번에 3개월까지)

   Cafe24 는 읽기만 한다. 우리 DB 에 주문을 덮어쓰고 쓰인 코드를 used 로 바꾼다.
   두 번 돌아도 결과가 같다. */

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
    return Response.json({ error: "from·to 는 YYYY-MM-DD 입니다." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const trigger = request.headers.get("x-vercel-cron-schedule") ?? "manual";
  const { data: jobRow } = await db
    .from("job_runs")
    .insert({
      job_kind: "sync_orders",
      target_date: kstToday(),
      status: "collecting",
      formula_version: (pricingConfig.pricing as { formulaVersion?: string }).formulaVersion ?? "v1.4",
    })
    .select("id")
    .single();
  const jobId = jobRow?.id as string | undefined;

  try {
    const result = await syncOrders({ from, to });
    if (jobId) {
      await db
        .from("job_runs")
        .update({
          status: result.codeErrors.length ? "partially_failed" : "completed",
          finished_at: new Date().toISOString(),
          step_log: { trigger, ...result },
        })
        .eq("id", jobId);
    }
    return Response.json({ trigger, ...result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (jobId) {
      await db
        .from("job_runs")
        .update({ status: "held", finished_at: new Date().toISOString(), error_code: "sync_orders", error_message: message })
        .eq("id", jobId);
    }
    return Response.json({ error: message, trigger }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
