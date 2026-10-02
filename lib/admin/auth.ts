/* /admin 잠금 — 관리자 로그인이 생기기 전까지 쓰는 브라우저 기본 인증.
   아이디는 아무거나, 비밀번호는 ADMIN_PASSWORD. 값이 없으면 누구도 못 연다.
   proxy.ts 가 화면을 막고, 서버 액션은 같은 검사를 한 번 더 한다 —
   액션은 페이지와 따로 호출될 수 있다(Next.js 문서 forms.md).
   ponytail: 비밀번호 하나를 같이 쓴다. 관리자가 여럿이 되면 Supabase Auth 로 바꾼다. */

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdminAuthorization(header: string | null) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    // 브라우저는 UTF-8 로 보낸다(charset="UTF-8"). atob 만 쓰면 한글 비밀번호가 안 맞는다.
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch {
    return false; // 깨진 헤더는 500 이 아니라 401 이어야 한다
  }
  return sameText(decoded.slice(decoded.indexOf(":") + 1), password);
}
