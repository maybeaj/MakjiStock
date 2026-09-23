# 막지 스톡 (MAKJI Bread Market)

빵 6종의 할인가를 **네이버 검색 관심도**와 **원/달러 환율**로 매일 두 번 다시 계산해, 주식 시세 화면처럼 보여주는 비로그인 모바일 웹앱입니다. 손님은 가격이 오르기 전에 오전가를 하루 한 번 잠그고, 다음 가격이 오를지 내릴지 맞혀 Cafe24 할인코드를 받습니다.

![막지 상품 6종](public/images/bread-market-products-v1.png)

- **왜 만드나** — 할인을 "몇 % 세일"이 아니라 매일 바뀌는 시세로 바꿔서, 오전과 오후에 다시 들어올 이유를 만듭니다.
- **어떻게 파나** — 계산된 가격은 Cafe24 자사몰 상품가에 그대로 PUT 되고, 결제·회원은 Cafe24가 맡습니다. 이 앱은 가격과 게임만 담당합니다.
- **누가 쓰나** — 가입 없이 들어오는 모바일 방문자. 둘러보는 동안에는 식별자가 생기지 않습니다. 잠금이나 예측을 처음 누를 때만 `visitor_token` 쿠키(32바이트 난수·HttpOnly·1년)가 발급되고, 서버와 DB는 원문이 아니라 HMAC-SHA256 해시만 다룹니다. (`lib/visitor.ts`)

## 하루의 구조

시장의 하루는 자정이 아니라 **02:00(KST)** 에 바뀝니다.

| 세션 | 시각 (KST) | 가격 | 할 수 있는 것 |
|---|---|---|---|
| 오전장 | 06:00–15:59 | 직전 영업일 **종가** 기준 | 가격 잠금(하루 1회), 예측 |
| 오후장 | 16:00–다음 날 01:59 | 당일 **시가** 기준 | 잠금가로 구매, 예측 |
| 정가 | 02:00–05:59 | 기준가(정가) | 없음 |

주말에도 장은 열립니다. 검색지수는 매일 반영하고, 환율만 외환시장이 쉬어 금요일 종가로 이월합니다.

## 주요 기능

- **매일 두 번 가격 산정** — 네이버 검색어 트렌드 6회 + 한국은행 ECOS 시가·종가를 모아 세션별로 가격을 확정하고 Supabase에 저장한 뒤 Cafe24에 반영합니다. (`app/api/internal/daily-pricing`)
- **가격 잠금** — 오전장에 빵 하나의 오전가를 잠급니다. 16:00에 가격이 오르면 차액만큼 Cafe24 할인코드가 나오고, 내려가면 더 싼 현재가로 삽니다. 하루 1회 제한은 DB 유니크 제약이 강제합니다. (`app/api/locks`, `lib/locks/lock-codes.ts`)
- **가격 예측** — 지금 확정가 대비 다음 확정가의 방향(`up`/`down`)을 맞힙니다. 판정은 제출 시각과 무관하게 다음 날 06:00 오전가입니다. 안정형(오전장 7~10%·오후장 5~7%, 바로 발급)과 공격형(5~13%, 틀리지만 않으면 발급·동가는 무승부) 중 하나를 고릅니다. 상품 할인과 합쳐 38%를 넘지 않습니다. (`app/api/predictions`, `lib/predictions/resolve.ts`)
- **막지지수와 급등주** — 6종 가격을 묶은 지수와 전일 대비 검색지수 상승폭 1위를 마켓 상단에 띄웁니다.
- **Cafe24 연동** — Admin API OAuth, 토큰 암호화 저장·자동 갱신, 상품번호 동기화, 상품가 PUT, 정액 할인코드 발급. 데모몰/실몰은 `SHOP_TARGET` 하나로 전환합니다. (`lib/cafe24/client.ts`)
- **독립 백테스트** — 운영과 **같은 산식 코드**로 90일을 재현해 `report.md`·`daily.csv`·원본 응답까지 남깁니다. (`backtest/`)

## 가격 산식 (v1.2)

```text
검색쿠폰(%p)  = S × 0.15                          # S: 네이버 검색지수 절댓값 0~100
환율원시(%p)  = 환율하락률(%) × 0.28 × 50          # = ×14
환율조정(%p)  = 하락이면 min(28, 환율원시)
                상승이면 max(−14, 환율원시 × 0.5)  # 상승분은 절반만 반영
할인율(%p)    = clamp(검색쿠폰 + 환율조정, 0, 28)

판매가 = round(기준가 × (1 − 할인율/100) / 10) × 10
```

- 매일 **기준가에서 다시** 계산합니다. 어제 가격에 누적하지 않습니다.
- 정가를 넘지 않고(할증 없음), 기준가의 72%보다 싸지지 않습니다.
- 화면의 등락률은 할인율이 아니라 **직전 확정가 대비** 변화율입니다.
- 파라미터는 `config/pricing-products.json`, 계산은 `lib/pricing/pricing.mjs` 한 곳에 있습니다. 앱·크론·백테스트가 이 파일을 공유합니다.
- 산식을 바꾸면 `formulaVersion`을 올립니다. 과거 확정가는 덮어쓰지 않습니다.

자세한 근거는 [docs/PRD-브레드마켓.md](docs/PRD-브레드마켓.md) §8, 할인율 결정 과정은 [docs/할인율-결정-리포트.md](docs/할인율-결정-리포트.md)에 있습니다.

## 시작하기

요구 사항: Node.js 22.13 이상.

```bash
npm install
cp .env.example .env.local   # 값을 채웁니다
npm run dev                  # http://localhost:3000
```

Supabase 값이 비어 있으면 로컬 메모리 데모 모드로 뜹니다. 실제 시세를 보려면 최소한 아래가 필요합니다.

| 변수 | 쓰임 |
|---|---|
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 검색어 트렌드 (API HUB를 쓰면 `NAVER_API_HUB_*`) |
| `BOK_ECOS_API_KEY` | 한국은행 원/달러 시가·종가 |
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 가격·잠금·예측 저장 |
| `VISITOR_TOKEN_HMAC_SECRET` | 익명 방문자 해시 (`openssl rand -hex 32`) |
| `TOKEN_ENCRYPTION_KEY` | Cafe24 토큰 암호화 (`openssl rand -hex 32`) |
| `CRON_SECRET` | 내부 작업 보호 |
| `CAFE24_CLIENT_ID` / `CAFE24_CLIENT_SECRET` / `CAFE24_MALL_ID` / `SHOP_TARGET` | Cafe24 Admin API |

Cafe24 access/refresh 토큰과 상품번호는 환경변수에 넣지 않습니다. 토큰은 Supabase `cafe24_tokens`에 암호화해 두고 서버가 스스로 갱신하며, 상품번호는 `POST /api/internal/sync-products`로 몰에서 가져옵니다. 전체 목록은 [.env.example](.env.example)을 보세요.

DB 스키마는 `supabase/schema.sql`·`supabase/migrations/`·`supabase/rls.sql`에 있습니다.

## 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드·실행 |
| `npm test` | 가격·백테스트 테스트 + `typecheck` + `lint` (CI가 푸시·PR마다 실행) |
| `npm run test:pricing` | `tests/*.test.mjs` (산식, 세션, 크론, 예측, 보상, 암호화) |
| `npm run backtest` | 90일 백테스트 실행 → `backtest/output/` |
| `npm run simulate:pricing` | 산식 파라미터 시뮬레이션 |
| `node scripts/cafe24-token.mjs` | 저장된 Cafe24 토큰 상태 확인 |
| `node scripts/backfill-daily-prices.mjs` | 과거 확정가 채우기 |

개발 중에는 `DEV_KST_DATE`·`DEV_KST_HOUR`로 서버의 "오늘"과 세션을 바꿔 볼 수 있습니다(프로덕션에서는 무시).

## 자동화

`vercel.json`의 크론 3개가 하루를 돌립니다(스케줄은 UTC, 아래는 KST).

| 시각 (KST) | 경로 | 하는 일 |
|---|---|---|
| 02:00 | `/api/internal/reset-list-price` | Cafe24 가격을 정가로 복귀, 잠금 보호 종료 |
| 05:00 | `/api/internal/daily-pricing?session=am` | 수집 → 오전가 계산 → Cafe24 반영 → 예측 판정·코드 발급 |
| 15:00 | `/api/internal/daily-pricing?session=pm` | 오후가 계산 → 반영 → 잠금 차액 코드 발급 |

같은 `(상품, 날짜, 세션, 산식버전)`은 한 번만 확정되므로 재시도해도 안전합니다.

대표 판매가와 옵션가는 함께 갱신됩니다. 옵션별 총 정가는
`config/cafe24-option-prices.ts`에 두고, 같은 할인율을 적용한 옵션 총액에서 대표
판매가를 뺀 값을 Cafe24 `additional_amount`로 보냅니다. 02:00 정가 리셋도 옵션
추가금을 원래 값으로 복원합니다. 실제 상품에서는 설정과 Cafe24 옵션명이 하나라도
다르면 반영 전에 실패합니다. 현재 데모 상품에는 옵션이 없어 대표 판매가만 반영되며,
데모몰에 실제와 같은 옵션명을 만들면 같은 옵션 반영 로직이 자동으로 적용됩니다.

## 디렉터리

```text
app/                Next.js App Router. (bread)/market · (bread)/me 화면과 api/ 라우트
components/         bread-market/ 화면 컴포넌트(Shell, MarketPanel, MyPanel, sheets)
lib/pricing/        산식·환율·검색·날짜. 앱과 백테스트가 공유하는 .mjs
lib/bread-market/   화면에 줄 데이터 조립(engine, market-data, page-data, reward-policy)
lib/cafe24/         Admin API 클라이언트와 토큰 갱신
config/             pricing-products.json — 상품 6종, 검색어, 산식 파라미터
supabase/           schema.sql · migrations · rls.sql
backtest/           운영과 같은 산식을 쓰는 독립 90일 백테스트
scripts/            백필·시뮬레이션·토큰 점검 스크립트
tests/              node:test 단위 테스트
docs/               PRD와 정책 결정 문서
```

## 문서

- [docs/PRD-브레드마켓.md](docs/PRD-브레드마켓.md) — 제품 기준 문서. 충돌하면 이 문서가 우선합니다.
- [docs/산식과-쿠폰-공부노트.md](docs/산식과-쿠폰-공부노트.md) — 산식·쿠폰을 근거와 코드 위치까지 이어 놓은 노트
- [DESIGN.md](DESIGN.md) — 브랜드·IA·컴포넌트·접근성 기준
- [docs/NextJS-Supabase-MARKET-ME-로직구조.md](docs/NextJS-Supabase-MARKET-ME-로직구조.md) — 화면 로직 구현 명세
- [docs/가격-잠금-1회-사유.md](docs/가격-잠금-1회-사유.md) · [docs/매수가-기준-예측-제외-사유.md](docs/매수가-기준-예측-제외-사유.md) — 범위를 줄인 이유
- [docs/가격자동화-실행가이드.md](docs/가격자동화-실행가이드.md) — 일일 자동화 운영
- [backtest/README.md](backtest/README.md) — 백테스트 호출 원칙과 결과물

## 현재 상태

- 버전 `0.1.0`, 비공개 프로젝트. 가격 산식은 v1.0으로 고정, 백테스트로 90일 검증했습니다.
- 화면은 서버 렌더에서 `lib/bread-market/page-data.ts`가 시세·잠금·예측을 직접 읽습니다. 실시세를 하나도 받지 못하면 지어낸 가격 대신 오류를 띄웁니다 — 시드 데이터는 개발 환경에서만 씁니다.
- 범위 밖: 자체 회원가입·결제, 이메일 지정가 알림, 구매가 기준 예측, 막지코인·배팅류 게임.
- 미결 항목은 [DESIGN.md](DESIGN.md)의 Open questions와 PRD §24에 있습니다.
