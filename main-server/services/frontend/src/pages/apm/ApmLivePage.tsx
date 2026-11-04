import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Info, Lock, LockOpen } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { DashboardGrid } from '@/components/apm/live/DashboardGrid'
import {
  DEFAULT_DASHBOARD_NAME,
  DEFAULT_LAYOUT,
  LAYOUT_VERSION,
} from '@/components/apm/live/defaultLayout'
import { HostTree } from '@/components/apm/live/HostTree'
import { InstanceChipBar } from '@/components/apm/live/InstanceChipBar'
import { LiveContext } from '@/components/apm/live/LiveContext'
import { SummaryStrip } from '@/components/apm/live/SummaryStrip'
import { WidgetRuntimeContext, type WidgetRuntime } from '@/components/apm/live/widgetState'
import { WidgetFrame } from '@/components/apm/live/WidgetFrame'
import { WidgetZoom } from '@/components/apm/live/WidgetZoom'
import { WidgetPicker } from '@/components/apm/live/WidgetPicker'
import { MAX_WIDGETS, widgetRegistry } from '@/components/apm/live/widgetRegistry'
import { ROUTES } from '@/constants/routes'
import { useAgents } from '@/hooks/queries/useAgents'
import { useSystemsHostMemory } from '@/hooks/queries/useAggregations'
import { useApmDashboards } from '@/hooks/queries/useApmDashboards'
import { useSystems } from '@/hooks/queries/useSystems'
import { useApmDashboardMutations } from '@/hooks/mutations/useApmDashboardMutations'
import { useApmLiveStream } from '@/hooks/useApmLiveStream'
import { useExcludedInstances } from '@/hooks/useExcludedInstances'
import { droppedKeys, type WidgetTarget } from '@/lib/apm/liveData'
import { buildHostTree, instancesInScope, summarize, type Scope } from '@/lib/apm/liveScope'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { useAuthStore } from '@/store/authStore'
import type { DashboardWidget, WidgetType } from '@/types/apm'

const DEFAULT_SLOW_MS = 3000
const AUTOSAVE_DEBOUNCE_MS = 800
const CLOCK_TICK_MS = 5000
const HELP_TEXT = '왼쪽 호스트 목록에서 범위를 고르면 모든 위젯이 그 범위를 따릅니다'

let widgetSeq = 0
const newWidgetId = (type: WidgetType) => `${type}-${Date.now().toString(36)}${widgetSeq++}`
const cloneDefault = () => DEFAULT_LAYOUT.map((w) => ({ ...w }))

export function ApmLivePage() {
  const [params] = useSearchParams()
  // 숨겨진 탭에서는 SSE·시계·요약 띠 애니메이션을 멈춘다
  const active = useTabActive()
  const user = useAuthStore((s) => s.user)
  const { data: systems = [], isSuccess: systemsLoaded } = useSystems()
  const {
    data: agents = [],
    isSuccess: agentsLoaded,
    isError: agentsError,
    refetch: refetchAgents,
  } = useAgents({ agent_type: 'agent_t' })
  const { data: dashboards, isLoading: dashboardsLoading } = useApmDashboards()
  const { create, update } = useApmDashboardMutations({ silent: true })

  const initialSystem = useMemo(() => {
    const n = Number(params.get('system'))
    return Number.isInteger(n) && n > 0 ? n : null
  }, [params])
  const [rawScope, setScope] = useState<Scope>(
    initialSystem ? { kind: 'system', systemId: initialSystem } : { kind: 'all' },
  )
  // ?system= 이 존재하지 않는 시스템이면 전체로 되돌린다 (시스템 목록 조회가 끝난 뒤에만 판단)
  const scope = useMemo<Scope>(
    () =>
      rawScope.kind !== 'all' && systemsLoaded && !systems.some((s) => s.id === rawScope.systemId)
        ? { kind: 'all' }
        : rawScope,
    [rawScope, systems, systemsLoaded],
  )
  const { excluded, setChecked } = useExcludedInstances(user?.id)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // 화면 잠금: 켜면 위젯 이동·리사이즈(마우스·키보드)를 막는다. 기본은 해제(항상 이동 가능)
  const [locked, setLocked] = useState(false)
  // 확대 오버레이: 저장 레이아웃과 무관한 일시 상태
  const [zoom, setZoom] = useState<{ id: string; returnTo: HTMLElement | null } | null>(null)
  const [widgetState, setWidgetStateMap] = useState<WidgetRuntime['state']>({})
  const setWidgetState = useCallback((id: string, key: string, value: unknown) => {
    setWidgetStateMap((m) => ({ ...m, [id]: { ...m[id], [key]: value } }))
  }, [])
  const closeZoom = useCallback(() => setZoom(null), [])
  const runtimeFor = (widgetId: string): WidgetRuntime => ({
    widgetId,
    state: widgetState,
    setState: setWidgetState,
    closeZoom,
  })
  const [confirmReset, setConfirmReset] = useState(false)
  const [queueFilter, setQueueFilter] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // 호스트 목록을 main 스크롤 영역 높이만큼 채우기 위해 main 의 높이를 추적한다
  const rootRef = useRef<HTMLDivElement>(null)
  const [mainHeight, setMainHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const main = rootRef.current?.closest('main')
    if (!main) return
    const measure = () => setMainHeight(main.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(main)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(t)
  }, [active])

  // 범위를 바꿔도 스트림을 다시 맺지 않도록 항상 전체 시스템을 구독하고 화면에서 거른다
  const streamIds = useMemo(() => systems.map((s) => s.id), [systems])
  const events = useApmLiveStream(streamIds, active)

  const tree = useMemo(
    () => buildHostTree(agents, systems, events, now),
    [agents, systems, events, now],
  )
  const hostMem = useSystemsHostMemory(useMemo(() => tree.map((s) => s.systemId), [tree]))
  const inScope = useMemo(() => instancesInScope(tree, scope), [tree, scope])
  const visible = useMemo(() => inScope.filter((i) => !excluded.has(i.key)), [inScope, excluded])
  const visibleKeys = useMemo(() => visible.map((i) => i.key), [visible])
  const summary = useMemo(() => summarize(events, visibleKeys), [events, visibleKeys])

  const target: WidgetTarget = {
    systemIds: scope.kind === 'all' ? [] : [scope.systemId],
    instanceRole: scope.kind === 'instance' ? scope.role : undefined,
    instanceKeys: visibleKeys,
  }

  const scopeSystemIds = scope.kind === 'all' ? streamIds : [scope.systemId]
  const slowMs = scopeSystemIds.length
    ? Math.min(
        ...scopeSystemIds.map(
          (id) => systems.find((s) => s.id === id)?.tx_slow_threshold_ms ?? DEFAULT_SLOW_MS,
        ),
      )
    : DEFAULT_SLOW_MS

  const systemName = useCallback(
    (id: number) => systems.find((s) => s.id === id)?.display_name ?? `#${id}`,
    [systems],
  )
  const colorMap = useMemo(
    () => new Map(tree.flatMap((s) => s.instances).map((i) => [i.key, i.colorVar])),
    [tree],
  )
  // 범위에 시스템이 둘 이상이면 같은 role(was1 등)이 겹치므로 "시스템·role" 로 구분한다
  const multiSystem = useMemo(() => new Set(inScope.map((i) => i.systemId)).size > 1, [inScope])
  const instanceLabel = useCallback(
    (systemId: number, role: string) => (multiSystem ? `${systemName(systemId)}·${role}` : role),
    [multiSystem, systemName],
  )
  const ctx = useMemo(
    () => ({
      queueFilter,
      setQueueFilter,
      systemName,
      colorOf: (key: string) => colorMap.get(key) ?? '--color-accent',
      instanceLabel,
      labelOf: (key: string) => {
        const cut = key.indexOf(':')
        return instanceLabel(Number(key.slice(0, cut)), key.slice(cut + 1))
      },
    }),
    [queueFilter, systemName, colorMap, instanceLabel],
  )

  const selectScope = (next: Scope) => {
    setScope(next)
    setQueueFilter(null)
    setMobileOpen(false)
  }
  const toggleInstance = (key: string) => setChecked([key], excluded.has(key))

  // ---- 레이아웃 + 자동 저장 ----
  const own = dashboards?.find((d) => d.owner_user_id === user?.id)
  const [local, setLocal] = useState<DashboardWidget[] | null>(null)
  // 버전이 없거나 낮은 저장본(구 기본 배치)은 쓰지 않고 기본 배치로 바꾼다 (아래 effect 가 한 번 저장)
  const stale = own != null && Number(own.filters?.layout_version ?? 0) < LAYOUT_VERSION
  const layout = local ?? (own && !stale ? own.layout : DEFAULT_LAYOUT)

  const recordId = useRef<number | null>(null)
  const recordName = useRef(DEFAULT_DASHBOARD_NAME)
  const pending = useRef<DashboardWidget[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const busy = useRef(false)
  const mutate = useRef({ create: create.mutateAsync, update: update.mutateAsync })
  useEffect(() => {
    mutate.current = { create: create.mutateAsync, update: update.mutateAsync }
    if (own) {
      recordId.current = own.id
      recordName.current = own.name
    }
  }, [create.mutateAsync, update.mutateAsync, own])

  const flush = useCallback(async () => {
    if (busy.current || !pending.current) return
    const next = pending.current
    pending.current = null
    busy.current = true
    const body = {
      name: recordName.current,
      layout: next,
      filters: { layout_version: LAYOUT_VERSION },
    }
    try {
      if (recordId.current === null) {
        recordId.current = (await mutate.current.create(body)).id
      } else {
        await mutate.current.update({ id: recordId.current, body })
      }
    } catch {
      // 실패 토스트는 mutation 훅이 띄운다. 화면 상태는 그대로 두고 다음 변경 때 다시 저장한다
    } finally {
      busy.current = false
      if (pending.current) void flush()
    }
  }, [])

  const commit = useCallback(
    (next: DashboardWidget[]) => {
      setLocal(next)
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  // 페이지를 떠날 때 대기 중인 변경을 바로 저장한다
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      void flush()
    },
    [flush],
  )

  // 구버전 저장 레이아웃을 기본 배치로 한 번만 마이그레이션 저장한다 (이후 편집은 v2 로 저장되어 유지)
  const migrated = useRef(false)
  useEffect(() => {
    if (!stale || migrated.current) return
    migrated.current = true
    commit(cloneDefault())
  }, [stale, commit])

  const addWidget = (type: WidgetType) => {
    if (layout.length >= MAX_WIDGETS) return
    const { w, h } = widgetRegistry[type].defaultSize
    const y = layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)
    commit([...layout, { i: newWidgetId(type), type, x: 0, y, w, h }])
  }

  const zoomed = zoom ? layout.find((it) => it.i === zoom.id) : undefined
  const scopeLabel =
    scope.kind === 'all'
      ? '전체'
      : scope.kind === 'system'
        ? systemName(scope.systemId)
        : `${systemName(scope.systemId)} / ${scope.role}`

  const droppedList = droppedKeys(events.agg)
  const noHosts = agentsLoaded && tree.length === 0
  // 선택한 시스템에 등록된 Agent-T 가 하나도 없는 경우 (전체에 호스트가 있어도 해당 범위만 비어 있음)
  const scopeEmpty = agentsLoaded && !noHosts && scope.kind !== 'all' && inScope.length === 0

  return (
    <div
      ref={rootRef}
      style={mainHeight ? ({ '--apm-h': `${mainHeight}px` } as CSSProperties) : undefined}
      className="-m-4 flex min-w-0 flex-col md:-m-6 lg:flex-row"
    >
      <HostTree
        tree={tree}
        scope={scope}
        onScope={selectScope}
        excluded={excluded}
        onCheck={setChecked}
        loaded={agentsLoaded}
        error={agentsError}
        onRetry={() => void refetchAgents()}
        hostMem={hostMem}
        collapsed={treeCollapsed}
        onToggleCollapsed={() => setTreeCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onToggleMobile={() => setMobileOpen((v) => !v)}
      />

      <div className="min-w-0 flex-1 p-4 md:px-6 md:pt-1.5 md:pb-6">
        <div>
          {(events.status === 'fallback' || droppedList.length > 0) && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {events.status === 'fallback' && (
                <NeuBadge variant="warning">실시간 연결 끊김 — 폴링 중</NeuBadge>
              )}
              {droppedList.map((k) => (
                <NeuBadge key={k} variant="critical">
                  수집 누락 {systemName(Number(k.split(':')[0]))}/{k.split(':').slice(1).join(':')}
                </NeuBadge>
              ))}
            </div>
          )}

          {noHosts && (
            <div className="bg-bg-base shadow-neu-inset text-text-secondary mb-3 rounded-sm px-3 py-2 text-sm">
              등록된 Agent-T 인스턴스가 없습니다.{' '}
              <Link to={ROUTES.AGENTS} className="text-accent underline">
                에이전트 관리
              </Link>
              에서 Agent-T 를 등록하면 호스트가 나타나고 데이터가 표시됩니다.
            </div>
          )}

          {scopeEmpty && (
            <div
              role="status"
              className="bg-bg-base shadow-neu-inset text-text-secondary mb-3 rounded-sm px-3 py-2 text-sm"
            >
              이 시스템에 등록된 Agent-T 가 없습니다.{' '}
              <Link to={ROUTES.AGENTS} className="text-accent underline">
                에이전트 관리
              </Link>
              에서 Agent-T 를 등록하세요.
            </div>
          )}

          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-0">
            <div className="flex items-center gap-1.5">
              <h1 className="type-heading text-text-primary text-xl font-bold whitespace-nowrap">
                실시간 모니터링
              </h1>
              <span
                role="img"
                tabIndex={0}
                aria-label={HELP_TEXT}
                title={HELP_TEXT}
                className="text-text-tertiary hover:text-text-secondary rounded-sm"
              >
                <Info size={14} aria-hidden />
              </span>
            </div>
            <div className="min-w-[12rem] flex-1">
              <InstanceChipBar
                instances={inScope}
                systemName={systemName}
                hidden={excluded}
                onToggle={toggleInstance}
                onShowAll={() =>
                  setChecked(
                    inScope.map((i) => i.key),
                    true,
                  )
                }
              />
            </div>
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              {confirmReset ? (
                <div
                  className="flex items-center gap-1.5 text-xs whitespace-nowrap"
                  role="alert"
                  aria-label="기본 배치로 되돌릴까요?"
                >
                  <span className="text-text-secondary">되돌릴까요?</span>
                  <NeuButton
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      commit(cloneDefault())
                      setConfirmReset(false)
                    }}
                  >
                    되돌리기
                  </NeuButton>
                  <NeuButton size="sm" variant="secondary" onClick={() => setConfirmReset(false)}>
                    취소
                  </NeuButton>
                </div>
              ) : (
                <NeuButton size="sm" variant="secondary" onClick={() => setConfirmReset(true)}>
                  기본 화면으로
                </NeuButton>
              )}
              <NeuButton
                size="sm"
                variant={locked ? 'primary' : 'secondary'}
                aria-pressed={locked}
                onClick={() => setLocked((v) => !v)}
              >
                <span className="inline-flex items-center gap-1">
                  {locked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
                  화면 잠금
                </span>
              </NeuButton>
              <NeuButton
                size="sm"
                variant={editing ? 'primary' : 'secondary'}
                aria-pressed={editing}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? '편집 완료' : '편집'}
              </NeuButton>
            </div>
          </div>
          <div className="mb-1">
            <SummaryStrip
              summary={summary}
              points={events.points}
              active={events.active}
              keys={visibleKeys}
              colorVars={colorMap}
              paused={!active}
            />
          </div>

          {editing && (
            <>
              <WidgetPicker count={layout.length} onAdd={addWidget} />
              <p className="text-text-tertiary mb-3 text-xs">
                변경 사항은 자동으로 저장됩니다. 위젯 추가·삭제는 여기서, 이동·크기 조정은 제목줄과
                우하단 모서리를 끌어 바꿉니다(화면 잠금으로 막을 수 있음)
              </p>
            </>
          )}

          {dashboardsLoading ? (
            <div className="text-text-tertiary py-12 text-center text-sm">화면을 불러오는 중</div>
          ) : (
            <LiveContext.Provider value={ctx}>
              {/* 편집 중에는 우하단 AI 어시스턴트 버튼 영역만큼 여백을 남겨 위젯 모서리가 가려지지 않게 한다 */}
              <div className={editing ? 'pb-28' : 'pb-12'}>
                <DashboardGrid
                  widgets={layout}
                  locked={locked}
                  onChange={commit}
                  renderWidget={(w) => {
                    const def = widgetRegistry[w.type]
                    const Component = def.component
                    return (
                      <WidgetFrame
                        title={def.title}
                        editing={editing}
                        locked={locked}
                        onZoom={(returnTo) => setZoom({ id: w.i, returnTo })}
                        onRemove={() => commit(layout.filter((it) => it.i !== w.i))}
                      >
                        <WidgetRuntimeContext.Provider value={runtimeFor(w.i)}>
                          <Component events={events} target={target} slowMs={slowMs} />
                        </WidgetRuntimeContext.Provider>
                      </WidgetFrame>
                    )
                  }}
                />
              </div>
              {zoomed && (
                <WidgetZoom
                  title={widgetRegistry[zoomed.type].title}
                  scopeLabel={scopeLabel}
                  returnFocusTo={zoom?.returnTo ?? null}
                  onClose={() => setZoom(null)}
                >
                  {(() => {
                    const Component = widgetRegistry[zoomed.type].component
                    return (
                      <WidgetRuntimeContext.Provider value={runtimeFor(zoomed.i)}>
                        <Component events={events} target={target} slowMs={slowMs} />
                      </WidgetRuntimeContext.Provider>
                    )
                  })()}
                </WidgetZoom>
              )}
            </LiveContext.Provider>
          )}
          {!dashboardsLoading && layout.length === 0 && (
            <div className="text-text-tertiary py-12 text-center text-sm">
              표시할 위젯이 없습니다. 편집에서 위젯을 추가하거나 기본 화면으로 되돌리세요.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
