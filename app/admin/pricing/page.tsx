import pricingConfig from "@/config/pricing-products.json";
import { loadPriceStats } from "@/lib/admin/data";
import { CAP_TOTAL, SEARCH_MOMENTUM_WEIGHT } from "@/lib/bread-market/engine";
import {
  INSTANT_CODE_HOURS,
  INSTANT_REWARD_PCTS,
  PREDICTION_REWARD_MAX_PCT,
  PREDICTION_REWARD_MIN_PCT,
  PRODUCT_DISCOUNT_CAP_PCT,
  TOTAL_CAP_PCT,
} from "@/lib/bread-market/reward-policy";

export const dynamic = "force-dynamic";

/* 1차는 보기 전용이다. 산식은 config/pricing-products.json(크론)과 engine.ts(화면) 두 곳의
   상수라 여기서 고쳐도 반영할 곳이 없다. 산식을 DB 버전 테이블로 옮기는 2차에서 저장을 연다. */

const p = pricingConfig.pricing;
const range = (xs: readonly number[]) => `${Math.min(...xs)}~${Math.max(...xs)}%`;
const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;

export default async function AdminPricingPage() {
  const stats = await loadPriceStats(p.discountCapPct);

  const formula = [
    { label: "검색 가중치", help: `검색지수 × 가중치 = 검색 할인 (최대 ${Math.round(100 * p.searchWeight)}%p)`, value: String(p.searchWeight) },
    { label: "환율 배율", help: "환율 변화율 × 배율 = 환율 할인", value: String(Math.round(p.fxWeight * p.fxScale * 100) / 100) },
    { label: "환율 할인 상한", help: "내릴 때 최대 %p", value: `${p.fxDiscountCapPct}%p` },
    { label: "환율 할증 상한", help: "오를 때 할인을 줄이는 최대 %p", value: `${p.fxSurchargeCapPct}%p` },
    { label: "환율 상승 반영", help: "오른 만큼 할인을 줄이는 비율", value: `${p.fxRisePassThroughPct}%` },
    { label: "상품 할인 상한", help: "정가 대비 최대 할인", value: `${p.discountCapPct}%` },
    { label: "상품 할인 하한", help: "0 이면 정가를 넘지 않아요", value: `${p.discountFloorPct}%` },
  ];
  const coupons = [
    { label: "안정형 · 오전장", help: "누르면 바로 받기", value: range(INSTANT_REWARD_PCTS.am), hours: `${INSTANT_CODE_HOURS}시간`, color: "#2C6199" },
    { label: "안정형 · 오후장", help: "누르면 바로 받기", value: range(INSTANT_REWARD_PCTS.pm), hours: `${INSTANT_CODE_HOURS}시간`, color: "#2C6199" },
    { label: "공격형", help: "맞히거나 같으면 받기", value: `${PREDICTION_REWARD_MIN_PCT}~${PREDICTION_REWARD_MAX_PCT}%`, hours: "24시간", color: "#B02A63" },
  ];

  const instantMax = Math.max(...INSTANT_REWARD_PCTS.am, ...INSTANT_REWARD_PCTS.pm);
  const orderMax = p.discountCapPct + PREDICTION_REWARD_MAX_PCT;
  const checks = [
    { ok: orderMax <= TOTAL_CAP_PCT, text: `주문당 최대 ${p.discountCapPct}% + ${PREDICTION_REWARD_MAX_PCT}% = ${orderMax}% (한도 ${TOTAL_CAP_PCT}%)` },
    { ok: instantMax < PREDICTION_REWARD_MAX_PCT, text: `안정형 최대 ${instantMax}% < 공격형 최대 ${PREDICTION_REWARD_MAX_PCT}%` },
    { ok: p.discountFloorPct >= 0, text: "판매가는 정가를 넘지 않음" },
    /* 같은 값이 세 곳에 있다. 어긋나면 크론과 화면과 쿠폰 천장이 서로 다른 상한을 쓴다. */
    {
      ok: CAP_TOTAL === p.discountCapPct && PRODUCT_DISCOUNT_CAP_PCT === p.discountCapPct && SEARCH_MOMENTUM_WEIGHT === p.searchWeight,
      text: "크론(config)·화면(engine)·쿠폰(reward-policy) 상한이 같음",
    },
  ];
  const capW = (p.discountCapPct / TOTAL_CAP_PCT) * 100;
  const couponW = (PREDICTION_REWARD_MAX_PCT / TOTAL_CAP_PCT) * 100;

  return (
    <main className="ap">
      <div className="ap__head">
        <div>
          <div className="ap__sub">지금은 보기 전용이에요. 값 수정과 새 버전 저장은 2차에서 열려요.</div>
          <h1>할인율 관리</h1>
        </div>
        <span className="ap-chip">운영 중 <b>{p.formulaVersion}</b></span>
      </div>

      <div className="ap-grid2">
        <section className="ap-box">
          <div className="ap-box__h"><h2>상품 할인 (산식)</h2><span>매 장 가격에 들어가요</span></div>
          <div className="ap-rows">
            {formula.map((f) => (
              <div key={f.label} className="ap-kv">
                <div><b>{f.label}</b><small>{f.help}</small></div>
                <em>{f.value}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="ap-box">
          <div className="ap-box__h"><h2>쿠폰 보상률</h2><span>바꾸면 새로 받는 쿠폰부터</span></div>
          <div className="ap-rows">
            {coupons.map((c) => (
              <div key={c.label} className="ap-kv">
                <div><b style={{ color: c.color }}>{c.label}</b><small>{c.help} · {c.hours} 안에 사용</small></div>
                <em>{c.value}</em>
              </div>
            ))}
          </div>
          <p className="ap__note" style={{ margin: 0 }}>안정형 최대값이 공격형 최대값보다 작아야 공격형을 고를 이유가 생겨요.</p>
        </section>
      </div>

      <section className="ap-box">
        <div className="ap-box__h"><h2>안전 검사</h2><span>2차에서는 하나라도 실패하면 저장할 수 없어요</span></div>
        <div className="ap-bar" aria-label={`상품 할인 ${p.discountCapPct}%, 쿠폰 ${PREDICTION_REWARD_MAX_PCT}%, 한도 ${TOTAL_CAP_PCT}%`}>
          <div style={{ width: `${capW}%`, background: "#15171E", color: "#fff" }}>상품 할인 {p.discountCapPct}%</div>
          <div style={{ width: `${couponW}%`, background: "#B02A63", color: "#fff" }}>쿠폰 {PREDICTION_REWARD_MAX_PCT}%</div>
          <div style={{ flex: 1, justifyContent: "flex-end", color: "var(--ink-2)" }}>한도 {TOTAL_CAP_PCT}%</div>
        </div>
        <div className="ap-checks">
          {checks.map((c) => (
            <div key={c.text} className={`ap-msg ${c.ok ? "ap-msg--ok" : "ap-msg--err"}`}>{c.ok ? "통과" : "실패"} · {c.text}</div>
          ))}
        </div>
      </section>

      <section className="ap-box">
        <div className="ap-box__h">
          <h2>지난 90일 실제 발행가</h2>
          <span>{stats.sessions}개 장 · 같은 장을 다시 계산한 경우 마지막 버전만</span>
        </div>
        <div className="ap-cards">
          <div className="ap-card"><span>평균 할인</span><b>{pct(stats.avgDiscountPct, 2)}</b></div>
          <div className="ap-card"><span>상한 {p.discountCapPct}%에 닿은 장</span><b>{pct(stats.capHitPct)}</b></div>
          <div className="ap-card"><span>정가로 멈춘 장</span><b>{pct(stats.listPricePct)}</b></div>
          <div className="ap-card"><span>직전 대비 최대 변동</span><b>{pct(stats.maxMovePct)}</b></div>
        </div>
        <p className="ap__note" style={{ margin: 0 }}>
          90일 중에는 예전 산식 버전으로 나간 가격도 섞여 있어요. 초안 값으로 다시 계산해 비교하는 백테스트는 2차에서 열려요.
        </p>
      </section>
    </main>
  );
}
