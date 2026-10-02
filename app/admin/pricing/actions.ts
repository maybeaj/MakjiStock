"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAdminAuthorization } from "@/lib/admin/auth";
import { backtest, loadBacktestInputs, type BacktestStats } from "@/lib/admin/backtest";
import { checkPolicy, describePolicyChanges, nextVersion, type CouponPolicy, type PctRange } from "@/lib/bread-market/policy";
import { loadActivePolicy } from "@/lib/bread-market/policy-server";
import type { PricingConfig } from "@/lib/pricing/pricing.mjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** 화면이 고치는 값만. 나머지(fxScale, 반올림 단위 등)는 운영 버전 값을 그대로 이어받는다. */
export type PolicyDraft = {
  searchWeight: number;
  fxMultiplier: number;
  fxDiscountCapPct: number;
  fxSurchargeCapPct: number;
  fxRisePassThroughPct: number;
  discountCapPct: number;
  discountFloorPct: number;
  coupons: CouponPolicy;
};

async function assertAdmin() {
  if (!isAdminAuthorization((await headers()).get("authorization"))) throw new Error("관리자 비밀번호가 필요합니다.");
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const range = (r: PctRange | undefined): PctRange => ({ min: num(r?.min), max: num(r?.max) });

/* 브라우저에서 온 값은 믿지 않는다. 숫자로 바꾸고, 운영 버전에 없는 키는 버린다. */
function toPolicy(base: PricingConfig, d: PolicyDraft) {
  const formula: PricingConfig = {
    ...base,
    searchWeight: num(d.searchWeight),
    fxWeight: num(d.fxMultiplier) / base.fxScale,
    fxDiscountCapPct: num(d.fxDiscountCapPct),
    fxSurchargeCapPct: num(d.fxSurchargeCapPct),
    fxRisePassThroughPct: num(d.fxRisePassThroughPct),
    discountCapPct: num(d.discountCapPct),
    discountFloorPct: num(d.discountFloorPct),
  };
  const coupons: CouponPolicy = {
    instantAm: range(d.coupons?.instantAm),
    instantPm: range(d.coupons?.instantPm),
    prediction: range(d.coupons?.prediction),
  };
  return { formula, coupons };
}

export async function runBacktest(draft: PolicyDraft): Promise<{ active: BacktestStats; draft: BacktestStats } | { error: string }> {
  await assertAdmin();
  const active = await loadActivePolicy();
  const next = toPolicy(active.formula, draft);
  if (!checkPolicy(next).every((c) => c.ok)) return { error: "저장 전 검사를 통과하지 못한 값이에요. 먼저 고쳐 주세요." };
  const rows = await loadBacktestInputs();
  return { active: backtest(rows, active.formula), draft: backtest(rows, next.formula) };
}

export type SaveResult = { ok: true; version: string } | { ok: false; error: string };

export async function savePolicy(draft: PolicyDraft, note: string, baseVersion: string): Promise<SaveResult> {
  await assertAdmin();
  /* 화면을 연 뒤 다른 사람이 먼저 저장했을 수 있다. 비교와 버전 번호는 지금 운영값 기준으로 다시 잡는다. */
  const active = await loadActivePolicy();
  if (!active.fromDb) return { ok: false, error: "운영 정책을 DB 에서 읽지 못했어요. 010 마이그레이션이 적용됐는지 확인해 주세요." };
  /* 초안은 화면을 연 시점의 값 전부를 담는다. 그 사이 다른 사람이 저장했다면 그대로 올리면
     그 사람의 변경을 조용히 되돌린다. */
  if (baseVersion !== active.version) {
    return { ok: false, error: `그 사이 ${active.version} 이 저장됐어요. 새로고침해서 바뀐 값을 확인한 뒤 다시 저장해 주세요.` };
  }
  const next = toPolicy(active.formula, draft);

  const failed = checkPolicy(next).filter((c) => !c.ok);
  if (failed.length) return { ok: false, error: `검사 실패: ${failed.map((c) => c.text).join(" / ")}` };

  const changes = describePolicyChanges(active, next);
  if (changes.formula.length + changes.coupons.length === 0) return { ok: false, error: "바뀐 값이 없어요." };

  const version = nextVersion(active.version);
  const db = supabaseAdmin();
  const { error } = await db.from("pricing_versions").insert({
    version,
    formula: next.formula,
    coupons: next.coupons,
    note: note.trim().slice(0, 500) || null,
  });
  if (error) {
    return { ok: false, error: error.code === "23505" ? `${version} 이 이미 있어요. 새로고침 후 다시 저장해 주세요.` : error.message };
  }

  /* 버전은 이미 운영 중이다. 기록만 실패하면 되돌리지 않고 알린다 (상품 저장과 같은 규칙). */
  const audit = [
    ...(changes.formula.length ? [{ kind: "formula", target: `${active.version} → ${version}`, change: changes.formula.join(", ") }] : []),
    ...(changes.coupons.length ? [{ kind: "coupon", target: `${active.version} → ${version}`, change: changes.coupons.join(", ") }] : []),
  ];
  const { error: auditError } = await db.from("admin_audit_log").insert(audit);

  revalidatePath("/admin", "layout");
  if (auditError) return { ok: false, error: `${version} 은 저장됐지만 변경 기록을 남기지 못했어요: ${auditError.message}` };
  return { ok: true, version };
}
