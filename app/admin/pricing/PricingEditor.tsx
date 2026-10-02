"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { BacktestStats } from "@/lib/admin/backtest";
import {
  TOTAL_CAP_PCT,
  checkPolicy,
  describePolicyChanges,
  nextVersion,
  round2,
  type CouponPolicy,
  type Policy,
} from "@/lib/bread-market/policy";
import { runBacktest, savePolicy, type PolicyDraft } from "./actions";

function draftOf(p: Policy): PolicyDraft {
  const f = p.formula;
  return {
    searchWeight: f.searchWeight,
    fxMultiplier: round2(f.fxWeight * f.fxScale),
    fxDiscountCapPct: f.fxDiscountCapPct,
    fxSurchargeCapPct: f.fxSurchargeCapPct,
    fxRisePassThroughPct: f.fxRisePassThroughPct ?? 100,
    discountCapPct: f.discountCapPct,
    discountFloorPct: f.discountFloorPct ?? 0,
    coupons: structuredClone(p.coupons),
  };
}

/* 화면 검사용으로 초안을 정책 모양으로 되돌린다. 서버 액션도 같은 checkPolicy 로 다시 검사한다. */
function policyOf(active: Policy, d: PolicyDraft): Pick<Policy, "formula" | "coupons"> {
  return {
    formula: {
      ...active.formula,
      searchWeight: d.searchWeight,
      fxWeight: d.fxMultiplier / active.formula.fxScale,
      fxDiscountCapPct: d.fxDiscountCapPct,
      fxSurchargeCapPct: d.fxSurchargeCapPct,
      fxRisePassThroughPct: d.fxRisePassThroughPct,
      discountCapPct: d.discountCapPct,
      discountFloorPct: d.discountFloorPct,
    },
    coupons: d.coupons,
  };
}

type FormulaKey = Exclude<keyof PolicyDraft, "coupons">;
const FORMULA: { key: FormulaKey; label: string; help: string; step: string }[] = [
  { key: "searchWeight", label: "검색 가중치", help: "검색지수(0~100) × 가중치 = 검색 할인 %p", step: "0.01" },
  { key: "fxMultiplier", label: "환율 배율", help: "환율 변화율 × 배율 = 환율 할인 %p", step: "0.5" },
  { key: "fxDiscountCapPct", label: "환율 할인 상한 (%p)", help: "환율이 내릴 때 최대", step: "1" },
  { key: "fxSurchargeCapPct", label: "환율 할증 상한 (%p)", help: "환율이 오를 때 할인을 줄이는 최대", step: "1" },
  { key: "fxRisePassThroughPct", label: "환율 상승 반영 (%)", help: "오른 만큼 할인을 줄이는 비율", step: "10" },
  { key: "discountCapPct", label: "상품 할인 상한 (%)", help: "정가 대비 최대 할인", step: "1" },
  { key: "discountFloorPct", label: "상품 할인 하한 (%)", help: "0 이면 정가를 넘지 않아요", step: "1" },
];
const COUPONS: { key: keyof CouponPolicy; label: string; help: string; color: string }[] = [
  { key: "instantAm", label: "안정형 · 오전장", help: "누르면 바로 받기 · 3시간", color: "#2C6199" },
  { key: "instantPm", label: "안정형 · 오후장", help: "누르면 바로 받기 · 3시간", color: "#2C6199" },
  { key: "prediction", label: "공격형", help: "맞히거나 같으면 받기 · 24시간", color: "#B02A63" },
];

const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;

export function PricingEditor({ active, initialStats }: { active: Policy; initialStats: BacktestStats }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PolicyDraft>(() => draftOf(active));
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ active: BacktestStats; draft: BacktestStats } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const candidate = useMemo(() => policyOf(active, draft), [active, draft]);
  const checks = useMemo(() => checkPolicy(candidate), [candidate]);
  const changes = useMemo(() => describePolicyChanges(active, candidate), [active, candidate]);
  const changeLines = [...changes.formula, ...changes.coupons];
  const allOk = checks.every((c) => c.ok);
  const version = nextVersion(active.version);

  const setFormula = (key: FormulaKey, v: string) => {
    setDraft((d) => ({ ...d, [key]: v === "" ? Number.NaN : Number(v) }));
    setResult(null);
  };
  const setCoupon = (key: keyof CouponPolicy, edge: "min" | "max", v: string) => {
    setDraft((d) => ({ ...d, coupons: { ...d.coupons, [key]: { ...d.coupons[key], [edge]: v === "" ? Number.NaN : Number(v) } } }));
    setResult(null);
  };

  const onBacktest = () =>
    start(async () => {
      const r = await runBacktest(draft);
      if ("error" in r) setMessage({ ok: false, text: r.error });
      else setResult(r);
    });
  const onSave = () => {
    if (!window.confirm(`${version}로 저장할까요?\n\n${changeLines.join("\n")}\n\n다음 가격 계산부터 바로 적용되고, 저장한 버전은 지울 수 없어요.`)) return;
    start(async () => {
      const r = await savePolicy(draft, note, active.version);
      if (r.ok) {
        setMessage({ ok: true, text: `${r.version} 로 저장했어요. 다음 가격 계산과 새로 받는 쿠폰부터 적용돼요.` });
        setNote("");
        setResult(null);
        router.refresh();
      } else setMessage({ ok: false, text: r.error });
    });
  };
  const onDiscard = () => {
    setDraft(draftOf(active));
    setResult(null);
    setMessage(null);
  };

  /* 저장된 뒤 새 운영값이 들어오면 초안을 그 값으로 다시 맞춘다. */
  const [seen, setSeen] = useState(active.version);
  if (seen !== active.version) {
    setSeen(active.version);
    setDraft(draftOf(active));
  }

  const stats = result ?? { active: initialStats, draft: null };
  const capW = (Math.max(0, candidate.formula.discountCapPct) / TOTAL_CAP_PCT) * 100;
  const couponW = (Math.max(0, candidate.coupons.prediction.max) / TOTAL_CAP_PCT) * 100;

  return (
    <>
      {message ? (
        <p className={`ap-msg ${message.ok ? "ap-msg--ok" : "ap-msg--err"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>
      ) : null}

      <div className="ap-grid2">
        <section className="ap-box">
          <div className="ap-box__h"><h2>상품 할인 (산식)</h2><span>매 장 가격에 들어가요</span></div>
          <div className="ap-rows">
            {FORMULA.map((f) => {
              const now = draftOf(active)[f.key];
              const v = draft[f.key];
              return (
                <div key={f.key} className="ap-kv ap-kv--edit">
                  <div><b>{f.label}</b><small>{f.help}</small></div>
                  <span className="ap-num">
                    <input type="number" step={f.step} inputMode="decimal" aria-label={f.label} value={Number.isNaN(v) ? "" : v} onChange={(e) => setFormula(f.key, e.target.value)} />
                    <small className={v !== now ? "is-changed" : undefined}>지금 {now}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="ap-box">
          <div className="ap-box__h"><h2>쿠폰 보상률 (%)</h2><span>저장 뒤 새로 받는 쿠폰부터</span></div>
          <div className="ap-rows">
            {COUPONS.map((c) => {
              const r = draft.coupons[c.key];
              const now = active.coupons[c.key];
              return (
                <div key={c.key} className="ap-kv ap-kv--edit">
                  <div><b style={{ color: c.color }}>{c.label}</b><small>{c.help}</small></div>
                  <span className="ap-num">
                    <span className="ap-range">
                      <input type="number" step="1" min="1" aria-label={`${c.label} 최소`} value={Number.isNaN(r.min) ? "" : r.min} onChange={(e) => setCoupon(c.key, "min", e.target.value)} />
                      <span aria-hidden="true">~</span>
                      <input type="number" step="1" min="1" aria-label={`${c.label} 최대`} value={Number.isNaN(r.max) ? "" : r.max} onChange={(e) => setCoupon(c.key, "max", e.target.value)} />
                    </span>
                    <small className={r.min !== now.min || r.max !== now.max ? "is-changed" : undefined}>지금 {now.min}~{now.max}</small>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="ap__note" style={{ margin: 0 }}>안정형 최대값이 공격형 최대값보다 작아야 공격형을 고를 이유가 생겨요.</p>
        </section>
      </div>

      <section className="ap-box">
        <div className="ap-box__h"><h2>저장 전 검사</h2><span>하나라도 실패하면 저장할 수 없어요</span></div>
        <div className="ap-bar" aria-label={`상품 할인 ${candidate.formula.discountCapPct}%, 쿠폰 ${candidate.coupons.prediction.max}%, 한도 ${TOTAL_CAP_PCT}%`}>
          <div style={{ width: `${Math.min(capW, 100)}%`, background: "#15171E", color: "#fff" }}>상품 할인 {candidate.formula.discountCapPct}%</div>
          <div style={{ width: `${Math.min(couponW, Math.max(0, 100 - capW))}%`, background: "#B02A63", color: "#fff" }}>쿠폰 {candidate.coupons.prediction.max}%</div>
          <div style={{ flex: 1, justifyContent: "flex-end", color: "var(--ink-2)" }}>한도 {TOTAL_CAP_PCT}%</div>
        </div>
        <div className="ap-checks">
          {checks.map((c) => (
            <div key={c.text} className={`ap-msg ${c.ok ? "ap-msg--ok" : "ap-msg--err"}`}>{c.ok ? "통과" : "실패"} · {c.text}</div>
          ))}
        </div>
      </section>

      <section className="ap-box">
        <div className="ap-box__h">
          <div>
            <h2>90일 백테스트</h2>
            <span>지난 90일의 실제 입력(검색지수·환율)으로 초안과 {active.version} 을 다시 계산해 비교해요</span>
          </div>
          <button type="button" className="ap-btn ap-btn--ghost" onClick={onBacktest} disabled={pending || !allOk || changeLines.length === 0}>
            {pending ? "계산 중…" : "백테스트 실행"}
          </button>
        </div>
        <div className="ap-tablewrap">
          <table className="ap-table">
            <thead>
              <tr><th></th><th className="r">평균 할인</th><th className="r">상한에 닿은 장</th><th className="r">정가로 멈춘 장</th><th className="r">직전 대비 최대 변동</th></tr>
            </thead>
            <tbody>
              {(
                [
                  [`${active.version} (운영)`, stats.active],
                  [`${version} (초안)`, stats.draft],
                ] as const
              ).map(([label, s]) => (
                <tr key={label}>
                  <td><b>{label}</b></td>
                  {s ? (
                    <>
                      <td className="r">{pct(s.avgDiscountPct, 2)}</td>
                      <td className="r">{pct(s.capHitPct)}</td>
                      <td className="r">{pct(s.listPricePct)}</td>
                      <td className="r">{pct(s.maxMovePct)}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="mono">값을 바꾸고 백테스트를 실행하면 나와요</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ap__note" style={{ margin: 0 }}>{stats.active.sessions}개 장 기준. 쿠폰 보상률은 가격에 들어가지 않아 백테스트에 영향이 없어요.</p>
      </section>

      <section className="ap-box">
        <div className="ap-box__h"><h2>바뀌는 내용</h2><span>{changeLines.length ? `${changeLines.length}개` : "아직 없음"}</span></div>
        {changeLines.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 14 }}>
            {changeLines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        ) : null}
        <label className="ap-field">
          변경 이유 (선택)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="예: 환율 급등 구간에서 할인 축소폭 완화" />
        </label>
      </section>

      <div className="ap-actions" style={{ alignItems: "center" }}>
        <span className="ap__note">저장하면 다음 가격 계산과 새로 받는 쿠폰부터 {version} 으로 적용돼요. 이미 나온 가격과 쿠폰은 그대로예요.</span>
        <button type="button" className="ap-btn ap-btn--ghost" onClick={onDiscard} disabled={pending || changeLines.length === 0}>초안 버리기</button>
        <button type="button" className="ap-btn" onClick={onSave} disabled={pending || !allOk || changeLines.length === 0}>
          {version}로 저장
        </button>
      </div>
    </>
  );
}
