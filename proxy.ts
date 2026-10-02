import type { NextRequest } from "next/server";
import { isAdminAuthorization } from "@/lib/admin/auth";

export function proxy(request: NextRequest) {
  if (isAdminAuthorization(request.headers.get("authorization"))) return;
  return new Response("관리자 비밀번호가 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="makji-admin", charset="UTF-8"' },
  });
}

export const config = {
  matcher: "/admin/:path*",
};
