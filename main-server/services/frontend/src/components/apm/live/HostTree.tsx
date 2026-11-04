import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Check,
  ChevronRight,
  LayoutGrid,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { groupVitals, type InstanceStatus, type Scope, type TreeSystem } from '@/lib/apm/liveScope'

const STATUS_LABEL: Record<InstanceStatus, string> = {
  live: '수신 중',
  stale: '수신 지연',
  off: '수신 없음',
}
const STATUS_DOT: Record<InstanceStatus, string> = {
  live: 'bg-normal',
  stale: 'bg-warning',
  off: 'bg-text-disabled',
}

interface HostTreeProps {
  tree: TreeSystem[]
  scope: Scope
  onScope: (scope: Scope) => void
  /** 실시간 모니터링에서 제외(체크 해제)한 인스턴스 키 */
  excluded: Set<string>
  /** 인스턴스 키들을 한꺼번에 포함/제외 */
  onCheck: (keys: string[], checked: boolean) => void
  /** 에이전트 목록 조회가 끝났는지 (끝나기 전에는 빈 안내를 띄우지 않는다) */
  loaded: boolean
  /** 에이전트 목록 조회 실패 (재시도 버튼을 보여 준다) */
  error?: boolean
  onRetry?: () => void
  /** 시스템별 호스트 메모리 사용률(%). 값이 없으면 HEAP 만 보인다 */
  hostMem?: Map<number, number | null>
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 1024px 미만에서 목록을 펼친 상태 */
  mobileOpen: boolean
  onToggleMobile: () => void
}

const itemBase =
  'focus-visible:ring-accent flex min-h-[32px] min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left text-xs transition-[background-color,color] duration-150 focus-visible:ring-1 focus-visible:outline-none'
const itemIdle = 'text-text-secondary hover:bg-accent-muted hover:text-text-primary'
/** 선택: 약간 떠 있는 면 위에 눌린 그림자. 강조색은 아이콘/뱃지 글자에만 쓴다 */
const itemActive = 'bg-surface text-text-primary shadow-neu-pressed font-semibold'

/** 깊이 한 단계의 들여쓰기(px). chevron 슬롯(w-6 = 24px)의 가운데가 자식 가이드선의 x 좌표 */
const INDENT = 20
const GUIDE_X = INDENT + 12

/** 하위 항목이 없는 행에서도 chevron 자리를 비워 같은 깊이의 체크박스를 세로로 맞춘다 */
function ChevronSpacer() {
  return <span aria-hidden data-testid="chevron-spacer" className="w-6 shrink-0" />
}

const pct = (v: number | null) => (v == null ? '-' : `${Math.round(v)}%`)

/** 포함 여부 체크박스. state=mixed 면 일부만 선택(tri-state, aria-checked="mixed"). */
function IncludeCheckbox({
  state,
  label,
  onChange,
  className,
}: {
  state: 'all' | 'none' | 'some'
  label: string
  onChange: (checked: boolean) => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <span className={cn('relative inline-flex h-3.5 w-3.5 shrink-0', className)}>
      <input
        ref={ref}
        type="checkbox"
        aria-label={label}
        aria-checked={state === 'some' ? 'mixed' : state === 'all'}
        checked={state === 'all'}
        onChange={() => onChange(state !== 'all')}
        className="peer border-border-alt bg-bg-base focus-visible:ring-accent checked:border-text-secondary indeterminate:border-text-secondary h-full w-full cursor-pointer appearance-none rounded-sm border focus-visible:ring-1 focus-visible:outline-none"
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="text-text-primary pointer-events-none absolute inset-0 hidden h-full w-full p-px peer-checked:block"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="text-text-primary pointer-events-none absolute inset-0 hidden h-full w-full p-px peer-indeterminate:block"
      />
    </span>
  )
}

const checkState = (keys: string[], excluded: Set<string>): 'all' | 'none' | 'some' => {
  const on = keys.filter((k) => !excluded.has(k)).length
  return on === 0 ? 'none' : on === keys.length ? 'all' : 'some'
}

function scopeLabel(tree: TreeSystem[], scope: Scope) {
  if (scope.kind === 'all') return '전체 (OVERALL)'
  const sys = tree.find((s) => s.systemId === scope.systemId)
  const name = sys?.name ?? `#${scope.systemId}`
  return scope.kind === 'system' ? name : `${name} / ${scope.role}`
}

/** Intermax 식 호스트 목록: 전체, 시스템 그룹, 인스턴스 행. 선택한 범위를 모든 위젯이 따른다. */
export function HostTree({
  tree,
  scope,
  onScope,
  excluded,
  onCheck,
  loaded,
  error = false,
  onRetry,
  hostMem,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onToggleMobile,
}: HostTreeProps) {
  const [closed, setClosed] = useState<Set<number>>(new Set())
  const toggleGroup = (id: number) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const total = tree.reduce((n, s) => n + s.instances.length, 0)
  const allActive = scope.kind === 'all'
  const allKeys = tree.flatMap((s) => s.instances.map((i) => i.key))

  return (
    <aside
      aria-label="호스트 목록"
      className={cn(
        'border-border shrink-0 px-4 pt-4 lg:flex lg:flex-col lg:border-r lg:p-0',
        'lg:sticky lg:top-0 lg:h-[var(--apm-h,100dvh)] lg:self-start',
        'lg:bg-bg-base',
        collapsed ? 'lg:w-12' : 'lg:w-64',
      )}
    >
      {/* 1024px 미만: 현재 범위를 보여 주는 토글 버튼 */}
      <button
        type="button"
        onClick={onToggleMobile}
        aria-expanded={mobileOpen}
        className="bg-bg-base shadow-neu-flat focus-visible:ring-accent text-text-primary mb-3 flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-3 text-sm font-medium focus-visible:ring-1 focus-visible:outline-none lg:hidden"
      >
        <span className="truncate">호스트 목록: {scopeLabel(tree, scope)}</span>
        {mobileOpen ? (
          <ChevronDown size={16} aria-hidden />
        ) : (
          <ChevronRight size={16} aria-hidden />
        )}
      </button>

      <div
        className={cn(
          'mb-3 lg:mb-0 lg:min-h-0 lg:flex-1',
          mobileOpen ? 'block' : 'hidden lg:block',
          !collapsed && 'lg:flex lg:flex-col',
        )}
      >
        {collapsed ? (
          <button
            type="button"
            aria-label="호스트 목록 펼치기"
            onClick={onToggleCollapsed}
            className="text-text-secondary hover:text-text-primary focus-visible:ring-accent hidden min-h-[44px] w-full items-center justify-center focus-visible:ring-1 focus-visible:outline-none lg:flex"
          >
            <PanelLeftOpen size={16} aria-hidden />
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 lg:shrink-0">
              <h2 className="text-text-primary text-sm font-semibold">호스트 목록</h2>
              <button
                type="button"
                aria-label="호스트 목록 접기"
                onClick={onToggleCollapsed}
                className="text-text-secondary hover:text-text-primary focus-visible:ring-accent hidden rounded-sm p-1 focus-visible:ring-1 focus-visible:outline-none lg:block"
              >
                <PanelLeftClose size={16} aria-hidden />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-2 pb-3 lg:max-h-none lg:min-h-0 lg:flex-1">
              <div role="tree" aria-label="호스트 트리">
                <div
                  role="treeitem"
                  aria-level={1}
                  aria-selected={allActive}
                  className="flex items-center gap-0.5"
                >
                  <ChevronSpacer />
                  <IncludeCheckbox
                    state={checkState(allKeys, excluded)}
                    label="전체 인스턴스 포함 (ALL)"
                    onChange={(c) => onCheck(allKeys, c)}
                  />
                  <button
                    type="button"
                    aria-current={allActive ? 'true' : undefined}
                    onClick={() => onScope({ kind: 'all' })}
                    className={cn(itemBase, 'flex-1', allActive ? itemActive : itemIdle)}
                  >
                    <LayoutGrid
                      size={14}
                      aria-hidden
                      className={cn('shrink-0', allActive ? 'text-accent' : 'text-text-tertiary')}
                    />
                    <span className="flex-1 truncate">전체 (OVERALL)</span>
                    <span className="tabular-nums opacity-80">{loaded ? total : '-'}</span>
                  </button>
                </div>

                {tree.map((sys) => {
                  const open = !closed.has(sys.systemId)
                  const sysActive = scope.kind === 'system' && scope.systemId === sys.systemId
                  const vitals = groupVitals(sys.instances)
                  return (
                    <div
                      key={sys.systemId}
                      role="treeitem"
                      aria-level={2}
                      aria-expanded={open}
                      aria-selected={sysActive}
                      className="mt-2"
                    >
                      <div className="flex items-center gap-0.5" style={{ paddingLeft: INDENT }}>
                        <button
                          type="button"
                          aria-label={`${sys.name} ${open ? '접기' : '펼치기'}`}
                          aria-expanded={open}
                          onClick={() => toggleGroup(sys.systemId)}
                          className="text-text-tertiary hover:text-text-primary focus-visible:ring-accent flex min-h-[40px] w-6 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:outline-none"
                        >
                          {open ? (
                            <ChevronDown size={14} aria-hidden />
                          ) : (
                            <ChevronRight size={14} aria-hidden />
                          )}
                        </button>
                        <IncludeCheckbox
                          state={checkState(
                            sys.instances.map((i) => i.key),
                            excluded,
                          )}
                          label={`${sys.name} 전체 포함`}
                          onChange={(c) =>
                            onCheck(
                              sys.instances.map((i) => i.key),
                              c,
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-current={sysActive ? 'true' : undefined}
                          onClick={() => onScope({ kind: 'system', systemId: sys.systemId })}
                          className={cn(
                            itemBase,
                            'min-h-[40px] flex-1',
                            sysActive ? itemActive : itemIdle,
                          )}
                        >
                          <Server
                            size={14}
                            aria-hidden
                            className={cn(
                              'shrink-0',
                              sysActive ? 'text-accent' : 'text-text-tertiary',
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{sys.name}</span>
                            <span className="block text-[10px] font-normal tabular-nums opacity-80">
                              <span className="whitespace-nowrap">{sys.instances.length}대</span>
                              {' · '}
                              <span className="whitespace-nowrap">CPU {pct(vitals.cpu)}</span>
                              {' / '}
                              <span className="whitespace-nowrap">HEAP {pct(vitals.heap)}</span>
                              {hostMem?.get(sys.systemId) != null && (
                                <>
                                  {' / '}
                                  <span
                                    className="whitespace-nowrap"
                                    title="호스트 메모리 (시스템 내 최대)"
                                  >
                                    MEM {pct(hostMem.get(sys.systemId) ?? null)}
                                  </span>
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      </div>
                      {open && (
                        <ul role="group" className="relative">
                          {sys.instances.map((inst, idx) => {
                            const active =
                              scope.kind === 'instance' &&
                              scope.systemId === inst.systemId &&
                              scope.role === inst.role
                            const last = idx === sys.instances.length - 1
                            return (
                              <li
                                key={inst.key}
                                role="treeitem"
                                aria-level={3}
                                aria-selected={active}
                                className="relative"
                              >
                                {/* 트리 가이드: 시스템 chevron 아래로 내려오는 세로선 + 행으로 들어가는 가로선 */}
                                <span
                                  aria-hidden
                                  data-testid="tree-guide-v"
                                  className="bg-border pointer-events-none absolute top-0 w-px"
                                  style={{ left: GUIDE_X, height: last ? '50%' : '100%' }}
                                />
                                <span
                                  aria-hidden
                                  data-testid="tree-guide-h"
                                  className="bg-border pointer-events-none absolute top-1/2 h-px w-6"
                                  style={{ left: GUIDE_X }}
                                />
                                <div
                                  className="flex items-center gap-0.5 py-px"
                                  style={{ paddingLeft: INDENT * 2 }}
                                >
                                  <ChevronSpacer />
                                  <IncludeCheckbox
                                    state={excluded.has(inst.key) ? 'none' : 'all'}
                                    label={`${inst.role} 포함`}
                                    onChange={(c) => onCheck([inst.key], c)}
                                  />
                                  <button
                                    type="button"
                                    aria-current={active ? 'true' : undefined}
                                    onClick={() =>
                                      onScope({
                                        kind: 'instance',
                                        systemId: inst.systemId,
                                        role: inst.role,
                                      })
                                    }
                                    className={cn(
                                      itemBase,
                                      'min-w-0 flex-1',
                                      active ? itemActive : itemIdle,
                                    )}
                                  >
                                    <span
                                      aria-hidden
                                      className="h-[9px] w-[9px] shrink-0 rounded-xs"
                                      style={{ background: `var(${inst.colorVar})` }}
                                    />
                                    <span
                                      className="min-w-0 flex-1"
                                      title={`${sys.name} / ${inst.role}${inst.host && inst.host !== inst.role ? ` (${inst.host})` : ''}`}
                                    >
                                      <span className="text-text-primary block truncate font-semibold">
                                        {inst.role}
                                      </span>
                                      <span className="flex items-center gap-1 text-[10px] font-normal">
                                        <span
                                          data-testid="type-badge"
                                          className={cn(
                                            'shrink-0 rounded-sm px-1 leading-4 font-semibold',
                                            active
                                              ? 'bg-accent-muted text-accent'
                                              : 'bg-agent-collect-bg text-agent-collect-text',
                                          )}
                                        >
                                          WAS
                                        </span>
                                        {inst.host && inst.host !== inst.role && (
                                          <span className="text-text-secondary min-w-0 truncate">
                                            {inst.host}
                                          </span>
                                        )}
                                        {inst.cpu != null && (
                                          <span
                                            title="JVM CPU"
                                            className="ml-auto shrink-0 tabular-nums opacity-80"
                                          >
                                            CPU {Math.round(inst.cpu)}%
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                    <span
                                      role="img"
                                      aria-label={STATUS_LABEL[inst.status]}
                                      title={STATUS_LABEL[inst.status]}
                                      data-status={inst.status}
                                      className={cn(
                                        'h-2 w-2 shrink-0 rounded-full',
                                        STATUS_DOT[inst.status],
                                      )}
                                    />
                                  </button>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>

              {!loaded && !error && (
                <div
                  role="status"
                  aria-label="호스트 목록 불러오는 중"
                  className="mt-2 animate-pulse space-y-2 px-1"
                >
                  {[0, 1, 2].map((n) => (
                    <div key={n} className="bg-surface h-8 rounded-sm" />
                  ))}
                </div>
              )}
              {error && (
                <div role="alert" className="text-text-secondary px-2 py-3 text-xs">
                  호스트 목록을 불러오지 못했습니다.{' '}
                  <button type="button" onClick={onRetry} className="text-accent underline">
                    다시 시도
                  </button>
                </div>
              )}
              {loaded && tree.length === 0 && (
                <p className="text-text-tertiary px-2 py-3 text-xs">등록된 호스트 없음</p>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
