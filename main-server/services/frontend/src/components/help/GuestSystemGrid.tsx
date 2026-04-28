import { useEffect, useState } from 'react'
import { helpApi, type HelpSystem } from '@/api/help'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { cn } from '@/lib/utils'

interface GuestSystemGridProps {
  onSelect: (systemId: number | null) => void
}

export function GuestSystemGrid({ onSelect }: GuestSystemGridProps) {
  const [systems, setSystems] = useState<HelpSystem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    helpApi
      .getSystems()
      .then(setSystems)
      .catch(() => setSystems([]))
      .finally(() => setLoading(false))
  }, [])

  const handleConfirm = () => {
    onSelect(selectedId)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-text-secondary text-sm">시스템 목록 불러오는 중...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h2 className="text-text-primary mb-1 text-lg font-semibold">
            어떤 시스템에 대해 문의하시나요?
          </h2>
          <p className="text-text-secondary text-sm">
            해당 시스템 선택 시 더 정확한 답변을 드릴 수 있습니다.
          </p>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* 전체 카드 */}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={cn(
              'border-border rounded-sm border px-4 py-3 text-left transition-all',
              'focus:ring-accent focus:ring-1 focus:outline-none',
              selectedId === null
                ? 'border-accent shadow-neu-pressed bg-accent text-accent-contrast'
                : 'bg-surface text-text-primary hover:border-accent hover:bg-accent-muted',
            )}
          >
            <div className="text-sm font-medium">전체</div>
            <div
              className={cn(
                'mt-0.5 text-xs',
                selectedId === null ? 'text-accent-contrast/70' : 'text-text-secondary',
              )}
            >
              모든 시스템 지식 검색
            </div>
          </button>

          {systems.map((sys) => (
            <button
              key={sys.id}
              type="button"
              onClick={() => setSelectedId(sys.id)}
              className={cn(
                'border-border rounded-sm border px-4 py-3 text-left transition-all',
                'focus:ring-accent focus:ring-1 focus:outline-none',
                selectedId === sys.id
                  ? 'border-accent shadow-neu-pressed bg-accent text-accent-contrast'
                  : 'bg-surface text-text-primary hover:border-accent hover:bg-accent-muted',
              )}
            >
              <div className="text-sm font-medium">{sys.display_name}</div>
              {sys.description && (
                <div
                  className={cn(
                    'mt-0.5 line-clamp-1 text-xs',
                    selectedId === sys.id ? 'text-accent-contrast/70' : 'text-text-secondary',
                  )}
                >
                  {sys.description}
                </div>
              )}
            </button>
          ))}
        </div>

        <NeuButton variant="primary" className="w-full" onClick={handleConfirm}>
          선택 완료
        </NeuButton>
      </div>
    </div>
  )
}
