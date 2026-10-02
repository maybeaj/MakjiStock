import { isPublicAt } from "@/lib/bread-market/reward-policy";
import { kstNow } from "@/lib/market/calendar";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 어드민 화면이 읽는 값. 서버에서만 부른다 (service_role). */

export type AdminProduct = {
  id: string;
  ticker: string;
  name: string;
  base_price_won: number;
  cafe24_product_no: number | null;
  keywords: string[];
  active: boolean;
};

export type AdminProductRow = AdminProduct & {
  /** 지금 공개된 오늘 가격. 아직 없으면 null. */
  todayPrice: { session: "am" | "pm"; priceWon: number; discountPct: number } | null;
};

const PRODUCT_COLUMNS = "id,ticker,name,base_price_won,cafe24_product_no,keywords,active";

export async function loadAdminProducts() {
  const db = supabaseAdmin();
  const now = kstNow();
  const [{ data: products, error }, { data: prices, error: priceError }, { data: jobs, error: jobError }] =
    await Promise.all([
      db.from("products").select(PRODUCT_COLUMNS).order("ticker"),
      db
        .from("daily_prices")
        .select("product_id,price_session,price_won,discount_pct,created_at")
        .eq("publish_date", now.date)
        .order("created_at"),
      db
        .from("job_runs")
        .select("status")
        .eq("target_date", now.date)
        .in("status", ["partially_failed", "held"]),
    ]);
  const fail = error ?? priceError ?? jobError;
  if (fail) throw new Error(fail.message);

  /* 같은 장을 다시 계산하면(산식 버전이 오르면) 행이 하나 더 생긴다. 나중 것이 이긴다.
     오후가는 16:00 전에 계산돼 있어도 아직 공개 전이라 건너뛴다. */
  const latest = new Map<string, AdminProductRow["todayPrice"]>();
  const amDone = new Set<string>();
  for (const p of prices ?? []) {
    const session = p.price_session as "am" | "pm" | "list";
    if (session === "list" || !isPublicAt(now.date, session, now)) continue;
    if (session === "am") amDone.add(p.product_id);
    const prev = latest.get(p.product_id);
    if (prev?.session === "pm" && session === "am") continue;
    latest.set(p.product_id, { session, priceWon: p.price_won, discountPct: Number(p.discount_pct) });
  }

  const rows: AdminProductRow[] = (products ?? []).map((p) => ({ ...p, todayPrice: latest.get(p.id) ?? null }));
  const active = rows.filter((r) => r.active);
  return {
    rows,
    summary: {
      activeCount: active.length,
      amApplied: active.filter((r) => amDone.has(r.id)).length,
      nextRun: nextPricingRun(now.hour),
      needsCheck: (jobs ?? []).length,
    },
  };
}

/* vercel.json 크론과 같은 시각이다 — 오후가 15:00(UTC 06:00), 오전가 05:30(UTC 20:30).
   hour 는 시장 시계라 00~01시는 24·25 로 들어온다. */
function nextPricingRun(hour: number) {
  if (hour >= 6 && hour < 15) return "15:00 오후가";
  return "05:30 오전가";
}

export async function loadAdminProduct(id: string): Promise<AdminProduct | null> {
  const { data, error } = await supabaseAdmin().from("products").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type AuditKind = "formula" | "coupon" | "product";
export type AuditRow = { id: string; at: string; kind: AuditKind; target: string; change: string; actor: string };

export async function loadAuditLog(kind?: AuditKind): Promise<AuditRow[]> {
  let q = supabaseAdmin().from("admin_audit_log").select("id,at,kind,target,change,actor").order("at", { ascending: false }).limit(200);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditRow[];
}

export type PriceStats = {
  sessions: number;
  avgDiscountPct: number;
  capHitPct: number;
  listPricePct: number;
  maxMovePct: number;
};

/* 지난 90일 실제 발행가. 초안 산식으로 다시 계산하는 백테스트는 산식이 DB 로 옮겨진 뒤(2차)다.
   그때까지는 실제로 나간 가격만 요약한다. 같은 장에 버전이 둘이면 나중 것만 센다. */
export async function loadPriceStats(capPct: number): Promise<PriceStats> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin()
    .from("daily_prices")
    .select("product_id,publish_date,price_session,discount_pct,price_change_pct,created_at")
    .gte("publish_date", since)
    .neq("price_session", "list")
    .order("created_at")
    // 6종 × 2장 × 91일 = 1,092행. PostgREST 기본 1,000행에 잘리지 않게 넉넉히.
    .range(0, 4999);
  if (error) throw new Error(error.message);

  const bySession = new Map<string, { discount: number; move: number }>();
  for (const r of data ?? []) {
    bySession.set(`${r.product_id}|${r.publish_date}|${r.price_session}`, {
      discount: Number(r.discount_pct),
      move: Math.abs(Number(r.price_change_pct ?? 0)),
    });
  }
  const rows = [...bySession.values()];
  const n = rows.length || 1;
  return {
    sessions: rows.length,
    avgDiscountPct: rows.reduce((s, r) => s + r.discount, 0) / n,
    capHitPct: (rows.filter((r) => r.discount >= capPct - 1e-6).length / n) * 100,
    listPricePct: (rows.filter((r) => r.discount <= 1e-6).length / n) * 100,
    maxMovePct: rows.reduce((m, r) => Math.max(m, r.move), 0),
  };
}
