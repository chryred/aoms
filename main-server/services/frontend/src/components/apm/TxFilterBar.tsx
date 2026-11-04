import { useState, type ReactNode } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuMultiSelect } from '@/components/neumorphic/NeuMultiSelect'
import { cn } from '@/lib/utils'

/** URL 쿼리스트링과 대응하는 필터 값 (기간은 KST 날짜 YYYY-MM-DD + 선택적 시각 HH:mm:ss). */
export interface TxFilters {
  from: string
  fromTime: string
  to: string
  toTime: string
  systemIds: number[]
  role: string
  uri: string
  userIp: string
  userId: string
  minElapsed: string
  maxElapsed: string
  minSql: string
  errorOnly: boolean
  traceId: string
  spanId: string
  bizKey: string
  minFetch: string
  minSqlCnt: string
  minConn: string
}

interface Props {
  value: TxFilters
  systemOptions: { value: number; label: string }[]
  onApply: (next: TxFilters) => void
  validate: (f: TxFilters) => string | null
}

const INPUT =
  'bg-bg-base border-border shadow-neu-inset text-text-primary placeholder:text-text-disabled focus:ring-accent focus:ring-offset-bg-base w-full min-w-0 rounded-sm border px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-offset-1 focus:outline-none'

/** 라벨을 입력 왼쪽에 두는 조밀한 한 줄 필드 */
function Field({
  label,
  children,
  className,
  wrap,
}: {
  label: string
  children: ReactNode
  className?: string
  /** 좁은 폭에서 입력을 다음 줄로 넘긴다 (기간 필드) */
  wrap?: boolean
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="text-text-secondary w-[4.5rem] shrink-0 text-xs font-medium">{label}</span>
      <div
        className={cn('flex min-w-0 flex-1 items-center gap-1.5', wrap && 'flex-wrap gap-y-1.5')}
      >
        {children}
      </div>
    </div>
  )
}

const DETAIL_KEYS: (keyof TxFilters)[] = [
  'bizKey',
  'minFetch',
  'minSqlCnt',
  'minConn',
  'spanId',
  'traceId',
  'minSql',
]

export function TxFilterBar({ value, systemOptions, onApply, validate }: Props) {
  const [draft, setDraft] = useState<TxFilters>(value)
  const [invalid, setInvalid] = useState<string | null>(null)
  // 상세 조건이 이미 걸려 있으면 처음부터 펼쳐 보여준다
  const [detail, setDetail] = useState(() => DETAIL_KEYS.some((k) => value[k] !== ''))
  const set = <K extends keyof TxFilters>(key: K, v: TxFilters[K]) =>
    setDraft((d) => ({ ...d, [key]: v }))
  const text = (key: keyof TxFilters, label: string, extra?: { type?: string; min?: number }) => (
    <input
      aria-label={label}
      className={cn(
        INPUT,
        extra?.type === 'number' &&
          '[appearance:textfield] px-1.5 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
      )}
      type={extra?.type}
      min={extra?.min}
      value={draft[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
    />
  )

  return (
    <NeuCard className="mb-4 p-4">
      <form
        className="grid grid-cols-1 gap-x-5 gap-y-2.5 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          const msg = validate(draft)
          setInvalid(msg)
          if (!msg) onApply(draft)
        }}
      >
        <Field label="기간 (KST)" className="md:col-span-2 xl:col-span-3" wrap>
          <input
            aria-label="시작일 (KST)"
            type="date"
            className={cn(INPUT, 'w-auto min-w-[8.5rem] flex-1')}
            value={draft.from}
            onChange={(e) => set('from', e.target.value)}
          />
          <input
            aria-label="시작 시각 (KST, 선택)"
            type="time"
            step={1}
            className={cn(INPUT, 'w-auto min-w-[8rem] flex-1')}
            value={draft.fromTime}
            onChange={(e) => set('fromTime', e.target.value)}
          />
          <span className="text-text-secondary">~</span>
          <input
            aria-label="종료일 (KST)"
            type="date"
            className={cn(INPUT, 'w-auto min-w-[8.5rem] flex-1')}
            value={draft.to}
            onChange={(e) => set('to', e.target.value)}
          />
          <input
            aria-label="종료 시각 (KST, 선택)"
            type="time"
            step={1}
            className={cn(INPUT, 'w-auto min-w-[8rem] flex-1')}
            value={draft.toTime}
            onChange={(e) => set('toTime', e.target.value)}
          />
        </Field>
        <Field label="시스템">
          <NeuMultiSelect
            options={systemOptions}
            selected={draft.systemIds}
            onChange={(s) => set('systemIds', s.map(Number))}
            className="w-full"
          />
        </Field>
        <Field label="인스턴스">{text('role', '인스턴스')}</Field>

        <Field label="수행 시간">
          {text('minElapsed', '응답시간 > (ms)', { type: 'number', min: 0 })}
          <span className="text-text-secondary">~</span>
          {text('maxElapsed', '응답시간 < (ms)', { type: 'number', min: 0 })}
          <span className="text-text-secondary text-xs">ms</span>
        </Field>
        <Field label="URI">{text('uri', 'URI')}</Field>
        <Field label="IP">{text('userIp', '사용자 IP')}</Field>
        <Field label="사용자 ID">{text('userId', '사용자 ID')}</Field>

        {detail && (
          <>
            <Field label="거래 키">{text('bizKey', '거래 키')}</Field>
            <Field label="Fetch ≥">
              {text('minFetch', 'Fetch Count ≥', { type: 'number', min: 0 })}
            </Field>
            <Field label="SQL 시간 ≥">
              {text('minSql', 'SQL 시간 > (ms)', { type: 'number', min: 0 })}
              <span className="text-text-secondary text-xs">ms</span>
            </Field>
            <Field label="SQL 실행 ≥">
              {text('minSqlCnt', 'SQL 실행 ≥', { type: 'number', min: 0 })}
            </Field>
            <Field label="Open Conn ≥">
              {text('minConn', 'Open Conn ≥', { type: 'number', min: 0 })}
            </Field>
            <Field label="TID">{text('spanId', 'TID (span_id)')}</Field>
            <Field label="GUID">{text('traceId', '트랜잭션 ID (trace_id)')}</Field>
          </>
        )}

        {invalid && (
          <p role="alert" className="text-critical-text text-xs md:col-span-2 xl:col-span-4">
            {invalid}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3 md:col-span-2 xl:col-span-4">
          <div
            role="group"
            aria-label="결과 구분"
            className="bg-bg-deep border-border flex rounded-sm border p-0.5"
          >
            {[
              { label: '전체', on: !draft.errorOnly },
              { label: '에러만', on: draft.errorOnly },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={o.on}
                onClick={() => set('errorOnly', o.label === '에러만')}
                className={cn(
                  'min-h-[32px] rounded-sm px-3 text-xs',
                  o.on
                    ? 'bg-bg-base shadow-neu-pressed text-text-primary font-semibold'
                    : 'text-text-secondary hover:text-text-primary font-normal',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="조건 표시"
            className="bg-bg-deep border-border flex rounded-sm border p-0.5"
          >
            {[
              { label: '기본', on: !detail },
              { label: '상세', on: detail },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={o.on}
                onClick={() => setDetail(o.label === '상세')}
                className={cn(
                  'min-h-[32px] rounded-sm px-3 text-xs',
                  o.on
                    ? 'bg-bg-base shadow-neu-pressed text-text-primary font-semibold'
                    : 'text-text-secondary hover:text-text-primary font-normal',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <NeuButton type="submit" size="sm">
            조회
          </NeuButton>
        </div>
      </form>
    </NeuCard>
  )
}
