import { randomBytes } from "node:crypto";
import { cafe24Request } from "@/lib/cafe24/client";

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

/** 추측할 수 없는 코드. Cafe24 는 1~35자를 받는다. */
export function makeDiscountCode() {
  return `MJ${randomBytes(7).toString("hex").toUpperCase()}`;
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
  const created = await cafe24Request<{ discountcode?: { discount_code_no?: string } }>(
    "/api/v2/admin/discountcodes",
    {
      method: "POST",
      body: JSON.stringify({
        request: {
          discount_code_name: name,
          discount_code: code,
          discount_value_unit: "W", // 정액
          discount_value: amountWon,
          discount_truncation_unit: "T", // 10원 단위
          available_start_date: toCafe24Time(validFrom),
          available_end_date: toCafe24Time(validUntil),
          available_product_type: "P",
          available_product: [cafe24ProductNo],
          // rabbit3456 운영 정책: 자사몰 회원가입·로그인 후 쿠폰번호 등록
          available_user: "M",
          available_issue_count: 1,
        },
      }),
    },
  );
  return { code, codeNo: created.discountcode?.discount_code_no ?? null };
}
