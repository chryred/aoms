import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useFeedbackSearch } from '@/hooks/queries/useFeedbackSearch'
import { useSystems } from '@/hooks/queries/useSystems'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { cn, formatKST } from '@/lib/utils'
import type { FeedbackSearchItem } from '@/api/alerts'
import type { Severity } from '@/types/alert'

const PAGE_SIZE = 20

const ALERT_TYPE_LABEL: Record<string, string> = {
  metric: '메트릭',
  metric_resolved: '메트릭(복구)',
  log_analysis: '로그분석',
}

export function FeedbackSearchPage() {
  const [systemId, setSystemId] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<FeedbackSearchItem | null>(null)

  const { data: systems = [] } = useSystems()

  const { data, isLoading, error, refetch } = useFeedbackSearch({
    system_id: systemId ? Number(systemId) : undefined,
    q: appliedKeyword || undefined,
    limit: PAGE_SIZE,
    offset,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const applySearch = () => {
    setAppliedKeyword(keyword.trim())
    setOffset(0)
  }

  const onKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applySearch()
    }
  }

  const onSystemChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSystemId(e.target.value)
    setOffset(0)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  return (
    <>
      <div className="mb-3 flex items-baseline gap-3">
        <h1 className="text-text-primary text-base font-bold">해결책 검색</h1>
        <p className="text-text-secondary text-xs">
          과거 등록된 원인/해결책을 시스템·키워드로 빠르게 찾아봅니다
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-56">
          <NeuSelect value={systemId} onChange={onSystemChange}>
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>
        </div>
        <div className="min-w-[240px] flex-1">
          <NeuInput
            placeholder="원인 또는 해결책 키워드"
            leftIcon={<Search className="h-4 w-4" />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={onKeywordKeyDown}
          />
        </div>
        <NeuButton onClick={applySearch}>검색</NeuButton>
        {(appliedKeyword || systemId) && (
          <NeuButton
            variant="ghost"
            onClick={() => {
              setKeyword('')
              setAppliedKeyword('')
              setSystemId('')
              setOffset(0)
            }}
          >
            초기화
          </NeuButton>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton shape="table" count={8} />
      ) : error ? (
        <ErrorCard onRetry={refetch} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="등록된 해결책이 없습니다"
          description="검색 조건을 변경해 보세요"
        />
      ) : (
        <NeuCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-border text-text-primary border-b text-left text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2.5">번호</th>
                  <th className="whitespace-nowrap px-3 py-2.5">심각도</th>
                  <th className="whitespace-nowrap px-3 py-2.5">유형</th>
                  <th className="whitespace-nowrap px-3 py-2.5">시스템명</th>
                  <th className="px-3 py-2.5">제목</th>
                  <th className="whitespace-nowrap px-3 py-2.5">등록자</th>
                  <th className="whitespace-nowrap px-3 py-2.5">등록일</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const active = selected?.id === row.id
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelected(row)}
                      className={cn(
                        'border-border text-text-primary cursor-pointer border-b transition-colors last:border-b-0',
                        active ? 'bg-accent-muted' : 'hover:bg-hover-subtle',
                      )}
                    >
                      <td className="text-text-secondary whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                        {row.id}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {row.severity ? (
                          <SeverityBadge severity={row.severity as Severity} />
                        ) : (
                          <span className="text-text-disabled">-</span>
                        )}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap px-3 py-2.5 text-xs">
                        {row.alert_type
                          ? ALERT_TYPE_LABEL[row.alert_type] ?? row.alert_type
                          : '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {row.system_display_name ?? row.system_name ?? '-'}
                      </td>
                      <td className="px-3 py-2.5" title={row.title ?? undefined}>
                        <span className="block max-w-[260px] truncate">{row.title ?? '-'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{row.resolver}</td>
                      <td className="text-text-secondary whitespace-nowrap px-3 py-2.5 text-xs">
                        {formatKST(row.created_at, 'datetime')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </NeuCard>
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-text-secondary text-sm">
            총 {total}건 · 페이지 {currentPage} / {totalPages}
          </span>
          <div className="flex gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </NeuButton>
          </div>
        </div>
      )}

      <FeedbackDetailDrawer item={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-text-secondary mb-1.5 text-xs font-semibold uppercase tracking-wider">
        {label}
      </h3>
      <p className="text-text-primary text-sm leading-relaxed break-words">{children}</p>
    </section>
  )
}

interface FeedbackDetailDrawerProps {
  item: FeedbackSearchItem | null
  onClose: () => void
}

function FeedbackDetailDrawer({ item, onClose }: FeedbackDetailDrawerProps) {
  const open = !!item

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'border-border bg-bg-base fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        {item && (
          <>
            <header className="border-border flex items-start justify-between gap-3 border-b px-6 pb-5 pt-7">
              <div className="min-w-0">
                <div className="text-text-secondary mb-2 flex items-center gap-2 text-xs">
                  {item.severity && <SeverityBadge severity={item.severity as Severity} />}
                  {item.alert_type && (
                    <span>{ALERT_TYPE_LABEL[item.alert_type] ?? item.alert_type}</span>
                  )}
                  <span>·</span>
                  <span>{formatKST(item.created_at, 'datetime')}</span>
                </div>
                <h2 className="text-text-primary text-base font-semibold leading-snug">
                  해결책 상세
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label="닫기"
                className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <Field label="번호">
                <span className="font-mono">#{item.id}</span>
              </Field>
              <Field label="시스템명">
                {item.system_display_name ?? item.system_name ?? '-'}
              </Field>
              <Field label="제목">{item.title ?? '-'}</Field>
              <Field label="오류 타입">{item.error_type}</Field>
              <section>
                <h3 className="text-text-secondary mb-2 text-xs font-semibold uppercase tracking-wider">
                  해결책
                </h3>
                <div className="bg-bg-base shadow-neu-inset text-text-primary min-h-[16rem] whitespace-pre-wrap rounded-sm p-4 text-sm leading-relaxed">
                  {item.solution}
                </div>
              </section>
              <Field label="등록자">{item.resolver}</Field>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
