import { Bot, X } from 'lucide-react'
import { useChatStore } from '@/store/chatStore'
import { cn } from '@/lib/utils'

/** 우하단 고정 플로팅 AI 어시스턴트 버튼. */
export function ChatLauncher() {
  const isOpen = useChatStore((s) => s.isOpen)
  const toggle = useChatStore((s) => s.toggleOpen)

  return (
    <>
      {!isOpen && (
        <span
          aria-hidden
          className="fixed right-12 bottom-15 z-49 h-12 w-12 rounded-full animate-chat-pulse"
        />
      )}
      <button
        type="button"
        aria-label={isOpen ? 'AI 어시스턴트 닫기' : 'AI 어시스턴트 열기'}
        aria-expanded={isOpen}
        title="AI 어시스턴트"
        onClick={toggle}
        className={cn(
          'fixed right-12 bottom-15 z-50',
          'flex h-12 w-12 items-center justify-center rounded-full',
          'transition-[transform,box-shadow,background-color] duration-400 ease-in-out',
          'hover:scale-110',
          'active:scale-95 active:shadow-neu-inset',
          'focus:outline-none focus:ring-2 focus:ring-[#FB923C] focus:ring-offset-2 focus:ring-offset-bg-base',
          'motion-reduce:transition-none',
          isOpen
            ? 'bg-surface shadow-neu-flat hover:shadow-neu-flat-hover'
            : 'bg-[#FB923C] shadow-[0_4px_14px_rgba(251,146,60,0.4)] hover:shadow-[0_6px_20px_rgba(251,146,60,0.55)]',
        )}
      >
        {isOpen ? (
          <X className="h-5 w-5 text-text-primary" />
        ) : (
          <Bot className="h-6 w-6 text-[#1E2127]" />
        )}
      </button>
    </>
  )
}
