import { backtest, loadBacktestInputs } from "@/lib/admin/backtest";
import { loadActivePolicy, loadPolicyHistory } from "@/lib/bread-market/policy-server";
import { PricingEditor } from "./PricingEditor";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default async function AdminPricingPage() {
  const [active, history, rows] = await Promise.all([loadActivePolicy(), loadPolicyHistory().catch(() => []), loadBacktestInputs()]);
  const { fromDb, ...policy } = active;

  return (
    <main className="ap">
      <div className="ap__head">
        <div>
          <div className="ap__sub">값을 바꾸면 새 산식 버전이 만들어져요. 이미 나온 가격과 쿠폰은 바뀌지 않아요.</div>
          <h1>할인율 관리</h1>
        </div>
        <span className="ap-chip">운영 중 <b>{policy.version}</b>{history[0] ? ` · ${fmt.format(new Date(history[0].created_at))}부터` : ""}</span>
      </div>

      {!fromDb ? (
        <p className="ap-msg ap-msg--err" role="alert">pricing_versions 를 읽지 못해 코드 대비값을 보여주고 있어요. 010 마이그레이션을 적용해야 저장할 수 있어요.</p>
      ) : null}

      <PricingEditor active={policy} initialStats={backtest(rows, policy.formula)} />

      {history.length ? (
        <section className="ap-box">
          <div className="ap-box__h"><h2>버전 이력</h2><span>최근 {history.length}개</span></div>
          <div className="ap-tablewrap">
            <table className="ap-table">
              <thead><tr><th>버전</th><th>언제</th><th>메모</th><th>누가</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.version}>
                    <td><b>{h.version}</b></td>
                    <td className="mono">{fmt.format(new Date(h.created_at))}</td>
                    <td>{h.note ?? ""}</td>
                    <td className="mono">{h.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
