import { useState, useRef, useEffect } from 'react'
import { Plus, X, HelpCircle, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { Synap } from '@/components/mascot'
import { useSynapState } from '@/store/chatStore'
import type { System } from '@/types/system'
import type { ChatSession } from '@/types/chat'
import { SystemMultiSelect } from './SystemMultiSelect'

interface ChatHeaderProps {
  title: string
  /** subtitle 표시 문자열. null = 숨김, undefined = 기본값("Synapse-V 어시스턴트"). */
  subtitle?: string | null
  onNewChat: () => void
  /** 닫기 핸들러. 미지정 시 X 버튼을 숨김(전용 /chat 페이지용). */
  onClose?: () => void
  disabled?: boolean
  systems: System[]
  filterSystemIds: number[]
  onFilterSystemChange: (ids: number[]) => void
  /** 최근 세션 목록 (최대 5개). 전달 시 제목 클릭으로 세션 전환 가능. */
  sessions?: ChatSession[]
  currentSessionId?: string | null
  onSessionSelect?: (id: string) => void
}

export function ChatHeader({
  title,
  subtitle,
  onNewChat,
  onClose,
  disabled,
  systems,
  filterSystemIds,
  onFilterSystemChange,
  sessions,
  currentSessionId,
  onSessionSelect,
}: ChatHeaderProps) {
  const effectiveSubtitle = subtitle === null ? null : (subtitle ?? 'Synapse-V 어시스턴트')
  const synapState = useSynapState()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const hasSessionPicker = !!(sessions && sessions.length > 1 && onSessionSelect)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  return (
    <div className="border-border bg-surface flex flex-col border-b">
      {/* 상단 행: 아이콘, 제목, 버튼 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-text-primary shrink-0">
          <Synap size={22} state={synapState} />
        </span>

        {/* 제목 영역 — 세션 피커 드롭다운 */}
        <div ref={dropdownRef} className="relative min-w-0 flex-1">
          {hasSessionPicker ? (
            <button
              type="button"
              onClick={() => !disabled && setDropdownOpen((o) => !o)}
              className={cn(
                'flex w-full items-start gap-1 text-left',
                disabled && 'cursor-default',
              )}
            >
              <span className="truncate text-sm font-semibold">{title}</span>
              <ChevronDown
                className={cn(
                  'text-text-secondary mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform duration-150',
                  dropdownOpen && 'rotate-180',
                )}
              />
            </button>
          ) : (
            <div className="truncate text-sm font-semibold">{title}</div>
          )}
          {effectiveSubtitle && (
            <div className="text-text-secondary text-[11px]">{effectiveSubtitle}</div>
          )}

          {/* 세션 선택 드롭다운 */}
          {dropdownOpen && hasSessionPicker && (
            <div className="border-border bg-surface shadow-neu-flat absolute left-0 top-full z-50 mt-1 w-[280px] rounded-sm border py-1">
              {sessions!.map((session) => {
                const isCurrent = session.id === currentSessionId
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      onSessionSelect!(session.id)
                      setDropdownOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                      isCurrent
                        ? 'text-accent bg-accent/10'
                        : 'text-text-primary hover:bg-bg-base',
                    )}
                  >
                    <Check
                      className={cn('h-3 w-3 shrink-0', isCurrent ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{session.title}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <NeuButton size="sm" variant="ghost" onClick={onNewChat} disabled={disabled}>
          <Plus className="h-4 w-4" />
          <span>새 대화</span>
        </NeuButton>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2"
            aria-label="챗봇 닫기"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 시스템 필터 행 */}
      {systems.length > 0 && (
        <div className="border-border flex items-center gap-2 border-t px-3 py-1.5">
          <span className="text-text-secondary flex shrink-0 items-center gap-1 text-[11px]">
            <span className="cursor-default">지식 검색 대상</span>
            <span
              className="inline-flex cursor-help"
              title="선택한 시스템의 과거 장애·문서·정책만 RAG 검색합니다. 여러 시스템을 동시에 선택할 수 있습니다."
              aria-label="도움말"
              role="img"
            >
              <HelpCircle className="h-3 w-3" />
            </span>
          </span>
          <div className="flex-1">
            <SystemMultiSelect
              value={filterSystemIds}
              onChange={onFilterSystemChange}
              systems={systems}
              placeholder="시스템 선택"
            />
          </div>
        </div>
      )}
    </div>
  )
}
