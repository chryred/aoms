import { Pencil, Plus, Save, Share2, Trash2 } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import type { ApmDashboard } from '@/types/apm'

interface DashboardSwitcherProps {
  dashboards: ApmDashboard[]
  currentId: number | null
  name: string
  dirty: boolean
  editing: boolean
  isAdmin: boolean
  saving: boolean
  onSelect: (id: number | null) => void
  onRename: (name: string) => void
  onSave: () => void
  onDelete: () => void
  onShareDefault: () => void
  onToggleEdit: () => void
}

const NEW_VALUE = 'new'

export function DashboardSwitcher(p: DashboardSwitcherProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[180px]">
        <NeuSelect
          label="화면"
          id="apm-dashboard-select"
          value={p.currentId === null ? NEW_VALUE : String(p.currentId)}
          onChange={(e) => p.onSelect(e.target.value === NEW_VALUE ? null : Number(e.target.value))}
        >
          {p.currentId === null && <option value={NEW_VALUE}>{p.name} (새 화면)</option>}
          {p.dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.is_shared_default ? ' (공유 기본)' : ''}
            </option>
          ))}
        </NeuSelect>
      </div>
      {p.editing && (
        <div className="min-w-[160px]">
          <NeuInput
            label="화면 이름"
            id="apm-dashboard-name"
            aria-label="이름 변경"
            value={p.name}
            maxLength={100}
            onChange={(e) => p.onRename(e.target.value)}
          />
        </div>
      )}
      <NeuButton size="sm" variant="secondary" onClick={() => p.onSelect(null)}>
        <Plus size={14} /> 새 화면
      </NeuButton>
      <NeuButton size="sm" variant={p.editing ? 'primary' : 'secondary'} onClick={p.onToggleEdit}>
        <Pencil size={14} /> {p.editing ? '편집 종료' : '편집'}
      </NeuButton>
      <NeuButton size="sm" variant="primary" loading={p.saving} onClick={p.onSave}>
        <Save size={14} /> 저장
      </NeuButton>
      {p.currentId !== null && (
        <NeuButton size="sm" variant="danger" onClick={p.onDelete}>
          <Trash2 size={14} /> 삭제
        </NeuButton>
      )}
      {p.isAdmin && p.currentId !== null && (
        <NeuButton size="sm" variant="secondary" onClick={p.onShareDefault}>
          <Share2 size={14} /> 공유 기본으로 지정
        </NeuButton>
      )}
      {p.dirty && <NeuBadge variant="warning">저장 안 됨</NeuBadge>}
    </div>
  )
}
