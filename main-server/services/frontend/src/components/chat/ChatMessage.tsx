import { useState, useMemo } from 'react'
import { User, Bot, Loader2, RotateCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { ChatMessage as ChatMessageType } from '@/types/chat'
import { chatApi } from '@/api/chat'
import { ToolCallCard } from './ToolCallCard'

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-text-primary mt-2 mb-1 text-base font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-text-primary mt-2 mb-1 text-sm font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-text-primary mt-2 mb-1 text-sm font-semibold">{children}</h3>
  ),
  p: ({ children }) => <p className="text-text-primary mb-1 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="text-text-primary font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code className="bg-bg-deep text-text-primary block overflow-x-auto rounded-sm p-2 font-mono text-xs">
          {children}
        </code>
      )
    }
    return (
      <code className="bg-bg-deep text-accent rounded-sm px-1 font-mono text-xs">{children}</code>
    )
  },
  pre: ({ children }) => <pre className="mb-1">{children}</pre>,
  ul: ({ children }) => <ul className="mb-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="text-text-primary">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-border my-1 border-l-2 pl-2 italic">
      <span className="text-text-secondary">{children}</span>
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-accent underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  hr: () => <hr className="border-border my-2" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-border w-full border-collapse border text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg-deep">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-border border-b">{children}</tr>,
  th: ({ children }) => (
    <th className="border-border text-text-primary border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-border text-text-primary border px-2 py-1">{children}</td>
  ),
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-text-primary text-sm break-words">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

const FAILURE_PATTERNS = [
  '응답 형식을 해석하지 못했습니다',
  '오류가 발생했습니다',
  '처리할 수 없습니다',
]

interface ChatMessageProps {
  message: ChatMessageType
  sessionId: string
  onRetry?: (messageId: string) => void
}

export function ChatMessageView({ message, sessionId, onRetry }: ChatMessageProps) {
  const { role, content, thought, attachments } = message

  const isFailedAssistant = useMemo(() => {
    if (role !== 'assistant') return false
    const text = typeof content === 'string' ? content : ''
    return FAILURE_PATTERNS.some((p) => text.includes(p))
  }, [role, content])

  if (role === 'tool') {
    return (
      <div className="animate-fade-in-up-subtle flex">
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
      <div className="animate-fade-in-up-subtle flex justify-end">
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
    <div className="animate-fade-in-up-subtle flex">
      <div className="bg-surface shadow-neu-flat flex max-w-[95%] flex-col gap-2 rounded-sm px-3 py-2 text-sm">
        <div className="text-text-secondary flex items-center gap-1 text-[11px]">
          <Bot className="text-accent h-3 w-3" />
          <span>어시스턴트</span>
        </div>
        {thought && <ThoughtToggle thought={thought} />}
        {content ? (
          <MarkdownContent content={content} />
        ) : (
          <span className="text-text-primary text-sm">…</span>
        )}
        {isFailedAssistant && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message.id)}
            className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            aria-label="이 메시지 재시도"
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span>다시 시도</span>
          </button>
        )}
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
      {open && <div className="text-text-secondary mt-1 whitespace-pre-wrap italic">{thought}</div>}
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
    <div className="animate-fade-in-up-subtle flex">
      <div className="bg-surface shadow-neu-flat flex max-w-[95%] flex-col gap-2 rounded-sm px-3 py-2 text-sm">
        <div className="text-text-secondary flex items-center gap-1 text-[11px]">
          <Bot className="text-accent h-3 w-3" />
          <span>어시스턴트</span>
          {running && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
        {thought && <div className="text-text-secondary text-xs italic">💭 {thought}</div>}
        <div className="break-words">
          {content && <MarkdownContent content={content} />}
          {running && <span className="text-text-primary animate-pulse text-sm">▋</span>}
        </div>
      </div>
    </div>
  )
}
