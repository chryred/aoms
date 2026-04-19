import { useState } from 'react'
import { User, Bot, Loader2 } from 'lucide-react'
import type { ChatMessage as ChatMessageType } from '@/types/chat'
import { chatApi } from '@/api/chat'
import { ToolCallCard } from './ToolCallCard'

interface ChatMessageProps {
  message: ChatMessageType
  sessionId: string
}

export function ChatMessageView({ message, sessionId }: ChatMessageProps) {
  const { role, content, thought, attachments } = message

  if (role === 'tool') {
    return (
      <div className="flex animate-fade-in-up-subtle">
        <div className="flex-1">
          <ToolCallCard
            toolName={message.tool_name ?? '(unknown)'}
            args={message.tool_args ?? undefined}
            result={message.tool_result ?? undefined}
            thought={thought ?? undefined}
          />
        </div>
      </div>
    )
  }

  if (role === 'user') {
    return (
      <div className="flex animate-fade-in-up-subtle justify-end">
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          {attachments?.length > 0 && (
            <AttachmentThumbs attachments={attachments} sessionId={sessionId} />
          )}
          <div className="bg-accent/15 border-accent/30 rounded-sm border px-3 py-2 text-sm">
            {content}
          </div>
          <div className="text-text-secondary flex items-center gap-1 text-[11px]">
            <User className="h-3 w-3" />
            <span>사용자</span>
          </div>
        </div>
      </div>
    )
  }

  // assistant
  return (
    <div className="flex animate-fade-in-up-subtle">
      <div className="bg-surface shadow-neu-flat flex max-w-[95%] flex-col gap-2 rounded-sm px-3 py-2 text-sm">
        <div className="text-text-secondary flex items-center gap-1 text-[11px]">
          <Bot className="h-3 w-3 text-accent" />
          <span>어시스턴트</span>
        </div>
        {thought && <ThoughtToggle thought={thought} />}
        <div className="text-text-primary whitespace-pre-wrap break-words">
          {content || '…'}
        </div>
      </div>
    </div>
  )
}

function ThoughtToggle({ thought }: { thought: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-text-secondary hover:text-text-primary"
      >
        {open ? '▼' : '▶'} 사고 과정
      </button>
      {open && (
        <div className="text-text-secondary mt-1 whitespace-pre-wrap italic">{thought}</div>
      )}
    </div>
  )
}

function AttachmentThumbs({
  attachments,
  sessionId,
}: {
  attachments: ChatMessageType['attachments']
  sessionId: string
}) {
  return (
    <div className="flex gap-2">
      {attachments.map((a) => (
        <a
          key={a.key}
          href={chatApi.attachmentUrl(sessionId, a.key)}
          target="_blank"
          rel="noreferrer"
          className="shadow-neu-inset block h-16 w-16 overflow-hidden rounded-sm"
        >
          <img
            src={chatApi.attachmentUrl(sessionId, a.key)}
            alt={a.key}
            className="h-full w-full object-cover"
          />
        </a>
      ))}
    </div>
  )
}

/** 스트리밍 중인 assistant 임시 메시지 */
export function StreamingAssistantMessage({
  content,
  running,
  thought,
}: {
  content: string
  running: boolean
  thought?: string
}) {
  return (
    <div className="flex animate-fade-in-up-subtle">
      <div className="bg-surface shadow-neu-flat flex max-w-[95%] flex-col gap-2 rounded-sm px-3 py-2 text-sm">
        <div className="text-text-secondary flex items-center gap-1 text-[11px]">
          <Bot className="h-3 w-3 text-accent" />
          <span>어시스턴트</span>
          {running && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
        {thought && (
          <div className="text-text-secondary text-xs italic">💭 {thought}</div>
        )}
        <div className="text-text-primary whitespace-pre-wrap break-words">
          {content}
          {running && <span className="animate-pulse">▋</span>}
        </div>
      </div>
    </div>
  )
}
