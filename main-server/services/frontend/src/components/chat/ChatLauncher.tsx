import { X } from 'lucide-react'
import { useChatStore, useSynapState } from '@/store/chatStore'
import { Synap, SynapBubble } from '@/components/mascot'
import { cn } from '@/lib/utils'
import { useScreenContext } from '@/hooks/useScreenContext'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useSynapPersonality } from '@/hooks/useSynapPersonality'
import type { SynapStateType } from '@/components/mascot'

/** 우하단 고정 플로팅 AI 어시스턴트 버튼. AppLayout이 /chat 페이지에서 렌더링을 스킵한다. */
export function ChatLauncher() {
  const isOpen = useChatStore((s) => s.isOpen)
  const setOpen = useChatStore((s) => s.setOpen)
  const setPendingScreenContext = useChatStore((s) => s.setPendingScreenContext)
  const unread = useChatStore((s) => s.unread)
  const baseSynapState = useSynapState()
  const screenContext = useScreenContext()
  const noAnim = useReducedMotion()
  const { message, dismiss, isSpeaking } = useSynapPersonality()

  const synapState: SynapStateType = isSpeaking ? 'listening' : baseSynapState

  const handleClick = () => {
    if (!isOpen) {
      // false→true 전환 시에만 현재 화면 컨텍스트 캡처
      const hasContext =
        screenContext.screen ?? screenContext.system_id ?? screenContext.incident_id
      if (hasContext) {
        setPendingScreenContext(screenContext)
      }
    }
    setOpen(!isOpen)
  }

  return (
    <div className="fixed right-12 bottom-15 z-50 h-12 w-12">
      {/* 말풍선 — 채팅 닫혔을 때만 표시 */}
      {message && !isOpen && <SynapBubble message={message} onDismiss={dismiss} />}

      {/* float 래퍼 — 채팅 닫혔을 때만 둥실거림 */}
      <div className={cn('h-12 w-12', !isOpen && !noAnim && 'animate-synap-float')}>
        {!isOpen && (
          <span
            aria-hidden
            className="animate-chat-pulse pointer-events-none absolute inset-0 rounded-full"
          />
        )}
        {!isOpen && unread > 0 && (
          <span
            aria-label={`미읽은 메시지 ${unread}개`}
            className="bg-critical absolute -top-1 -right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        <button
          type="button"
          aria-label={isOpen ? 'AI 어시스턴트 닫기' : 'AI 어시스턴트 열기'}
          aria-expanded={isOpen}
          title="AI 어시스턴트"
          onClick={handleClick}
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full',
            'transition-[transform,box-shadow,background-color] duration-400 ease-in-out',
            'hover:scale-110',
            'active:shadow-neu-inset active:scale-95',
            'focus:ring-offset-bg-base focus:ring-accent focus:ring-1 focus:ring-offset-2 focus:outline-none',
            'motion-reduce:transition-none',
            'bg-surface shadow-neu-flat hover:shadow-neu-flat-hover text-text-primary',
          )}
        >
          {isOpen ? <X className="h-5 w-5" /> : <Synap size={38} state={synapState} />}
        </button>
      </div>
    </div>
  )
}
