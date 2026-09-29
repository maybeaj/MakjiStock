import { randomBytes } from "node:crypto";
import { CAFE24_WRITES_ENABLED, cafe24Request } from "@/lib/cafe24/client";

/* Cafe24 할인코드 생성 — PRD §12.4
   잠금 차액과 예측 보상이 같은 API 를 쓴다. 필드 형식을 한 곳에만 둔다.

   실제 호출에서 배운 것
   - discount_code_name 은 필수다 (없으면 422)
   - 기간은 ISO 8601 + 타임존. 토큰 응답은 타임존 없는 KST 로 오지만
     요청 형식은 반대다
   - discount_value 는 숫자다. 문자열이면 거부된다
   - 요청당 1건. 버킷 40, 초당 2회 회복 */

/** 버킷 회복 속도(초당 2회)보다 느리게 보낸다. */
export const CAFE24_CALL_GAP_MS = 600;

/* 쓰기를 막는 판단은 cafe24/client.ts 가 한다. 여기서는 던지지 않고 코드 문자열만
   만들어 돌려준다 — 판정·저장·화면이 운영과 같은 경로로 흐르게 두려는 것이다. */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** 추측할 수 없는 코드. Cafe24 는 1~35자를 받는다. 운영은 MJ, 그 밖은 MJT. */
export function makeDiscountCode() {
  return `${IS_PRODUCTION ? "MJ" : "MJT"}${randomBytes(7).toString("hex").toUpperCase()}`;
}

/** Cafe24 요청용 시각. KST 벽시계에 +09:00 을 붙인다. */
export function toCafe24Time(iso: string) {
  const kst = new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  return `${kst.replace(" ", "T")}+09:00`;
}

export async function createDiscountCode({
  name,
  amountWon,
  cafe24ProductNo,
  validFrom,
  validUntil,
}: {
  name: string;
  amountWon: number;
  cafe24ProductNo: number;
  validFrom: string;
  validUntil: string;
}): Promise<{ code: string; codeNo: string | null }> {
  const code = makeDiscountCode();

  /* 몰에 만들지 않는다. 판정·저장·화면은 운영과 똑같이 흐르고 코드만 실재하지 않는다.
     codeNo 가 null 인 것이 곧 "몰에 없는 코드"라는 표시다. */
  if (!CAFE24_WRITES_ENABLED) {
    console.warn(`[discount-code] 로컬 발급 — Cafe24 호출 생략: ${code} (${name})`);
    return { code, codeNo: null };
  }

  const created = await cafe24Request<{ discountcode?: { discount_code_no?: string } }>(
    "/api/v2/admin/discountcodes",
    {
      method: "POST",
      body: JSON.stringify({
        request: {
          discount_code_name: IS_PRODUCTION ? name : `[테스트] ${name}`,
          discount_code: code,
          discount_value_unit: "W", // 정액
          discount_value: amountWon,
          discount_truncation_unit: "T", // 10원 단위
          available_start_date: toCafe24Time(validFrom),
          available_end_date: toCafe24Time(validUntil),
          available_product_type: "P",
          available_product: [cafe24ProductNo],
          /* A = 제한 없음(회원·비회원 모두). M 은 회원만이다. 관리자에서 "제한 없음"으로
             만든 코드(code1234)를 조회해 확인했다(2026-09-29). 비회원 주문서에서도 쓰게 한다. */
          available_user: "A",
          available_issue_count: 1,
        },
      }),
    },
  );
  return { code, codeNo: created.discountcode?.discount_code_no ?? null };
}
