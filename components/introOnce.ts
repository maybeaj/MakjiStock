/* 스플래시·온보딩은 새로고침할 때마다 보여주되, Next 가 스스로 문서를 다시
   불러온 경우에는 건너뛴다.

   Next 는 클라이언트 이동 중 RSC 요청이 실패하면(200 이 아님·네트워크 오류·
   배포가 바뀌어 빌드 id 가 다름) 그 주소로 문서를 통째로 다시 연다
   (next/dist/client/components/router-reducer/fetch-server-response.js
   doMpaNavigation). 사용자에게는 MY 탭을 눌렀는데 스플래시가 뜨는 것으로 보인다.

   사용자가 직접 한 새로고침은 navigation type 이 "reload" 라 구분된다.
   그 밖의 로드는 이 탭에서 이미 한 번 봤으면 건너뛴다.

   같은 문서 안에서 이미 본 것은 새로고침이어도 다시 띄우지 않는다. / 가 스플래시를
   보여준 뒤 /market 으로 클라이언트 이동하면, 문서의 navigation type 은 여전히
   "reload" 일 수 있다. 모듈 변수는 문서가 살아 있는 동안만 남는다. */
const seenInThisDocument = new Set<string>();

export function shouldShowIntro(key: string) {
  if (seenInThisDocument.has(key)) return false;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === "reload") return true;
    return sessionStorage.getItem(key) === null;
  } catch {
    return true;
  }
}

export function markIntroSeen(key: string) {
  seenInThisDocument.add(key);
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // 저장소를 쓸 수 없으면 다음 로드에서 한 번 더 보일 뿐이다.
  }
}
