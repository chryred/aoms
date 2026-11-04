/** "1079ms" 처럼 1000 이상인 ms 값은 "1.1s" 로 줄인다. 다른 형식은 그대로 */
export function abbreviateLabel(text: string): string {
  const m = /^(-?[\d,.]+)\s*ms$/.exec(text.trim())
  if (!m) return text
  const v = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(v) || Math.abs(v) < 1000) return text
  return `${(v / 1000).toFixed(1)}s`
}

/**
 * 축 높이(px)와 최소 간격으로 보일 y축 라벨 [최대, 중간, 최소]를 정한다.
 * 높이를 모르면(0) 모두 보이고, 간격이 모자라면 중간 라벨을 먼저 뺀다.
 */
export function visibleYLabels(
  heightPx: number,
  viewH: number,
  padY: number,
  minGap: number,
): [boolean, boolean, boolean] {
  if (heightPx <= 0) return [true, true, true]
  const top = (padY / 100) * heightPx
  const mid = heightPx / 2
  const bottom = ((viewH - padY) / 100) * heightPx
  const midOk = mid - top >= minGap && bottom - mid >= minGap
  return [true, midOk, bottom - top >= minGap]
}
