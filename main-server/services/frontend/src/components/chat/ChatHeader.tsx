import { Plus, X, Bot, HelpCircle } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import type { System } from '@/types/system'

interface ChatHeaderProps {
  title: string
  /** subtitle 표시 문자열. null = 숨김, undefined = 기본값("Synapse-V 어시스턴트"). */
  subtitle?: string | null
  onNewChat: () => void
  /** 닫기 핸들러. 미지정 시 X 버튼을 숨김(전용 /chat 페이지용). */
  onClose?: () => void
  disabled?: boolean
  systems: System[]
  filterSystemId: number | null
  onFilterSystemChange: (id: number | null) => void
}

export function ChatHeader({
  title,
  subtitle,
  onNewChat,
  onClose,
  disabled,
  systems,
  filterSystemId,
  onFilterSystemChange,
}: ChatHeaderProps) {
  const effectiveSubtitle = subtitle === null ? null : (subtitle ?? 'Synapse-V 어시스턴트')

  return (
    <div className="border-border bg-surface flex flex-col border-b">
      {/* 상단 행: 아이콘, 제목, 버튼 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Bot className="text-accent h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {effectiveSubtitle && (
            <div className="text-text-secondary text-[11px]">{effectiveSubtitle}</div>
          )}
        </div>
        <NeuButton size="sm" variant="ghost" onClick={onNewChat} disabled={disabled}>
          <Plus className="h-4 w-4" />
          <span>새 채팅</span>
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
            <label htmlFor="chat-system-filter" className="cursor-pointer">
              지식 검색 대상
            </label>
            <span
              className="inline-flex cursor-help"
              title="선택한 시스템의 과거 장애·문서·정책만 RAG 검색합니다. '전체 시스템'이면 모든 시스템 지식 검색."
              aria-label="도움말"
              role="img"
            >
              <HelpCircle className="h-3 w-3" />
            </span>
          </span>
          <select
            id="chat-system-filter"
            value={filterSystemId ?? ''}
            onChange={(e) => onFilterSystemChange(e.target.value ? Number(e.target.value) : null)}
            className="bg-bg-base text-text-primary border-border focus:ring-accent flex-1 rounded-sm border px-2 py-1 text-xs focus:ring-1 focus:outline-none"
          >
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
