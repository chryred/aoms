import { cn } from '@/lib/utils'
import type { TreeInstance } from '@/lib/apm/liveScope'

interface InstanceChipBarProps {
  instances: TreeInstance[]
  /** 있으면 범위에 시스템이 둘 이상일 때 칩 이름을 "시스템·role" 로 표시 */
  systemName?: (id: number) => string
  hidden: Set<string>
  onToggle: (key: string) => void
  onShowAll: () => void
}

const chip =
  'focus-visible:ring-accent flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-0.5 text-xs transition-[box-shadow,opacity] duration-150 focus-visible:ring-1 focus-visible:outline-none'

/** 범위 안 인스턴스 칩. 호스트 목록 체크박스와 같은 제외 집합(hidden)을 보고 토글한다. */
export function InstanceChipBar({
  instances,
  systemName,
  hidden,
  onToggle,
  onShowAll,
}: InstanceChipBarProps) {
  if (instances.length === 0) return null
  const multiSystem = systemName != null && new Set(instances.map((i) => i.systemId)).size > 1
  const allShown = instances.every((i) => !hidden.has(i.key))
  return (
    <div
      role="group"
      aria-label="인스턴스 선택"
      data-testid="chip-bar"
      className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] px-0.5 py-0 xl:flex-wrap xl:overflow-visible xl:[mask-image:none]"
    >
      <button
        type="button"
        aria-pressed={allShown}
        onClick={onShowAll}
        className={cn(
          chip,
          'bg-bg-base text-text-primary',
          allShown ? 'shadow-neu-soft' : 'shadow-neu-pressed text-text-tertiary opacity-60',
        )}
      >
        ALL
      </button>
      {instances.map((inst) => {
        const on = !hidden.has(inst.key)
        return (
          <button
            key={inst.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(inst.key)}
            className={cn(
              chip,
              'bg-bg-base text-text-primary',
              on ? 'shadow-neu-soft' : 'shadow-neu-pressed text-text-tertiary opacity-60',
            )}
          >
            <span
              aria-hidden
              className="h-[9px] w-[9px] shrink-0 rounded-xs"
              style={{ background: `var(${inst.colorVar})` }}
            />
            {multiSystem ? `${systemName(inst.systemId)}·${inst.role}` : inst.role}
          </button>
        )
      })}
    </div>
  )
}
