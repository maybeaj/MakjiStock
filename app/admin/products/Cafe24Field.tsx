"use client";

import { useState, useTransition } from "react";
import { checkCafe24Product, type Cafe24Check } from "./actions";

/* 상품번호 입력 + 연결 확인. 입력은 폼과 함께 제출된다 (name="cafe24_product_no"). */
export function Cafe24Field({ defaultValue, basePriceWon }: { defaultValue: number | null; basePriceWon?: number }) {
  const [no, setNo] = useState(defaultValue ? String(defaultValue) : "");
  const [result, setResult] = useState<Cafe24Check | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="ap-form" style={{ gap: 10 }}>
      <label className="ap-field">
        상품번호
        <input name="cafe24_product_no" inputMode="numeric" value={no} onChange={(e) => { setNo(e.target.value); setResult(null); }} />
        <small>비우면 이 빵은 몰 가격 반영과 쿠폰 발급에서 빠져요.</small>
      </label>
      <div className="ap-cafe24">
        <button type="button" className="ap-btn ap-btn--ghost" disabled={pending || !no.trim()} onClick={() => start(async () => setResult(await checkCafe24Product(Number(no))))}>
          {pending ? "확인 중…" : "연결 확인"}
        </button>
        <span role="status">
          {result
            ? result.ok
              ? `몰 상품: ${result.name} · 판매가 ${result.priceWon.toLocaleString("ko-KR")}원${basePriceWon && result.priceWon !== basePriceWon ? " — 정가와 달라요. 몰 판매가는 매 장 가격 계산 때 바뀌니 정가 기준으로 확인해 주세요." : ""}`
              : result.error
            : "Cafe24에서 상품명과 판매가를 읽어 와 맞는 상품인지 확인해요."}
        </span>
      </div>
    </div>
  );
}
