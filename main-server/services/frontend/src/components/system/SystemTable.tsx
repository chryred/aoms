import { useState } from 'react'
import { Pencil, Trash2, Terminal } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { EmptyState } from '@/components/common/EmptyState'
import { useDeleteSystem } from '@/hooks/mutations/useDeleteSystem'
import { formatKST } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { System } from '@/types/system'

interface ConfirmDialogProps {
  open: boolean
  name: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ open, name, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-overlay absolute inset-0" onClick={onCancel} />
      <div className="bg-bg-base shadow-neu-flat relative z-10 w-80 rounded-sm p-6">
        <h3 className="text-text-primary text-base font-semibold">시스템 삭제</h3>
        <p className="text-text-secondary mt-2 text-sm">
          <strong className="text-text-primary">{name}</strong> 시스템을 삭제하시겠습니까?
          <br />이 작업은 되돌릴 수 없습니다.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <NeuButton variant="ghost" size="sm" onClick={onCancel}>
            취소
          </NeuButton>
          <NeuButton variant="danger" size="sm" onClick={onConfirm}>
            삭제
          </NeuButton>
        </div>
      </div>
    </div>
  )
}

interface SystemTableProps {
  systems: System[]
  onEdit: (system: System) => void
  searchQuery?: string
}

export function SystemTable({ systems, onEdit, searchQuery = '' }: SystemTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<System | null>(null)
  const { mutate: deleteSystem, isPending: isDeleting } = useDeleteSystem()

  const filtered = systems.filter((s) => {
    const q = searchQuery.toLowerCase()
    return s.display_name.toLowerCase().includes(q) || s.system_name.toLowerCase().includes(q)
  })

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={<Terminal className="h-12 w-12" />}
        title={searchQuery ? '검색 결과가 없습니다' : '등록된 시스템이 없습니다'}
        description={!searchQuery ? '우측 상단의 버튼으로 시스템을 등록하세요' : undefined}
      />
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-border border-b">
              {['시스템명', '상태', '등록일', ''].map((h) => (
                <th key={h} className="type-label px-4 py-3 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {filtered.map((system) => (
              <tr key={system.id} className="transition-colors hover:bg-[rgba(0,212,255,0.04)]">
                <td className="px-4 py-3">
                  <p className="text-text-primary font-medium">{system.display_name}</p>
                  <p className="text-text-secondary font-mono text-xs">{system.system_name}</p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm',
                      system.status === 'active' ? 'text-normal' : 'text-text-disabled',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        system.status === 'active' ? 'bg-normal' : 'bg-text-disabled',
                      )}
                    />
                    {system.status === 'active' ? '운영 중' : '비활성'}
                  </span>
                </td>
                <td className="text-text-secondary px-4 py-3 text-sm">
                  {formatKST(system.created_at, 'date')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEdit(system)}
                      aria-label="수정"
                      className="text-text-secondary hover:bg-accent-muted hover:text-accent focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(system)}
                      aria-label="삭제"
                      className="text-critical hover:bg-critical-card-bg focus:ring-critical rounded-sm p-1.5 focus:ring-1 focus:outline-none"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        name={deleteTarget?.display_name ?? ''}
        onConfirm={() => {
          if (deleteTarget) {
            deleteSystem(deleteTarget.id, { onSettled: () => setDeleteTarget(null) })
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      {isDeleting && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center">
          <div className="bg-bg-base text-text-secondary shadow-neu-flat rounded-sm px-6 py-4 text-sm">
            삭제 중...
          </div>
        </div>
      )}
    </>
  )
}
