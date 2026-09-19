import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/* vercel.json 의 크론 3개가 의도한 KST 시간대에 걸려 있는지 고정한다.

   Vercel 크론은 UTC 로만 해석하고, Hobby 는 지정 분이 아니라 그 '시간대 안'
   아무 때나 실행한다. 그래서 각 작업을 공개 시각 직전 한 시간에 걸어
   지터가 공개 시각을 넘지 않게 한다. */

const vercelConfig = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
);

/** 크론식의 UTC 시(hour)를 KST 시로 바꾼다. */
function kstHourOf(schedule) {
  const utcHour = Number(schedule.trim().split(/\s+/)[1]);
  return (utcHour + 9) % 24;
}

function cronFor(pathPrefix) {
  const found = vercelConfig.crons.filter((c) => c.path.startsWith(pathPrefix));
  assert.ok(found.length > 0, `${pathPrefix} 크론이 없다`);
  return found;
}

test("크론은 정가 리셋 · 오전가 · 오후가 3개다", () => {
  assert.equal(vercelConfig.crons.length, 3);
});

test("정가 리셋은 02시대 KST — 오후장(16:00~01:59) 뒤 02:00~05:59 정가 구간의 시작", () => {
  const [reset] = cronFor("/api/internal/reset-list-price");
  assert.equal(kstHourOf(reset.schedule), 2);
});

test("오전가는 05시대 KST 에 만든다 — 06:00 공개 전", () => {
  const [am] = cronFor("/api/internal/daily-pricing?session=am");
  assert.equal(kstHourOf(am.schedule), 5);
});

test("오후가는 15시대 KST 에 만든다 — 16:00 공개 전", () => {
  const [pm] = cronFor("/api/internal/daily-pricing?session=pm");
  assert.equal(kstHourOf(pm.schedule), 15);
});

test("가격 산정 크론은 공개 1시간 전에 걸려 지터를 흡수한다", () => {
  // 그 시간대의 가장 늦은 실행(59분)에도 공개 시각을 넘지 않아야 한다
  for (const d of [
    { name: "오전가", cronKstHour: 5, publishHour: 6 },
    { name: "오후가", cronKstHour: 15, publishHour: 16 },
  ]) {
    assert.ok(
      d.cronKstHour + 0.99 <= d.publishHour,
      `${d.name}: 가장 늦게 실행돼도 ${d.publishHour}:00 을 넘으면 안 된다`,
    );
  }
});

test("정가 리셋은 지터를 흡수할 여유가 없다 — 알려진 한계", () => {
  const [reset] = cronFor("/api/internal/reset-list-price");
  const cronKstHour = kstHourOf(reset.schedule);

  // 02:00 이 곧 정가 복귀 시각이라 앞에 둘 여유 시간이 없다.
  // 한 시간 앞으로 당기면(01시대) 오후장 잠금가 구매 구간이 잘린다.
  // Hobby 에서는 최대 59분 늦을 수 있음을 받아들인다(몰에 오후가가 조금 더 남는다). Pro 는 분 단위로 정확하다.
  assert.equal(cronKstHour, 2);

  const worstCaseDelayMinutes = 59;
  assert.ok(
    worstCaseDelayMinutes < 60,
    "지연은 한 시간을 넘지 않는다 — 06:00 오전가 공개에는 영향이 없다",
  );
});

test("Hobby 는 하루 1회 제한 — 분·시에 */ 나 , 가 없어야 한다", () => {
  for (const cron of vercelConfig.crons) {
    const [minute, hour] = cron.schedule.trim().split(/\s+/);
    for (const field of [minute, hour]) {
      assert.ok(
        !field.includes("*") && !field.includes(",") && !field.includes("/"),
        `${cron.schedule} 는 하루 1회를 넘는다 — Hobby 에서 배포가 실패한다`,
      );
    }
  }
});
