import { useState, useRef, useEffect } from 'react'
import { Plus, X, ChevronDown, Check } from 'lucide-react'
import { cn, formatRelative } from '@/lib/utils'
import { describeScopeChip } from '@/lib/chatScope'
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
  /** 현재 대화의 조회 범위(빈 배열 = 전체 시스템) */
  scopeSystemIds: number[]
  /** 로그인 사용자의 담당 시스템 — 칩 문구("담당 시스템"/"선택 시스템") 판정용 */
  primarySystemIds: number[]
  onScopeChange: (ids: number[]) => void
  /** 최근 세션 목록 (최대 10개). 전달 시 제목 클릭으로 세션 전환 가능. */
  sessions?: ChatSession[]
  currentSessionId?: string | null
  onSessionSelect?: (id: string) => void
  /** "전체 대화 보기" — 전용 /chat 페이지로 이동. 미지정 시 링크를 숨김 */
  onViewAll?: () => void
}

const SCOPE_TOOLTIP =
  '질문에 시스템 이름을 쓰거나 시스템 화면에서 물으면 그 시스템을 우선 조회합니다.'

export function ChatHeader({
  title,
  subtitle,
  onNewChat,
  onClose,
  disabled,
  systems,
  scopeSystemIds,
  primarySystemIds,
  onScopeChange,
  sessions,
  currentSessionId,
  onSessionSelect,
  onViewAll,
}: ChatHeaderProps) {
  const effectiveSubtitle = subtitle === null ? null : (subtitle ?? 'Synapse-V 어시스턴트')
  const synapState = useSynapState()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 세션이 1개여도 항상 표시한다 (전환·"전체 대화 보기" 진입점)
  const hasSessionPicker = !!(sessions && sessions.length > 0 && onSessionSelect)

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
            <div className="border-border bg-surface shadow-neu-flat absolute top-full left-0 z-50 mt-1 w-[280px] rounded-sm border py-1">
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
                      isCurrent ? 'text-accent bg-accent/10' : 'text-text-primary hover:bg-bg-base',
                    )}
                  >
                    <Check
                      className={cn('h-3 w-3 shrink-0', isCurrent ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        <span className="text-text-disabled shrink-0 text-[11px]">
                          {formatRelative(session.updated_at)}
                        </span>
                      </div>
                      {session.matched_in === 'message' && session.match_preview && (
                        <div className="text-text-secondary mt-0.5 truncate text-[11px]">
                          💬 {session.match_preview}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
              {onViewAll && (
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false)
                    onViewAll()
                  }}
                  className="border-border text-text-secondary hover:bg-bg-base hover:text-text-primary mt-1 w-full border-t px-3 py-2 text-left text-xs"
                >
                  전체 대화 보기
                </button>
              )}
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

      {/* 조회 범위 칩 — 클릭하면 시스템 선택을 펼쳐 바꿀 수 있다 */}
      {systems.length > 0 && (
        <div className="border-border border-t px-2 py-0.5">
          <button
            type="button"
            onClick={() => setScopeOpen((o) => !o)}
            aria-expanded={scopeOpen}
            title={SCOPE_TOOLTIP}
            className="text-text-secondary hover:text-text-primary focus:ring-accent flex min-h-[28px] max-w-full items-center gap-1 rounded-sm px-1 text-[11px] focus:ring-1 focus:outline-none"
          >
            <span className="truncate">
              {describeScopeChip(scopeSystemIds, primarySystemIds, systems)}
            </span>
            <ChevronDown
              className={cn('h-3 w-3 shrink-0 transition-transform', scopeOpen && 'rotate-180')}
            />
          </button>
          {scopeOpen && (
            <div className="mt-1 mb-1">
              <SystemMultiSelect
                value={scopeSystemIds}
                onChange={onScopeChange}
                systems={systems}
                placeholder="전체 시스템"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
