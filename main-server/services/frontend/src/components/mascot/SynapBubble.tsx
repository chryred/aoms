import { useCallback, useEffect, useRef, useState } from 'react'
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

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={triggerDismiss}
      className={cn(
        'synap-bubble',
        'absolute right-0 bottom-16',
        'bg-surface shadow-neu-flat rounded-sm',
        'w-max max-w-[200px] cursor-pointer select-none',
        'px-3 py-2',
        hiding ? 'animate-synap-bubble-out' : 'animate-synap-bubble-in',
      )}
    >
      <p className="text-text-primary text-sm leading-snug">{message}</p>
    </div>
  )
}
