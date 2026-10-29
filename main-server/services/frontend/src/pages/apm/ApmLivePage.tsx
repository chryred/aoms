import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuMultiSelect } from '@/components/neumorphic/NeuMultiSelect'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { PageHeader } from '@/components/common/PageHeader'
import { DashboardGrid } from '@/components/apm/live/DashboardGrid'
import { DashboardSwitcher } from '@/components/apm/live/DashboardSwitcher'
import { LiveContext } from '@/components/apm/live/LiveContext'
import { WidgetFrame } from '@/components/apm/live/WidgetFrame'
import { WidgetPicker } from '@/components/apm/live/WidgetPicker'
import { MAX_WIDGETS, widgetRegistry } from '@/components/apm/live/widgetRegistry'
import { useApmDashboards } from '@/hooks/queries/useApmDashboards'
import { useSystems } from '@/hooks/queries/useSystems'
import { useApmDashboardMutations } from '@/hooks/mutations/useApmDashboardMutations'
import { useApmLiveStream } from '@/hooks/useApmLiveStream'
import { droppedKeys } from '@/lib/apm/liveData'
import { useAuthStore } from '@/store/authStore'
import type { ApmDashboard, ApmDashboardBody, DashboardWidget, WidgetType } from '@/types/apm'

const DEFAULT_SLOW_MS = 3000

interface Draft {
  id: number | null
  name: string
  layout: DashboardWidget[]
  /** 저장된 화면의 필터. 사용자가 필터를 바꾸기 전까지 이 값을 사용 */
  filters: { system_ids: number[]; instance_role: string }
}

const emptyDraft = (): Draft => ({
  id: null,
  name: '새 화면',
  layout: [],
  filters: { system_ids: [], instance_role: '' },
})

function toDraft(d: ApmDashboard): Draft {
  const f = d.filters as { system_ids?: number[]; instance_role?: string }
  return {
    id: d.id,
    name: d.name,
    layout: d.layout,
    filters: { system_ids: f.system_ids ?? [], instance_role: f.instance_role ?? '' },
  }
}

/** 키 순서를 고정해 저장본과 비교("저장 안 됨" 표시)가 순서에 흔들리지 않게 한다. */
function normalize(layout: DashboardWidget[]) {
  return layout.map((w) => ({
    i: w.i,
    type: w.type,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    target: w.target ?? null,
  }))
}

function pickInitial(list: ApmDashboard[], userId: number | undefined): Draft {
  const d =
    list.find((x) => x.owner_user_id === userId) ?? list.find((x) => x.is_shared_default) ?? list[0]
  return d ? toDraft(d) : emptyDraft()
}

let widgetSeq = 0
const newWidgetId = (type: WidgetType) => `${type}-${Date.now().toString(36)}${widgetSeq++}`

export function ApmLivePage() {
  const [params] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const { data: systems = [] } = useSystems()
  const { data: dashboards } = useApmDashboards()
  const { create, update, remove, shareDefault } = useApmDashboardMutations()

  const queryIds = useMemo(
    () =>
      params
        .getAll('system')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    [params],
  )
  const [draft, setDraft] = useState<Draft | null>(null)
  const [systemOverride, setSystemOverride] = useState<number[] | null>(
    queryIds.length ? queryIds : null,
  )
  const [roleOverride, setRoleOverride] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [queueFilter, setQueueFilter] = useState<string | null>(null)

  const base = draft ?? (dashboards ? pickInitial(dashboards, user?.id) : emptyDraft())
  const selectedSystems = systemOverride ?? base.filters.system_ids
  const role = roleOverride ?? base.filters.instance_role

  const streamIds = selectedSystems.length > 0 ? selectedSystems : systems.map((s) => s.id)
  const events = useApmLiveStream(streamIds)

  // F2 가 System 타입에 tx_slow_threshold_ms 를 추가하기 전에도 병합되도록 방어적으로 읽는다
  const slowOf = (id: number) =>
    (systems.find((s) => s.id === id) as { tx_slow_threshold_ms?: number } | undefined)
      ?.tx_slow_threshold_ms ?? DEFAULT_SLOW_MS
  const slowMs = streamIds.length ? Math.min(...streamIds.map(slowOf)) : DEFAULT_SLOW_MS

  const systemName = (id: number) => systems.find((s) => s.id === id)?.display_name ?? `#${id}`
  const roles = useMemo(() => {
    const set = new Set<string>()
    for (const e of events.active.values()) set.add(e.instance_role)
    for (const list of events.agg.values()) if (list[0]) set.add(list[0].instance_role)
    return [...set].sort()
  }, [events.active, events.agg])

  const currentFilters = { system_ids: selectedSystems, instance_role: role }
  const saved = dashboards?.find((d) => d.id === base.id)
  const dirty =
    base.id === null ||
    !saved ||
    JSON.stringify([saved.name, normalize(saved.layout), toDraft(saved).filters]) !==
      JSON.stringify([base.name, normalize(base.layout), currentFilters])

  const select = (id: number | null) => {
    const found = id === null ? undefined : dashboards?.find((x) => x.id === id)
    setDraft(found ? toDraft(found) : emptyDraft())
    setSystemOverride(null)
    setRoleOverride(null)
    setQueueFilter(null)
  }

  const save = () => {
    const body: ApmDashboardBody = {
      name: base.name.trim() || '새 화면',
      layout: base.layout,
      filters: currentFilters,
    }
    if (base.id === null) {
      create.mutate(body, { onSuccess: (d) => setDraft(toDraft(d)) })
    } else {
      update.mutate({ id: base.id, body })
    }
  }

  const addWidget = (type: WidgetType) => {
    if (base.layout.length >= MAX_WIDGETS) return
    const { w, h } = widgetRegistry[type].defaultSize
    const y = base.layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)
    setDraft({ ...base, layout: [...base.layout, { i: newWidgetId(type), type, x: 0, y, w, h }] })
  }

  const droppedList = droppedKeys(events.agg)

  return (
    <div>
      <PageHeader
        title="실시간 모니터링"
        description="위젯을 끌어 놓고 크기를 조절해 원하는 화면을 구성합니다"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <NeuMultiSelect
            label="시스템"
            options={systems.map((s) => ({ value: s.id, label: s.display_name }))}
            selected={selectedSystems}
            onChange={(v) => setSystemOverride(v as number[])}
          />
        </div>
        <div className="min-w-[160px]">
          <NeuSelect
            label="WAS"
            id="apm-role-select"
            value={role}
            onChange={(e) => setRoleOverride(e.target.value)}
          >
            <option value="">전체</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NeuSelect>
        </div>
        {events.status === 'fallback' && (
          <NeuBadge variant="warning">실시간 연결 끊김 — 폴링 중</NeuBadge>
        )}
        {droppedList.map((k) => (
          <NeuBadge key={k} variant="critical">
            수집 누락 {systemName(Number(k.split(':')[0]))}/{k.split(':').slice(1).join(':')}
          </NeuBadge>
        ))}
      </div>

      <div className="mb-4">
        <DashboardSwitcher
          dashboards={dashboards ?? []}
          currentId={base.id}
          name={base.name}
          dirty={dirty}
          editing={editing}
          isAdmin={isAdmin}
          saving={create.isPending || update.isPending}
          onSelect={select}
          onRename={(name) => setDraft({ ...base, name })}
          onSave={save}
          onDelete={() => {
            if (base.id !== null && window.confirm('이 화면을 삭제할까요?')) {
              remove.mutate(base.id, { onSuccess: () => select(null) })
            }
          }}
          onShareDefault={() => base.id !== null && shareDefault.mutate(base.id)}
          onToggleEdit={() => setEditing((v) => !v)}
        />
      </div>

      {editing && <WidgetPicker count={base.layout.length} onAdd={addWidget} />}

      <LiveContext.Provider value={{ queueFilter, setQueueFilter, systemName }}>
        <DashboardGrid
          widgets={base.layout}
          editing={editing}
          onChange={(layout) => setDraft({ ...base, layout })}
          renderWidget={(w) => {
            const def = widgetRegistry[w.type]
            const Component = def.component
            const target = {
              systemIds: w.target?.system_ids?.length ? w.target.system_ids : selectedSystems,
              instanceRole: w.target?.instance_role || role || undefined,
            }
            return (
              <WidgetFrame
                title={def.title}
                editing={editing}
                onRemove={() =>
                  setDraft({ ...base, layout: base.layout.filter((it) => it.i !== w.i) })
                }
              >
                <Component events={events} target={target} slowMs={slowMs} />
              </WidgetFrame>
            )
          }}
        />
      </LiveContext.Provider>
      {base.layout.length === 0 && (
        <div className="text-text-tertiary py-12 text-center text-sm">
          표시할 위젯이 없습니다. 편집 모드에서 위젯을 추가하세요.
        </div>
      )}
    </div>
  )
}
