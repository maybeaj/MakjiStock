/** 예측 기준가와 판정 장을 서버·화면·테스트가 함께 쓰는 단일 정책.

    예측은 하루 한 번, 판정은 언제나 다음 날 06:00 오전가다. 주말도 쉬지 않는다.
    잠금이 "오늘 오후가"를 다루므로 예측까지 같은 사건에 걸면 한 번의 가격
    상승에 보상이 두 번 나간다. 06:00 결과 확인이 다음 날 재방문 이유가 된다.
    docs/가격-잠금-1회-사유.md */
export function predictionSchedule(date: string, hour: number) {
  // date 는 02:00 에 바뀌는 시장 날짜다. 다음 날은 그냥 하루 뒤.
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const targetDate = next.toISOString().slice(0, 10);
  return {
    submitSession: hour >= 16 ? ("pm" as const) : ("am" as const),
    referenceDate: date,
    targetDate,
    targetSession: "am" as const,
    closesAt: `${targetDate}T06:00:00+09:00`,
    label: "내일 06:00 오전가",
  };
}
