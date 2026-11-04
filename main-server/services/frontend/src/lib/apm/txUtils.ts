import { toMs } from '@/lib/apm/canvas'
import type { TxSql, TxSummary } from '@/types/apm'

export const txKey = (tx: Pick<TxSummary, 'trace_id' | 'span_id'>) => `${tx.trace_id}:${tx.span_id}`

/** AP 시간 = 응답 − SQL − 외부 (음수는 0) */
export const apMs = (tx: TxSummary) => Math.max(0, tx.elapsed_ms - tx.sql_ms - (tx.ext_ms ?? 0))

/** 산점도 드래그로 고른 영역 (데이터 좌표: ts ms, 응답 ms) */
export interface TxBrush {
  t0: number
  t1: number
  y0: number
  y1: number
}

export function inBrush(tx: TxSummary, b: TxBrush): boolean {
  const ts = toMs(tx.start_ts)
  return ts >= b.t0 && ts <= b.t1 && tx.elapsed_ms >= b.y0 && tx.elapsed_ms <= b.y1
}

/** 예외 건수 = 트랜잭션 에러(0/1) + 에러가 난 SQL 건수 */
export function exceptionCount(summary: TxSummary, sql: TxSql[]): number {
  return (summary.error || summary.exc_class ? 1 : 0) + sql.reduce((n, s) => n + (s.err || 0), 0)
}
