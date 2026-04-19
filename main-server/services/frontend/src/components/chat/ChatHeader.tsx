import { Plus, X, Bot } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'

interface ChatHeaderProps {
  title: string
  onNewChat: () => void
  onClose: () => void
  disabled?: boolean
}

export function ChatHeader({ title, onNewChat, onClose, disabled }: ChatHeaderProps) {
  return (
    <div className="border-border bg-surface flex items-center gap-2 border-b px-3 py-2">
      <Bot className="text-accent h-5 w-5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="text-text-secondary text-[11px]">Synapse-V 어시스턴트</div>
      </div>
      <NeuButton size="sm" variant="ghost" onClick={onNewChat} disabled={disabled}>
        <Plus className="h-4 w-4" />
        <span>새 채팅</span>
      </NeuButton>
      <button
        type="button"
        onClick={onClose}
        className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary rounded-sm p-1.5"
        aria-label="챗봇 닫기"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
