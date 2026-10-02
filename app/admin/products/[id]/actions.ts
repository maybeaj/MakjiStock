"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthorization } from "@/lib/admin/auth";
import { loadAdminProduct } from "@/lib/admin/data";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_KEYWORDS = 20; // 네이버 데이터랩 한 그룹 한도 (lib/pricing/naver.mjs)

function back(id: string, error: string): never {
  redirect(`/admin/products/${encodeURIComponent(id)}?error=${encodeURIComponent(error)}`);
}

export async function saveProduct(id: string, formData: FormData) {
  if (!isAdminAuthorization((await headers()).get("authorization"))) throw new Error("관리자 비밀번호가 필요합니다.");

  const before = await loadAdminProduct(id);
  if (!before) back(id, "상품을 찾을 수 없어요.");

  const base = Number(String(formData.get("base_price_won") ?? "").replace(/[,\s원]/g, ""));
  if (!Number.isInteger(base) || base <= 0 || base % 10 !== 0) back(id, "정가는 10원 단위의 양수여야 해요.");

  const noText = String(formData.get("cafe24_product_no") ?? "").trim();
  const cafe24No = noText === "" ? null : Number(noText);
  if (cafe24No !== null && (!Number.isInteger(cafe24No) || cafe24No <= 0)) back(id, "Cafe24 상품번호는 양의 정수예요.");

  const keywords = [
    ...new Set(
      String(formData.get("keywords") ?? "")
        .split(/[\n,]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
  if (keywords.length === 0) back(id, "검색어가 하나는 있어야 검색 할인을 계산할 수 있어요.");
  if (keywords.length > MAX_KEYWORDS) back(id, `검색어는 최대 ${MAX_KEYWORDS}개예요. 지금 ${keywords.length}개.`);

  const active = formData.get("active") === "on";

  const changes: string[] = [];
  if (base !== before.base_price_won) changes.push(`정가 ${before.base_price_won.toLocaleString("ko-KR")}원 → ${base.toLocaleString("ko-KR")}원`);
  if (cafe24No !== before.cafe24_product_no) changes.push(`Cafe24 #${before.cafe24_product_no ?? "없음"} → #${cafe24No ?? "없음"}`);
  const added = keywords.filter((k) => !before.keywords.includes(k));
  const removed = before.keywords.filter((k) => !keywords.includes(k));
  if (added.length) changes.push(`검색어 추가 ${added.join(", ")}`);
  if (removed.length) changes.push(`검색어 삭제 ${removed.join(", ")}`);
  if (active !== before.active) changes.push(active ? "판매 다시 시작" : "판매 멈춤");
  if (changes.length === 0) redirect("/admin/products");

  const db = supabaseAdmin();
  /* ponytail: 마지막 저장이 이긴다(버전 검사 없음). 관리자가 여럿이 되면 updated_at 으로 막는다. */
  const { data: updated, error } = await db
    .from("products")
    .update({ base_price_won: base, cafe24_product_no: cafe24No, keywords, active })
    .eq("id", id)
    .select("id");
  if (error) back(id, `저장하지 못했어요: ${error.message}`);
  if (!updated?.length) back(id, "상품을 찾을 수 없어요.");

  /* 상품은 이미 바뀌었다. 기록만 실패하면 저장을 되돌리지 않고 실패를 알린다 —
     되돌리기가 또 실패하면 어느 쪽이 맞는지 알 수 없게 된다. */
  const { error: auditError } = await db
    .from("admin_audit_log")
    .insert({ kind: "product", target: `${before.ticker} ${before.name}`, change: changes.join(" · ") });

  revalidatePath("/admin", "layout");
  if (auditError) back(id, `저장은 됐지만 변경 기록을 남기지 못했어요: ${auditError.message}`);
  redirect(`/admin/products?saved=${encodeURIComponent(before.ticker)}`);
}
