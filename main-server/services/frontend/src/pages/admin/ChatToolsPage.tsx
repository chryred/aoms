import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import {
  useChatExecutorConfigs,
  useChatTools,
} from '@/hooks/queries/useChatTools'
import {
  useSaveChatExecutorConfig,
  useTestChatExecutor,
  useToggleChatTool,
} from '@/hooks/mutations/useChatToolMutations'
import type {
  ChatExecutorConfig,
  ChatExecutorFieldSchema,
  ChatTool,
} from '@/types/chat'
import { cn, formatKST } from '@/lib/utils'

const EXECUTOR_LABELS: Record<string, string> = {
  ems: 'EMS (서버 모니터링)',
  admin: 'Admin (시스템/알림)',
  log_analyzer: 'Log Analyzer (로그/집계)',
}

export default function ChatToolsPage() {
  const toolsQ = useChatTools()
  const configsQ = useChatExecutorConfigs()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null)
  const selectedTool = useMemo(
    () => (toolsQ.data ?? []).find((t) => t.name === selectedToolName) ?? null,
    [toolsQ.data, selectedToolName],
  )

  const toolsByExecutor = useMemo(() => {
    const map = new Map<string, ChatTool[]>()
    ;(toolsQ.data ?? []).forEach((t) => {
      const list = map.get(t.executor) ?? []
      list.push(t)
      map.set(t.executor, list)
    })
    return map
  }, [toolsQ.data])

  const toggleExpanded = (executor: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(executor)) next.delete(executor)
      else next.add(executor)
      return next
    })
  }

  if (toolsQ.isLoading || configsQ.isLoading) {
    return (
      <>
        <PageHeader title="챗봇 도구 관리" description="Executor 자격증명과 도구 활성화를 관리합니다." />
        <LoadingSkeleton lines={8} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="챗봇 도구 관리"
        description="Executor 자격증명과 도구 활성화를 관리합니다."
      />
      <div className="space-y-3">
        {(configsQ.data ?? []).map((cfg) => {
          const isOpen = expanded.has(cfg.executor)
          const tools = toolsByExecutor.get(cfg.executor) ?? []
          const enabledCount = tools.filter((t) => t.is_enabled).length
          const bodyId = `executor-body-${cfg.executor}`
          const hasConfig = (cfg.config_schema ?? []).length > 0

          return (
            <section key={cfg.executor} className="bg-surface shadow-neu-flat rounded-sm">
              {/* 아코디언 헤더 */}
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => toggleExpanded(cfg.executor)}
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'transition-transform duration-200',
                      isOpen ? 'rotate-90' : 'rotate-0',
                    )}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden="true"
                      className="text-text-secondary"
                    >
                      <path
                        d="M5 3l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <span className="text-text-primary text-base font-semibold">
                    {EXECUTOR_LABELS[cfg.executor] ?? cfg.executor}
                  </span>
                  {tools.length > 0 && (
                    <span className="text-text-secondary text-xs">
                      {enabledCount}/{tools.length} 활성
                    </span>
                  )}
                </div>
              </button>

              {/* 아코디언 바디 */}
              <div
                id={bodyId}
                role="region"
                className={cn(
                  'grid transition-[grid-template-rows] duration-300 ease-in-out',
                  isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="overflow-hidden">
                  <div className="border-border border-t px-5 pb-5 pt-4 space-y-4">
                    {/* 자격증명 섹션 */}
                    {hasConfig && (
                      <div className="space-y-2">
                        <div className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                          자격증명
                        </div>
                        <ExecutorConfigCard config={cfg} />
                      </div>
                    )}

                    {/* 도구 섹션 */}
                    <div className="space-y-2">
                      {hasConfig && (
                        <div className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                          도구
                        </div>
                      )}
                      {tools.map((tool) => (
                        <ToolRow
                          key={tool.name}
                          tool={tool}
                          onSelect={() => setSelectedToolName(tool.name)}
                          isLocked={
                            cfg.config_schema.some((f) => f.required) &&
                            !cfg.updated_at
                          }
                        />
                      ))}
                      {tools.length === 0 && (
                        <div className="text-text-secondary text-sm">등록된 도구 없음</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <ToolDetailPanel
        tool={selectedTool}
        onClose={() => setSelectedToolName(null)}
      />
    </>
  )
}

function ToolRow({
  tool,
  onSelect,
  isLocked = false,
}: {
  tool: ChatTool
  onSelect: () => void
  isLocked?: boolean
}) {
  const toggle = useToggleChatTool()
  const effectiveEnabled = isLocked ? false : tool.is_enabled

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="bg-bg-base shadow-neu-flat flex cursor-pointer items-center justify-between rounded-sm px-4 py-3 hover:brightness-105 transition-colors"
    >
      <div className="min-w-0 flex-1 pr-3">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-sm font-medium">{tool.display_name}</span>
          <span className="text-text-secondary text-xs">({tool.name})</span>
        </div>
        <div className="text-text-secondary mt-0.5 text-xs">{tool.description}</div>
      </div>

      {/* 상세 진입 힌트 */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        className="text-text-disabled mr-3 shrink-0"
      >
        <path
          d="M5 3l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <label
        className={cn(
          'flex cursor-pointer items-center gap-2',
          toggle.isPending || isLocked ? 'cursor-not-allowed opacity-60' : '',
        )}
        onClick={(e) => e.stopPropagation()}
        title={isLocked ? '자격증명을 먼저 저장해야 도구를 활성화할 수 있습니다' : undefined}
      >
        <input
          type="checkbox"
          checked={effectiveEnabled}
          onChange={(e) => toggle.mutate({ name: tool.name, is_enabled: e.target.checked })}
          className="sr-only"
          disabled={toggle.isPending || isLocked}
        />
        <div
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors duration-300 ease-in-out',
            effectiveEnabled ? 'bg-accent' : 'bg-border shadow-neu-inset',
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform duration-300 ease-in-out',
              effectiveEnabled
                ? 'bg-surface translate-x-4'
                : 'bg-text-disabled translate-x-0.5',
            )}
          />
        </div>
        {isLocked ? (
          <span className="flex items-center gap-1 text-xs font-medium text-text-disabled">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
              <path
                d="M7 11V7a5 5 0 0 1 10 0v4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            자격증명 필요
          </span>
        ) : (
          <span
            className={cn(
              'text-xs font-medium',
              effectiveEnabled ? 'text-accent' : 'text-text-secondary',
            )}
          >
            {effectiveEnabled ? '활성' : '비활성'}
          </span>
        )}
      </label>
    </div>
  )
}

function ToolDetailPanel({ tool, onClose }: { tool: ChatTool | null; onClose: () => void }) {
  const toggle = useToggleChatTool()
  const isOpen = tool !== null
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const panel = panelRef.current
    if (!panel) return

    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusable[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-40 bg-overlay transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={tool ? `${tool.display_name} 도구 상세` : '도구 상세'}
        className={cn(
          'border-border bg-bg-base fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)]',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {tool && (
          <>
            <div className="border-border flex items-center justify-between border-b px-6 py-4">
              <div>
                <div className="text-text-primary text-base font-semibold">{tool.display_name}</div>
                <div className="text-text-secondary mt-0.5 text-xs">{tool.name}</div>
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={onClose}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* 활성화 토글 */}
              <div className="bg-bg-base shadow-neu-flat rounded-sm px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-text-primary text-sm font-medium">도구 활성화</div>
                  <div className="text-text-secondary mt-0.5 text-xs">
                    비활성화 시 챗봇이 이 도구를 사용하지 않습니다.
                  </div>
                </div>
                <label className={cn('flex cursor-pointer items-center gap-2', toggle.isPending && 'cursor-not-allowed opacity-50')}>
                  <input
                    type="checkbox"
                    checked={tool.is_enabled}
                    onChange={(e) => toggle.mutate({ name: tool.name, is_enabled: e.target.checked })}
                    className="sr-only"
                    disabled={toggle.isPending}
                  />
                  <div className={cn('relative h-5 w-9 rounded-full transition-colors duration-300', tool.is_enabled ? 'bg-accent' : 'bg-border shadow-neu-inset')}>
                    <div className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-300', tool.is_enabled ? 'translate-x-4' : 'translate-x-0.5')} />
                  </div>
                  <span className={cn('text-xs font-medium', tool.is_enabled ? 'text-accent' : 'text-text-secondary')}>
                    {tool.is_enabled ? '활성' : '비활성'}
                  </span>
                </label>
              </div>

              {/* Input Schema */}
              {tool.input_schema && Object.keys(tool.input_schema).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-text-secondary text-xs font-medium uppercase tracking-wider">입력 스키마</div>
                  <pre className="bg-bg-base shadow-neu-inset rounded-sm px-4 py-3 text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(tool.input_schema, null, 2)}
                  </pre>
                </div>
              )}

              {/* Executor */}
              <div className="space-y-1.5">
                <div className="text-text-secondary text-xs font-medium uppercase tracking-wider">Executor</div>
                <div className="bg-bg-base shadow-neu-flat rounded-sm px-4 py-3 text-sm text-text-primary">
                  {EXECUTOR_LABELS[tool.executor] ?? tool.executor}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function ExecutorConfigCard({ config }: { config: ChatExecutorConfig }) {
  const schema = config.config_schema ?? []
  const saveMut = useSaveChatExecutorConfig()
  const testMut = useTestChatExecutor()
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    const initial: Record<string, string> = {}
    schema.forEach((field) => {
      const v = config.config?.[field.key]
      initial[field.key] = v != null ? String(v) : ''
    })
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.executor])

  if (schema.length === 0) return null

  const handleSave = () => {
    const payload: Record<string, string> = {}
    schema.forEach((field) => {
      const v = form[field.key] ?? ''
      if (field.secret && (v === '' || v === '***')) return
      payload[field.key] = v
    })
    saveMut.mutate({ executor: config.executor, config: payload })
  }

  const handleTest = async () => {
    const res = await testMut.mutateAsync({ executor: config.executor, config: form })
    if (res.ok) toast.success(res.message ?? '연결 성공')
    else toast.error(res.message ?? '연결 실패')
  }

  return (
    <div className="bg-bg-base shadow-neu-flat space-y-3 rounded-sm px-4 py-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {schema.map((field: ChatExecutorFieldSchema) => (
          <div key={field.key} className="space-y-1">
            <label className="text-text-secondary text-xs">
              {field.label}
              {field.required && <span className="text-critical ml-1">*</span>}
            </label>
            <NeuInput
              type={field.type === 'password' ? 'password' : 'text'}
              value={form[field.key] ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.secret ? '(변경 시에만 입력, 그대로 두면 유지)' : field.label}
            />
            {field.help && (
              <div className="text-text-secondary text-xs mt-0.5">{field.help}</div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        {config.updated_at ? (
          <span className="text-text-disabled text-xs">
            마지막 수정: {formatKST(config.updated_at, 'datetime')}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <NeuButton variant="ghost" size="sm" onClick={handleTest} loading={testMut.isPending}>
            연결 테스트
          </NeuButton>
          <NeuButton size="sm" onClick={handleSave} loading={saveMut.isPending}>
            저장
          </NeuButton>
        </div>
      </div>
    </div>
  )
}
