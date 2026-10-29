import { useState } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuMultiSelect } from '@/components/neumorphic/NeuMultiSelect'

/** URL 쿼리스트링과 1:1 로 대응하는 필터 값 (기간은 KST 날짜 YYYY-MM-DD). */
export interface TxFilters {
  from: string
  to: string
  systemIds: number[]
  role: string
  uri: string
  userIp: string
  userId: string
  minElapsed: string
  minSql: string
  errorOnly: boolean
  traceId: string
}

interface Props {
  value: TxFilters
  systemOptions: { value: number; label: string }[]
  onApply: (next: TxFilters) => void
  validate: (from: string, to: string) => string | null
}

export function TxFilterBar({ value, systemOptions, onApply, validate }: Props) {
  const [draft, setDraft] = useState<TxFilters>(value)
  const [invalid, setInvalid] = useState<string | null>(null)
  const set = <K extends keyof TxFilters>(key: K, v: TxFilters[K]) =>
    setDraft((d) => ({ ...d, [key]: v }))

  return (
    <NeuCard className="mb-4">
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          const msg = validate(draft.from, draft.to)
          setInvalid(msg)
          if (!msg) onApply(draft)
        }}
      >
        <NeuInput
          id="tx-from"
          type="date"
          label="시작일 (KST)"
          value={draft.from}
          onChange={(e) => set('from', e.target.value)}
        />
        <NeuInput
          id="tx-to"
          type="date"
          label="종료일 (KST)"
          value={draft.to}
          onChange={(e) => set('to', e.target.value)}
        />
        <NeuMultiSelect
          label="시스템"
          options={systemOptions}
          selected={draft.systemIds}
          onChange={(s) => set('systemIds', s.map(Number))}
        />
        <NeuInput
          id="tx-role"
          label="인스턴스"
          value={draft.role}
          onChange={(e) => set('role', e.target.value)}
        />
        <NeuInput
          id="tx-uri"
          label="URI"
          value={draft.uri}
          onChange={(e) => set('uri', e.target.value)}
        />
        <NeuInput
          id="tx-ip"
          label="사용자 IP"
          value={draft.userIp}
          onChange={(e) => set('userIp', e.target.value)}
        />
        <NeuInput
          id="tx-uid"
          label="사용자 ID"
          value={draft.userId}
          onChange={(e) => set('userId', e.target.value)}
        />
        <NeuInput
          id="tx-trace"
          label="트랜잭션 ID (trace_id)"
          value={draft.traceId}
          onChange={(e) => set('traceId', e.target.value)}
        />
        <NeuInput
          id="tx-min-elapsed"
          type="number"
          min={0}
          label="응답시간 > (ms)"
          value={draft.minElapsed}
          onChange={(e) => set('minElapsed', e.target.value)}
        />
        <NeuInput
          id="tx-min-sql"
          type="number"
          min={0}
          label="SQL 시간 > (ms)"
          value={draft.minSql}
          onChange={(e) => set('minSql', e.target.value)}
        />
        <label className="text-text-primary flex items-end gap-2 pb-3 text-sm">
          <input
            type="checkbox"
            checked={draft.errorOnly}
            onChange={(e) => set('errorOnly', e.target.checked)}
          />
          에러만
        </label>
        {invalid && (
          <p role="alert" className="text-critical-text text-xs sm:col-span-2 lg:col-span-4">
            {invalid}
          </p>
        )}
        <div className="flex items-end justify-end">
          <NeuButton type="submit">조회</NeuButton>
        </div>
      </form>
    </NeuCard>
  )
}
