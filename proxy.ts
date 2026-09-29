import type { NextRequest } from "next/server";

/* /admin 잠금 — 관리자 로그인이 생기기 전까지 쓰는 브라우저 기본 인증.
   아이디는 아무거나, 비밀번호는 ADMIN_PASSWORD. 값이 없으면 누구도 못 연다.
   ponytail: 비밀번호 하나를 같이 쓴다. 관리자가 여럿이 되면 Supabase Auth 로 바꾼다. */

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  const header = request.headers.get("authorization") ?? "";
  if (password && header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (sameText(given, password)) return;
  }
  return new Response("관리자 비밀번호가 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="makji-admin", charset="UTF-8"' },
  });
}

export const config = {
  matcher: "/admin/:path*",
};
