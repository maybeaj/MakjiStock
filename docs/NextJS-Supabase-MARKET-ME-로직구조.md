# MAKJI STOCK MARKET·ME 로직 구현 구조

- 문서 상태: Draft v1.0
- 기준일: 2026-09-16
- 대상 구현: Next.js App Router + Supabase
- 원본 로직 참고: `프로토타입_1차_3팀.html`

> 2026-09-18 갱신: 예측(3.6)·보상·가격 잠금 규칙은 [PRD v0.6](PRD-브레드마켓.md) §4.3·§4.4·§12.4·§13이 우선한다. 예측은 “내일 할인율 1위 상품”이 아니라 일반(오늘 확정가 대비)·구매자(내 매수가 대비) `UP`·`DOWN` 방식이고, 보상은 Cafe24 할인코드 API의 1회용 정액 코드다. 정가 복귀는 05:00이 아니라 00:00이다. 아래 1절의 `UP`·`DOWN` 제외 항목과 3.6·3.8의 예측 판정 흐름은 이 기준으로 읽는다.

## 1. 기준과 제외 범위

이 문서는 첨부 화면의 배치나 화면 전환 순서를 옮긴 문서가 아니다. 원본 HTML에서 `MARKET`과 `ME`가 실제로 의존하는 계산 함수, 상태 변경, 이벤트 호출 순서를 뽑아 서버 기반 웹앱 구조로 바꾼 구현 명세다.

가져오지 않는 기능:

- `HOME`, `EVENT`, `DOGAM` 화면과 원본 4탭 내비게이션
- 빵 도감, 씰, 배지, 스탬프, 운세, 빵 자르기, 영수증 인증
- 앱 내부 쿠폰함
- 클라이언트 난수로 가격과 결과를 만드는 데모 로직
- `UP`·`DOWN` 가격 방향 예측

로직 관계를 참고해 실제 서버 기능으로 교체하는 기능:

- 오늘 시세와 막지지수
- 91일 지수 추이와 상품별 최근 가격 추이
- 오늘 총할인율 1위 상품
- 상품 정렬과 상품 상세
- Cafe24 상품 이동
- 지정가 알림 등록과 도달 판정
- 내일 총할인율 1위 상품 예측
- `ME`의 지정가 알림·예측·보상 상태

## 2. 원본 HTML에서 추출한 실행 의존 순서

원본 `boot()`는 앱 전체 기능을 한꺼번에 렌더링한다. MARKET·ME만 남긴 실서비스의 의존 순서는 다음과 같다.

```text
상품 기준정보
  ↓
날짜·영업일·환율·검색지수 입력
  ↓
quote(product, date)
  ├─ 검색지수 절댓값 쿠폰
  ├─ 환율 양방향 조정
  ├─ 상품 할인 최대 28%·환율 조정 +28%p / −14%p
  └─ 10원 단위 판매가
  ↓
series(product, range) / indexOf(date)
  ↓
MARKET 집계
  ├─ 오늘 막지지수와 전일 변화
  ├─ 91일 지수 추이
  ├─ 오늘 총할인율 1위
  ├─ 상품 6종과 최근 7일 추이
  └─ 현재 예측 라운드와 내 참여 상태
  ↓
사용자 행동
  ├─ 정렬 변경
  ├─ 상품 상세
  │    ├─ 최근 14일 가격
  │    ├─ 검색쿠폰·환율 조정 분해
  │    ├─ 지정가 알림 등록
  │    └─ Cafe24 구매 이동
  └─ 내일 할인율 1위 예측 제출
       ↓
다음 날 가격 확정 작업
  ├─ Cafe24 가격 반영
  ├─ 이전 예측 라운드 판정
  ├─ 지정가 도달 판정·메일 발송
  └─ 다음 예측 라운드 개설
       ↓
ME 조회
  ├─ 지정가 알림 상태
  ├─ 예측 대기·적중·미적중 기록
  └─ 적중자의 이메일 쿠폰 수령 상태
```

### 2.1 원본 함수와 실서비스 대응

| 원본 HTML 함수 | 원본 역할 | 실서비스 대응 |
|---|---|---|
| `quote(bread, key)` | 데모 환율·검색값으로 가격 계산 | 일일 가격 작업의 `calculateDailyPrice()` |
| `series(bread, off, len)` | 과거 N일 가격 생성 | `daily_prices` 기간 조회 |
| `indexOf_(key)` | 6종 가격지수 계산 | 확정 가격 기반 `market_indices` 생성 |
| `sortedBreads()` | 현재 배열 정렬 | 응답 배열을 브라우저에서 정렬 |
| `renderMarket()` | 상품 6종과 미니 차트 | `GET /api/market` + `ProductQuoteList` |
| `renderDash()` | 91일 막지지수 | MARKET 집계 응답의 `index.history` |
| `renderTop1()` | 오늘 할인율 1위 | 서버가 계산한 `topDiscountProductId` |
| `renderPredEntry()` | 예측 진입 상태 | 현재 라운드와 익명 방문자의 제출 상태 |
| `openDetail(tk)` | 상세·14일 차트·할인 분해 | `GET /api/products/[productId]` |
| `openAlert(tk)` / `bindAlert()` | 목표가·이메일 입력 | `POST /api/price-alerts` |
| `showAlertReached()` | 도달 데모 | 일일 작업의 실제 도달 판정과 이메일 발송 |
| `openPredict()` | UP/DOWN 데모 예측 | 6종 중 내일 총할인율 1위 상품 선택 |
| `renderAlerts()` | 지정가 상태 목록 | `GET /api/me`의 `priceAlerts` |
| `renderPreds()` | 예측 기록 목록 | `GET /api/me`의 `predictions` |

`renderHero()`는 HOME 함수지만 `mktIdx`, `mktDelta`도 갱신한다. 실서비스에서는 HOME을 가져오지 않고 MARKET 집계 API가 오늘 지수와 전일 대비 값을 직접 반환한다.

원본 확인 위치:

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

1. 브라우저가 `/market`을 요청한다.
2. `proxy.ts`가 `visitor_token` 쿠키 존재 여부만 확인한다.
3. 쿠키가 없으면 무작위 토큰을 `HttpOnly`, `Secure`, `SameSite=Lax`로 발급한다.
4. Server Component가 `getMarketSnapshot()`을 호출한다.
5. 서버는 공개 완료 상태인 오늘 가격 6종, 최근 가격, 막지지수, 현재 예측 라운드를 읽는다.
6. 서버는 쿠키를 HMAC 처리한 `visitor_hash`로 현재 사용자의 예측 제출 여부를 조회한다.
7. MARKET을 렌더링한다.
8. 화면 표시가 완료되면 `POST /api/events`로 `page_view`를 보낸다.

초기 화면 데이터는 여러 API를 연속 호출하지 않고 한 번의 집계 조회로 받는다.

```http
GET /api/market?priceDays=7&indexDays=91
```

```json
{
  "asOf": "2026-09-16T16:00:00+09:00",
  "marketStatus": "published",
  "priceSession": "PM",
  "fxSourceDate": "2026-09-15",
  "index": {
    "value": 85.97,
    "changePoint": -1.24,
    "history": []
  },
  "topDiscountProductId": "uuid",
  "products": [],
  "predictionRound": {
    "id": "uuid",
    "targetPublishDate": "2026-09-17",
    "closesAt": "2026-09-17T05:50:00+09:00",
    "myEntry": null
  }
}
```

### 3.2 MARKET 정렬

원본의 `sortedBreads() → renderMarket()` 흐름을 유지하되 서버 요청은 다시 하지 않는다.

1. 초기 응답의 상품 6종을 메모리에 둔다.
2. 사용자가 정렬 기준을 선택한다.
3. `drop`은 전일 대비 등락률, `price`는 오늘 가격, `name`은 한글 상품명 기준으로 정렬한다.
4. 정렬은 표시 순서만 바꾸며 확정 가격과 예측 기준에는 영향을 주지 않는다.

원본 `price` 정렬은 내림차순이다. 출시 문구가 단순히 `가격 순`이면 오름차순인지 내림차순인지 최종 확정한다.

### 3.3 상품 상세

원본의 호출 관계는 `상품 행 또는 TOP1 클릭 → openDetail(ticker)`다.

1. `product_click` 이벤트를 기록한다.
2. 상세 데이터가 초기 응답에 없으면 다음 API를 호출한다.

```http
GET /api/products/{productId}?historyDays=14
```

3. 서버는 상품 기준정보, 오늘 확정가, 직전 확정가, 14일 가격 이력을 반환한다.
4. 전일 대비 금액과 등락률은 저장된 두 확정가로 계산하거나 저장값을 사용한다.
5. 검색쿠폰, 환율 조정, 최종 할인율(0~28%, 정가 초과 없음), 실제 데이터 기준일을 표시한다.
6. 사용자는 지정가 알림 또는 Cafe24 구매 이동을 선택한다.

```json
{
  "product": {
    "id": "uuid",
    "ticker": "TTR",
    "name": "막지 테트리스 브레드",
    "basePriceWon": 11000,
    "cafe24ProductNo": 31
  },
  "quote": {
    "priceWon": 9560,
    "previousPriceWon": 8830,
    "priceChangeWon": 730,
    "priceChangePct": 8.27,
    "searchRatio": 55,
    "searchDiscountPct": 5.5,
    "fxDeclinePct": 0.546,
    "fxDiscountPct": 7.644,
    "discountPct": 13.144,
    "searchSignalDate": "2026-09-15",
    "fxCurrentDate": "2026-09-15",
    "fxPreviousDate": "2026-09-14",
    "formulaVersion": "v1.0"
  },
  "history": []
}
```

### 3.4 Cafe24 구매 이동

브라우저가 Cafe24 URL로 직접 이동하지 않고 서버 리다이렉트를 거친다.

```text
구매 버튼 클릭
→ GET /api/out/cafe24/{productId}
→ visitor_hash와 click_id 생성
→ purchase_link_click 저장
→ 허용된 Cafe24 상품 URL로 302 응답
```

리다이렉트 API는 클라이언트가 전달한 임의 URL을 사용하지 않는다. `products`의 Cafe24 상품번호로 목적지를 조립해 오픈 리다이렉트를 막는다.

### 3.5 지정가 알림 등록

원본은 등록 직후 `showAlertReached()`를 호출하는 데모다. 실서비스에서는 등록과 도달을 분리한다.

1. 상세를 연 상품을 기본 선택한다.
2. 다른 상품을 선택하면 해당 상품 기준가와 산식상 최대 할인 가격을 다시 계산한다.
3. 슬라이더 값을 10원 단위 목표가로 변환한다.
4. 최근 30일 중 확정 가격이 목표가 이하였던 일수를 조회한다.
5. 이메일 형식과 개인정보 필수 동의를 검사한다.
6. `POST /api/price-alerts`를 호출한다.
7. 서버는 목표가 범위, 10원 단위, 활성 상품, 속도 제한을 검증한다.
8. 서버는 이메일 원문을 암호화하고 정규화 이메일 해시를 생성한다.
9. 알림을 `pending_verification` 상태로 저장하고 이메일 소유 확인 링크를 보낸다.
10. `/api/price-alerts/verify?token=...`가 토큰을 1회 소비한다.
11. 알림이 `active`가 되고 `ME`에 표시된다.

```http
POST /api/price-alerts
Content-Type: application/json

{
  "productId": "uuid",
  "targetPriceWon": 8990,
  "email": "person@example.com",
  "consentVersion": "price-alert-v1"
}
```

```json
{
  "alertId": "uuid",
  "status": "pending_verification",
  "verificationExpiresAt": "2026-09-17T15:20:00+09:00"
}
```

슬라이더의 산식상 최저값은 `round(base_price × 0.72 / 10) × 10`이다. 이는 원가·마진을 반영한 최소 판매가가 아니라 현재 28%p 상한 산식(v1.2)이 만들 수 있는 범위다.

### 3.6 예측 참여

원본의 `predictBread()`와 UP/DOWN 선택은 사용하지 않는다. 확정된 규칙대로 6개 상품 중 내일 총할인율 1위를 고른다.

1. MARKET 응답에서 현재 열린 라운드와 마감 시각을 확인한다.
2. 이미 참여했으면 선택 결과만 보여주고 다시 제출하지 않는다.
3. 참여 전이면 6종 전체를 선택지로 표시한다.
4. 상품 하나를 고르고 `POST /api/predictions`를 호출한다.
5. 서버는 라운드 상태와 `closes_at`을 검사한다.
6. 서버는 쿠키에서 계산한 `visitor_hash`를 사용한다.
7. `(round_id, visitor_hash)` 유니크 제약으로 하루 한 번만 저장한다.
8. 저장 성공 후 같은 서버 흐름에서 `prediction_submit` 이벤트를 기록한다.
9. MARKET과 ME의 예측 상태가 `pending`으로 바뀐다.

```http
POST /api/predictions
Content-Type: application/json

{
  "roundId": "uuid",
  "selectedProductId": "uuid",
  "eventId": "client-generated-uuid"
}
```

오류 코드는 `ROUND_NOT_FOUND`, `ROUND_NOT_OPEN`, `ROUND_CLOSED`, `PRODUCT_NOT_ELIGIBLE`, `ALREADY_PREDICTED`, `RATE_LIMITED`로 구분한다.

### 3.7 ME 진입

ME는 계정 화면이 아니라 현재 브라우저 쿠키에 연결된 상태 조회다.

1. 브라우저가 `/me`를 요청한다.
2. 서버는 쿠키에서 `visitor_hash`를 계산한다.
3. `getMyDashboard(visitor_hash)`가 지정가 알림과 예측 기록을 조회한다.
4. 적중 예측이 있으면 쿠폰 수령 상태를 함께 조회한다.
5. 화면 표시 후 `page_view`를 기록한다.
6. 결과가 처음 표시된 라운드는 `result_view`를 기록한다.

```http
GET /api/me?predictionLimit=30
```

```json
{
  "browserIdentityNotice": true,
  "priceAlerts": [
    {
      "id": "uuid",
      "productId": "uuid",
      "targetPriceWon": 8990,
      "currentPriceWon": 9560,
      "status": "active",
      "distanceWon": 570,
      "createdAt": "2026-09-16T15:20:00+09:00"
    }
  ],
  "predictions": [
    {
      "roundId": "uuid",
      "targetPublishDate": "2026-09-17",
      "selectedProductId": "uuid",
      "status": "pending",
      "submittedAt": "2026-09-16T14:20:00+09:00",
      "winningProductIds": [],
      "reward": null
    }
  ]
}
```

ME에서 `renderDogam()`, 씰 통계·진척도, `renderCoupons()` 기반 앱 내부 쿠폰함은 제거한다. `renderAlerts()`와 `renderPreds()`에 대응하는 데이터, 적중자 쿠폰 이메일 수령 상태만 남긴다.

### 3.8 오전 5시·오전 6시·오후 4시 서버 작업

```text
05:00 Cafe24 판매가를 기준가로 복귀하고 정가 세션 공개
  ↓
05:45 job_runs AM 잠금 획득
  ↓
05:45~05:55 Naver 상품별 독립 6회 호출 + D-1까지의 최근 두 종가 스냅샷 확인
  ↓
입력 검증과 원본 저장
  ↓
6종 가격·할인율·막지지수 계산
  ↓
daily_prices status=calculated 저장
  ↓
05:55~05:59 Cafe24 현재가 GET → 다른 상품만 PUT
  ↓
상품별 Cafe24 적용 결과 저장
  ↓
06:00 공개 가능한 오전 가격을 published 처리
  ↓
전날 prediction_round 판정
  ↓
적중 prediction_entries 갱신
  ↓
active price_alerts와 오늘 공개가 비교
  ↓
도달 알림을 triggered로 원자적 변경 후 이메일 발송
  ↓
다음 prediction_round 개설
  ↓
AM job_runs completed 또는 partially_failed
  ↓
15:55~15:59 D의 원/달러 시가와 D-1까지의 최근 종가 스냅샷 확인
  ↓
오후 6종 가격 계산 → Cafe24 GET·필요 상품 PUT
  ↓
16:00 공개 가능한 오후 가격을 published 처리
  ↓
active price_alerts 도달 재판정
  ↓
PM job_runs completed 또는 partially_failed
```

Cafe24 적용 실패 상품은 계산 목표가를 실제 판매가처럼 공개하지 않는다. `daily_prices.cafe24_apply_status`와 공개 상태를 분리해 직전 실제 판매가 유지 여부를 명시한다.

## 4. 권장 Next.js 파일 구조

현재 저장소는 Vinext/D1 시작 구조이므로 아래는 Next.js App Router + Supabase 전환 목표 구조다.

```text
app/
  layout.tsx
  page.tsx                         # /market으로 redirect
  (main)/
    layout.tsx                     # MARKET·ME 2탭 셸
    market/page.tsx
    market/loading.tsx
    me/page.tsx
    me/loading.tsx
  api/
    market/route.ts
    products/[productId]/route.ts
    predictions/current/route.ts
    predictions/route.ts
    price-alerts/route.ts
    price-alerts/[alertId]/route.ts
    price-alerts/verify/route.ts
    me/route.ts
    rewards/claim/route.ts
    rewards/verify/route.ts
    events/route.ts
    out/cafe24/[productId]/route.ts
    cafe24/oauth/callback/route.ts
    internal/
      daily-pricing/route.ts
      resolve-predictions/route.ts
      evaluate-price-alerts/route.ts
      cafe24/orders/route.ts

components/
  shell/
    AppHeader.tsx
    BottomTabs.tsx                # MARKET·ME만 존재
  market/
    MarketSnapshot.tsx
    MarketIndexChart.tsx
    TopDiscountProduct.tsx
    SortControls.tsx
    ProductQuoteList.tsx
    ProductQuoteRow.tsx
    PredictionEntry.tsx
  product/
    ProductDetailSheet.tsx
    PriceHistoryChart.tsx
    DiscountBreakdown.tsx
    Cafe24PurchaseLink.tsx
  price-alerts/
    PriceAlertSheet.tsx
    TargetPriceControl.tsx
    PriceAlertEmailForm.tsx
    PriceAlertList.tsx
  predictions/
    PredictionSheet.tsx
    ProductPredictionChoice.tsx
    PredictionHistory.tsx
    RewardClaimForm.tsx
  analytics/
    PageViewTracker.tsx

lib/
  env.ts
  supabase/
    admin.ts                       # server-only service role client
    database.types.ts
  visitor/
    cookie.ts
    hash.ts
    session.ts
  pricing/
    calculate.ts
    index.ts
    round-to-ten.ts
    policy.ts
  external/
    naver-datalab.ts
    ecos.ts
    cafe24/
      client.ts
      oauth.ts
      products.ts
      coupons.ts
    mail/
      client.ts
      templates.ts
  services/
    market.ts
    product-detail.ts
    predictions.ts
    price-alerts.ts
    rewards.ts
    analytics.ts
    daily-pricing.ts
  validation/
    predictions.ts
    price-alerts.ts
    events.ts
  security/
    hmac.ts
    encryption.ts
    rate-limit.ts
    cron-auth.ts

proxy.ts                            # visitor_token 보장; DB 작업 금지

supabase/
  migrations/
    0001_products_and_prices.sql
    0002_anonymous_visitors.sql
    0003_predictions.sql
    0004_price_alerts.sql
    0005_rewards.sql
    0006_events_and_attribution.sql
    0007_job_runs_and_audit.sql

tests/
  unit/
    pricing.test.ts
    prediction-resolution.test.ts
    target-price.test.ts
  integration/
    market-route.test.ts
    prediction-route.test.ts
    price-alert-route.test.ts
    daily-pricing.test.ts
  e2e/
    market-to-detail.spec.ts
    anonymous-prediction.spec.ts
    price-alert.spec.ts
    me-status.spec.ts
```

`proxy.ts`는 쿠키 발급처럼 빠르고 요청 전 필요한 일만 담당한다. Supabase 조회, 외부 API 호출, 가격 계산은 Route Handler 또는 서버 서비스에서 실행한다.

## 5. API 구조

| Method | 경로 | 호출 주체 | DB 변경 | 역할 |
|---|---|---|---|---|
| `GET` | `/api/market` | 브라우저/서버 | 없음 | 오늘 시세·지수·TOP1·현재 라운드 집계 |
| `GET` | `/api/products/[productId]` | 브라우저 | 없음 | 상품 상세와 14일 가격 이력 |
| `GET` | `/api/predictions/current` | 브라우저 | 없음 | 현재 라운드와 내 참여 상태 |
| `POST` | `/api/predictions` | 브라우저 | 있음 | 익명 예측 1회 저장 |
| `POST` | `/api/price-alerts` | 브라우저 | 있음 | 지정가 알림 생성·인증메일 발송 |
| `GET` | `/api/price-alerts/verify` | 이메일 링크 | 있음 | 이메일 인증 후 알림 활성화 |
| `DELETE` | `/api/price-alerts/[alertId]` | 브라우저 | 있음 | 현재 브라우저 소유 알림 해지 |
| `GET` | `/api/me` | 브라우저/서버 | 없음 | 알림·예측·보상 상태 집계 |
| `POST` | `/api/rewards/claim` | 적중 브라우저 | 있음 | 쿠폰 수령 이메일 인증 시작 |
| `GET/POST` | `/api/rewards/verify` | 이메일 링크/폼 | 있음 | 이메일 확인·쿠폰 배정·발송 |
| `POST` | `/api/events` | 브라우저 | 있음 | 허용된 행동 이벤트 저장 |
| `GET` | `/api/out/cafe24/[productId]` | 브라우저 | 있음 | 클릭 기록 후 302 이동 |
| `POST` | `/api/internal/daily-pricing` | Cron | 있음 | 수집·계산·Cafe24 반영·공개 오케스트레이션 |
| `POST` | `/api/internal/resolve-predictions` | 내부 작업 | 있음 | 이전 라운드 판정 |
| `POST` | `/api/internal/evaluate-price-alerts` | 내부 작업 | 있음 | 목표가 도달 판정과 메일 큐 생성 |
| `POST` | `/api/internal/cafe24/orders` | Cafe24/내부 | 있음 | 검증된 구매 전환 저장 |
| `GET` | `/api/cafe24/oauth/callback` | 관리자 | 있음 | Admin API OAuth 토큰 저장 |

### 5.1 Route Handler 공통 응답

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "serverTime": "2026-09-16T15:20:00+09:00"
  }
}
```

```json
{
  "error": {
    "code": "ALREADY_PREDICTED",
    "message": "이 라운드에는 이미 참여했습니다."
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

사용자 오류는 4xx, 외부 서비스나 서버 오류는 5xx로 구분한다. 외부 API 원문 오류와 비밀값은 공개 응답에 포함하지 않는다.

## 6. Supabase 테이블과 핵심 제약

### 6.1 가격과 상품

#### `products`

- `id uuid primary key`
- `ticker text unique not null`
- `name text not null`
- `base_price_won integer not null check (base_price_won > 0)`
- `cafe24_product_no bigint unique not null`
- `cafe24_shop_no integer not null default 1`
- `keywords jsonb not null`
- `active boolean not null default true`
- `valid_from`, `valid_to`

#### `trend_snapshots`

- 상품·신호일별 Naver ratio
- 요청 90일 구간과 keyword group 버전
- 원본 응답 위치와 호출 시각
- `unique(product_id, signal_date, keyword_group_version)`

#### `fx_snapshots`

- 동일 공급자의 원/달러 `CLOSE_1530`, `OPEN` 스냅샷
- `business_date`, `snapshot_type`, `usd_krw_rate`
- 공급자 원본 시각과 서버 수집 시각
- `unique(business_date, snapshot_type, provider)`

#### `daily_prices`

- 상품, 공개일, 입력 기준일, 할인 구성, 확정가
- `price_session`: `AM` 또는 `PM`; 자정 정가 복귀는 별도 가격 작업 로그로 감사
- `price_won % 10 = 0`
- `discount_pct between 0 and 38` (DB 제약. v1.2 산식 상한은 28이다)
- `unique(product_id, publish_date, price_session, formula_version)`
- 상태: `calculated`, `applying`, `published`, `held`, `failed`
- Cafe24 상태: `pending`, `applied`, `unchanged`, `failed`

#### `market_indices`

- `publish_date`, `index_value`, `previous_value`, `change_point`
- `price_session`: `AM` 또는 `PM`
- 6종의 공개 완료 가격을 기준으로 생성
- `unique(publish_date, price_session)`

### 6.2 익명 방문자

#### `anonymous_visitors`

- `visitor_hash text primary key`
- `first_seen_at`, `last_seen_at`
- 분석 동의와 최초 UTM

#### `visitor_sessions`

- `id uuid primary key`
- `visitor_hash`
- `started_at`, `last_seen_at`
- landing path, referrer domain, UTM

쿠키 원문은 DB에 저장하지 않는다. 클라이언트가 보낸 방문자 ID도 신뢰하지 않는다.

### 6.3 예측

#### `prediction_rounds`

- `id uuid primary key`
- `target_publish_date date unique not null`
- `opens_at`, `closes_at`, `resolved_at`
- 상태: `scheduled`, `open`, `closed`, `resolved`, `void`
- `winning_product_ids uuid[]`
- `resolution_version`, `void_reason`

#### `prediction_entries`

- `id uuid primary key`
- `round_id`, `visitor_hash`, `product_id`
- `submitted_at`
- 결과: `pending`, `won`, `lost`, `void`
- `claim_eligible boolean`
- `unique(round_id, visitor_hash)`

### 6.4 지정가 알림

#### `price_alerts`

- `id uuid primary key`
- `visitor_hash text not null`
- `product_id uuid not null`
- `target_price_won integer not null check (target_price_won % 10 = 0)`
- `email_ciphertext text not null`
- `email_hash text not null`
- 상태: `pending_verification`, `active`, `triggered`, `cancelled`, `expired`
- `verification_token_hash`, `verification_expires_at`
- `consent_version`, `consented_at`
- `verified_at`, `triggered_at`, `cancelled_at`, `expires_at`
- 생성 당시 `formula_version`과 `base_price_won`

권장 제약:

- 활성 상품만 등록 가능하도록 애플리케이션 검증
- 목표가는 등록 당시 기준가 이하
- 목표가는 현재 산식상 최대 할인 가격 이상
- 같은 이메일·상품·목표가의 중복 활성 알림 제한
- `status='active'` 조회용 `(product_id, target_price_won)` 부분 인덱스

#### `notification_deliveries`

- `id uuid primary key`
- `price_alert_id` 또는 `reward_claim_id`
- 종류: `verification`, `price_reached`, `reward_verification`, `coupon`
- 공급자 메시지 ID
- 상태: `queued`, `sent`, `delivered`, `failed`
- 시도 횟수, 마지막 오류 코드, 발송 시각

도달 판정은 다음 조건의 행을 잠금 처리하여 한 번만 발송한다.

```sql
status = 'active'
and target_price_won >= :published_price_won
and triggered_at is null
```

### 6.5 보상과 이벤트

#### `reward_claims`

- 적중 `prediction_entry_id`에 대해 1개만 생성
- 이메일 암호문과 해시
- 인증·쿠폰 발송·만료 상태
- `unique(prediction_entry_id)`

#### `events`

- `id uuid primary key`
- `visitor_hash`, `session_id`
- 허용된 `event_name`
- `path`, `product_id`, `round_id`
- 개인정보 없는 `properties jsonb`
- `occurred_at`, `received_at`, `source`

#### `job_runs`, `audit_logs`

- 일일 가격 작업 잠금과 단계 상태
- 외부 API 요청 메타데이터
- Cafe24 변경 전·목표·변경 후 가격
- 재시도와 실패 사유
- 비밀값과 이메일 원문은 제외

## 7. RLS와 서버 경계

앱은 비로그인이므로 Supabase Auth 세션을 사용자 식별 수단으로 사용하지 않는다.

- 브라우저는 가격·예측·알림 테이블을 직접 수정하지 않는다.
- 모든 쓰기는 Next.js Route Handler가 검증한 뒤 service role로 수행한다.
- service role key는 `server-only` 모듈에서만 읽는다.
- 공개 가격도 일관된 집계와 캐시를 위해 `/api/market`을 통해 읽는다.
- RLS는 `anon` 직접 쓰기를 거부한다.
- 소유권은 요청 본문이 아니라 HttpOnly 쿠키에서 계산한 `visitor_hash`로 확인한다.
- 내부 작업 API는 `CRON_SECRET` 또는 서명 검증을 통과해야 한다.

Supabase Auth를 쓰지 않는다는 것은 보안 검증이 없다는 뜻이 아니다. 익명 쿠키 소유권, 서버 검증, 유니크 제약, 속도 제한, 이메일 인증을 조합한다.

## 8. 분석 이벤트 발생 순서

| 이벤트 | 정확한 발생 시점 |
|---|---|
| `page_view` | `/market` 또는 `/me` 핵심 콘텐츠가 실제 표시된 뒤 |
| `product_click` | 상품 행·TOP1에서 상세를 열기 직전 |
| `price_alert_start` | 지정가 알림 입력을 연 시점 |
| `price_alert_created` | DB 생성 성공 후 |
| `price_alert_verified` | 이메일 토큰 소비와 `active` 전환 성공 후 |
| `price_alert_triggered` | 도달 상태의 원자적 변경 성공 후 |
| `prediction_submit` | `prediction_entries` 저장 성공 후 |
| `result_view` | ME에 판정 결과가 실제 표시된 뒤 |
| `coupon_click` | 적중자가 쿠폰 수령 절차를 시작할 때 |
| `reward_email_verified` | 보상 이메일 인증 성공 후 |
| `reward_coupon_sent` | 메일 공급자 발송 성공 후 |
| `purchase_link_click` | Cafe24 302 응답을 보내기 전 서버에서 |
| `purchase_completed` | Cafe24 주문 근거가 서버에서 검증된 뒤 |

예측과 지정가 알림의 원본 상태는 각각 전용 테이블이다. 이벤트 테이블은 분석용 복제 기록이며 업무 상태의 진실 공급원으로 사용하지 않는다.

## 9. 구현 순서

### 1단계: 기반 전환

1. 실제 Next.js App Router 프로젝트 구조로 전환한다.
2. Supabase 프로젝트와 마이그레이션을 연결한다.
3. 환경변수 검증과 server-only Supabase client를 만든다.
4. `visitor_token` 발급·HMAC·세션 계산을 구현한다.

### 2단계: 읽기 전용 MARKET

1. 상품·검색·환율·가격 테이블을 만든다.
2. 기존 가격 계산 코어를 TypeScript 서비스로 연결한다.
3. `/api/market`, `/api/products/[id]`를 구현한다.
4. 시세, 지수, TOP1, 정렬, 상세, 차트를 연결한다.
5. `page_view`, `product_click`, Cafe24 리다이렉트를 구현한다.

### 3단계: 일일 가격과 Cafe24

1. 수집·계산·공개 상태 기계를 구현한다.
2. Naver 6회 독립 호출과 종가 15:30·당일 시가 환율 스냅샷 수집을 연결한다.
3. Cafe24 GET·PUT, OAuth 갱신, 재시도를 연결한다.
4. 동일 날짜 재실행 멱등성과 부분 실패를 검증한다.

### 4단계: 예측과 ME

1. 라운드와 익명 예측 저장을 구현한다.
2. 오전 6시 판정과 공동 1위 처리를 구현한다.
3. ME의 예측 대기·적중·미적중 상태를 연결한다.
4. 적중자 이메일 인증과 Cafe24 쿠폰 메일을 연결한다.

### 5단계: 지정가 알림

1. 목표가 범위·최근 30일 빈도 조회를 구현한다.
2. 이메일 인증과 알림 활성화를 구현한다.
3. 오전 6시와 오후 4시 가격 공개 직후 도달 판정을 구현한다.
4. 중복 발송 방지와 ME 상태를 연결한다.

## 10. 필수 검증 시나리오

- 첫 방문에서 쿠키가 발급되고 같은 응답에서 MARKET을 볼 수 있다.
- 쿠키 원문이 DB와 로그에 저장되지 않는다.
- 6개 상품의 가격은 공개 완료 행만 노출된다.
- 정렬 변경은 API 재호출이나 가격 재계산을 발생시키지 않는다.
- 상세의 전일 대비 값은 정가 대비 값과 혼동되지 않는다.
- 목표가는 10원의 배수이고 기준가보다 높을 수 없다.
- 미인증 지정가 알림은 도달 판정 대상이 아니다.
- 하나의 지정가 알림은 여러 번 실행해도 도달 메일이 한 번만 발송된다.
- 한 브라우저는 같은 예측 라운드에 한 번만 참여한다.
- 예측 정답은 UP/DOWN이 아니라 총할인율 공동 1위 상품 집합이다.
- 판정 전 ME는 `pending`, 판정 후 `won`·`lost`·`void` 중 하나를 보여준다.
- 적중하지 않은 예측은 쿠폰 수령 API를 통과하지 못한다.
- Cafe24 구매 클릭은 이벤트 저장 후 허용된 상품 URL로 이동한다.
- 도감·씰·이벤트 미니게임·앱 내부 쿠폰함 관련 컴포넌트와 API가 생성되지 않는다.

## 11. 구현 전 남은 정책 결정

- 지정가 알림의 기본 만료 기간
- 같은 이메일이 동시에 만들 수 있는 활성 알림 수
- 목표가 도달 알림을 1회성으로 끝낼지 반복 알림으로 둘지 여부
- 일부 상품 가격이 `held`일 때 예측 라운드를 무효 처리할지 여부
- 공동 1위 보상 예산
- 메일 공급자와 반송·재시도 정책
- Cafe24 시리얼 쿠폰 생성 API의 실제 쇼핑몰 설정 검증

MVP 권장값은 지정가 알림 1회성, 30일 만료, 이메일당 활성 알림 10개 이하, 일부 상품 데이터 누락 시 예측 라운드 무효다.

## 12. 구현 기준 문서

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Supabase 서버 패키지 선택](https://supabase.com/docs/guides/auth/choosing-a-server-package)
- [Supabase Database와 RLS](https://supabase.com/docs/guides/database/overview)
- [Supabase Cron](https://supabase.com/docs/guides/cron)

현재 저장소의 `package.json`은 `vinext`를 사용하고 `db/schema.ts`는 D1 시작 구조다. 이 문서는 현재 파일 배치를 설명하는 문서가 아니라, 실제 Next.js + Supabase 구현으로 전환할 때의 목표 구조다. 구현 착수 시에는 먼저 런타임과 DB 방향을 전환한 뒤 위 순서대로 기능을 붙인다.
