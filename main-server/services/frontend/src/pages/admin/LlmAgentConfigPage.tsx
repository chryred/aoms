import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { llmConfigApi } from '@/api/llmConfig'
import type { LlmAgentConfig, LlmAgentConfigCreate, LlmAgentConfigUpdate } from '@/types/llmConfig'
import { Pencil, Trash2, Plus, X } from 'lucide-react'
import { formatKST } from '@/lib/utils'
import { cn } from '@/lib/utils'

// ── 드로어 ──────────────────────────────────────────────────────────────

interface DrawerProps {
  open: boolean
  onClose: () => void
  editTarget: LlmAgentConfig | null
}

function ConfigDrawer({ open, onClose, editTarget }: DrawerProps) {
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const lastEditRef = useRef<LlmAgentConfig | null>(null)
  if (open) lastEditRef.current = editTarget
  const display = open ? editTarget : lastEditRef.current
  const isEdit = Boolean(display)

  const [form, setForm] = useState({
    area_code: '',
    area_name: '',
    agent_code: '',
    description: '',
    is_active: true,
  })

  useEffect(() => {
    if (open && display) {
      setForm({
        area_code: display.area_code,
        area_name: display.area_name,
        agent_code: display.agent_code,
        description: display.description ?? '',
        is_active: display.is_active,
      })
    } else if (open && !display) {
      setForm({ area_code: '', area_name: '', agent_code: '', description: '', is_active: true })
    }
  }, [open, display])

  // Focus trap + ESC
  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const createMutation = useMutation({
    mutationFn: (body: LlmAgentConfigCreate) => llmConfigApi.createConfig(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-agent-configs'] })
      onClose()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: LlmAgentConfigUpdate }) =>
      llmConfigApi.updateConfig(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-agent-configs'] })
      onClose()
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit && display) {
      updateMutation.mutate({
        id: display.id,
        body: {
          area_name: form.area_name,
          agent_code: form.agent_code,
          description: form.description || undefined,
          is_active: form.is_active,
        },
      })
    } else {
      createMutation.mutate({
        area_code: form.area_code,
        area_name: form.area_name,
        agent_code: form.agent_code,
        description: form.description || undefined,
        is_active: form.is_active,
      })
    }
  }

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={isEdit ? 'AgentCode 수정' : 'AgentCode 등록'}
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 헤더 */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-text-primary text-lg font-semibold">
            {isEdit ? `영역 수정 — ${display?.area_name ?? ''}` : '영역 추가'}
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <NeuInput
              id="drawer-area-code"
              label="영역 코드"
              placeholder="예: log_analysis"
              value={form.area_code}
              onChange={(e) => setForm({ ...form, area_code: e.target.value })}
              disabled={isEdit}
            />
            <NeuInput
              id="drawer-area-name"
              label="영역명"
              placeholder="예: 실시간 로그 분석"
              value={form.area_name}
              onChange={(e) => setForm({ ...form, area_name: e.target.value })}
            />
            <NeuInput
              id="drawer-agent-code"
              label="Agent Code"
              placeholder="DevX agent_code"
              value={form.agent_code}
              onChange={(e) => setForm({ ...form, agent_code: e.target.value })}
            />
            <div>
              <label htmlFor="drawer-description" className="text-text-secondary mb-1.5 block text-sm font-medium">
                설명
              </label>
              <textarea
                id="drawer-description"
                rows={7}
                placeholder="이 영역의 용도를 입력하세요"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="border-border bg-bg-base text-text-primary placeholder:text-text-disabled shadow-neu-inset focus:ring-accent w-full rounded-sm border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-text-secondary mb-1.5 block text-sm font-medium">활성 상태</label>
              <button
                type="button"
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  form.is_active ? 'bg-normal/15 text-normal' : 'bg-critical/15 text-critical',
                )}
              >
                {form.is_active ? '활성' : '비활성'}
              </button>
            </div>
          </div>

          {/* 푸터 */}
          <div className="border-border flex justify-end gap-2 border-t px-6 py-4">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" loading={isPending}>
              저장
            </NeuButton>
          </div>
        </form>
      </div>
    </>
  )
}

// ── 메인 페이지 ─────────────────────────────────────────────────────────

export function LlmAgentConfigPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LlmAgentConfig | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const { data: configs, isLoading } = useQuery({
    queryKey: ['llm-agent-configs'],
    queryFn: () => llmConfigApi.getConfigs(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => llmConfigApi.deleteConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-agent-configs'] })
      setDeleteId(null)
    },
  })

  function openCreate() {
    setEditTarget(null)
    setDrawerOpen(true)
  }

  function openEdit(c: LlmAgentConfig) {
    setEditTarget(c)
    setDrawerOpen(true)
  }

  if (isLoading) return <LoadingSkeleton shape="table" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="DevX AgentCode 관리"
        description="업무 영역별 DevX AgentCode를 관리합니다"
      />

      <div className="flex justify-end px-1">
        <NeuButton size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          영역 추가
        </NeuButton>
      </div>

      <div className="shadow-neu-flat overflow-x-auto rounded-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              {['영역 코드', '영역명', '설명', '활성', '수정일', ''].map((h) => (
                <th key={h} className="text-text-secondary px-4 py-2.5 text-left text-xs font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs?.map((c) => (
              <tr
                key={c.id}
                className="border-border border-b transition-colors last:border-0 hover:bg-[rgba(0,212,255,0.04)]"
              >
                <td className="text-text-primary max-w-[180px] truncate px-4 py-2.5 font-mono text-xs">
                  {c.area_code}
                </td>
                <td className="text-text-primary px-4 py-2.5">{c.area_name}</td>
                <td className="text-text-secondary max-w-[220px] truncate px-4 py-2.5 text-xs">
                  {c.description ?? '-'}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      c.is_active ? 'bg-normal/15 text-normal' : 'bg-critical/15 text-critical',
                    )}
                  >
                    {c.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="text-text-disabled px-4 py-2.5 text-xs">
                  {formatKST(c.updated_at, 'datetime')}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-text-secondary hover:text-accent"
                      aria-label="수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteId(c.id)}
                      className="text-text-secondary hover:text-critical"
                      aria-label="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 드로어 */}
      <ConfigDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editTarget={editTarget}
      />

      {/* 삭제 확인 모달 */}
      {deleteId && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center">
          <div className="border-border bg-bg-base shadow-neu-flat w-full max-w-sm rounded-sm border p-6">
            <h3 className="text-text-primary mb-2 text-base font-semibold">설정 삭제</h3>
            <p className="text-text-secondary mb-4 text-sm">이 영역 설정을 삭제하시겠습니까?</p>
            <div className="flex justify-end gap-2">
              <NeuButton variant="ghost" onClick={() => setDeleteId(null)}>
                취소
              </NeuButton>
              <NeuButton
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              >
                삭제
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
