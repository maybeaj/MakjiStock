import Link from "next/link";
import { loadAuditLog, type AuditKind } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

const KINDS: { key: AuditKind | undefined; label: string }[] = [
  { key: undefined, label: "전체" },
  { key: "formula", label: "산식" },
  { key: "coupon", label: "쿠폰" },
  { key: "product", label: "상품" },
];
const LABEL: Record<AuditKind, string> = { formula: "산식", coupon: "쿠폰", product: "상품" };

const fmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: raw } = await searchParams;
  const kind = raw && raw in LABEL ? (raw as AuditKind) : undefined;
  const logs = await loadAuditLog(kind);

  return (
    <main className="ap">
      <div className="ap__head">
        <div>
          <div className="ap__sub">가격·쿠폰에 영향을 주는 변경은 모두 남아요. 지울 수 없어요.</div>
          <h1>변경 기록</h1>
        </div>
        <nav className="ap-chips" aria-label="종류">
          {KINDS.map((k) => (
            <Link
              key={k.label}
              href={k.key ? `/admin/audit?kind=${k.key}` : "/admin/audit"}
              className="ap-chip"
              aria-current={k.key === kind ? "page" : undefined}
            >
              {k.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="ap-tablewrap">
        <table className="ap-table">
          <thead>
            <tr><th>언제</th><th>종류</th><th>대상</th><th>바뀐 내용</th><th>누가</th></tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={5} className="mono">아직 기록이 없어요.</td></tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{fmt.format(new Date(l.at))}</td>
                  <td><span className={`ap-pill ap-pill--${l.kind}`}>{LABEL[l.kind]}</span></td>
                  <td><b>{l.target}</b></td>
                  <td>{l.change}</td>
                  <td className="mono">{l.actor}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="ap__note">어드민이 생기기 전 변경은 docs/산식-버전.md 에서 옮겨 왔어요(누가: 기록 이관).</p>
    </main>
  );
}
