import { DEFAULT_POLICY, checkPolicy, type CouponPolicy, type Policy } from "@/lib/bread-market/policy";
import type { PricingConfig } from "@/lib/pricing/pricing.mjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* 운영 중인 정책 = pricing_versions 의 가장 최근 행. 서버에서만 부른다.

   못 읽거나 행이 검사를 통과하지 못하면 DEFAULT_POLICY(코드의 v1.4)와 fromDb:false 를 준다.
   화면은 그대로 보여주고, 가격 크론은 fromDb 가 false 면 계산하지 않고 보류한다 — 운영값과 다른
   대비값으로 가격을 내고 v1.4 로 기록하면 그날 무슨 산식이었는지 알 수 없게 된다.
   ponytail: 요청마다 한 행을 읽는다. 느려지면 짧은 캐시를 둔다. */
export async function loadActivePolicy(): Promise<Policy & { fromDb: boolean }> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("pricing_versions")
      .select("version,formula,coupons")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("pricing_versions 가 비어 있습니다");
    const policy = { version: data.version, formula: data.formula as PricingConfig, coupons: data.coupons as CouponPolicy };
    // 손으로 넣은 행이 깨져 있으면 NaN 이 크론과 쿠폰 표로 흘러간다. 저장할 때와 같은 검사를 읽을 때도 한다.
    const failed = checkPolicy(policy).filter((c) => !c.ok);
    if (failed.length) throw new Error(`${data.version} 이 검사를 통과하지 못했습니다: ${failed.map((c) => c.text).join(" / ")}`);
    return { ...policy, fromDb: true };
  } catch (cause) {
    console.error("[policy] 운영 정책을 읽지 못해 코드 대비값을 씁니다", cause);
    return { ...DEFAULT_POLICY, fromDb: false };
  }
}

export type PolicyVersionRow = { version: string; note: string | null; actor: string; created_at: string };

export async function loadPolicyHistory(): Promise<PolicyVersionRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("pricing_versions")
    .select("version,note,actor,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}
