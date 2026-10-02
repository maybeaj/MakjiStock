import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminProduct } from "@/lib/admin/data";
import { saveProduct } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const product = await loadAdminProduct(decodeURIComponent(id));
  if (!product) notFound();
  const save = saveProduct.bind(null, product.id);

  return (
    <main className="ap">
      <div>
        <Link href="/admin/products" className="ap__back">← 상품 관리</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, letterSpacing: "-0.03em" }}>{product.name} 수정</h1>
      </div>

      {error ? <p className="ap-msg ap-msg--err" role="alert">{error}</p> : null}

      <form action={save} className="ap-form">
        <section className="ap-box">
          <div className="ap-box__h"><h2>기본 정보</h2><span>화면 이름·티커 변경은 2차에서 열려요</span></div>
          <div className="ap-fields">
            <label className="ap-field">화면 이름<input value={product.name} readOnly /></label>
            <label className="ap-field">티커<input value={product.ticker} readOnly /></label>
            <label className="ap-field">
              정가 (원, 10원 단위)
              <input name="base_price_won" inputMode="numeric" required defaultValue={product.base_price_won} />
              <small>다음 가격 계산부터 이 정가로 할인을 계산해요. 이미 나온 가격은 그대로예요.</small>
            </label>
          </div>
        </section>

        <section className="ap-box">
          <div className="ap-box__h"><h2>Cafe24 연결</h2><span>비우면 가격 반영과 쿠폰 발급이 멈춰요</span></div>
          <div className="ap-fields">
            <label className="ap-field">
              상품번호
              <input name="cafe24_product_no" inputMode="numeric" defaultValue={product.cafe24_product_no ?? ""} />
            </label>
          </div>
        </section>

        <section className="ap-box">
          <div className="ap-box__h"><h2>네이버 검색어</h2><span>한 줄에 하나 · 최대 20개 · 지금 {product.keywords.length}개</span></div>
          <label className="ap-field">
            <span className="sr-only">검색어</span>
            <textarea name="keywords" required defaultValue={product.keywords.join("\n")} />
            <small>바꾸면 검색지수가 새 검색어 묶음으로 다시 정규화돼요. 전날과 비교가 한 번 튈 수 있어요.</small>
          </label>
        </section>

        <section className="ap-box">
          <label className="ap-check">
            <input type="checkbox" name="active" defaultChecked={product.active} />
            판매 중
          </label>
          <p className="ap__note" style={{ margin: 0 }}>끄면 다음 가격 계산부터 빠지고 시세 목록에서 사라져요. 이미 받은 쿠폰과 잠금은 그대로 유효해요.</p>
        </section>

        <div className="ap-actions">
          <Link href="/admin/products" className="ap-btn ap-btn--ghost">취소</Link>
          <button type="submit" className="ap-btn">저장</button>
        </div>
      </form>
    </main>
  );
}
