/** 워터폴 공통 눈금 — 0, ¼, ½, ¾, 전체 (ms) */
export interface TimeTick {
  /** 0~1 위치 */
  frac: number
  ms: number
}

export function timeTicks(totalMs: number): TimeTick[] {
  const total = Math.max(0, totalMs)
  return [0, 0.25, 0.5, 0.75, 1].map((frac) => ({ frac, ms: Math.round(total * frac) }))
}

/** 막대의 left/width(%) — 시작 오프셋과 길이를 공통 스케일에 얹는다. 폭은 CSS min-width 로 최소 2px 보장 */
export function barRange(startMs: number, durMs: number, totalMs: number) {
  if (totalMs <= 0) return { left: 0, width: 0 }
  const left = Math.min(100, Math.max(0, (startMs / totalMs) * 100))
  const width = Math.min(100 - left, Math.max(0, (durMs / totalMs) * 100))
  return { left, width }
}
