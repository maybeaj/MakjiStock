import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KPI | MAKJI Admin", robots: { index: false, follow: false } };

/* KPI 대시보드 — supabase/migrations/008 의 kpi_weekly · kpi_daily 를 그대로 보여준다.
   계산은 뷰가 한다. 여기서 다시 계산하면 SQL 과 화면이 다른 숫자를 말한다.
   /admin 은 proxy.ts 가 비밀번호로 잠근다. */

type Weekly = {
  week_start: string;
  visitors: number;
  clickers: number;
  codes_issued: number;
  codes_used: number;
  code_use_pct: number | null;
  lock_codes: number;
  lock_same_day_pct: number | null;
  attributed_orders: number;
  click_to_order_pct: number | null;
  orders: number;
  am_order_pct: number | null;
  baseline_weekly_orders: number | null;
  sales_lift_pct: number | null;
};

type Daily = {
  trade_day: string;
  visitors: number;
  clickers: number;
  codes_issued: number;
  codes_used: number;
  orders: number;
  am_orders: number;
  attributed_orders: number;
};

const pct = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);

const cell: React.CSSProperties = { padding: "10px 12px", borderTop: "1px solid var(--line)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const head: React.CSSProperties = { ...cell, borderTop: "none", fontSize: 12, fontWeight: 700, color: "var(--ink-2)", background: "var(--paper-2)" };

export default async function KpiPage() {
  const db = supabaseAdmin();
  const [weekly, daily, lastSync] = await Promise.all([
    db.from("kpi_weekly").select("*").limit(8),
    db.from("kpi_daily").select("*").limit(14),
    db.from("job_runs").select("status,finished_at,step_log,error_message").eq("job_kind", "sync_orders").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = weekly.error ?? daily.error;
  const weeks = (weekly.data ?? []) as Weekly[];
  const days = (daily.data ?? []) as Daily[];
  const now = weeks[0];
  const sync = lastSync.data;

  const cards: { label: string; value: string; sub: string; star?: boolean }[] = now
    ? [
        { label: "코드 귀속 주문", value: `${now.attributed_orders}건`, sub: "막지스톡 할인코드가 쓰인 주문", star: true },
        { label: "할인코드 사용률", value: pct(now.code_use_pct), sub: `${now.codes_used} / ${now.codes_issued}개 사용` },
        { label: "잠금 후 당일 구매율", value: pct(now.lock_same_day_pct), sub: `잠금 차액 코드 ${now.lock_codes}개 중` },
        { label: "이동 대비 구매전환", value: pct(now.click_to_order_pct), sub: `구매 링크 누른 ${now.clickers}명 기준` },
        { label: "주문 · 오전 결제", value: `${now.orders}건`, sub: `오전장 결제 ${pct(now.am_order_pct)}` },
        { label: "판매 증분", value: pct(now.sales_lift_pct), sub: now.baseline_weekly_orders === null ? "도입 전 주문을 채우면 나와요" : `도입 전 주 평균 ${now.baseline_weekly_orders}건 대비` },
      ]
    : [];

  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)", padding: "36px 40px 56px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 22 }}>
        <header style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>이번 주 {now?.week_start ?? "—"}부터 · 장일 기준(02:00에 하루가 바뀜)</div>
          <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.03em" }}>KPI</h1>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            마지막 주문 동기화: {sync?.finished_at ? new Date(sync.finished_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "아직 없음"}
            {sync?.status && sync.status !== "completed" ? ` · ${sync.status}${sync.error_message ? ` (${sync.error_message})` : ""}` : ""}
          </div>
        </header>

        {error ? (
          <p role="alert" style={{ padding: 14, borderRadius: 12, background: "var(--up-soft)", color: "var(--up)" }}>
            지표를 읽지 못했어요: {error.message}. 마이그레이션 008 이 적용됐는지 확인해 주세요.
          </p>
        ) : null}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {cards.map((c) => (
            <div key={c.label} style={{ padding: "16px 18px", borderRadius: 16, background: c.star ? "var(--ink)" : "#fff", color: c.star ? "#fff" : "var(--ink)", border: c.star ? "none" : "1px solid var(--line)", display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.75 }}>{c.star ? "★ " : ""}{c.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{c.sub}</div>
            </div>
          ))}
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>주별</h2>
          <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 820 }}>
              <thead>
                <tr>
                  {["주 시작", "방문자", "링크 클릭", "코드 발급", "코드 사용률", "잠금 당일", "코드 귀속", "이동→구매", "주문", "오전 결제", "판매 증분"].map((h, i) => (
                    <th key={h} style={{ ...head, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.week_start}>
                    <td style={{ ...cell, textAlign: "left" }}>{w.week_start}</td>
                    <td style={cell}>{w.visitors}</td>
                    <td style={cell}>{w.clickers}</td>
                    <td style={cell}>{w.codes_issued}</td>
                    <td style={cell}>{pct(w.code_use_pct)}</td>
                    <td style={cell}>{pct(w.lock_same_day_pct)}</td>
                    <td style={{ ...cell, fontWeight: 800 }}>{w.attributed_orders}</td>
                    <td style={cell}>{pct(w.click_to_order_pct)}</td>
                    <td style={cell}>{w.orders}</td>
                    <td style={cell}>{pct(w.am_order_pct)}</td>
                    <td style={cell}>{pct(w.sales_lift_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>최근 14일</h2>
          <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 640 }}>
              <thead>
                <tr>
                  {["장일", "방문자", "링크 클릭", "코드 발급", "코드 사용", "주문", "오전 결제", "코드 귀속"].map((h, i) => (
                    <th key={h} style={{ ...head, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.trade_day}>
                    <td style={{ ...cell, textAlign: "left" }}>{d.trade_day}</td>
                    <td style={cell}>{d.visitors}</td>
                    <td style={cell}>{d.clickers}</td>
                    <td style={cell}>{d.codes_issued}</td>
                    <td style={cell}>{d.codes_used}</td>
                    <td style={cell}>{d.orders}</td>
                    <td style={cell}>{d.am_orders}</td>
                    <td style={{ ...cell, fontWeight: 800 }}>{d.attributed_orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
          방문자는 같은 브라우저 기준이에요. 주문은 막지스톡 6종이 들어간 결제 완료 주문만 세고 취소는 뺐어요.
          코드 귀속은 우리가 발급한 할인코드가 실제로 쓰인 주문이에요. 판매 증분은 첫 방문 기록 이전 주들의 평균과 비교해요.
        </p>
      </div>
    </main>
  );
}
