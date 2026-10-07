# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-10-07
- Primary product surfaces: `/market`, `/me`, 상품 상세·가격 잠금·가격 예측 바텀시트
- Operator surface: `/admin`(상품 관리·할인율 관리·변경 기록·KPI). 손님 화면이 아니므로 아래 모바일 기준을 따르지 않는다 — Components 의 Admin 항목 참고.
- Evidence reviewed: `프로토타입_1차_3팀.html`, 실상품 촬영본 5종, `docs/PRD-브레드마켓.md`, `components/bread-market/*`

## Brand
- Personality: 친근한 동네 빵집과 매일 열리는 시장의 긴장감을 섞되, 금융 앱처럼 차갑거나 어렵게 보이지 않는다.
- Trust signals: 환율 기준 시각, 잠금 만료 시각, 최저가 보장 조건, 보상 상한을 짧고 명확하게 노출한다.
- Avoid: 손익·투자·매수·매도·지갑·배팅 용어, 빵보다 차트가 먼저 보이는 구성, 과도한 등락색과 호가창.

## Product goals
- Goals: 오전 탐색을 하루 1종목 잠금으로 전환하고, 오후 구매와 다음 날 결과 확인까지 연결한다.
- Non-goals: 자체 결제, 자체 회원가입, 이메일 지정가 알림, 복잡한 금융 시뮬레이션.
- Success signals: 잠금률, 잠금 후 구매율, 일반 예측 참여율, 다음 날 결과 확인율, 쿠폰 재구매율.

## Personas and jobs
- Primary personas: 환율·시장 밈에 익숙하고 가격에 민감한 20~30대 모바일 디저트 탐색자.
- User jobs: 먹고 싶은 빵을 먼저 발견하고, 오늘 사도 손해 보지 않는다는 확신을 얻고, 다음 날 다시 올 이유를 만든다.
- Key contexts of use: 출근·등교 중 오전 시세 확인, 오후 간식 구매, 다음 날 결과·쿠폰 확인.

## Information architecture
- Primary navigation: 하단의 `마켓`, `MY` 2탭만 사용한다. 아이콘이나 추가 메뉴는 넣지 않는다.
- Core routes/screens: 마켓, MY. 상품 상세·잠금·예측은 바텀시트로 처리한다.
- Content hierarchy: 빵 이미지 → 상품명 → 오늘 가격 → 잠금/구매 CTA → 등락·환율 → 검색 관심도.

## Design principles
- Bread first: 첫 화면과 카드에서 빵 비주얼이 금융 데이터보다 먼저 인지되어야 한다.
- One next action: 06:00은 예측 결과 확인·오전가 잠금, 16:00~01:59는 잠금가 비교·`02:00 정가 전에` 구매 하나만 강하게 보여준다. 오전·오후 중 고르는 선택은 두지 않는다.
- Anonymous first, commerce-owned identity: 시세·잠금·예측은 별도 가입 없이 익명 브라우저 기록으로 제공하고, 회원·결제·쿠폰 등록은 기존 막지몰 한 곳에서만 처리한다. 이를 "가입을 나중으로 미룬다"고 설명하지 않는다.
- Earned correction: 예측의 `다시 고르기`는 제출 전 뒤로 가기가 아니라, 제출 후 스토리 공유가 검증된 사용자에게 주는 1회 수정 기회로만 사용한다.
- Finance as seasoning: 주식 메타포는 등락과 시장 열기를 설명하는 보조 레이어로만 사용한다.
- No-regret lock: 잠금 화면마다 최저가 보장을 인접 배치해 가격 하락 불안을 제거한다.
- Tradeoffs: 상세 차트보다 제품 사진과 구매 판단을 우선하고, 복잡한 보상보다 2방향 일반 예측을 우선한다.

## Visual language
- Color: 1차 프로토타입의 아이보리 `#FBF8F3`, 잉크 `#15171E`, 소프트 블루 `#4087C7`, 웜그레이 선을 그대로 사용한다.
- Typography: 전 화면은 1차 프로토타입과 동일한 Pretendard 400–800을 사용하고, 제목은 800 굵기와 음수 자간으로 위계를 만든다.
- Spacing/layout rhythm: 18–20px 모바일 여백, 9–14px 카드 내부 간격, 사진 중심 1열 히어로와 2열 상품 그리드.
- Shape/radius/elevation: 12/18/26px 라운드 체계, 얇은 웜그레이 선, 원본과 같은 낮은 그림자를 사용한다.
- Motion: 바텀시트와 짧은 상태 전환만 사용하고, reduced-motion을 존중한다.
- Imagery/iconography: 사용자가 제공한 모닝롤·햄치즈 머핀·테트리스 브레드·스콘·휘낭시에 촬영본만 사용한다. 어드민에서 새로 추가한 빵은 운영자가 올린 실제 사진(Supabase Storage `bread-photos`)을 쓰고, 사진이 없으면 자리표시 이미지를 둔다. 생성 이미지와 스프라이트는 사용하지 않는다. 시세 목록에서는 행 크기를 키우기보다 썸네일 안 사진을 가까이 크롭해 빵 자체가 먼저 보이게 한다.

## Components
- Existing components to reuse: Next.js 라우트, API market snapshot, 하단 2탭 구조.
- New/changed components: 제품 히어로, 제품 사진 행, 가격 옆 잠금 아이콘, 활성 잠금 카드(마켓에서는 잠금했을 때만 보임), 잠금 확인·잠금 상세 바텀시트, 마켓 내 안정형/공격형 선택, 공격형 2방향 예측 시트, 닫기 버튼이 있는 하단 예측 도크, 지수 그래프 라벨 `지수 3개월 추이 · 낮을수록 저렴`.
- MY: 상단 요약 카드 하나 — `누적 혜택 N원`을 가장 크게, 그 아래 `예측 성과 x/y 적중`과 `받은 코드 n · 지금 m`. 누르는 곳은 카드 하나이고 누르면 내 기록 시트가 열린다. MY·기록 시트의 예측에는 예측한 장(오전장·오후장)을 함께 적는다.
- Admin: 왼쪽 어두운 메뉴(220px, 운영 정책 버전 표시) + 오른쪽 본문(최대 1360px). 화면 전체를 채우고 자기 안에서 스크롤한다. 색 변수는 `globals.css`를 그대로 쓰고 스타일은 `app/admin/admin.css`에 둔다.
- Variants and states: 잠금권 있음/사용, 잠금 대기/보호 중/만료, 차액 쿠폰 있음/현재가가 더 낮음, 일반 예측 적중/실패/무효. 향후 예측 제출 완료에는 스토리 공유 미완료/검증 완료/수정권 사용 완료 상태를 추가한다.
- Token/component ownership: 전역 색상·타이포·간격은 `app/globals.css`, 상호작용과 상품 이미지 매핑은 `components/bread-market/*`.

## Accessibility
- Target standard: WCAG 2.1 AA 수준의 대비와 키보드 접근.
- Keyboard/focus behavior: 모든 카드와 시트 행동은 실제 button/link를 사용하고, 시트에는 dialog semantics와 닫기 버튼을 제공한다.
- Contrast/readability: 색상만으로 등락·상태를 전달하지 않고 텍스트·기호를 병행한다.
- Screen-reader semantics: 상품 비주얼에 상품명 기반 대체 설명, 주요 내비게이션과 진행 상태에 label을 제공한다.
- Reduced motion and sensory considerations: `prefers-reduced-motion`에서 전환을 제거한다.

## Responsive behavior
- Supported breakpoints/devices: 360–430px 모바일 우선, 데스크톱에서는 430px 앱 셸로 중앙 정렬.
- Layout adaptations: 370px 이하에서 히어로 타이포·상품 이미지 높이·진행 상태 간격을 축소한다.
- Touch/hover differences: 터치 영역을 40px 안팎으로 확보하고, hover는 제품 사진 확대 정도만 사용한다.

## Interaction states
- Loading: 서버 렌더에서 시세·잠금·예측을 함께 읽어 첫 화면부터 실제 값으로 그린다. 장이 넘어가거나 화면이 30초 넘게 가려졌다 돌아오면 서버 값을 다시 받는다.
- Empty: 내 기록에서 잠금·예측 진입 링크를 직접 제공한다.
- Error: 실시세를 하나도 받지 못하면 지어낸 가격 대신 오류를 보여준다(시드 가격은 로컬 개발에서만). 잠금·예측 읽기가 실패하면 그 부분만 빈 상태로 둔다.
- Success: 상단 토스트와 내 기록 진행 상태를 함께 갱신한다.
- Disabled: 예측 방향 수정은 스토리 공유 검증 전에는 노출하지 않고, 검증 후에도 회차당 1회만 허용한다. 현재 버전에는 공유 검증이 없어 수정 진입점을 제공하지 않는다.
- Disabled: 잠금은 평일 오전장에만 연다. 오후장·정가 시간에는 시세 목록의 잠금 버튼을 비활성화하고 현재 장 이름(`오후장`·`정가`)을, 상세 시트에는 `잠금은 06:00부터`를 보여준다. 하루 잠금권 사용 후 다른 상품 잠금 버튼을 비활성화한다. 주말에도 장은 열리고 예측도 평일과 같지만, 오후가가 나오지 않아 잠금은 닫는다 — 버튼은 `휴장`, 상세 시트는 `주말 휴장 · 월요일 06:00`.
- Offline/slow network: 이미 받은 시세로 정렬·상세 보기는 계속 동작한다. 잠금·예측 제출은 서버가 필요하다.

## Content voice
- Tone: 짧고 친근하며 안심을 주는 커머스 언어.
- Terminology: `가격 잠금`, `잠금가`, `현재가`, `차액 쿠폰`, `시장 열기`, `내 기록`. 계정 구조는 `서비스는 비회원`, `회원·결제는 막지몰`로 구분한다.
- Microcopy rules: 한 문장에 한 행동, 금융 전문용어 대신 결과 중심 문구, 보상 조건은 숫자와 유효기간을 함께 표기한다.

## Implementation constraints
- Framework/styling system: Next.js 16, React 19, 전역 CSS, 추가 UI 의존성 없음.
- Design-token constraints: 현재 CSS 변수에서 확장하고 별도 디자인 시스템 패키지는 만들지 않는다.
- Performance constraints: 원본 8K 촬영본은 긴 변 1400px·JPEG 품질 82로 최적화한 파생 파일을 사용한다.
- Compatibility constraints: 모바일 Safari/Chrome의 native share 차이를 clipboard fallback으로 처리한다.
- Test/screenshot expectations: typecheck·build 후 390×844와 430×932에서 MARKET/ME 및 3개 바텀시트를 시각 검수한다.

## Open questions
- [x] 실상품 촬영본 5종 적용 / 2026-09-18
- [ ] 환율 변동 가격 상·하한 / 사업·재무 / 마진 리스크
- [ ] 비회원 하루 1종목 제한의 서버 식별 방식 / 개발 / 악용 방지
- [ ] 차액 쿠폰과 현재가 동시 적용의 실제 Cafe24 구현 가능성 / 운영·개발 / 정책 실행 가능성
- [ ] 공휴일 환율 이월 확인 / 개발·운영 / ECOS 에 종가가 없는 날은 자동 이월되는지 운영 데이터로 확인
- [ ] 스토리 공유 검증 방식과 회차당 수정권 저장 모델 / 제품·개발 / 공유 성공 콜백만으로 인정할지, 서버 검증 가능한 채널을 둘지 결정
