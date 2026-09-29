import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrCreateVisitorHash } from "@/lib/visitor";

export const dynamic = "force-dynamic";

/* 방문 기록 — PRD §21

   POST /api/events  { name: "page_view", path: "/market" }

   재방문율을 보려면 "같은 브라우저가 언제 들어왔나" 가 날짜별로 쌓여야 한다.
   Vercel Analytics 는 방문 수만 세고 사람을 잇지 않는다. 그래서 여기서
   익명 쿠키(해시만 저장)를 발급하고 events 에 한 줄씩 남긴다.
   집계 SQL 은 supabase/snippets/retention.sql.

   이름은 허용 목록만 받는다. 이메일·쿠폰번호 같은 값은 받지 않는다.
   ponytail: 지금은 page_view 하나. 클릭·구매 이벤트는 붙일 때 목록에 더한다. */
const ALLOWED = new Set(["page_view"]);

export async function POST(request: Request) {
  let body: { name?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  if (!ALLOWED.has(name)) return Response.json({ error: "허용되지 않은 이벤트입니다." }, { status: 400 });
  // 경로만 받는다. 쿼리(UTM 등)는 버린다 — 개인정보가 섞일 수 있다.
  const path = typeof body.path === "string" && body.path.startsWith("/") ? body.path.split("?")[0].slice(0, 200) : null;

  const visitorHash = await getOrCreateVisitorHash();
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin().from("events").insert({
    id: randomUUID(),
    visitor_hash: visitorHash,
    event_name: name,
    occurred_at: now,
    path,
    source: "client",
  });
  if (error) return Response.json({ error: error.message }, { status: 502 });

  return new Response(null, { status: 204 });
}
