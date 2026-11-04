import type { TxSummary } from '@/types/apm'

/**
 * 시간 구성 — Agent-T 는 sql_ms(execute 구간)와 fetch_ms(ResultSet 순회)를 따로 누적하므로 겹치지 않는다.
 * 기타 AP = elapsed − sql − fetch − ext (대기·애플리케이션 처리 포함, 0 미만이면 0).
 */
export function timeComposition(t: TxSummary) {
  const sql = Math.max(0, t.sql_ms)
  const fetch = Math.max(0, t.fetch_ms)
  const ext = Math.max(0, t.ext_ms ?? 0)
  const other = Math.max(0, t.elapsed_ms - sql - fetch - ext)
  const total = Math.max(1, sql + fetch + ext + other)
  const pct = (ms: number) => (ms / total) * 100
  return {
    parts: [
      { key: 'sql', label: 'SQL', ms: sql, pct: pct(sql) },
      { key: 'fetch', label: 'Fetch', ms: fetch, pct: pct(fetch) },
      { key: 'ext', label: '외부 호출', ms: ext, pct: pct(ext) },
      { key: 'other', label: '기타 AP', ms: other, pct: pct(other) },
    ],
    cpuMs: Math.max(0, t.cpu_ms),
    cpuPct: t.elapsed_ms > 0 ? (Math.max(0, t.cpu_ms) / t.elapsed_ms) * 100 : 0,
    sqlAvgMs: t.sql_cnt > 0 ? sql / t.sql_cnt : 0,
  }
}
