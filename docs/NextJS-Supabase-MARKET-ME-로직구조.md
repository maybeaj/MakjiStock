# MAKJI STOCK MARKET·ME 로직 구현 구조

- 문서 상태: v2.0 — 실제 구현 반영
- 기준일: 2026-09-28
- 대상 구현: Next.js App Router + Supabase (배포된 코드 기준)
- 원본 로직 참고: `프로토타입_1차_3팀.html` (1·2절의 원본 함수 매핑은 이 프로토타입 기준)

> 이 문서는 원래 Next.js·Supabase 전환 **전**, 저장소가 vinext/D1 스타터였던 2026-09-16에 쓴 목표 구조 초안이었다. 그 뒤 실제 구현은 초안과 다른 방향으로 결정됐다 — 지정가 알림(이메일 목표가 알림)은 기획에서 삭제되고 **가격 잠금**으로 대체됐고, "내일 총할인율 1위 상품 예측"은 **UP/DOWN 방향 예측**(안정형·공격형)으로 바뀌었으며, 화면 이름 `ME`는 **MY**가 됐다. 이번 개정(v2.0)은 그 이후 실제로 동작하는 코드를 기준으로 전체를 다시 썼다.
>
> 기준이 어긋나면 [PRD-브레드마켓.md](PRD-브레드마켓.md)가 우선한다. 화면·산식 요약은 [README.md](../README.md), 산식 변경 이력은 [산식-버전.md](산식-버전.md), 잠금·예측 범위를 줄인 이유는 [가격-잠금-1회-사유.md](가격-잠금-1회-사유.md)·[매수가-기준-예측-제외-사유.md](매수가-기준-예측-제외-사유.md)에 있다.

## 1. 기준과 제외 범위

이 문서는 첨부 화면의 배치나 화면 전환 순서를 옮긴 문서가 아니다. 원본 HTML에서 `MARKET`과 `MY`가 실제로 의존하는 계산 함수, 상태 변경, 이벤트 호출 순서를 뽑아 서버 기반 웹앱 구조로 옮긴 구현 명세다.

가져오지 않는 기능:

- `HOME`, `EVENT`, `DOGAM` 화면과 원본 4탭 내비게이션
- 빵 도감, 씰, 배지, 스탬프, 운세, 빵 자르기, 영수증 인증
- 앱 내부 쿠폰함
- 클라이언트 난수로 가격과 결과를 만드는 데모 로직
- 지정가 알림(이메일 목표가 알림) — 기획 단계에서 삭제되고 가격 잠금으로 대체됨(`supabase/schema.sql` 머리말 주석)
- 구매가(내 매수가) 기준 예측 — Cafe24 주문과 방문자를 잇는 다리가 없어 1차 범위 밖([매수가-기준-예측-제외-사유.md](매수가-기준-예측-제외-사유.md))
- 예측 제출 후 "다시 고르기"(수정) — 스토리 공유 검증을 전제로 한 회차당 1회 수정권으로 도입 예정이며 아직 미구현(PRD §24, `components/bread-market/sheets.tsx`)

실제로 구현한 기능:

- 오늘 시세와 막지지수(6종 판매가를 정가 100 기준으로 환산한 평균)
- 91일 지수 추이, 마켓 목록의 9/24부터 세션별(오전·오후) 시세 스파크라인, 상세 시트의 최근 14일 오전·오후가 추이
- 급등주(전일 대비 검색지수 상승폭 1위)
- 상품 정렬(할인 많은 순·가격 순·이름 순)과 상품 상세 시트
- Cafe24 상품 이동(데모몰/자사몰 전환)
- 가격 잠금(오전장에 하루 1회·빵 1개, 오후가가 오르면 차액 쿠폰)
- 가격 방향(UP/DOWN) 예측 — 안정형(즉시 확정 보상)과 공격형(다음 날 결과 확인) 중 하루 한 번 택1
- MY의 잠금·예측·쿠폰 상태

## 2. 원본 HTML에서 추출한 실행 의존 순서

원본 `boot()`는 앱 전체 기능을 한꺼번에 렌더링한다. MARKET·MY만 남긴 실서비스의 의존 순서는 다음과 같다.

```text
상품 기준정보
  ↓
날짜·세션·환율·검색지수 입력
  ↓
calculateDay(product, session)   [lib/pricing/pricing.mjs]
  ├─ 검색지수 절댓값 쿠폰(0~15%p)
  ├─ 환율 하락·상승 양방향 전부 반영(±28%p, v1.4)
  ├─ 상품 할인 0~25%(discountCapPct)·정가 초과 없음
  └─ 10원 단위 판매가
  ↓
daily_prices 조회(기간·세션)
  ↓
MARKET 집계 [lib/bread-market/market-data.ts]
  ├─ 오늘 막지지수와 전일 변화
  ├─ 91일 지수 추이
  ├─ 급등주(검색지수 상승폭 1위)
  └─ 상품 6종과 최근 가격
  ↓
사용자 행동
  ├─ 정렬 변경(클라이언트만)
  ├─ 상품 상세 시트(이미 받은 시세로 즉시 렌더)
  │    ├─ 최근 14일 오전·오후가
  │    ├─ 검색쿠폰·환율 조정 분해
  │    ├─ 가격 잠금
  │    └─ Cafe24 구매 이동
  └─ 가격 방향 예측 제출(안정형 즉시 수령 또는 공격형 내일 판정)
       ↓
매일 02:00·05시대·15:00 서버 작업
  ├─ 02:00 Cafe24 가격 정가 복귀
  ├─ 05시대 수집·계산·Cafe24 반영(오전가)
  ├─ 15:00 수집·계산·Cafe24 반영(오후가)
  ├─ 오후가 확정 시 잠금 차액 쿠폰 자동 발급
  └─ 오전가 확정 시 전날 예측 판정
       ↓
MY 조회 (서버 렌더에서 직접 읽음, 별도 API 없음)
  ├─ 가격 잠금 상태
  ├─ 예측 대기·적중·미적중 기록
  └─ 쿠폰(할인코드) 상태
```

### 2.1 원본 함수와 실서비스 대응

| 원본 HTML 함수 | 원본 역할 | 실서비스 대응 |
|---|---|---|
| `quote(bread, key)` | 데모 환율·검색값으로 가격 계산 | `calculateDay()`(`lib/pricing/pricing.mjs`), 크론이 `daily_prices`에 저장 |
| `series(bread, off, len)` | 과거 N일 가격 생성 | `daily_prices` 기간 조회 + `lib/bread-market/engine.ts`의 `sessionSeries()` |
| `indexOf_(key)` | 6종 가격지수 계산 | `loadMarketData()`의 `indexSeries`(서버 계산, 클라이언트 재계산 없음) |
| `sortedBreads()` | 현재 배열 정렬 | `MarketPanel.tsx`가 받은 배열을 브라우저에서 정렬 |
| `renderMarket()` | 상품 6종과 미니 차트 | `(bread)/market/page.tsx` + `MarketPanel.tsx` |
| `renderDash()` | 91일 막지지수 | `MarketPanel.tsx`의 `IndexDash` |
| `openDetail(tk)` | 상세·차트·할인 분해 | `sheets.tsx`의 `DetailSheet`(별도 API 없이 이미 로드된 시세로 렌더) |
| `openAlert(tk)` / `bindAlert()` | 목표가·이메일 입력(지정가 알림) | 삭제됨 → `sheets.tsx`의 `LockSheet`, `POST /api/locks` |
| `showAlertReached()` | 도달 데모(지정가 알림) | 삭제됨 → 오후가 확정 시 `issueLockCodes()`가 차액 쿠폰 자동 발급 |
| `openPredict()` | UP/DOWN 데모 예측 | `sheets.tsx`의 `PredictSheet`(공격형, `POST /api/predictions`) / `MarketPanel.tsx`의 바로 받기(안정형, `POST /api/predictions/instant`) |
| `renderAlerts()` | 지정가 상태 목록 | 삭제됨 → `MyPanel.tsx`의 잠금 카드 |
| `renderPreds()` | 예측 기록 목록 | `MyPanel.tsx`의 예측 기록, `HistorySheet` |

`renderHero()`는 HOME 함수지만 `mktIdx`, `mktDelta`도 갱신한다. 실서비스에서는 HOME을 가져오지 않고 `MarketPanel`이 오늘 지수와 전일 대비 값을 직접 계산해 보여준다.

원본 확인 위치(원본 HTML 기준, 변경 없음):

- MARKET DOM: 1628~1685행
- ME DOM 중 필요한 상태 영역: 1744~1752행
- 가격·시계열·지수: `quote()` 2026행, `series()` 2055행, `indexOf_()` 2063행
- MARKET 실행: `sortedBreads()` 2492행부터 `renderPredEntry()` 2661행
- 상품 예측 데모: `openPredict()` 2727행
- 지정가 알림: `openAlert()` 3292행, `bindAlert()` 3317행
- ME 상태: `renderAlerts()` 3467행, `renderPreds()` 3484행
- 전체 데모 부팅: `boot()` 3505행

## 3. 요청과 상태 변경의 전체 실행 순서

### 3.1 MARKET 최초 진입

첫 화면은 `/market`이 아니라 `/`다. `/`(`app/page.tsx`)는 스플래시(`components/Splash.tsx`) → 온보딩(`components/Onboarding.tsx`)을 보여주고 끝나면 `router.replace("/market")`으로 넘어간다. `(bread)/layout.tsx`의 `SplashGate`·`OnboardingGate`(`components/SplashGate.tsx`, `OnboardingGate.tsx`)는 `/market`·`/me`에 직접 들어온 경우에도 같은 문서에서 이미 본 것이면 다시 띄우지 않는다(`components/introOnce.ts` — 브라우저 새로고침 때만 보여주고, Next가 문서를 다시 여는 경우는 건너뜀).

1. 브라우저가 `/market`을 요청한다(직접 진입이든 온보딩 뒤 이동이든).
2. Server Component(`app/(bread)/market/page.tsx`)가 `loadShellData()`(`lib/bread-market/page-data.ts`)를 호출한다.
3. `loadShellData()`는 시세(`loadMarketData`), 이 브라우저의 가격 잠금(`loadLock`), 예측 기록(`loadPredictions`), 바로 받기 쿠폰(`loadInstantRewards`)을 한 번에 병렬로 모은다. 하나가 실패해도 나머지는 그대로 그린다.
4. `visitor_token` 쿠키는 이 시점에 발급되지 않는다. 조회는 `readVisitorHash()`(`lib/visitor.ts`)를 쓰는데, 쿠키가 없으면 그냥 빈 값을 돌려준다. 쿠키는 잠금·예측·바로 받기처럼 **쓰기 동작을 처음 호출할 때만** `getOrCreateVisitorHash()`가 발급한다(32바이트 난수, HttpOnly, `SameSite=Lax`, 1년, `Secure`는 프로덕션에서만).
5. MARKET을 렌더링한다.

분석 이벤트(`page_view` 등)는 보내지 않는다. `events` 테이블은 `supabase/schema.sql`에 정의돼 있지만 실제로 쓰는 코드는 아직 없다 — 분석 이벤트 전체가 미구현이다.

`GET /api/market`(`app/api/market/route.ts`)은 같은 `loadMarketData()`를 감싼 얇은 라우트로 남아 있다. 화면은 이 라우트를 부르지 않고 서버 렌더에서 직접 함수를 호출한다 — API는 외부에서 값을 들여다보기 위한 보조 경로다. querystring으로 기간을 바꿀 수 없고, 91일 고정이다.

```json
{
  "source": "supabase",
  "latestDate": "2026-09-28",
  "days": 5,
  "products": [{ "id": "morning_roll", "ticker": "MRL", "name": "막지 제로 모닝롤", "basePriceWon": 4500 }],
  "quotes": [
    {
      "ticker": "MRL",
      "publishDate": "2026-09-28",
      "session": "am",
      "searchRatio": 55,
      "searchDiscountPct": 5.5,
      "fxDeclinePct": 0.546,
      "fxDiscountPct": 7.644,
      "discountPct": 13.144,
      "basePriceWon": 4500,
      "priceWon": 3910,
      "fxCurrentDate": "2026-09-27"
    }
  ],
  "indexSeries": [{ "publishDate": "2026-09-28", "session": "am", "index": 88.7, "products": 6 }]
}
```

### 3.2 MARKET 정렬

원본의 `sortedBreads() → renderMarket()` 흐름을 그대로 유지한다. 서버 요청은 다시 하지 않는다.

1. 초기 응답의 상품 6종을 메모리에 둔다(`MarketPanel.tsx`의 `rows`).
2. 사용자가 정렬 기준(`할인 많은 순`·`가격 순`·`이름 순`)을 선택한다.
3. `할인 많은 순`은 정가 대비 할인율, `가격 순`은 오늘 가격 내림차순, `이름 순`은 한글 상품명 기준으로 정렬한다.
4. 정렬은 표시 순서만 바꾸며 확정 가격과 예측 기준에는 영향을 주지 않는다.

### 3.3 상품 상세

원본의 호출 관계는 `상품 행 클릭 → openDetail(ticker)`다. 실서비스는 이미 받은 시세로 즉시 렌더하며, 별도 API를 호출하지 않는다(`/api/products/[id]` 같은 라우트는 없다).

1. `sheets.tsx`의 `DetailSheet`가 열린다.
2. `lib/bread-market/engine.ts`의 `quoteAt()`·`changeAt()`·`sessionSeries()`가 이미 로드된 `daily_prices` 데이터에서 오늘 가격, 직전 확정가 대비 등락, 최근 14일 오전·오후가 추이를 계산한다.
3. 정가 대비 할인율, 직전 확정가 대비 변화율(원·%), 환율 조정 중간가를 보여준다. 정가 시간에는 할인율을 보여주지 않고 "정가 시간"만 표시한다.
4. 사용자는 가격 잠금(오전장에만 활성화) 또는 Cafe24 구매 이동을 선택한다.

### 3.4 Cafe24 구매 이동

브라우저가 Cafe24 URL로 직접 이동하지 않고 서버 리다이렉트를 거친다.

```text
구매 버튼 클릭
→ GET /api/out/cafe24/{ticker 또는 productId}
→ SHOP_TARGET 환경변수로 목적지 결정
    demo (기본) config/cafe24-product-map.json 의 데모몰 상품
    live        products.shop_url 의 실제 자사몰 상품
→ 302 응답
```

리다이렉트 API는 클라이언트가 전달한 임의 URL을 쓰지 않는다. `products` 테이블의 상품번호·URL로 목적지를 조립해 오픈 리다이렉트를 막는다. 클릭 이벤트(`purchase_link_click`)는 현재 기록하지 않는다 — 3.1의 분석 이벤트 미구현과 같은 이유다.

### 3.5 가격 잠금

원본의 지정가 알림(`openAlert()`/`bindAlert()`)은 삭제됐다. 오전장에 빵 하나의 오전가를 잠그는 기능으로 대체됐다([가격-잠금-1회-사유.md](가격-잠금-1회-사유.md)).

1. 오전장(06:00~15:59)에만 잠금을 받는다. 정가 시간과 오후장에는 받지 않는다 — 다음 가격이 정해져 있거나 이미 지난 시간이라 보호할 불확실성이 없다.
2. 주말은 받지 않는다 — 외환시장이 쉬어 오후가가 나오지 않고, 그러면 비교할 값도 차액 쿠폰도 없다.
3. 사용자가 `LockSheet`에서 상품을 선택하면 `POST /api/locks`를 호출한다.
4. 잠금가는 클라이언트가 보내지 않는다. 서버가 `daily_prices`에서 그 시점 오전가를 읽어 그대로 잠근다.
5. `(visitor_hash, lock_date)` 유니크 제약으로 하루 1회·빵 1개만 저장한다. 해지해도 그날 잠금권은 복구되지 않는다.
6. 이메일 인증은 없다. 잠금 자체는 저장 즉시 `active`다.
7. 오후가가 이미 나와 있으면 그 자리에서 차액 쿠폰을 바로 발급한다. 아직이면 15:00 크론이 오후가를 확정할 때 자동 발급한다(`issueLockCodes()`).
8. 오후가가 잠금가보다 높으면 차액만큼 Cafe24 할인코드를, 낮으면 코드 없이 더 싼 현재가로 구매하면 된다.

```http
POST /api/locks
Content-Type: application/json

{ "ticker": "MRL" }
```

```json
{
  "lock": {
    "id": "uuid",
    "product_id": "morning_roll",
    "lock_session": "am",
    "locked_price_won": 3910,
    "protect_from": "2026-09-28T16:00:00+09:00",
    "protect_until": "2026-09-29T01:59:59+09:00",
    "status": "active"
  },
  "protectLabel": "오늘 16:00–새벽 01:59"
}
```

오류는 `상품을 찾을 수 없습니다`(404), 잠금 가능 시간이 아님·주말·오늘 이미 사용(409)으로 구분한다.

### 3.6 가격 방향 예측

원본의 UP/DOWN 데모(`openPredict()`)와 개념은 같지만 "내일 총할인율 1위" 방식은 쓰지 않는다. 지금 확정가 대비 다음 확정가의 방향을 맞힌다.

1. 정가 시간(00~05시)에는 예측·바로 받기 모두 막는다.
2. 참여 전에는 두 선택지를 보여준다 — **안정형**(그 자리에서 회차 보상률을 받고 예측을 포기, `POST /api/predictions/instant`)과 **공격형**(방향을 걸고 다음 날 결과를 확인, `sheets.tsx`의 `PredictSheet` → `POST /api/predictions`).
3. 하루 한 번, 둘 중 하나만 쓸 수 있다 — 안정형을 받았으면 예측이 막히고, 예측을 걸었으면 안정형을 받을 수 없다(`reward_claims`·`prediction_entries`의 `(round_id, visitor_hash)` 유니크가 DB에서 강제).
4. 기준가는 클라이언트가 보내지 않는다. 서버가 제출 시점의 확정가(`daily_prices`)를 읽는다.
5. 라운드는 그날의 첫 제출 때 만든다(`prediction_rounds` upsert). 별도로 라운드를 여는 크론이 없다.
6. 판정은 제출 시각과 무관하게 항상 **다음 날 06:00 오전가**다. 방향이 맞으면 적중, 틀리면 미적중(보상 0), 가격이 같으면 무효(보상은 지급)로 판정한다(`resolveDirection()`).
7. 공격형 보상률(5~13%)은 제출 시점에 뽑아 저장한다 — 제출 전에는 보여주지 않는다. 안정형 보상률(오전 7~10%·오후 5~7%)은 회차·세션으로 결정론적으로 정해져 고르기 전에도 화면에 보인다.
8. 제출한 예측은 바꿀 수 없다. "다시 고르기"는 향후 스토리 공유 검증을 통과한 사람에게 회차당 1회 방향 수정 기회로 도입할 예정이며 아직 구현하지 않았다.

```http
POST /api/predictions
Content-Type: application/json

{ "ticker": "MRL", "direction": "up" }
```

```json
{
  "entry": {
    "id": "uuid",
    "product_id": "morning_roll",
    "direction": "up",
    "reference_price_won": 3910,
    "target_publish_date": "2026-09-29",
    "target_session": "am",
    "result": "pending"
  },
  "targetLabel": "9/29 06:00 오전가",
  "rewardOnHitPct": 9
}
```

오류는 `direction 은 up 또는 down 이어야 합니다`(400), 상품 없음(404), 정가 시간·오늘 가격 미확정·이미 참여(409)로 구분한다.

### 3.7 MY 진입

MY는 계정 화면이 아니라 현재 브라우저 쿠키에 연결된 상태 조회다(원본 문서의 `ME`에 해당, 화면 이름만 MY로 바뀌었다).

1. 브라우저가 `/me`를 요청한다.
2. Server Component(`app/(bread)/me/page.tsx`)가 `loadShellData()`를 직접 호출한다 — 3.1의 MARKET과 같은 함수를 쓴다. 별도의 `GET /api/me`는 없다.
3. `readVisitorHash()`로 쿠키를 읽고, 없으면(한 번도 잠금·예측·바로 받기를 하지 않은 방문자) 빈 상태를 보여준다.
4. `MyPanel.tsx`가 잠금 카드 → 구매 → 예측 기록 → 할인코드 순서로 보여준다.
5. `GET /api/locks`, `GET /api/predictions`는 같은 값을 외부에서 들여다보기 위한 보조 라우트로 남아 있다. 화면은 부르지 않는다.

MY에서 도감·씰 통계·진척도·앱 내부 쿠폰함은 처음부터 없다. 잠금·예측·쿠폰 상태만 있다.

### 3.8 매일 서버 작업

`vercel.json`의 크론(스케줄은 UTC, 아래는 KST)이 하루를 돌린다.

```text
02:00 /api/internal/reset-list-price
  └─ Cafe24 판매가를 정가로 복귀. 02:00~05:59는 정가 시간
  ↓
05:30 /api/internal/daily-pricing?session=am
  ├─ Naver 검색지수(상품별 독립 호출) + ECOS 원/달러 시가·종가 수집
  ├─ 6종 할인율·판매가 계산(lib/pricing/pricing.mjs)
  ├─ daily_prices upsert(product_id, publish_date, price_session, formula_version 유니크)
  └─ Cafe24 PUT 반영(commit 모드)
  ↓
06:00~10:00 (매시) /api/internal/daily-pricing?session=am&onlyIfMissing=1
  └─ 검색지수가 아직 안 올라와 보류(held)된 상품만 다시 계산 — 이미 확정된 상품은 건드리지 않는다
  ↓
오전가 확정 시점마다: 전날 예측 판정(resolvePredictions) — 다음 날 06:00 오전가가 나오는 순간이 판정 시점
  ↓
15:00 /api/internal/daily-pricing?session=pm
  ├─ 당일 원/달러 시가 + 직전 두 영업일 종가로 오후가 계산
  ├─ daily_prices 저장, Cafe24 반영
  └─ 오전 잠금자의 차액 쿠폰 자동 발급(issueLockCodes)
```

이 흐름은 문서 초안에 있던 `job_runs` 동시성 잠금이나 "AM 잠금 획득" 같은 별도 락 메커니즘을 쓰지 않는다. `job_runs`는 실행 이력을 남기는 감사 로그일 뿐이고, 재시도 안전성은 `daily_prices`의 `(product_id, publish_date, price_session, formula_version)` 유니크 제약과 upsert로 확보한다 — 같은 조합은 몇 번을 다시 실행해도 덮어써질 뿐 중복 행이 생기지 않는다.

주말에도 크론은 돈다. 검색지수는 매일 반영하고, 환율만 외환시장이 쉬어 금요일 종가로 이월한다. 당일 시가가 없는 날(주말 등)은 오후가 계산을 보류하고 오전 확정가를 그대로 유지한다.

Cafe24 반영이 실패한 상품은 `daily_prices.cafe24_apply_status`가 `failed`로 남고 화면 가격(계산값)과 몰의 실제 판매가가 다를 수 있다. 이 상태를 자동으로 재시도하지는 않는다.

## 4. 실제 파일 구조

```text
app/
  layout.tsx
  page.tsx                              # 스플래시 → 온보딩, 끝나면 /market 으로 replace
  (bread)/
    layout.tsx                          # SplashGate → OnboardingGate
    market/page.tsx
    me/page.tsx
  api/
    market/route.ts                     # 보조 라우트. 화면은 직접 호출하지 않음
    locks/route.ts
    predictions/route.ts
    predictions/instant/route.ts
    out/cafe24/[productId]/route.ts
    auth/cafe24/start/route.ts
    auth/cafe24/callback/route.ts
    internal/
      daily-pricing/route.ts
      reset-list-price/route.ts
      sync-products/route.ts

components/
  Splash.tsx
  SplashGate.tsx
  Onboarding.tsx
  OnboardingGate.tsx
  introOnce.ts
  useHydrated.ts
  bread-market/
    Shell.tsx                           # 탭 셸, 토스트(4.5초)
    context.ts                          # SheetState, useBreadMarket
    MarketPanel.tsx
    MyPanel.tsx
    sheets.tsx                          # DetailSheet, LockedDetailSheet, LockSheet, PredictSheet, HistorySheet
    RollingNumber.tsx

lib/
  visitor.ts                            # visitor_token 발급·HMAC 해시
  crypto.ts                             # 이메일·쿠폰 코드 암호화
  market/
    calendar.ts                         # kstNow, 세션 판정
  supabase/
    admin.ts                            # service role client
  bread-market/
    engine.ts                           # quoteAt, changeAt, sessionSeries, 막지지수
    flow.ts                             # lockPhaseOf
    market-data.ts                      # loadMarketData
    page-data.ts                        # loadShellData(시세·잠금·예측·바로받기 한 번에)
    reward-policy.ts                    # 보상률·쿠폰 금액·세션 판정 순수 함수
    store.ts                            # 클라이언트 상태(useBreadState, useSession)
    visitor-data.ts                     # loadLock, loadPredictions, loadInstantRewards
  pricing/
    pricing.mjs                         # 산식 코어. 앱·백테스트가 공유
    dates.mjs / time.mjs
    fx.mjs                              # ECOS 환율
    naver.mjs                           # Naver 검색지수
    daily-job.ts
    current-price.ts
    variant-pricing.ts                  # 옵션가 반영
  predictions/
    schedule.ts
    resolve.ts
  locks/
    lock-codes.ts
  rewards/
    discount-code.ts                    # Cafe24 정액 할인코드 발급
  cafe24/
    client.ts
    price-sync.ts

config/
  pricing-products.json                 # 상품 6종, 검색어, 산식 파라미터
  cafe24-product-map.json               # 데모몰 매핑
  cafe24-option-prices.ts               # 옵션 총 정가

supabase/
  schema.sql
  rls.sql
  seed.sql
  migrations/
    001_cafe24_tokens.sql
    002_encrypt_cafe24_tokens.sql
    003_lock_discount_codes.sql
    004_shop_url.sql
    005_no_surcharge_reward5.sql
    006_prediction_risk_reward.sql
    007_reward_claim_product.sql

backtest/                               # 운영과 같은 산식을 쓰는 독립 90일 백테스트
scripts/                                # 백필·시뮬레이션·토큰 점검
tests/                                  # node:test 단위 테스트 (tests/*.test.mjs)
```

## 5. API 구조

| Method | 경로 | 호출 주체 | DB 변경 | 역할 |
|---|---|---|---|---|
| `GET` | `/api/market` | 외부 조회용(화면은 직접 호출 안 함) | 없음 | 오늘 시세·91일 지수·상품 목록 |
| `GET` | `/api/locks` | 외부 조회용 | 없음 | 이 브라우저의 오늘 잠금 |
| `POST` | `/api/locks` | 브라우저 | 있음 | 가격 잠금(오전장 1회) |
| `GET` | `/api/predictions` | 외부 조회용 | 없음 | 이 브라우저의 예측 기록 |
| `POST` | `/api/predictions` | 브라우저 | 있음 | 공격형 예측 제출 |
| `POST` | `/api/predictions/instant` | 브라우저 | 있음 | 안정형(바로 받기) 쿠폰 발급 |
| `GET` | `/api/out/cafe24/[productId]` | 브라우저 | 없음 | Cafe24 상품 페이지로 302 이동 |
| `GET` | `/api/auth/cafe24/start` | 관리자 | 없음 | Cafe24 Admin API OAuth 시작 |
| `GET` | `/api/auth/cafe24/callback` | Cafe24 | 있음 | OAuth 토큰 저장 |
| `GET/POST` | `/api/internal/daily-pricing` | Cron(GET)/수동(POST) | 있음 | 수집·계산·Cafe24 반영·잠금 코드·예측 판정 |
| `GET/POST` | `/api/internal/reset-list-price` | Cron(GET)/수동(POST) | 있음 | 02:00 정가 복귀 |
| `GET/POST` | `/api/internal/sync-products` | 수동/Cron | 있음 | Cafe24 상품번호를 `products.cafe24_product_no`에 채움 |

`ME`용 `GET /api/me`, 상품 상세용 `GET /api/products/[id]`는 실제로 만들지 않았다 — 화면이 서버 렌더에서 `loadShellData()`를 직접 호출하므로 필요가 없었다.

내부 라우트는 `Authorization: Bearer {CRON_SECRET}` 헤더를 검사한다. 없으면 401이다.

## 6. Supabase 테이블

`supabase/schema.sql` 기준(11개 테이블, 전부 RLS 활성화 — `supabase/rls.sql`).

### 6.1 가격과 상품

- **`products`** — `id`(text pk), `ticker`, `name`, `base_price_won`, `cafe24_product_no`, `cafe24_shop_no`, `keywords`, `list_margin_pct`/`min_margin_pct`(마진 하한, 둘 다 null이면 정책 상한을 그대로 씀), `active`
- **`trend_snapshots`** — 상품·신호일별 Naver ratio. `unique(product_id, signal_date, request_start_date, request_end_date, keyword_group_version)`
- **`fx_rates`** — ECOS 원/달러 시가·종가. `primary key(rate_date, item_code)`
- **`daily_prices`** — 상품·공개일·세션별 확정가. `discount_pct between 0 and 38`(DB 제약, v1.4 실제 상한은 25), `price_won % 10 = 0`, `unique(product_id, publish_date, price_session, formula_version)`. 상태: `scheduled`~`held`, Cafe24 상태: `pending`~`failed`
- **`job_runs`** — 실행 이력 감사 로그(동시성 잠금 아님). `job_kind`, `target_date`, `price_session`, `status`, `step_log`

### 6.2 익명 방문자

- **`anonymous_visitors`** — `visitor_hash`(text pk)만 신뢰 근거. 쿠키 원문은 저장하지 않는다.

### 6.3 가격 잠금

- **`price_locks`** — `visitor_hash`, `product_id`, `lock_date`, `lock_session`, `locked_price_won`, `protect_from`/`protect_until`, `status`(`pending_verification`~`expired`), `lock_code_amount_won`, `reward_claim_id`. `unique(visitor_hash, lock_date)`로 하루 1회·빵 1개를 강제한다.

### 6.4 예측

- **`prediction_rounds`** — `id`(text pk, `${날짜}-${세션}`), `round_date`, `target_publish_date`, `target_session`, `status`, `closes_at`. `unique(round_date, target_session)`
- **`prediction_entries`** — `round_id`, `visitor_hash`, `product_id`, `direction`(`up`/`down`), `reference_price_won`, `result`(`pending`/`hit`/`miss`/`void`), `reward_rate_pct`. 1차 출시는 `role='general'`만 쓴다 — `role='buyer'`(구매 기준)는 스키마에 자리만 있고 미구현. 일반 예측은 `(round_id, visitor_hash)` 부분 유니크로 라운드당 1회.

### 6.5 보상

- **`reward_claims`** — `prediction_entry_id` 또는 `price_lock_id` 중 하나에 연결(`check` 제약). `rate_pct`, `sale_price_won_at_issue`, `amount_won`, `discount_code_hash`, `status`. 예측 쪽은 `unique(prediction_entry_id)`, 잠금 쪽은 `unique(price_lock_id)`로 각각 1회만 발급한다. 쿠폰 원문 코드는 저장하지 않고 암호문(`discount_code_ciphertext`, `lib/crypto.ts`)만 남긴다.

### 6.6 이벤트

- **`events`** — `visitor_hash`, `event_name`, `occurred_at`, `path`, `product_id`, `round_id`, `properties`. 스키마는 있지만 **쓰는 코드가 없다** — `page_view`, `product_click`, `purchase_link_click` 등 분석 이벤트는 미구현이다. 도입할 때는 이 테이블을 그대로 쓰면 된다.

## 7. RLS와 서버 경계

앱은 비로그인이므로 Supabase Auth 세션을 사용자 식별 수단으로 쓰지 않는다.

- 브라우저는 Supabase를 직접 부르지 않는다. 모든 읽기·쓰기가 Next.js Route Handler 또는 Server Component를 지나고, 서버는 `service_role` 키(`lib/supabase/admin.ts`)로 접근한다.
- `service_role`은 RLS를 통과하므로 11개 테이블 모두 RLS를 켜 두고 정책은 하나도 만들지 않는다 — `anon`·`authenticated`는 전부 차단된다(`supabase/rls.sql`).
- 소유권은 요청 본문이 아니라 HttpOnly 쿠키에서 계산한 `visitor_hash`로 확인한다.
- 내부 작업 라우트(`/api/internal/*`)는 `CRON_SECRET`을 `Authorization: Bearer` 헤더로 검사한다.

## 8. 분석 이벤트

`events` 테이블(6.6)은 스키마에 정의돼 있지만 실제로 이벤트를 쓰는 코드는 없다. 문서 초안에 있던 `page_view`·`product_click`·`price_alert_*`·`prediction_submit`·`purchase_link_click` 등 이벤트 발생 순서표는 전부 미구현 상태이므로 이번 개정에서는 현재 상태만 남기고 표는 지운다. 붙일 때는 `events` 테이블 스키마와 아래 지점을 그대로 쓰면 된다.

- `product_click`에 대응할 지점: `DetailSheet`가 열릴 때(`sheets.tsx`)
- `prediction_submit`에 대응할 지점: `POST /api/predictions`·`POST /api/predictions/instant` 저장 성공 후
- `purchase_link_click`에 대응할 지점: `GET /api/out/cafe24/[productId]`가 302를 보내기 전

## 9. 구현 상태 요약

- 1~5단계(기반 전환, 읽기 전용 MARKET, 일일 가격·Cafe24, 예측·MY, 가격 잠금)는 모두 구현·배포됐다. 문서 초안의 "구현 순서" 절은 이제 히스토리이므로 지운다.
- 남은 것은 분석 이벤트(8절)와 구매 기준 예측·예측 수정권 같은 2차 범위([PRD §24](PRD-브레드마켓.md))다.

## 10. 필수 검증 시나리오

- 첫 방문에서는 쿠키가 없다. 잠금·예측·바로 받기를 처음 누를 때만 `visitor_token`이 발급된다.
- 쿠키 원문이 DB와 로그에 저장되지 않는다.
- 6개 상품의 가격은 공개 완료(세션 시각이 지난) 행만 노출된다.
- 정렬 변경은 API 재호출이나 가격 재계산을 발생시키지 않는다.
- 상세의 "직전가 대비" 값과 "정가 대비" 값이 혼동되지 않는다.
- 가격 잠금은 오전장에만, 주말에는 받지 않는다. 하루 1회·빵 1개는 `(visitor_hash, lock_date)` 유니크가 강제한다.
- 오후가가 잠금가보다 낮으면 쿠폰 없이 더 싼 현재가로 산다.
- 한 브라우저는 하루 한 번만 예측하거나 바로 받는다 — 둘 다는 못 한다.
- 예측 정답은 총할인율 1위가 아니라 방향(UP/DOWN) 일치 여부다. 가격이 같으면 무효(보상 지급)다.
- 판정 전 MY는 `pending`, 판정 후 `hit`·`miss`·`void` 중 하나를 보여준다.
- 만료된 할인코드는 화면에 내려보내지 않는다(받았다는 기록만 남는다).
- Cafe24 구매 클릭은 허용된 상품 URL로만 이동한다(오픈 리다이렉트 방지).
- 도감·씰·이벤트 미니게임·앱 내부 쿠폰함·지정가 알림 관련 컴포넌트와 API가 없다.

## 11. 남은 정책 결정

- 예측 수정권("다시 고르기")의 스토리 공유 검증 방식([PRD §24](PRD-브레드마켓.md))
- 분석 이벤트(`events` 테이블) 도입 범위와 시점
- 구매가 기준 예측을 열 때 Cafe24 주문과 방문자를 잇는 방법
- Cafe24 반영 실패(`cafe24_apply_status = 'failed'`) 상품의 재시도·알림 정책

## 12. 구현 기준 문서

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Supabase 서버 패키지 선택](https://supabase.com/docs/guides/auth/choosing-a-server-package)
- [Supabase Database와 RLS](https://supabase.com/docs/guides/database/overview)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
