import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { timeComposition } from '@/lib/apm/resourceStats'
import { cn } from '@/lib/utils'
import type { TxSummary } from '@/types/apm'

/** 구간 색 — 시간축·콜 트리 막대와 같은 조용한 토큰 */
const SEG_CLASS: Record<string, string> = {
  sql: 'bg-apm-normal',
  fetch: 'bg-apm-normal/50',
  ext: 'apm-seg-remote',
  other: 'bg-text-tertiary/50',
}

const fmt = (n: number) => Math.round(n).toLocaleString()
const pct1 = (n: number) => `${n.toFixed(1)}%`

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-text-secondary border-border mb-2 border-b pb-1 text-xs font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="text-text-secondary">{k}</dt>
      <dd className="font-num text-text-primary text-right tabular-nums">{children}</dd>
    </div>
  )
}

const None = () => <span className="text-text-tertiary">없음</span>

/** 리소스 — 이 트랜잭션이 시간·DB·외부·커넥션을 어디에 썼는지 */
export function TxResourceTab({ summary: s }: { summary: TxSummary }) {
  const c = timeComposition(s)
  const leak = s.conn_leak > 0
  const uncommit = s.conn_uncommit > 0
  const bad = leak || uncommit

  return (
    <div className="@container min-w-0" data-testid="resource-tab">
      <div className="grid gap-8 @min-[720px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Group title="시간 구성">
            <div
              data-testid="time-bar"
              role="img"
              aria-label={`시간 구성 ${c.parts.map((p) => `${p.label} ${fmt(p.ms)}ms`).join(', ')}`}
              className="bg-muted-bg flex h-2 overflow-hidden rounded-sm"
            >
              {c.parts.map(
                (p) =>
                  p.ms > 0 && (
                    <span
                      key={p.key}
                      data-seg={p.key}
                      className={SEG_CLASS[p.key]}
                      style={{ width: `${p.pct}%` }}
                    />
                  ),
              )}
            </div>
            <ul className="mt-2 space-y-0.5">
              {c.parts.map((p) => (
                <li
                  key={p.key}
                  data-testid="time-legend"
                  className="flex items-center gap-2 py-0.5 text-sm"
                >
                  <span
                    aria-hidden="true"
                    className={cn('h-1.5 w-3 shrink-0 rounded-sm', SEG_CLASS[p.key])}
                  />
                  <span className="text-text-secondary flex-1">{p.label}</span>
                  <span className="font-num text-text-primary w-20 text-right tabular-nums">
                    {fmt(p.ms)}ms
                  </span>
                  <span className="font-num text-text-tertiary w-14 text-right tabular-nums">
                    {pct1(p.pct)}
                  </span>
                </li>
              ))}
            </ul>
            <p data-testid="cpu-line" className="text-text-secondary mt-2 text-xs">
              CPU <span className="font-num tabular-nums">{fmt(c.cpuMs)}ms</span> (전체의{' '}
              <span className="font-num tabular-nums">{pct1(c.cpuPct)}</span>) · 실제 경과 시간과
              별개의 CPU 사용량
            </p>
          </Group>

          <Group title="DB · 외부 호출">
            <dl>
              <Line k="SQL 수행">
                {s.sql_cnt > 0 ? (
                  <>
                    {s.sql_cnt.toLocaleString()}회 · 총 {fmt(s.sql_ms)}ms · 평균 {fmt(c.sqlAvgMs)}ms
                  </>
                ) : (
                  <None />
                )}
              </Line>
              <Line k="Fetch">
                {s.fetch_cnt > 0 ? (
                  <>
                    {s.fetch_cnt.toLocaleString()}건 · {fmt(s.fetch_ms)}ms
                  </>
                ) : (
                  <None />
                )}
              </Line>
              <Line k="외부 호출">
                {s.ext_cnt > 0 ? (
                  <>
                    {s.ext_cnt.toLocaleString()}회 · {fmt(s.ext_ms ?? 0)}ms
                  </>
                ) : (
                  <None />
                )}
              </Line>
            </dl>
          </Group>
        </div>

        <Group title="커넥션">
          <p
            data-testid="conn-flow"
            className="font-num text-text-primary flex items-center gap-2 text-sm tabular-nums"
          >
            열림 {s.conn_open}
            <ArrowRight className="text-text-tertiary h-4 w-4" aria-hidden="true" />
            반환 {s.conn_close}
          </p>
          <div
            data-testid="conn-status"
            data-state={bad ? (leak ? 'critical' : 'warning') : 'normal'}
            className={cn(
              'mt-3 flex items-start gap-2 rounded-sm px-3 py-2 text-sm',
              !bad && 'bg-apm-normal/10 text-text-secondary',
              bad && leak && 'bg-apm-critical/10 text-apm-critical-text',
              bad && !leak && 'bg-apm-warning/10 text-apm-warning-text',
            )}
          >
            {bad ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <div className="space-y-1">
              {!bad && <p>모든 커넥션이 정상 반환·커밋되었습니다.</p>}
              {leak && (
                <p>
                  미반환 <span className="font-num">{s.conn_leak}</span>건 — 열린 커넥션이 닫히지
                  않았습니다. 풀 고갈의 원인이 될 수 있습니다.
                </p>
              )}
              {uncommit && (
                <p>
                  미커밋 <span className="font-num">{s.conn_uncommit}</span>건 — 커밋·롤백 없이
                  종료된 트랜잭션이 있습니다.
                </p>
              )}
            </div>
          </div>
        </Group>
      </div>
    </div>
  )
}
