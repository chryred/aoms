import { useEffect, useRef, useState } from 'react'
import { Crosshair } from 'lucide-react'
import { NeuMultiSelect } from '@/components/neumorphic/NeuMultiSelect'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import type { DashboardWidget } from '@/types/apm'

type Target = NonNullable<DashboardWidget['target']>

interface WidgetTargetControlProps {
  title: string
  target: DashboardWidget['target']
  systems: { id: number; display_name: string }[]
  roles: string[]
  /** undefined 를 넘기면 상단 필터를 따른다 */
  onChange: (target: Target | undefined) => void
}

/** 편집 모드 위젯별 대상 덮어쓰기: 시스템 다중 선택 + WAS. */
export function WidgetTargetControl({
  title,
  target,
  systems,
  roles,
  onChange,
}: WidgetTargetControlProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const ids = target?.system_ids ?? []
  const role = target?.instance_role ?? ''
  const emit = (next: Target) => {
    const clean: Target = {}
    if (next.system_ids?.length) clean.system_ids = next.system_ids
    if (next.instance_role) clean.instance_role = next.instance_role
    onChange(clean.system_ids || clean.instance_role ? clean : undefined)
  }
  const roleOptions = role && !roles.includes(role) ? [...roles, role] : roles
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={`${title} 대상`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-sm p-1 ${target ? 'text-accent' : 'text-text-secondary'} hover:text-accent`}
      >
        <Crosshair size={14} />
      </button>
      {open && (
        <div className="bg-surface border-border shadow-neu-flat absolute top-full right-0 z-50 mt-1 flex w-56 flex-col gap-2 rounded-sm border p-3">
          <NeuMultiSelect
            label="대상 시스템"
            options={systems.map((s) => ({ value: s.id, label: s.display_name }))}
            selected={ids}
            onChange={(v) => emit({ system_ids: v as number[], instance_role: role })}
          />
          <NeuSelect
            label="대상 WAS"
            id={`target-role-${title}`}
            value={role}
            onChange={(e) => emit({ system_ids: ids, instance_role: e.target.value })}
          >
            <option value="">상단 필터 따름</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NeuSelect>
          <button
            type="button"
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
            className="bg-btn-secondary text-text-primary shadow-neu-flat rounded-sm px-2 py-1 text-xs"
          >
            상단 필터 따름
          </button>
        </div>
      )}
    </div>
  )
}
