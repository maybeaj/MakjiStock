import { createHash } from "node:crypto";
import { decryptSecret } from "@/lib/crypto";
import { cafe24Request, parseCafe24Time } from "@/lib/cafe24/client";
import { CAFE24_CALL_GAP_MS } from "@/lib/rewards/discount-code";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* Cafe24 주문 동기화 — KPI 자동 집계용 (supabase/migrations/008_cafe24_orders.sql)

   두 가지를 한다.
   1) 최근 주문을 cafe24_orders · cafe24_order_items 에 쌓는다.
      하루 주문·오전 결제·판매 증분의 재료다.
   2) 우리가 발급한 할인코드마다 "이 코드로 된 주문이 있나"를 묻는다
      (GET /orders?discount_method=discount_code&discount_code=…). 있으면 reward_claims 를 used 로 바꾸고
      그 주문을 잇는다. 코드 귀속 주문·코드 사용률·잠금 후 구매의 재료다.
      응답 안에서 쓰인 코드가 어느 칸에 오는지 몰라도 되는 방식이다.

   이름·연락처·주소는 읽지도 저장하지도 않는다. 주문번호는 해시로만 남긴다. */

const PAGE = 500;
const DAY = 86_400_000;

type Json = Record<string, unknown>;

export type OrderRow = {
  order_hash: string;
  mall_id: string;
  ordered_at: string | null;
  paid_at: string | null;
  paid: boolean;
  canceled: boolean;
  total_won: number | null;
  items: { line_no: number; product_no: number | null; quantity: number; price_won: number | null }[];
};

export function orderHash(mallId: string, orderId: string) {
  return createHash("sha256").update(`${mallId}:${orderId}`).digest("hex");
}

const flag = (v: unknown) => v === true || v === "T";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const time = (v: unknown) => (typeof v === "string" && v ? parseCafe24Time(v).toISOString() : null);

/* Cafe24 주문 한 건을 우리 행으로 옮긴다. 응답 칸 이름은 이 함수만 안다.
   ponytail: 칸 이름은 Cafe24 주문 API 의 알려진 모양(order_id · order_date ·
   payment_date · paid · canceled · actual_order_amount.payment_amount ·
   items[].product_no/quantity/product_price)으로 썼다. 테스트몰에 주문이 없어
   실제 응답으로는 아직 확인하지 못했다. 첫 주문이 들어오면 raw 를 보고 여기만 고친다. */
export function readOrder(mallId: string, o: Json): OrderRow | null {
  const orderId = typeof o.order_id === "string" ? o.order_id : null;
  if (!orderId) return null;
  const amount = (o.actual_order_amount ?? o.initial_order_amount) as Json | undefined;
  const items = Array.isArray(o.items) ? (o.items as Json[]) : [];
  return {
    order_hash: orderHash(mallId, orderId),
    mall_id: mallId,
    ordered_at: time(o.order_date),
    paid_at: time(o.payment_date),
    paid: flag(o.paid),
    canceled: flag(o.canceled),
    total_won: num(amount?.payment_amount ?? o.payment_amount),
    items: items.map((it, i) => ({
      line_no: i + 1,
      product_no: num(it.product_no),
      quantity: num(it.quantity) ?? 1,
      price_won: num(it.product_price ?? it.price),
    })),
  };
}

const ymd = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10); // KST 날짜
const pause = () => new Promise((r) => setTimeout(r, CAFE24_CALL_GAP_MS));

async function fetchOrders(params: Record<string, string>) {
  const out: Json[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ ...params, limit: String(PAGE), offset: String(offset), embed: "items" });
    const res = await cafe24Request<{ orders?: Json[] }>(`/api/v2/admin/orders?${q}`);
    const page = res.orders ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
    await pause();
  }
}

async function saveOrders(rows: OrderRow[], productIdByNo: Map<number, string>) {
  if (rows.length === 0) return;
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await db.from("cafe24_orders").upsert(
    rows.map((o) => ({
      order_hash: o.order_hash,
      mall_id: o.mall_id,
      ordered_at: o.ordered_at,
      paid_at: o.paid_at,
      paid: o.paid,
      canceled: o.canceled,
      total_won: o.total_won,
      synced_at: now,
    })),
    { onConflict: "order_hash" },
  );
  if (error) throw new Error(`주문 저장 실패: ${error.message}`);
  const items = rows.flatMap((o) =>
    o.items.map((it) => ({
      order_hash: o.order_hash,
      ...it,
      product_id: it.product_no ? (productIdByNo.get(it.product_no) ?? null) : null,
    })),
  );
  if (items.length) {
    const { error: itemError } = await db.from("cafe24_order_items").upsert(items, { onConflict: "order_hash,line_no" });
    if (itemError) throw new Error(`주문 상품 저장 실패: ${itemError.message}`);
  }
}

export type SyncResult = {
  mallId: string;
  range: { from: string; to: string };
  orders: number;
  codesChecked: number;
  codesUsed: number;
  codeErrors: string[];
};

/** from·to 는 KST 날짜(YYYY-MM-DD). 기본은 최근 3일 — 늦게 결제·취소된 주문도 다시 덮어쓴다. */
export async function syncOrders({ from, to }: { from?: string; to?: string } = {}): Promise<SyncResult> {
  const mallId = process.env.CAFE24_MALL_ID;
  if (!mallId) throw new Error("CAFE24_MALL_ID 가 필요합니다.");
  const db = supabaseAdmin();
  const now = Date.now();
  const range = { from: from ?? ymd(now - 3 * DAY), to: to ?? ymd(now) };

  const { data: products, error: productError } = await db.from("products").select("id,cafe24_product_no");
  if (productError) throw new Error(productError.message);
  const productIdByNo = new Map(
    (products ?? []).filter((p) => p.cafe24_product_no).map((p) => [Number(p.cafe24_product_no), p.id as string]),
  );

  // 1) 기간 안의 주문
  const raw = await fetchOrders({ start_date: range.from, end_date: range.to, date_type: "order_date" });
  const rows = raw.map((o) => readOrder(mallId, o)).filter((o): o is OrderRow => o !== null);
  await saveOrders(rows, productIdByNo);

  // 2) 아직 안 쓰인 우리 코드 — 유효 기간이 최근 14일 안에 걸친 것만 묻는다
  const { data: claims, error: claimError } = await db
    .from("reward_claims")
    .select("id,discount_code_ciphertext,valid_from,valid_until,created_at")
    .eq("status", "issued")
    .not("discount_code_ciphertext", "is", null)
    .not("cafe24_discount_code_no", "is", null)
    .gte("created_at", new Date(now - 14 * DAY).toISOString());
  if (claimError) throw new Error(claimError.message);

  let codesUsed = 0;
  const codeErrors: string[] = [];
  for (const claim of claims ?? []) {
    await pause();
    try {
      const code = decryptSecret(claim.discount_code_ciphertext as string);
      const start = ymd(new Date((claim.valid_from as string) ?? (claim.created_at as string)).getTime());
      const end = ymd(Math.min(now, new Date((claim.valid_until as string) ?? now).getTime() + DAY));
      const found = (
        // discount_method 없이 discount_code 만 보내면 422 다(2026-09-29 실호출로 확인).
        await fetchOrders({ start_date: start, end_date: end, discount_method: "discount_code", discount_code: code })
      )
        .map((o) => readOrder(mallId, o))
        .filter((o): o is OrderRow => o !== null && !o.canceled);
      if (found.length === 0) continue;
      await saveOrders(found, productIdByNo);
      const first = found.sort((a, b) => (a.ordered_at ?? "").localeCompare(b.ordered_at ?? ""))[0];
      const { error } = await db
        .from("reward_claims")
        .update({ status: "used", used_at: first.paid_at ?? first.ordered_at, used_order_hash: first.order_hash })
        .eq("id", claim.id)
        .eq("status", "issued");
      if (error) throw new Error(error.message);
      codesUsed += 1;
    } catch (cause) {
      codeErrors.push(`${claim.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  return { mallId, range, orders: rows.length, codesChecked: claims?.length ?? 0, codesUsed, codeErrors };
}
