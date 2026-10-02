"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthorization } from "@/lib/admin/auth";
import { loadAdminProduct } from "@/lib/admin/data";
import { photoProblem, removeBreadPhoto, uploadBreadPhoto } from "@/lib/admin/photos";
import { cafe24Request, cafe24ShopNo } from "@/lib/cafe24/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_KEYWORDS = 20; // 네이버 데이터랩 한 그룹 한도 (lib/pricing/naver.mjs)
const won = (n: number) => n.toLocaleString("ko-KR");

async function assertAdmin() {
  if (!isAdminAuthorization((await headers()).get("authorization"))) throw new Error("관리자 비밀번호가 필요합니다.");
}

type Fields = {
  displayName: string;
  fullName: string;
  base: number;
  cafe24No: number | null;
  keywords: string[];
  active: boolean;
  photo: File | null;
  shopUrl: string | null;
};

/* 추가와 수정이 같은 규칙을 쓴다. 문제가 있으면 문구를, 없으면 값을 돌려준다. */
function parseFields(formData: FormData): Fields | string {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!displayName || displayName.length > 30) return "화면 이름은 1~30자예요.";
  if (!fullName || fullName.length > 80) return "상세 이름은 1~80자예요.";

  const base = Number(String(formData.get("base_price_won") ?? "").replace(/[,\s원]/g, ""));
  if (!Number.isInteger(base) || base <= 0 || base % 10 !== 0) return "정가는 10원 단위의 양수여야 해요.";

  const noText = String(formData.get("cafe24_product_no") ?? "").trim();
  const cafe24No = noText === "" ? null : Number(noText);
  if (cafe24No !== null && (!Number.isInteger(cafe24No) || cafe24No <= 0)) return "Cafe24 상품번호는 양의 정수예요.";

  const keywords = [
    ...new Set(
      String(formData.get("keywords") ?? "")
        .split(/[\n,]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  if (keywords.length === 0) return "검색어가 하나는 있어야 검색 할인을 계산할 수 있어요.";
  if (keywords.length > MAX_KEYWORDS) return `검색어는 최대 ${MAX_KEYWORDS}개예요. 지금 ${keywords.length}개.`;

  /* 손님이 실제로 사는 자사몰 주소 (SHOP_TARGET=live 일 때 구매 버튼이 간다). 비면 자사몰 첫 화면. */
  const shopText = String(formData.get("shop_url") ?? "").trim();
  let shopUrl: string | null = null;
  if (shopText) {
    try {
      const u = new URL(shopText);
      if (u.protocol !== "https:" || !/(^|\.)makji\.kr$/.test(u.hostname)) return "자사몰 주소는 https://makji.kr/... 이어야 해요.";
      shopUrl = u.toString();
    } catch {
      return "자사몰 주소 형식이 맞지 않아요.";
    }
  }

  const raw = formData.get("photo");
  const photo = raw instanceof File && raw.size > 0 ? raw : null;
  if (photo) {
    const problem = photoProblem(photo);
    if (problem) return problem;
  }
  return { displayName, fullName, base, cafe24No, keywords, active: formData.get("active") === "on", photo, shopUrl };
}

function backTo(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

export async function createProduct(formData: FormData) {
  await assertAdmin();
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(ticker)) backTo("/admin/products/new", "티커는 영문 3자예요.");
  const f = parseFields(formData);
  if (typeof f === "string") backTo("/admin/products/new", f);
  if (!f.photo) backTo("/admin/products/new", "사진을 올려 주세요. 목록과 상세에 그대로 쓰여요.");

  const db = supabaseAdmin();
  const { data: dup, error: dupError } = await db
    .from("products")
    .select("id")
    .or(`ticker.eq.${ticker},id.eq.${ticker.toLowerCase()}`)
    .limit(1);
  if (dupError) backTo("/admin/products/new", `확인하지 못했어요: ${dupError.message}`);
  if (dup?.length) backTo("/admin/products/new", `${ticker} 는 이미 있는 티커예요.`);

  let photo: { url: string; path: string };
  try {
    photo = await uploadBreadPhoto(f.photo, ticker);
  } catch (e) {
    backTo("/admin/products/new", e instanceof Error ? e.message : String(e));
  }
  const photoUrl = photo.url;

  /* 판매 중으로 넣어도 첫 가격 계산 전까지는 시세에 안 나온다 (engine.ts hydrateProducts). */
  const { error } = await db.from("products").insert({
    id: ticker.toLowerCase(),
    ticker,
    name: f.fullName, // 몰 상품명 — sync-products 가 이 이름으로 Cafe24 상품을 찾는다
    display_name: f.displayName,
    full_name: f.fullName,
    photo_url: photoUrl,
    base_price_won: f.base,
    cafe24_product_no: f.cafe24No,
    keywords: f.keywords,
    active: f.active,
    shop_url: f.shopUrl,
  });
  if (error) {
    await removeBreadPhoto(photo.path); // 올린 사진이 주인 없이 남지 않게
    backTo("/admin/products/new", `저장하지 못했어요: ${error.message}`);
  }

  const { error: auditError } = await db.from("admin_audit_log").insert({
    kind: "product",
    target: `${ticker} ${f.displayName}`,
    change: `빵 추가 · 정가 ${won(f.base)}원 · 검색어 ${f.keywords.length}개 · Cafe24 #${f.cafe24No ?? "없음"} · ${f.active ? "판매 중" : "멈춤"}`,
  });
  revalidatePath("/admin", "layout");
  if (auditError) backTo("/admin/products", `${ticker} 는 추가됐지만 변경 기록을 남기지 못했어요: ${auditError.message}`);
  redirect(`/admin/products?saved=${encodeURIComponent(ticker)}`);
}

export async function saveProduct(id: string, formData: FormData) {
  await assertAdmin();
  const editPath = `/admin/products/${encodeURIComponent(id)}`;
  const before = await loadAdminProduct(id);
  if (!before) backTo(editPath, "상품을 찾을 수 없어요.");
  const f = parseFields(formData);
  if (typeof f === "string") backTo(editPath, f);

  const changes: string[] = [];
  if (f.displayName !== (before.display_name ?? "")) changes.push(`화면 이름 ${before.display_name ?? "없음"} → ${f.displayName}`);
  if (f.fullName !== (before.full_name ?? "")) changes.push(`상세 이름 → ${f.fullName}`);
  if (f.base !== before.base_price_won) changes.push(`정가 ${won(before.base_price_won)}원 → ${won(f.base)}원`);
  if (f.cafe24No !== before.cafe24_product_no) changes.push(`Cafe24 #${before.cafe24_product_no ?? "없음"} → #${f.cafe24No ?? "없음"}`);
  const added = f.keywords.filter((k) => !before.keywords.includes(k));
  const removed = before.keywords.filter((k) => !f.keywords.includes(k));
  if (added.length) changes.push(`검색어 추가 ${added.join(", ")}`);
  if (removed.length) changes.push(`검색어 삭제 ${removed.join(", ")}`);
  if (f.active !== before.active) changes.push(f.active ? "판매 다시 시작" : "판매 멈춤");
  if (f.photo) changes.push("사진 교체");
  if (f.shopUrl !== (before.shop_url ?? null)) changes.push(`자사몰 주소 → ${f.shopUrl ?? "없음"}`);
  if (changes.length === 0) redirect("/admin/products");

  let photoUrl = before.photo_url;
  let uploadedPath: string | null = null;
  if (f.photo) {
    try {
      const uploaded = await uploadBreadPhoto(f.photo, before.ticker);
      photoUrl = uploaded.url;
      uploadedPath = uploaded.path;
    } catch (e) {
      backTo(editPath, e instanceof Error ? e.message : String(e));
    }
  }

  /* ponytail: 마지막 저장이 이긴다(버전 검사 없음). 관리자가 여럿이 되면 updated_at 으로 막는다. */
  const db = supabaseAdmin();
  const { data: updated, error } = await db
    .from("products")
    .update({
      display_name: f.displayName,
      full_name: f.fullName,
      photo_url: photoUrl,
      base_price_won: f.base,
      cafe24_product_no: f.cafe24No,
      keywords: f.keywords,
      active: f.active,
      shop_url: f.shopUrl,
    })
    .eq("id", id)
    .select("id");
  if (error || !updated?.length) {
    if (uploadedPath) await removeBreadPhoto(uploadedPath);
    backTo(editPath, error ? `저장하지 못했어요: ${error.message}` : "상품을 찾을 수 없어요.");
  }

  /* 상품은 이미 바뀌었다. 기록만 실패하면 저장을 되돌리지 않고 실패를 알린다 —
     되돌리기가 또 실패하면 어느 쪽이 맞는지 알 수 없게 된다. */
  const { error: auditError } = await db
    .from("admin_audit_log")
    .insert({ kind: "product", target: `${before.ticker} ${f.displayName}`, change: changes.join(" · ") });

  revalidatePath("/admin", "layout");
  if (auditError) backTo(editPath, `저장은 됐지만 변경 기록을 남기지 못했어요: ${auditError.message}`);
  redirect(`/admin/products?saved=${encodeURIComponent(before.ticker)}`);
}

export type Cafe24Check = { ok: true; name: string; priceWon: number } | { ok: false; error: string };

/* 상품번호로 Cafe24 상품명·판매가를 읽어 온다. 읽기만 한다. */
export async function checkCafe24Product(productNo: number): Promise<Cafe24Check> {
  await assertAdmin();
  if (!Number.isInteger(productNo) || productNo <= 0) return { ok: false, error: "상품번호를 먼저 넣어 주세요." };
  try {
    const res = await cafe24Request<{ product?: { product_name?: string; price?: string } }>(
      `/api/v2/admin/products/${productNo}?shop_no=${cafe24ShopNo()}&fields=product_no,product_name,price`,
    );
    if (!res.product) return { ok: false, error: `#${productNo} 상품을 찾지 못했어요.` };
    return { ok: true, name: res.product.product_name ?? "", priceWon: Math.round(Number(res.product.price ?? 0)) };
  } catch (e) {
    return { ok: false, error: `Cafe24 에 연결하지 못했어요: ${e instanceof Error ? e.message : String(e)}` };
  }
}
