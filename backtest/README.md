# MAKJI 독립 백테스트

앱 코드와 분리된 90일 가격 백테스트입니다.

## 호출 원칙

- 네이버 통합 검색어 트렌드 API는 상품당 한 번씩 총 6회 순차 호출합니다.
- 각 요청의 `keywordGroups`에는 해당 상품 그룹 하나만 넣습니다.
- 따라서 검색지수는 상품별 90일 구간 안에서 독립적으로 0~100 정규화됩니다.
- 상품끼리 지수의 절대 크기를 비교하지 않고, 각 상품의 일별 가격 신호로만 사용합니다.
- 환율은 한국은행 ECOS `731Y003/0000003`의 원/달러 **종가 15:30**와 `731Y003/0000002`의 **시가**를 사용합니다.
- 오전 06:00 가격은 D-1 이하 최근 두 영업일 종가를 비교합니다.
- 오후 16:00 가격은 D 당일 시가와 D-1 이하 최근 종가를 비교합니다.
- 당일 시가가 없는 주말·공휴일의 오후 세션은 오전 가격을 유지합니다.
- 산식은 운영과 같은 `lib/pricing/pricing.mjs` 의 `calculateDay` 이고, 설정(`config.json`)도 운영 `config/pricing-products.json` 과 같은 v1.0 입니다.
- 검색 쿠폰은 상품별 Naver 검색지수 절댓값에 `0.15`를 곱해 0~15%p로 계산합니다.
- 환율 조정은 `환율하락률 × 0.28 × 50`(= ×14)이며, 내리면 최대 +28%p, 오르면 절반만 반영해 최대 −14%p입니다.
- 총 할인율은 `clamp(검색 쿠폰 + 환율 조정, 0, 38)`입니다. 정가를 넘지 않습니다.
- 판매가는 기준가에서 세션마다 독립적으로 계산하고 10원 단위로 반올림합니다.

네이버 공식 제한은 요청당 그룹 최대 5개, 그룹당 검색어 최대 20개, 일 1,000회입니다. 이 백테스트는 비교 정규화 문제를 피하기 위해 허용량보다 더 보수적으로 요청당 그룹 1개만 사용합니다.

## 환경변수

`backtest/.env`에 아래 두 값을 넣습니다.

```dotenv
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
NAVER_PROVIDER=hub
BOK_ECOS_API_KEY=... # 선택: 없으면 ECOS sample 키를 페이지 단위로 사용
```

한국은행 ECOS 키는 [ECOS Open API](https://ecos.bok.or.kr/api/)에서 발급합니다. 키가 없으면 로컬 검증에 한해 ECOS `sample` 키를 10건씩 페이지 조회합니다. 반복 실행과 운영 자동화에는 정식 키를 사용합니다. `.env`는 Git에서 제외됩니다. Frankfurter와 한국수출입은행의 매매기준율은 시가·종가 쌍이 아니므로 이 백테스트에 사용하지 않습니다.

`NAVER_PROVIDER=hub`는 NAVER Cloud의 API HUB 키와 `X-NCP-APIGW-*` 헤더를 사용합니다. Naver Developers에서 발급한 기존 오픈 API 키라면 `NAVER_PROVIDER=openapi`로 변경합니다.

## 실행

```bash
npm run backtest
```

기간과 종료일을 지정할 수 있습니다.

```bash
node backtest/run.mjs --days 90 --end 2026-09-15
```

다른 `.env`를 시험할 때는 다음처럼 지정합니다.

```bash
node backtest/run.mjs --env-file /absolute/path/to/.env --days 90
```

## 결과

매 실행마다 `backtest/output/YYYYMMDD-HHMMSS/` 아래에 생성됩니다.

- `report.md`: 사람이 읽는 요약과 API별 KST 호출 시간
- `summary.json`: 실행 조건, 산식, 상품별 통계
- `daily.csv`: 상품별·일별 오전/오후 입력·할인·판매가
- `api-calls.json`: 각 API의 시작·종료 시각과 소요 시간
- `raw/`: 자격증명을 제외한 네이버 상품별 원본 응답 6개와 ECOS 시가·종가 원본 응답

네이버 자격증명은 출력 파일과 로그에 기록하지 않습니다.
