import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cafe24Env, cafe24RedirectUri } from "@/lib/cafe24/client";

const SCOPES = [
  "mall.read_product",
  "mall.write_product",
  "mall.read_promotion",
  "mall.write_promotion",
  // 코드 귀속 주문·구매 전환 집계(주문 동기화). 개발자센터 앱에도 같은 권한이 켜져 있어야 한다.
  "mall.read_order",
];

/* Cafe24 동의 화면으로 보낸다. state 를 쿠키에 심어 콜백에서 대조한다.
   손으로 URL 을 조립할 필요가 없어진다. */
export async function GET() {
  const { mallId, clientId } = cafe24Env();
  const state = randomBytes(16).toString("hex");

  (await cookies()).set("cafe24_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/cafe24",
    maxAge: 600,
  });

  const url = new URL(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", cafe24RedirectUri());
  url.searchParams.set("scope", SCOPES.join(","));

  return Response.redirect(url.toString(), 302);
}
