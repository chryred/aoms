import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { Loader2, Paperclip, Send, Sparkles, X } from 'lucide-react'
import type { ComposerAttachment } from '@/hooks/useChatAttachments'
import { cn } from '@/lib/utils'

interface ChatComposerProps {
  disabled?: boolean
  streaming?: boolean
  attachments: ComposerAttachment[]
  uploadingCount: number
  onAddFiles: (files: FileList | File[]) => void
  onRemoveAttachment: (localId: string) => void
  onSend: (content: string) => void
}

export function ChatComposer({
  disabled,
  streaming,
  attachments,
  uploadingCount,
  onAddFiles,
  onRemoveAttachment,
  onSend,
}: ChatComposerProps) {
  const [value, setValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const text = value.trim()
    if (!text || disabled || streaming) return
    if (uploadingCount > 0) return
    onSend(text)
    setValue('')
  }, [value, disabled, streaming, uploadingCount, onSend])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      onAddFiles(files)
    }
  }

  const sendDisabled =
    !value.trim() || disabled || streaming || uploadingCount > 0

  return (
    <div className="border-border bg-surface border-t">
      {attachments.length > 0 && (
        <div className="border-border bg-bg-base flex gap-2 overflow-x-auto border-b px-3 py-2">
          {attachments.map((a) => (
            <div
              key={a.localId}
              className={cn(
                'relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-sm',
                'shadow-neu-inset',
                a.status === 'failed' && 'ring-critical/60 ring-1',
              )}
              title={`${a.name} · ${Math.round(a.size / 1024)}KB`}
            >
              <img
                src={a.previewUrl}
                alt={a.name}
                className="h-full w-full object-cover"
              />
              {a.status === 'uploading' && (
                <div className="bg-bg-deep/60 absolute inset-0 flex items-center justify-center">
                  <Loader2 className="text-accent h-4 w-4 animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.localId)}
                className={cn(
                  'bg-bg-deep/90 text-text-primary absolute top-0.5 right-0.5',
                  'flex h-4 w-4 items-center justify-center rounded-full',
                  'hover:bg-critical hover:text-white',
                )}
                aria-label="첨부 제거"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary rounded-sm p-1.5"
            title="이미지 첨부"
            disabled={disabled}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="text-text-secondary hover:bg-hover-subtle cursor-not-allowed rounded-sm p-1.5 opacity-60"
            title="Skills (곧 지원 예정)"
            disabled
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAddFiles(e.target.files)
              e.target.value = ''
            }
          }}
        />

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={streaming ? '답변 생성 중…' : '메시지를 입력하세요'}
          disabled={disabled}
          rows={1}
          className={cn(
            'bg-bg-base text-text-primary placeholder:text-text-secondary',
            'shadow-neu-inset max-h-32 min-h-[40px] flex-1 resize-none rounded-sm px-3 text-sm',
            'py-[10px] leading-5',
            'focus:ring-accent focus:ring-1 focus:outline-none',
            'disabled:opacity-50',
          )}
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={sendDisabled}
          className={cn(
            'bg-accent text-accent-contrast shadow-neu-flat flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm',
            'hover:bg-accent-hover active:shadow-neu-inset',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
          aria-label="전송"
        >
          {streaming || uploadingCount > 0 ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  )
}
