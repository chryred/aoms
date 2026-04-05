import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { useUpdateConfig } from '@/hooks/mutations/useUpdateConfig'

interface EnabledToggleProps {
  configId: number
  enabled: boolean
}

export function EnabledToggle({ configId, enabled }: EnabledToggleProps) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled)
  const { mutate, isPending } = useUpdateConfig()

  // Sync when external cache changes
  useEffect(() => {
    setOptimisticEnabled(enabled)
  }, [enabled])

  const handleToggle = () => {
    const newValue = !optimisticEnabled
    setOptimisticEnabled(newValue)
    mutate(
      { id: configId, body: { enabled: newValue } },
      {
        onError: () => {
          setOptimisticEnabled(enabled)
          toast.error('활성화 상태 변경에 실패했습니다')
        },
      },
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimisticEnabled}
      aria-label={optimisticEnabled ? '수집기 비활성화' : '수집기 활성화'}
      disabled={isPending}
      onClick={handleToggle}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127] focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        optimisticEnabled ? 'bg-[#00D4FF]' : 'bg-[#2B2F37]',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          optimisticEnabled ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}
