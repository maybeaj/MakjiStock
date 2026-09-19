import demoShop from "@/config/cafe24-product-map.json";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* 상품 구매 링크 — 우리 서버를 거쳐 상품 상세로 보낸다.
   주소를 화면에 박지 않는 이유는 나중에 구매 링크 이동을 events 에
   남겨야 하기 때문이다 (PRD §21). 지금은 이동만 한다.

   몰이 둘이라 어디로 보낼지 SHOP_TARGET 이 정한다.
     demo (기본) config/cafe24-product-map.json 의 rabbit3456 데모몰
     live        products.shop_url 의 막지 자사몰
   실제 자사몰로 넘길 때 코드를 고치지 않고 SHOP_TARGET 만 live 로 바꾼다.

   ticker(MRL) 와 product_id(morning_roll) 둘 다 받는다. */

export async function GET(request: Request) {
  const key = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  if (!key) return Response.json({ error: "상품이 지정되지 않았습니다." }, { status: 400 });

  const target = process.env.SHOP_TARGET === "live" ? "live" : "demo";

  /* shop_url 은 live 일 때만 읽는다. 마이그레이션 004 를 아직 안 돌린
     환경에서도 데모몰 링크는 동작해야 한다. */
  const { data, error } = await supabaseAdmin()
    .from("products")
    .select(target === "live" ? "id,ticker,cafe24_product_no,shop_url" : "id,ticker,cafe24_product_no")
    .or(`id.eq.${key},ticker.eq.${key.toUpperCase()}`)
    .eq("active", true)
    .maybeSingle<{ id: string; ticker: string; cafe24_product_no: number | null; shop_url?: string | null }>();

  if (error) return Response.json({ error: error.message }, { status: 502 });
  if (!data) return Response.json({ error: `상품을 찾을 수 없습니다: ${key}` }, { status: 404 });

  if (target === "live") {
    if (data.shop_url) return Response.redirect(data.shop_url, 302);
    // 주소가 아직 없으면 자사몰 첫 화면. 엉뚱한 상품으로 보내지 않는다.
    return Response.redirect("https://makji.kr/", 302);
  }

  /* 데모 구매 링크는 가격 동기화와 같은 수동 매핑을 직접 쓴다.
     DB 동기화 전이거나 DB 상품번호가 오래되어도 항상 rabbit3456 의
     의도한 샘플 상품으로 이동한다. */
  const demoConfig = demoShop as {
    _mallId?: string;
    map?: Record<string, { productNo: number }>;
  };
  const mallId = demoConfig._mallId ?? process.env.CAFE24_MALL_ID;
  if (!mallId) return Response.json({ error: "CAFE24_MALL_ID 가 없습니다." }, { status: 500 });
  const productNo = demoConfig.map?.[data.id]?.productNo ?? data.cafe24_product_no;
  if (!productNo) return Response.redirect(`https://${mallId}.cafe24.com/`, 302);
  return Response.redirect(
    `https://${mallId}.cafe24.com/product/detail.html?product_no=${productNo}`,
    302,
  );
}
