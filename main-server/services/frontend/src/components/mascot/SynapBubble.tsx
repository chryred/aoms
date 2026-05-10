import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const DISPLAY_DURATION_MS = 6000
const FADE_OUT_DURATION_MS = 280

interface SynapBubbleProps {
  message: string
  onDismiss: () => void
}

export function SynapBubble({ message, onDismiss }: SynapBubbleProps) {
  const [hiding, setHiding] = useState(false)
  const hidingRef = useRef(false)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const triggerDismiss = useCallback(() => {
    if (hidingRef.current) return
    hidingRef.current = true
    setHiding(true)
    setTimeout(() => onDismissRef.current(), FADE_OUT_DURATION_MS)
  }, [])

  useEffect(() => {
    const t = setTimeout(triggerDismiss, DISPLAY_DURATION_MS)
    return () => clearTimeout(t)
  }, [triggerDismiss])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') triggerDismiss()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [triggerDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'synap-bubble',
        'absolute right-0 bottom-16',
        'bg-surface shadow-neu-flat rounded-sm',
        'w-max max-w-[200px]',
        'px-3 py-2 pr-7',
        hiding ? 'animate-synap-bubble-out' : 'animate-synap-bubble-in',
      )}
    >
      <p className="text-text-primary text-sm leading-snug">{message}</p>
      <button
        type="button"
        aria-label="말풍선 닫기"
        onClick={triggerDismiss}
        className={cn(
          'text-text-secondary hover:text-text-primary',
          'absolute top-1.5 right-1.5',
          'flex h-4 w-4 items-center justify-center rounded-sm',
          'focus:ring-accent focus:ring-1 focus:outline-none',
          'transition-colors duration-150',
        )}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  )
}
