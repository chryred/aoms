import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { helpApi, type HelpSystem } from '@/api/help'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { cn } from '@/lib/utils'

interface GuestSystemGridProps {
  onSelect: (systemIds: number[]) => void
}

export function GuestSystemGrid({ onSelect }: GuestSystemGridProps) {
  const [systems, setSystems] = useState<HelpSystem[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    helpApi
      .getSystems()
      .then((data) => {
        setSystems(data)
        // 디폴트: 모든 활성 시스템 선택
        setSelectedIds(data.map((s) => s.id))
      })
      .catch(() => setSystems([]))
      .finally(() => setLoading(false))
  }, [])

  const toggleSystem = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selectAll = () => setSelectedIds(systems.map((s) => s.id))
  const clearAll = () => setSelectedIds([])

  const handleConfirm = () => {
    onSelect(selectedIds)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-text-secondary text-sm">시스템 목록 불러오는 중...</p>
      </div>
    )
  }

  const allSelected = systems.length > 0 && selectedIds.length === systems.length

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h2 className="text-text-primary mb-1 text-lg font-semibold">
            어떤 시스템에 대해 문의하시나요?
          </h2>
          <p className="text-text-secondary text-sm">여러 시스템을 동시에 선택할 수 있습니다.</p>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {systems.map((sys) => {
            const isSelected = selectedIds.includes(sys.id)
            return (
              <button
                key={sys.id}
                type="button"
                onClick={() => toggleSystem(sys.id)}
                className={cn(
                  'border-border relative rounded-sm border px-4 py-3 text-left transition-all',
                  'focus:ring-accent focus:ring-1 focus:outline-none',
                  isSelected
                    ? 'border-accent shadow-neu-pressed bg-surface'
                    : 'bg-surface shadow-neu-flat hover:border-accent',
                )}
              >
                {/* 체크 아이콘 */}
                <span className="absolute top-2 right-2">
                  {isSelected ? (
                    <CheckCircle2 className="text-accent h-4 w-4" />
                  ) : (
                    <span className="block h-4 w-4" />
                  )}
                </span>

                <div className="text-text-primary pr-5 text-sm font-medium">{sys.display_name}</div>
                {sys.description && (
                  <div className="text-text-secondary mt-0.5 line-clamp-1 pr-5 text-xs">
                    {sys.description}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* 전체 선택 / 전체 해제 토글 */}
        {systems.length > 0 && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={allSelected ? clearAll : selectAll}
              className={cn(
                'text-text-secondary text-xs transition-colors',
                'hover:text-accent focus:ring-accent focus:ring-1 focus:outline-none',
              )}
            >
              {allSelected ? '전체 해제' : '전체 선택'}
            </button>
          </div>
        )}

        <NeuButton
          variant="primary"
          className="w-full"
          onClick={handleConfirm}
          disabled={selectedIds.length === 0}
        >
          선택 완료 {selectedIds.length > 0 && `(${selectedIds.length}개)`}
        </NeuButton>
      </div>
    </div>
  )
}
