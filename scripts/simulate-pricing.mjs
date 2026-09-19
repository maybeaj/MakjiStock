import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fetchUsdKrwClosingRates } from "../lib/pricing/fx.mjs";
import {
  addDays,
  buildFxSignals,
  dateRange,
  simulateProduct,
  summarizeKeywordSeries,
  summarizeSimulation,
} from "./lib/pricing-core.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function loadEnvFile(envPath) {
  try {
    const contents = await readFile(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getKstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getNaverCredentials(provider) {
  if (provider === "hub") {
    const clientId =
      process.env.NAVER_API_HUB_CLIENT_ID ??
      process.env.NCP_CLIENT_ID ??
      process.env.NAVER_CLIENT_ID;
    const clientSecret =
      process.env.NAVER_API_HUB_CLIENT_SECRET ??
      process.env.NCP_CLIENT_SECRET ??
      process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "NAVER API HUB 키가 필요합니다. NAVER_API_HUB_* 또는 NAVER_CLIENT_*로 설정하세요.",
      );
    }
    return {
      endpoint: "https://naverapihub.apigw.ntruss.com/search-trend/v1/search",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
    };
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID/NAVER_CLIENT_SECRET가 필요합니다.");
  }
  return {
    endpoint: "https://openapi.naver.com/v1/datalab/search",
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  };
}

async function naverRequest({ provider, startDate, endDate, keywordGroups }) {
  const auth = getNaverCredentials(provider);
  const response = await fetch(auth.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...auth.headers,
    },
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit: "date",
      keywordGroups,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Naver DataLab ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

function resultToMap(result) {
  return Object.fromEntries(
    (result?.data ?? []).map((point) => [point.period, Number(point.ratio)]),
  );
}

function rollingAverageMap(ratioByDate, signalDates, windowSize) {
  if (windowSize <= 1) return ratioByDate;
  return Object.fromEntries(
    signalDates.map((date, index) => {
      if (!Number.isFinite(ratioByDate[date])) return [date, null];
      const values = signalDates
        .slice(Math.max(0, index - windowSize + 1), index + 1)
        .map((item) => ratioByDate[item])
        .filter(Number.isFinite);
      return [date, values.reduce((sum, value) => sum + value, 0) / values.length];
    }),
  );
}

async function fetchProductTrend(product, request) {
  const payload = await request([
    { groupName: product.ticker, keywords: product.keywords },
  ]);
  return resultToMap(payload.results?.[0]);
}

async function fetchKeywordProfiles(products, request) {
  const entries = products.flatMap((product) =>
    product.keywords.map((keyword) => ({ productId: product.id, keyword })),
  );
  const output = Object.fromEntries(products.map((product) => [product.id, {}]));

  for (let offset = 0; offset < entries.length; offset += 5) {
    const batch = entries.slice(offset, offset + 5);
    const payload = await request(
      batch.map((entry, index) => ({
        groupName: `k${offset + index}`,
        keywords: [entry.keyword],
      })),
    );
    batch.forEach((entry, index) => {
      output[entry.productId][entry.keyword] = resultToMap(payload.results?.[index]);
    });
  }
  return output;
}

async function loadFxRates(source, startDate, endDate, fxFile) {
  if (fxFile) {
    const payload = JSON.parse(await readFile(path.resolve(fxFile), "utf8"));
    return payload.fxRatesByDate ?? payload.rates ?? payload;
  }
  if (source !== "ecos") {
    throw new Error(
      `지원하지 않는 환율 소스입니다: ${source}. 가격 산정에는 ECOS 원/달러 종가만 사용합니다.`,
    );
  }
  const result = await fetchUsdKrwClosingRates({ startDate, endDate });
  return result.ratesByDate;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function rowsToCsv(rows) {
  const fields = [
    "publishDate",
    "signalDate",
    "ticker",
    "productName",
    "status",
    "searchRatio",
    "fxDeclinePct",
    "previousSearchRatio",
    "searchChangePoint",
    "searchCouponPct",
    "fxRawAdjustmentPct",
    "fxAdjustmentPct",
    "rawDiscountPct",
    "discountPct",
    "targetPriceWon",
    "priceWon",
    "previousPriceWon",
    "priceChangePct",
    "fxRateDate",
    "fxRate",
    "fxCarriedForward",
    "dailyMoveCapped",
  ];
  return [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(",")),
  ].join("\n");
}

function buildMarkdownReport(report) {
  const lines = [
    "# 가격 시뮬레이션 리포트",
    "",
    `- 신호 기간: ${report.period.startDate} ~ ${report.period.endDate}`,
    `- 가격 공개일: 신호일 다음 날 오전 9시를 가정`,
    `- 환율 소스: ${report.sources.fx}`,
    `- 검색 지수 전처리: ${report.searchWindowDays}일 이동평균`,
    `- 검색 쿠폰: 검색지수 × ${report.pricing.searchWeight}`,
    `- 환율 조정: 하락률 × ${report.pricing.fxWeight * report.pricing.fxScale} (최대 +${report.pricing.fxDiscountCapPct}%p), 상승분은 ${report.pricing.fxRisePassThroughPct ?? 100}%만 반영 (최대 −${report.pricing.fxSurchargeCapPct}%p)`,
    `- 총 할인율: clamp(검색 쿠폰 + 환율 조정, ${report.pricing.discountFloorPct ?? "−∞"}, ${report.pricing.discountCapPct})`,
    `- 가격 범위: 최대 ${report.pricing.discountCapPct}% 할인${(report.pricing.discountFloorPct ?? -1) >= 0 ? ", 정가 초과 없음" : ""}`,
    `- 전일 대비 가격 변동 제한: ${report.pricing.dailyPriceMoveCapPct ?? "없음"}${report.pricing.dailyPriceMoveCapPct === null ? "" : "%"}`,
    "",
    "## 상품별 가격 움직임",
    "",
    "| 상품 | 계산일 | 상승 | 하락 | 보합 | 평균 절대 등락률 | 95% 등락률 | 할인 상한 도달 | 가격 범위 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const product of report.products) {
    const summary = product.summary;
    lines.push(
      `| ${product.ticker} ${product.name} | ${summary.calculated} | ${summary.upDays} | ${summary.downDays} | ${summary.flatDays} | ${summary.meanAbsDailyPriceChangePct ?? "-"}% | ${summary.p95AbsDailyPriceChangePct ?? "-"}% | ${summary.capHits} | ${summary.minPriceWon?.toLocaleString("ko-KR") ?? "-"}~${summary.maxPriceWon?.toLocaleString("ko-KR") ?? "-"}원 |`,
    );
  }

  lines.push("", "## 키워드 진단", "");
  for (const product of report.products) {
    lines.push(`### ${product.name}`, "");
    lines.push(
      "| 키워드 | 판정 | 관측률 | 비영(0 초과) 비율 | 고유값 수 | 보합률 |",
      "|---|---|---:|---:|---:|---:|",
    );
    for (const metric of product.keywordMetrics) {
      lines.push(
        `| ${metric.keyword} | ${metric.grade} | ${metric.coveragePct}% | ${metric.nonZeroPct}% | ${metric.uniqueCount} | ${metric.flatPct}% |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## 해석 주의",
    "",
    "- 네이버 ratio는 절대 검색량이 아니라 한 요청 안의 최댓값을 100으로 둔 상대값입니다.",
    "- 상품별 지수는 서로 다른 상품의 검색량 크기를 비교하지 않도록 상품마다 별도 요청해 정규화했습니다.",
    "- 개별 키워드 판정은 관측 지속성과 움직임을 보는 용도이며, 서로 다른 요청의 ratio 크기를 직접 비교하지 않습니다.",
    "- 환율 데이터가 휴장일에 없으면 가장 최근 두 영업일의 하락률을 그대로 유지합니다.",
    "- API 데이터가 빠지면 0으로 계산하지 않고 직전 확정 가격을 유지합니다.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = path.resolve(args["env-file"] ?? path.join(projectRoot, ".env"));
  await loadEnvFile(envPath);

  const configPath = path.resolve(
    args.config ?? path.join(projectRoot, "config/pricing-products.json"),
  );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const pricing = {
    ...config.pricing,
    ...(args["search-weight"] && {
      searchWeight: Number(args["search-weight"]),
    }),
    ...(args["fx-weight"] && { fxWeight: Number(args["fx-weight"]) }),
    ...(args["fx-scale"] && { fxScale: Number(args["fx-scale"]) }),
    ...(args["fx-discount-cap"] && {
      fxDiscountCapPct: Number(args["fx-discount-cap"]),
    }),
    ...((args["fx-surcharge-cap"] || args["surcharge-cap"]) && {
      fxSurchargeCapPct: Number(
        args["fx-surcharge-cap"] ?? args["surcharge-cap"],
      ),
    }),
    ...(args["discount-cap"] && { discountCapPct: Number(args["discount-cap"]) }),
    ...(args["daily-move-cap"] && {
      dailyPriceMoveCapPct: Number(args["daily-move-cap"]),
    }),
  };
  const searchWindowDays = Number(args["search-window"] ?? 1);
  if (!Number.isInteger(searchWindowDays) || searchWindowDays < 1) {
    throw new Error("--search-window는 1 이상의 정수여야 합니다.");
  }
  const endDate = args.end ?? addDays(getKstDate(), -1);
  const startDate = args.start ?? addDays(endDate, -89);
  const provider = args["naver-provider"] ?? "hub";
  const fxSource = args["fx-source"] ?? "ecos";
  const outputDir = path.resolve(args.output ?? path.join(projectRoot, "artifacts"));
  const signalDates = dateRange(startDate, endDate);
  const searchStartDate = addDays(startDate, -1);
  const request = (keywordGroups) =>
    naverRequest({ provider, startDate: searchStartDate, endDate, keywordGroups });

  console.log(`Naver DataLab ${searchStartDate}..${endDate} 조회 중 (${provider})`);
  const productTrends = {};
  for (const product of config.products) {
    productTrends[product.id] = await fetchProductTrend(product, request);
  }
  const keywordProfiles = await fetchKeywordProfiles(config.products, request);

  console.log(`USD/KRW 환율 조회 중 (${fxSource})`);
  const fxRatesByDate = await loadFxRates(
    fxSource,
    addDays(startDate, -14),
    endDate,
    args["fx-file"],
  );
  const fxSignalsByDate = buildFxSignals(fxRatesByDate, signalDates);

  const allRows = [];
  const products = config.products.map((product) => {
    const rows = simulateProduct({
      product,
      pricing,
      signalDates,
      searchRatioByDate: rollingAverageMap(
        productTrends[product.id],
        signalDates,
        searchWindowDays,
      ),
      fxSignalsByDate,
    });
    allRows.push(...rows);
    const keywordMetrics = product.keywords
      .map((keyword) =>
        summarizeKeywordSeries(
          keyword,
          keywordProfiles[product.id][keyword],
          signalDates,
        ),
      )
      .sort((a, b) => {
        const gradeOrder = { strong: 0, usable: 1, sparse: 2 };
        return gradeOrder[a.grade] - gradeOrder[b.grade] || b.coveragePct - a.coveragePct;
      });
    return {
      id: product.id,
      ticker: product.ticker,
      name: product.name,
      basePriceWon: product.basePriceWon,
      cafe24ProductNo: product.cafe24ProductNo,
      summary: summarizeSimulation(rows, pricing),
      keywordMetrics,
      rows,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    period: { startDate, endDate, days: signalDates.length },
    sources: {
      naver: provider,
      fx: args["fx-file"] ? `file:${path.resolve(args["fx-file"])}` : fxSource,
    },
    pricing,
    searchWindowDays,
    products,
  };

  await mkdir(outputDir, { recursive: true });
  const stem = `pricing-simulation-${startDate}-${endDate}`;
  const jsonPath = path.join(outputDir, `${stem}.json`);
  const csvPath = path.join(outputDir, `${stem}.csv`);
  const markdownPath = path.join(outputDir, `${stem}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(csvPath, `${rowsToCsv(allRows)}\n`),
    writeFile(markdownPath, buildMarkdownReport(report)),
  ]);

  console.table(
    products.map((product) => ({
      ticker: product.ticker,
      calculated: product.summary.calculated,
      up: product.summary.upDays,
      down: product.summary.downDays,
      flat: product.summary.flatDays,
      meanAbsMovePct: product.summary.meanAbsDailyPriceChangePct,
      capHits: product.summary.capHits,
      strongKeywords: product.keywordMetrics.filter((item) => item.grade === "strong")
        .length,
      usableKeywords: product.keywordMetrics.filter((item) => item.grade === "usable")
        .length,
    })),
  );
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Markdown: ${markdownPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
