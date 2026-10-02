import Link from "next/link";
import type { AdminProduct } from "@/lib/admin/data";
import { Cafe24Field } from "./Cafe24Field";

/* 빵 추가·수정이 같이 쓰는 폼. product 가 없으면 추가다. */
export function ProductForm({ product, action }: { product?: AdminProduct; action: (formData: FormData) => Promise<void> }) {
  const isNew = !product;
  return (
    <form action={action} className="ap-form">
      <div className="ap-grid2">
        <div className="ap-form">
          <section className="ap-box">
            <div className="ap-box__h"><h2>기본 정보</h2>{isNew ? null : <span>티커는 바꿀 수 없어요 (잠금·링크가 티커로 이어져 있어요)</span>}</div>
            <div className="ap-fields">
              <label className="ap-field">
                화면 이름
                <input name="display_name" required maxLength={30} defaultValue={product?.display_name ?? ""} placeholder="예: 휘낭시에" />
              </label>
              <label className="ap-field">
                티커 (영문 3자)
                <input
                  name="ticker"
                  required={isNew}
                  readOnly={!isNew}
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  defaultValue={product?.ticker ?? ""}
                  placeholder="예: BAG"
                  style={{ textTransform: "uppercase" }}
                />
              </label>
              <label className="ap-field" style={{ gridColumn: "1 / -1" }}>
                상세 이름 (몰 상품명)
                <input name="full_name" required maxLength={80} defaultValue={product?.full_name ?? product?.name ?? ""} placeholder="예: 겉바속쫀 막지 글루텐프리 휘낭시에" />
              </label>
              <label className="ap-field">
                정가 (원, 10원 단위)
                <input name="base_price_won" inputMode="numeric" required defaultValue={product?.base_price_won ?? ""} />
                <small>다음 가격 계산부터 이 정가로 할인을 계산해요.</small>
              </label>
            </div>
          </section>

          <section className="ap-box">
            <div className="ap-box__h"><h2>Cafe24 연결</h2></div>
            <Cafe24Field defaultValue={product?.cafe24_product_no ?? null} basePriceWon={product?.base_price_won} />
            <label className="ap-field">
              자사몰 상품 주소 (선택)
              <input name="shop_url" type="url" defaultValue={product?.shop_url ?? ""} placeholder="https://makji.kr/product/..." />
              <small>손님 구매 버튼이 가는 곳이에요. 비우면 자사몰 첫 화면으로 가요.</small>
            </label>
          </section>

          <section className="ap-box">
            <div className="ap-box__h"><h2>네이버 검색어</h2><span>한 줄에 하나 · 최대 20개{product ? ` · 지금 ${product.keywords.length}개` : ""}</span></div>
            <label className="ap-field">
              <span className="sr-only">검색어</span>
              <textarea name="keywords" required defaultValue={product?.keywords.join("\n") ?? ""} placeholder={"막지 휘낭시에\n글루텐프리 휘낭시에"} />
              <small>바꾸면 검색지수가 새 검색어 묶음으로 다시 정규화돼요. 전날과 비교가 한 번 튈 수 있어요.</small>
            </label>
          </section>
        </div>

        <div className="ap-form">
          <section className="ap-box">
            <div className="ap-box__h"><h2>사진</h2><span>JPG·PNG·WEBP · 4MB 까지</span></div>
            {product?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage 공개 주소·로컬 경로가 섞여 있어 그대로 보여준다
              <img src={product.photo_url} alt={`${product.display_name ?? product.name} 지금 사진`} className="ap-photo" />
            ) : null}
            <label className="ap-field">
              {product?.photo_url ? "바꿀 사진" : "사진"}
              <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required={isNew} />
              <small>실제 촬영본을 올려 주세요. 목록에서는 가운데를 가까이 크롭해요.</small>
            </label>
          </section>

          <section className="ap-box">
            <label className="ap-check">
              <input type="checkbox" name="active" defaultChecked={product ? product.active : true} />
              판매 중
            </label>
            <p className="ap__note" style={{ margin: 0 }}>
              {isNew
                ? "판매 중으로 저장해도 첫 가격 계산(다음 05:30 오전가 또는 15:00 오후가)이 끝나야 시세 목록에 나와요."
                : "끄면 다음 가격 계산부터 빠지고 시세 목록에서 사라져요. 이미 받은 쿠폰과 잠금은 그대로 유효해요."}
            </p>
          </section>

          <div className="ap-actions">
            <Link href="/admin/products" className="ap-btn ap-btn--ghost">취소</Link>
            <button type="submit" className="ap-btn">{isNew ? "빵 추가" : "저장"}</button>
          </div>
        </div>
      </div>
    </form>
  );
}
