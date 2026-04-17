// 과거 레코드에 LLM 응답 JSON 원문이 alert_history.title로 저장된 경우를
// 방어적으로 한 줄 요약해서 보여준다. 신규 레코드는 백엔드에서 올바른 title이 들어와 그대로 통과.
export function formatAlertTitle(title: string | null | undefined): string {
  if (!title) return '-'
  const trimmed = title.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return title
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const pick = (k: string) => (typeof parsed[k] === 'string' ? (parsed[k] as string).trim() : '')
    return pick('root_cause') || pick('recommendation') || pick('anomaly_type') || '분석 내용 없음'
  } catch {
    return title
  }
}
