import Link from "next/link";
import { loadAdminProducts } from "@/lib/admin/data";
import { kstNow } from "@/lib/market/calendar";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const { rows, summary } = await loadAdminProducts();
  const now = kstNow();

  return (
    <main className="ap">
      <div className="ap__head">
        <div>
          <div className="ap__sub">{now.date} · {now.hour}시 기준</div>
          <h1>상품 관리</h1>
        </div>
        {/* 새 빵은 화면 코드(engine.ts BREADS)와 사진이 함께 있어야 보인다. DB 에만 넣으면
            가격은 계산되는데 화면에는 안 나온다. 상품 목록을 DB 로 옮기는 2차에서 연다. */}
        <span className="ap-btn" aria-disabled="true" title="2차에서 열려요">빵 추가</span>
      </div>

      {saved ? <p className="ap-msg ap-msg--ok" role="status">{saved} 저장했어요. 다음 가격 계산부터 반영돼요.</p> : null}

      <div className="ap-cards">
        <div className="ap-card"><span>판매 중</span><b>{summary.activeCount}종</b></div>
        <div className="ap-card"><span>오늘 오전가 반영</span><b>{summary.amApplied} / {summary.activeCount}</b></div>
        <div className="ap-card"><span>다음 가격 계산</span><b>{summary.nextRun}</b></div>
        <div className={`ap-card${summary.needsCheck > 0 ? " ap-card--warn" : ""}`}>
          <span>확인 필요 (오늘 계산 일부 실패·보류)</span><b>{summary.needsCheck}건</b>
        </div>
      </div>

      <div className="ap-tablewrap">
        <table className="ap-table">
          <thead>
            <tr>
              <th>상품</th>
              <th className="r">정가</th>
              <th className="r">지금 가격</th>
              <th className="r">할인율</th>
              <th>Cafe24</th>
              <th>검색어</th>
              <th>판매</th>
              <th><span className="sr-only">수정</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="ap-prod">
                    <span className="ap-tk">{r.ticker}</span>
                    <b>{r.name}</b>
                  </div>
                </td>
                <td className="r">{won(r.base_price_won)}원</td>
                <td className="r">
                  {r.todayPrice ? <>{won(r.todayPrice.priceWon)}원 <small className="mono">{r.todayPrice.session === "am" ? "오전" : "오후"}</small></> : "—"}
                </td>
                <td className="r" style={{ color: "#2C6199" }}>{r.todayPrice ? `${r.todayPrice.discountPct.toFixed(1)}%` : "—"}</td>
                <td className="mono">{r.cafe24_product_no ? `#${r.cafe24_product_no}` : "미연결"}</td>
                <td className="mono">{r.keywords.length}개</td>
                <td>
                  <span className={`ap-pill ${r.active ? "ap-pill--on" : "ap-pill--off"}`}>{r.active ? "판매 중" : "멈춤"}</span>
                </td>
                <td className="r"><Link href={`/admin/products/${encodeURIComponent(r.id)}`}>수정</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="ap__note">판매를 멈추면 다음 가격 계산부터 빠지고, 시세 목록에서도 사라져요. 이미 받은 쿠폰과 잠금은 그대로 유효해요.</p>
    </main>
  );
}
