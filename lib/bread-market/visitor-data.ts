import { decryptSecret } from "@/lib/crypto";
import { isPublicAt } from "@/lib/bread-market/reward-policy";
import { kstNow, marketClockOf } from "@/lib/market/calendar";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readVisitorHash } from "@/lib/visitor";

/* 이 브라우저의 잠금·예측. 쿠키(visitor_token)가 본인 확인을 대신하므로
   자기 것만 나온다.

   쿠키를 읽기만 한다 — 발급은 Route Handler 몫이다. 그래서 페이지 렌더에서
   불러도 된다. 쿠키가 없는 첫 방문자는 빈 값이 나오는데, 잠금도 예측도
   아직 없는 게 맞다.

   부르는 쪽은 반드시 dynamic 이어야 한다. 사람마다 다른 값이라 HTML 이
   캐시되면 남의 잠금이 보인다. */

export type ServerLockRow = {
  lock_date: string;
  lock_session: "am" | "pm";
  locked_price_won: number;
  lock_code_amount_won: number | null;
  status: string;
  products: { ticker: string; name: string } | null;
};

export type LockData = {
  lock: ServerLockRow | null;
  discountCode: string | null;
  validUntil: string | null;
};

export const EMPTY_LOCK: LockData = { lock: null, discountCode: null, validUntil: null };

/** 관계 컬럼은 supabase-js 가 객체로도 배열로도 추론한다. 첫 건만 쓴다. */
function oneProduct(p: unknown): { ticker: string; name: string } | null {
  const row = Array.isArray(p) ? p[0] : p;
  if (!row || typeof row !== "object") return null;
  const { ticker, name } = row as { ticker?: string; name?: string };
  return ticker ? { ticker, name: name ?? "" } : null;
}

export async function loadLock(): Promise<LockData> {
  const visitorHash = await readVisitorHash();
  if (!visitorHash) return EMPTY_LOCK;

  const { date } = kstNow();
  const db = supabaseAdmin();

  // date 는 02:00 에 바뀌는 시장 날짜라 자정 뒤 보호 구간도 같은 날 잠금이다.
  const { data, error } = await db
    .from("price_locks")
    .select(
      "id,product_id,lock_date,lock_session,locked_price_won,protect_from,protect_until,status,lock_code_amount_won,current_price_won_at_protect,reward_claim_id,products(ticker,name)",
    )
    .eq("visitor_hash", visitorHash)
    .eq("lock_date", date)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return EMPTY_LOCK;

  /* 보호가 시작되기 전에는 차액 금액도 상태도 감춘다. 오후가 크론이 15시대에
     돌아 16:00 전에 이미 쿠폰이 발급돼 있는데, 금액을 내려보내면 잠금가 + 금액
     으로 오후가가 역산되고 status("protecting") 하나만으로도 오후가가 잠금가보다
     올랐다는 게 드러난다. 아래에서 discountCode 를 막는 것과 같은 이유다.

     protect_from 타임스탬프 대신 시장 시계로 잰다. 보호 시작은 곧 그 날짜의
     오후가 공개 시각이라 판정이 같고, DEV_KST_* 가 듣지 않는 Date.now() 를
     섞지 않아야 시세 필터와 같은 시계로 움직인다. */
  const protectStarted = isPublicAt(data.lock_date, "pm", kstNow());

  /* 차액 할인코드는 이메일로 보내지 않고 여기서 바로 내려준다. */
  let discountCode: string | null = null;
  let validUntil: string | null = null;
  if (data.reward_claim_id) {
    const { data: claim } = await db
      .from("reward_claims")
      .select("discount_code_ciphertext,valid_from,valid_until,status")
      .eq("id", data.reward_claim_id)
      .maybeSingle();
    /* 보호 구간(16:00~다음 날 01:59) 안에서만 코드를 내려보낸다.

       끝: 시장 날짜가 02:00 에 바뀌며 이 조회에서 저절로 빠지지만 그 맞물림에
       기대지 않고 직접 본다.
       시작: 오후가 크론은 15시대에 돌아 16:00 공개를 준비한다. 그래서 16:00 전에
       이미 쿠폰이 발급돼 있는데, 그때 보여주면 몰에서 아직 쓸 수 없는 코드를
       쥐여주는 것이고 차액으로 오후가까지 역산된다. */
    const expired = claim?.valid_until ? new Date(claim.valid_until).getTime() <= Date.now() : false;
    if (claim?.discount_code_ciphertext && protectStarted && !expired) {
      try {
        discountCode = decryptSecret(claim.discount_code_ciphertext);
        validUntil = claim.valid_until;
      } catch {
        // 키가 바뀌었거나 값이 깨진 경우. 잠금 정보는 그대로 보여준다.
        discountCode = null;
      }
    }
  }

  return {
    lock: {
      lock_date: data.lock_date,
      lock_session: data.lock_session as "am" | "pm",
      locked_price_won: data.locked_price_won,
      lock_code_amount_won: protectStarted ? data.lock_code_amount_won : null,
      status: !protectStarted && data.status === "protecting" ? "active" : data.status,
      products: oneProduct(data.products),
    },
    discountCode,
    validUntil,
  };
}

export type ServerPredictionRow = {
  id: string;
  direction: "up" | "down";
  reference_price_won: number;
  target_publish_date: string;
  target_session: "am" | "pm";
  result: "pending" | "hit" | "miss" | "void";
  result_price_won: number | null;
  reward_rate_pct: number;
  /** 제출한 장. 기준가가 그 장의 확정가라, 같은 결과가라도 오전장·오후장 제출이 갈린다. */
  submitted_date: string;
  submitted_session: "am" | "pm";
  products: { ticker: string; name: string } | null;
  reward: { code: string | null; amountWon: number | null; validUntil: string | null } | null;
};

/* 제출 시각 → 시장 날짜·장. 시장 하루는 02:00 에 바뀌므로 00:00–01:59 제출은 전날 오후장이다. */
function submittedSessionOf(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const { date, hour } = marketClockOf(`${get("year")}-${get("month")}-${get("day")}`, Number(get("hour")) % 24);
  return { date, session: hour >= 16 ? ("pm" as const) : ("am" as const) };
}

export async function loadPredictions(): Promise<ServerPredictionRow[]> {
  const visitorHash = await readVisitorHash();
  if (!visitorHash) return [];

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("prediction_entries")
    .select(
      "id,product_id,direction,reference_price_won,target_publish_date,target_session,result,result_price_won,reward_rate_pct,submitted_at,resolved_at,products(ticker,name)",
    )
    .eq("visitor_hash", visitorHash)
    .eq("role", "general")
    .order("submitted_at", { ascending: false })
    /* 누적 기록을 화면이 직접 센다. 하루 한 번뿐이라 100 이면 100일치다.
       더 쌓이면 그때 count 질의로 바꾼다. */
    .limit(100);
  if (error) throw new Error(error.message);

  const entries = data ?? [];
  const hitIds = entries.filter((e) => e.result === "hit" || e.result === "void").map((e) => e.id);

  /* 보상 코드도 여기서 바로 내려준다. 자기 예측의 코드만 보인다. */
  const codes = new Map<string, { code: string | null; amountWon: number | null; validUntil: string | null }>();
  const now = Date.now();
  if (hitIds.length > 0) {
    const { data: claims } = await db
      .from("reward_claims")
      .select("prediction_entry_id,discount_code_ciphertext,amount_won,valid_until")
      .in("prediction_entry_id", hitIds);
    for (const claim of claims ?? []) {
      if (!claim.discount_code_ciphertext || !claim.prediction_entry_id) continue;
      try {
        /* 만료된 코드는 내려보내지 않는다. 몰에서 이미 안 먹는 번호를 복사하게
           두면 결제 직전에야 알게 된다. 예측 기록 자체는 남긴다 — 적중은 적중이다. */
        const expired = claim.valid_until ? new Date(claim.valid_until).getTime() <= now : false;
        codes.set(claim.prediction_entry_id, {
          code: expired ? null : decryptSecret(claim.discount_code_ciphertext),
          amountWon: claim.amount_won,
          validUntil: claim.valid_until,
        });
      } catch {
        // 키가 바뀌었거나 값이 깨진 경우. 예측 기록은 그대로 보여준다.
      }
    }
  }

  return entries.map((e) => {
    const submitted = submittedSessionOf(e.submitted_at);
    return {
      id: e.id,
      direction: e.direction as "up" | "down",
      reference_price_won: e.reference_price_won,
      target_publish_date: e.target_publish_date,
      target_session: e.target_session as "am" | "pm",
      result: e.result as ServerPredictionRow["result"],
      result_price_won: e.result_price_won,
      reward_rate_pct: e.reward_rate_pct,
      submitted_date: submitted.date,
      submitted_session: submitted.session,
      products: oneProduct(e.products),
      reward: codes.get(e.id) ?? null,
    };
  });
}

/** 만료됐거나 복호화에 실패하면 code 가 비고, 받았다는 사실만 남는다. */
export type InstantReward = {
  roundId: string;
  /** 쿠폰이 묶인 빵. 007 마이그레이션 전에 발급된 것은 null 이다. */
  product: { ticker: string; name: string } | null;
  /** 만료·복호화 실패면 null. 받았다는 사실만 남는다. */
  code: string | null;
  amountWon: number | null;
  ratePct: number;
  validUntil: string | null;
};

/**
 * 바로 받기로 받은 쿠폰. 예측 보상·잠금 차액과 달리 회차에만 묶여 있어
 * (reward_claims.round_id) 예측 목록 조회로는 잡히지 않는다.
 *
 * 쓸 수 있는 것만 내려보낸다 — 만료된 코드를 복사하면 결제 직전에야 안다.
 */
export async function loadInstantRewards(): Promise<InstantReward[]> {
  const visitorHash = await readVisitorHash();
  if (!visitorHash) return [];

  const { data, error } = await supabaseAdmin()
    .from("reward_claims")
    .select("round_id,rate_pct,amount_won,discount_code_ciphertext,valid_from,valid_until,products(ticker,name)")
    .eq("visitor_hash", visitorHash)
    .not("round_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);

  const now = Date.now();
  const out: InstantReward[] = [];
  for (const claim of data ?? []) {
    /* 만료된 것도 내려보내되 code 만 비운다. 회차당 한 번뿐인 참여권을 안정형에
       썼다는 사실은 3시간이 지나도 사라지지 않는다 — 화면이 그걸 모르면 예측을
       다시 열어주고, 누르면 서버가 409 를 준다 (predictions/route.ts). */
    const started = claim.valid_from ? new Date(claim.valid_from).getTime() <= now : true;
    const expired = claim.valid_until ? new Date(claim.valid_until).getTime() <= now : false;
    let code: string | null = null;
    if (started && !expired && claim.discount_code_ciphertext) {
      try {
        code = decryptSecret(claim.discount_code_ciphertext);
      } catch {
        // 키가 바뀌었거나 값이 깨진 경우. 받았다는 사실만 남긴다.
      }
    }
    out.push({
      roundId: claim.round_id as string,
      product: oneProduct(claim.products),
      code,
      amountWon: claim.amount_won,
      ratePct: claim.rate_pct,
      validUntil: claim.valid_until,
    });
  }
  return out;
}

/**
 * 지금까지 받은 할인코드 금액의 합(원). 예측 보상·바로 받기·잠금 차액을 모두 센다.
 * 만료·사용 여부와 상관없이 받았다는 사실은 남으므로 전부 더한다.
 * 아직 공개 전(valid_from 이 미래)인 잠금 코드는 화면에서도 안 보이므로 뺀다.
 */
export async function loadRewardTotalWon(): Promise<number> {
  const visitorHash = await readVisitorHash();
  if (!visitorHash) return 0;

  const { data, error } = await supabaseAdmin()
    .from("reward_claims")
    .select("amount_won")
    .eq("visitor_hash", visitorHash)
    .neq("status", "pending_email")
    .or(`valid_from.is.null,valid_from.lte.${new Date().toISOString()}`);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, c) => sum + (c.amount_won ?? 0), 0);
}
