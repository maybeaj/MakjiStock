# 막지 스톡 (MAKJI Bread Market)

막지 빵(지금 6종)의 할인가를 **네이버 검색 관심도**와 **원/달러 환율**로 매일 두 번 다시 계산해, 주식 시세 화면처럼 보여주는 비로그인 모바일 웹앱입니다. 손님은 가격이 오르기 전에 오전가를 하루 한 번 잠그고, 다음 가격이 오를지 내릴지 맞혀 Cafe24 할인코드를 받습니다.

![막지 상품 6종](public/images/bread-market-products-v1.png)

- **왜 만드나** — 할인을 "몇 % 세일"이 아니라 매일 바뀌는 시세로 바꿔서, 오전과 오후에 다시 들어올 이유를 만듭니다.
- **어떻게 파나** — 계산된 가격은 Cafe24 자사몰 상품가에 그대로 PUT 되고, 결제·회원은 Cafe24가 맡습니다. 이 앱은 가격과 게임만 담당합니다.
- **누가 쓰나** — 가입 없이 들어오는 모바일 방문자. 첫 화면이 뜬 뒤 방문 기록(`page_view`)을 남길 때 `visitor_token` 쿠키(32바이트 난수·HttpOnly·1년)가 발급되고, 서버와 DB는 원문이 아니라 HMAC-SHA256 해시만 다룹니다. 재방문율을 보기 위한 익명 식별자입니다. (`lib/visitor.ts`, `app/api/events`)

## 프로젝트 구성

```text
makji-stock
├── README.md                     # 이 문서
├── DESIGN.md                     # 브랜드·화면 구성·컴포넌트·접근성 기준
├── docs/                         # 기획·정책·운영 문서
│   ├── PRD-브레드마켓.md          # 제품 기준 문서 (충돌하면 이 문서가 우선)
│   ├── NextJS-Supabase-MARKET-ME-로직구조.md
│   ├── 산식-버전.md · 산식과-쿠폰-공부노트.md
│   ├── 가격자동화-실행가이드.md · 막지-상품6종-검색어.md
│   ├── KPI-시장규모-BM-설계.md
│   ├── 가격-잠금-1회-사유.md · 매수가-기준-예측-제외-사유.md
│   ├── 기획-정리-2026-09-19.md · 기획-정리-2026-09-21.md
│   ├── 할인율-결정-리포트.md · 네이버-검색지수-도착시각.md · 가격정책-마진연동-계산안.md
│   ├── 기업_요구사항.md · 시스템 아키텍처.pdf
│   └── reference/                # 할인율 산식 시뮬레이터(HTML)
├── app/                          # Next.js App Router
│   ├── (bread)/market/           # 마켓 화면
│   ├── (bread)/me/               # MY 화면
│   ├── admin/                    # 어드민 (상품·할인율·변경 기록·KPI)
│   └── api/                      # 서버 API
│       ├── market/ · events/     # 시세 조회 · 방문 기록
│       ├── locks/ · predictions/ # 가격 잠금 · 가격 예측(안정형·공격형)
│       ├── out/cafe24/           # 구매 링크 (몰 상품 상세로 이동)
│       ├── auth/cafe24/          # Cafe24 OAuth 연결
│       └── internal/             # 자동 작업 (가격 계산·정가 복귀·주문 동기화·상품번호 동기화)
├── proxy.ts                      # /admin 비밀번호 잠금
├── components/
│   └── bread-market/             # 마켓·MY 화면 부품
├── lib/
│   ├── pricing/                  # 가격 산식·검색지수·환율 (앱·크론·백테스트 공용)
│   ├── bread-market/             # 화면 데이터 조립, 운영 정책(산식·쿠폰)
│   ├── admin/                    # 어드민 인증·데이터·백테스트·사진 업로드
│   ├── cafe24/                   # Cafe24 Admin API, 가격 반영, 주문 동기화
│   ├── locks/ · predictions/ · rewards/   # 잠금·예측 판정·할인코드 발급
│   └── visitor.ts · crypto.ts    # 익명 방문자 쿠키, 암호화
├── config/                       # 산식 대비값·Cafe24 옵션가·데모몰 상품 매핑
├── supabase/                     # DB 스키마·마이그레이션·접근 권한·집계 SQL
├── backtest/                     # 독립 90일 백테스트
├── scripts/                      # 백필·시뮬레이션·토큰 점검
├── tests/                        # 단위 테스트 (CI 가 푸시마다 실행)
├── public/                       # 폰트·빵 사진·스플래시
└── vercel.json                   # 자동 작업 일정
```

## 경로별 설명

### 문서

| 경로 | 설명 |
|---|---|
| `docs/PRD-브레드마켓.md` | 제품 기준 문서입니다. 다른 문서와 내용이 다르면 이 문서를 따릅니다. |
| `DESIGN.md` | 브랜드, 화면 구성(IA), 컴포넌트, 접근성 기준을 정한 디자인 문서입니다. |
| `docs/NextJS-Supabase-MARKET-ME-로직구조.md` | 마켓·MY·어드민이 Next.js와 Supabase로 어떻게 돌아가는지 정리한 구현 명세입니다. **구조를 처음 파악할 때 먼저 보면 좋습니다.** |
| `docs/산식과-쿠폰-공부노트.md` | 산식과 쿠폰의 숫자마다 근거 문서, 코드, 테스트 위치를 이어 둔 안내서입니다. 코드를 처음 보는 사람이 읽기 좋습니다. |
| `docs/산식-버전.md` | 산식 버전(v1.0~v1.4)의 변경 이력과 근거, 어드민에서 새 버전을 저장하는 흐름입니다. |
| `docs/가격자동화-실행가이드.md` | 매일 도는 자동 작업의 운영 방법, 수동 실행, makji.kr 전환 절차입니다. |
| `docs/막지-상품6종-검색어.md` | 빵별 네이버 검색어를 고른 기준과 당시 목록입니다. 지금 검색어는 어드민에서 관리합니다. |
| `docs/KPI-시장규모-BM-설계.md` | KPI 정의, 목표치, 시장 규모(TAM/SAM/SOM), 수익 모델 설계입니다. |
| `docs/가격-잠금-1회-사유.md`, `docs/매수가-기준-예측-제외-사유.md` | 기능 범위를 줄인 결정과 그 이유입니다. |
| `docs/기획-정리-*.md` | 날짜별 기획 회의에서 확정·변경·미결정된 내용을 정리한 기록입니다. 본문은 당시 그대로 두고, 바뀐 점만 맨 위에 적어 둡니다. |
| `docs/할인율-결정-리포트.md` | 할인율 산식의 계수를 실데이터로 비교해 정한 분석 보고서입니다. |
| `docs/네이버-검색지수-도착시각.md` | 네이버 검색지수가 하루 중 언제 갱신되는지 측정한 기록입니다. 자동 작업 시각을 정한 근거입니다. |
| `docs/가격정책-마진연동-계산안.md` | 초기에 검토한 마진 연동 가격 모델입니다. 마진 하한 계산은 지금 코드에도 남아 있습니다. |
| `docs/기업_요구사항.md` | 고객사가 요청한 요구사항입니다. 기능 범위를 판단하는 출발점입니다. |
| `docs/reference/` | 할인율 산식 시뮬레이터(HTML)입니다. |

### 앱 코드

빵의 할인가를 **네이버 검색 관심도**와 **원/달러 환율**로 매일 두 번 다시 계산해 주식 시세처럼 보여주는 모바일 웹앱입니다. 결제와 회원은 Cafe24가 맡고, 이 앱은 가격 계산과 이벤트(잠금·예측)만 담당합니다.

| 경로 | 설명 |
|---|---|
| `app/(bread)/market/` | 손님이 처음 보는 마켓 화면입니다. 판매 중인 빵의 현재가, 등락률, 막지지수와 3개월 추이, 급등 상품, 안정형·공격형 예측 카드를 보여줍니다. |
| `app/(bread)/me/` | MY 화면입니다. 누적 혜택, 예측 성과, 오늘의 가격 잠금, 받은 할인코드를 확인합니다. |
| `app/admin/` | 어드민입니다. 상품 관리(빵 추가·수정·사진), 할인율 관리(산식·쿠폰 보상률 저장과 90일 백테스트), 변경 기록, KPI를 봅니다. `ADMIN_PASSWORD`로 잠겨 있습니다. |
| `app/api/market/` | 화면에 보이는 현재 시세를 JSON으로 확인하는 조회용 API입니다. |
| `app/api/events/` | 방문 기록(`page_view`)을 남깁니다. 이때 익명 방문자 쿠키가 발급됩니다. 어드민 방문은 세지 않습니다. |
| `app/api/locks/` | 가격 잠금 API입니다. 오전장에 하루 한 번 가격을 잠그고, 오후가가 오르면 차액만큼 할인코드를 발급합니다. |
| `app/api/predictions/` | 가격 예측 API입니다. 안정형은 그 자리에서 할인코드를 주고(`instant/`), 공격형은 다음 날 06:00 오전가로 판정해 맞히면 5~13% 할인코드를 줍니다. |
| `app/api/out/cafe24/` | 손님을 Cafe24 상품 상세로 보내고 구매 링크 클릭을 기록합니다. `SHOP_TARGET` 값에 따라 데모몰이나 makji.kr로 연결합니다. |
| `app/api/auth/cafe24/` | Cafe24 관리자 연동(OAuth) 시작과 콜백입니다. 몰을 처음 연결할 때 씁니다. |
| `app/api/internal/` | 매일 자동으로 도는 작업입니다. 가격 계산·Cafe24 반영(`daily-pricing`), 새벽 정가 복귀(`reset-list-price`), 주문 동기화(`sync-orders`), 상품번호 동기화(`sync-products`). `CRON_SECRET` 없이는 호출할 수 없습니다. |
| `proxy.ts` | `/admin` 경로를 비밀번호로 잠급니다. |
| `components/bread-market/` | 마켓·MY 화면을 이루는 부품입니다(`Shell`, `MarketPanel`, `MyPanel`, `sheets`). |
| `lib/pricing/` | 가격 산식의 핵심입니다. 검색지수·환율 수집과 할인율 계산(`calculateDay`)이 있고, 앱·자동 작업·두 백테스트가 같은 코드를 씁니다. |
| `lib/bread-market/` | DB와 산식 결과를 화면에 필요한 형태로 조립합니다. 운영 정책(`policy.ts`, `policy-server.ts`)과 쿠폰 규칙(`reward-policy.ts`)도 여기 있습니다. |
| `lib/admin/` | 어드민 인증, 상품·변경 기록 조회, 90일 백테스트, 사진 업로드입니다. |
| `lib/cafe24/` | Cafe24 Admin API 클라이언트입니다. 토큰 암호화 저장과 자동 갱신, 상품가·옵션가 반영, 주문 동기화를 맡습니다. |
| `lib/locks/`, `lib/predictions/`, `lib/rewards/` | 잠금 차액 코드, 예측 판정, 할인코드 발급 규칙입니다. |
| `config/pricing-products.json` | 산식 v1.4와 빵 6종·검색어입니다. **운영 값의 정본은 DB `pricing_versions`** 이고, 이 파일은 DB를 못 읽을 때의 대비값과 스크립트 입력입니다. |
| `config/cafe24-option-prices.ts`, `config/cafe24-product-map.json` | Cafe24 옵션별 정가, 데모몰 상품번호 수동 매핑입니다. |
| `supabase/` | DB 테이블(`schema.sql`), 변경 이력(`migrations/` 001~011), 접근 권한(`rls.sql`), KPI·재방문·가드레일 집계 SQL(`snippets/`)입니다. |
| `backtest/` | 운영과 같은 산식으로 과거 90일을 다시 계산하는 독립 도구입니다. API를 새로 불러 입력부터 다시 모읍니다. 운영 DB에 저장된 입력으로 산식만 바꿔 보려면 어드민 백테스트를 씁니다. |
| `scripts/` | 과거 확정가 채우기, 산식 시뮬레이션, 입력 도착 시각 측정, Cafe24 토큰 점검 스크립트입니다. |
| `tests/` | 산식, 정책, 빵 목록, 장 시간, 자동 작업 일정, 예측 판정, 보상, 암호화 단위 테스트입니다. 푸시·PR마다 CI가 실행합니다(`.github/workflows/ci.yml`). |
| `vercel.json` | 가격 계산·정가 복귀·주문 동기화가 매일 몇 시에 도는지 정한 일정표입니다. |

## 하루의 구조

시장의 하루는 자정이 아니라 **02:00(KST)** 에 바뀝니다.

| 세션 | 시각 (KST) | 가격 | 할 수 있는 것 |
|---|---|---|---|
| 오전장 | 06:00–15:59 | 직전 영업일 **종가** 기준 | 가격 잠금(하루 1회), 예측 |
| 오후장 | 16:00–다음 날 01:59 | 당일 **시가** 기준 | 잠금가로 구매, 예측 |
| 정가 | 02:00–05:59 | 기준가(정가) | 없음 |

주말에도 장은 열립니다. 검색지수는 매일 반영하고, 환율만 외환시장이 쉬어 금요일 종가로 이월합니다.

## 주요 기능

- **매일 두 번 가격 산정** — 판매 중인 빵마다 네이버 검색어 트렌드 1회 + 한국은행 ECOS 시가·종가를 모아 세션별로 가격을 확정하고 Supabase에 저장한 뒤 Cafe24에 반영합니다. (`app/api/internal/daily-pricing`)
- **가격 잠금** — 오전장에 빵 하나의 오전가를 잠급니다. 16:00에 가격이 오르면 차액만큼 Cafe24 할인코드가 나오고, 내려가면 더 싼 현재가로 삽니다. 하루 1회 제한은 DB 유니크 제약이 강제합니다. (`app/api/locks`, `lib/locks/lock-codes.ts`)
- **가격 예측** — 지금 확정가 대비 다음 확정가의 방향(`up`/`down`)을 맞힙니다. 판정은 제출 시각과 무관하게 다음 날 06:00 오전가입니다. 안정형(오전장 7~10%·오후장 5~7%, 바로 발급)과 공격형(5~13%, 틀리지만 않으면 발급·동가는 무승부) 중 하나를 고릅니다. 상품 할인과 합쳐 38%를 넘지 않습니다. (`app/api/predictions`, `lib/predictions/resolve.ts`)
- **막지지수와 급등주** — 판매 중인 빵 가격을 묶은 지수와 전일 대비 검색지수 상승폭 1위를 마켓 상단에 띄웁니다.
- **Cafe24 연동** — Admin API OAuth, 토큰 암호화 저장·자동 갱신, 상품번호 동기화, 상품가 PUT, 정액 할인코드 발급. 데모몰/실몰은 `SHOP_TARGET` 하나로 전환합니다. (`lib/cafe24/client.ts`)
- **독립 백테스트** — 운영과 **같은 산식 코드**로 90일을 재현해 `report.md`·`daily.csv`·원본 응답까지 남깁니다. (`backtest/`)
- **방문·주문 집계** — `page_view`·구매 링크 클릭을 `events`에 남기고, Cafe24 주문을 매일 읽어 KPI 뷰로 묶습니다. (`app/api/events`, `app/api/internal/sync-orders`, 마이그레이션 008)
- **어드민** — `/admin`에서 빵 추가·수정(이름·사진·정가·검색어·판매 여부), 산식·쿠폰 보상률 변경과 저장 전 90일 백테스트, 변경 기록, KPI를 봅니다. 아래 [어드민](#어드민) 참고.

## 가격 산식 (v1.4)

```text
검색쿠폰(%p)  = S × 0.15                          # S: 네이버 검색지수 절댓값 0~100
환율원시(%p)  = 환율하락률(%) × 0.28 × 50          # = ×14
환율조정(%p)  = 하락이면 min(28, 환율원시)
                상승이면 max(−28, 환율원시)        # 상승분도 전부 반영
할인율(%p)    = clamp(검색쿠폰 + 환율조정, 0, 25)

판매가 = round(기준가 × (1 − 할인율/100) / 10) × 10
```

- 매일 **기준가에서 다시** 계산합니다. 어제 가격에 누적하지 않습니다.
- 정가를 넘지 않고(할증 없음), 기준가의 75%보다 싸지지 않습니다.
- 화면의 등락률은 할인율이 아니라 **직전 확정가 대비** 변화율입니다.
- 위 숫자는 v1.4 값입니다. **운영 값의 정본은 DB `pricing_versions`의 가장 최근 행**이고(쿠폰 보상률 포함), 어드민 `/admin/pricing`에서 새 버전으로 저장합니다. 크론·쿠폰 발급·화면이 모두 이 행을 읽습니다(`lib/bread-market/policy-server.ts`).
- 계산은 `lib/pricing/pricing.mjs`의 `calculateDay` 한 곳입니다. 크론·어드민 백테스트·`backtest/`가 같은 함수를 씁니다.
- 코드의 `DEFAULT_POLICY`(`lib/bread-market/policy.ts`)와 `config/pricing-products.json`은 DB 를 못 읽을 때의 대비값·스크립트 입력입니다. 둘과 010 마이그레이션의 v1.4 가 같은지는 `tests/policy.test.mjs`가 지킵니다.
- 저장할 때마다 버전이 올라가고(v1.4 → v1.5), 한 번 만든 버전은 고칠 수 없습니다. 과거 확정가는 덮어쓰지 않습니다.

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
| `CAFE24_CLIENT_ID` / `CAFE24_CLIENT_SECRET` / `CAFE24_MALL_ID` / `SHOP_TARGET` | Cafe24 Admin API. 지금 연결된 몰은 데모몰 `rabbit3456` |
| `ADMIN_PASSWORD` | `/admin` 비밀번호. 비어 있으면 어드민이 아무에게도 열리지 않습니다 |

Cafe24 access/refresh 토큰과 상품번호는 환경변수에 넣지 않습니다. 토큰은 Supabase `cafe24_tokens`에 암호화해 두고 서버가 스스로 갱신하며, 상품번호는 `POST /api/internal/sync-products`로 몰에서 가져오거나 어드민 상품 화면에서 넣습니다. 전체 목록은 [.env.example](.env.example)을 보세요.

로컬·프리뷰도 운영과 같은 몰을 보므로, 개발 모드에서는 Cafe24 쓰기(상품가 PUT·할인코드 생성)를 보내지 않습니다. 꼭 시험해야 할 때만 `CAFE24_ALLOW_LOCAL_WRITES=1`을 켭니다.

### DB

DB 스키마는 `supabase/schema.sql`·`supabase/migrations/`·`supabase/rls.sql`에 있습니다. 새 DB 는 `schema.sql`을 먼저 적용하고 `migrations/`를 번호 순으로 적용합니다.

| 마이그레이션 | 내용 |
|---|---|
| `001`·`002` | Cafe24 토큰 보관(`cafe24_tokens`)과 암호화 |
| `003` | 잠금 차액 할인코드 원문을 암호화해 저장 |
| `004` | `products.shop_url` (자사몰 상품 주소) |
| `005`·`006`·`007` | DB 제약을 할증 없음·보상률에 맞춤, 안정형/공격형 선택, 바로 받기 쿠폰과 빵 연결 |
| `008` | Cafe24 주문 동기화 테이블과 KPI 뷰(`kpi_daily`·`kpi_weekly`) |
| `009` | 어드민 변경 기록 `admin_audit_log` (추가만) |
| `010` | 산식·쿠폰 정책 버전 `pricing_versions` (추가만, 가장 최근 행이 운영값) |
| `011` | `products.display_name`·`full_name`·`photo_url`, 사진 버킷 `bread-photos` |

011 은 Supabase Storage 가 켜져 있어야 버킷을 만듭니다. 로컬 Supabase 는 `supabase/config.toml`에서 Storage 를 켜 두었습니다.

## 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드·실행 |
| `npm test` | 가격·백테스트 테스트 + `typecheck` + `lint` (CI가 푸시·PR마다 실행) |
| `npm run test:pricing` | `tests/*.test.mjs` (산식, 정책, 빵 목록, 세션, 크론, 예측, 보상, 암호화) |
| `npm run backtest` | 90일 백테스트 실행 → `backtest/output/` |
| `npm run simulate:pricing` | 산식 파라미터 시뮬레이션 |
| `npm run probe:inputs` | 검색지수·당일 환율 시가가 몇 시에 준비되는지 측정 |
| `node scripts/cafe24-token.mjs` | 저장된 Cafe24 토큰 상태 확인 |
| `node scripts/backfill-daily-prices.mjs` | 과거 확정가 채우기 |

개발 중에는 `DEV_KST_DATE`·`DEV_KST_HOUR`로 서버의 "오늘"과 세션을 바꿔 볼 수 있습니다(프로덕션에서는 무시).

## 자동화

`vercel.json`의 크론이 하루를 돌립니다(스케줄은 UTC, 아래는 KST). Vercel Hobby 플랜이라 크론마다 하루 1회이고, 적어 둔 시각이 속한 한 시간 안 아무 때나 돕니다(예: 15:00 → 15:00~15:59). 몰 가격은 크론이 도는 순간 바뀌고, 앱 화면은 브라우저 시계로 06:00·16:00 정각에 바뀝니다.

| 시각 (KST) | 경로 | 하는 일 |
|---|---|---|
| 02:00 | `/api/internal/reset-list-price` | Cafe24 가격을 정가로 복귀, 잠금 보호 종료 |
| 02:30 | `/api/internal/sync-orders` | 최근 3일 Cafe24 주문을 읽어 KPI 테이블에 반영 |
| 05:30 | `/api/internal/daily-pricing?session=am` | 수집 → 오전가 계산 → Cafe24 반영 → 예측 판정·코드 발급 |
| 06:00~10:00 매시 | `/api/internal/daily-pricing?session=am&onlyIfMissing=1` | 검색지수가 늦어 보류된 상품만 다시 계산 |
| 15:00 | `/api/internal/daily-pricing?session=pm` | 오후가 계산 → 반영 → 잠금 차액 코드 발급 |

가격 크론은 운영 정책(`pricing_versions`)을 못 읽으면 계산하지 않고 503 으로 보류합니다. 코드의 대비값으로 가격을 내면 그날 어떤 산식이었는지 알 수 없게 되기 때문입니다.

같은 `(상품, 날짜, 세션, 산식버전)`은 한 번만 확정되므로 재시도해도 안전합니다.

대표 판매가와 옵션가는 함께 갱신됩니다. 옵션별 총 정가는
`config/cafe24-option-prices.ts`에 두고, 같은 할인율을 적용한 옵션 총액에서 대표
판매가를 뺀 값을 Cafe24 `additional_amount`로 보냅니다. 02:00 정가 리셋도 옵션
추가금을 원래 값으로 복원합니다. 실제 상품에서는 설정과 Cafe24 옵션명이 하나라도
다르면 반영 전에 실패합니다. 현재 데모 상품에는 옵션이 없어 대표 판매가만 반영되며,
데모몰에 실제와 같은 옵션명을 만들면 같은 옵션 반영 로직이 자동으로 적용됩니다.

## 어드민

`/admin`은 브라우저 기본 인증으로 잠겨 있습니다. 아이디는 아무거나, 비밀번호는 `ADMIN_PASSWORD`입니다(`proxy.ts`, `lib/admin/auth.ts`). 서버 액션도 같은 검사를 다시 합니다.

| 화면 | 하는 일 |
|---|---|
| `/admin/products` | 판매 중·오늘 오전가 반영·다음 가격 계산·확인 필요 요약, 상품 목록. 빵 추가(`/new`)·수정 — 화면 이름, 티커(추가할 때만), 상세 이름(몰 상품명), 정가, Cafe24 상품번호(연결 확인), 자사몰 주소, 네이버 검색어(최대 20개), 사진(4MB, JPG·PNG·WEBP), 판매 여부 |
| `/admin/pricing` | 산식·쿠폰 보상률 초안 → 저장 전 검사 → 90일 백테스트 → 새 버전 저장 |
| `/admin/audit` | 상품·산식·쿠폰 변경 기록(`admin_audit_log`, 지울 수 없음) |
| `/admin/kpi` | 008 의 KPI 뷰 |

빵 목록의 정본은 DB `products`입니다. 새 빵은 첫 가격 계산이 끝난 뒤 시세 목록에 나오고, 판매를 멈춘 빵은 목록에서 빠져도 이미 받은 잠금·쿠폰·기록은 그대로 보입니다.

## 현재 상태

- 버전 `0.1.0`, 비공개 프로젝트. 가격 산식은 v1.4([docs/산식-버전.md](docs/산식-버전.md))에서 시작해 백테스트로 90일 검증했습니다. 운영 `pricing_versions`에는 아직 v1.4 한 행뿐입니다(어드민 저장 없음). 이후 운영 버전은 어드민 상단에서 확인합니다.
- 연결된 Cafe24 몰은 데모몰 `rabbit3456`입니다. 할인코드·몰 가격 반영·주문 동기화가 모두 이 몰 기준입니다. makji.kr 로 옮기는 절차는 [docs/가격자동화-실행가이드.md](docs/가격자동화-실행가이드.md)에 있습니다.
- 화면은 서버 렌더에서 `lib/bread-market/page-data.ts`가 시세·잠금·예측을 직접 읽습니다. 실시세를 하나도 받지 못하면 지어낸 가격 대신 오류를 띄웁니다 — 시드 데이터는 개발 환경에서만 씁니다.
- 범위 밖: 자체 회원가입·결제, 이메일 지정가 알림, 구매가 기준 예측, 막지코인·배팅류 게임.
- 미결 항목은 [DESIGN.md](DESIGN.md)의 Open questions와 PRD §24에 있습니다.
