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
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-10 w-80 rounded-sm bg-[#1E2127] p-6 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
        <h3 className="text-base font-semibold text-[#E2E8F2]">시스템 삭제</h3>
        <p className="mt-2 text-sm text-[#8B97AD]">
          <strong className="text-[#E2E8F2]">{name}</strong> 시스템을 삭제하시겠습니까?
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
            <tr className="border-b border-[#2B2F37]">
              {['시스템명', '상태', '등록일', ''].map((h) => (
                <th key={h} className="type-label px-4 py-3 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2B2F37]">
            {filtered.map((system) => (
              <tr key={system.id} className="transition-colors hover:bg-[rgba(0,212,255,0.04)]">
                <td className="px-4 py-3">
                  <p className="font-medium text-[#E2E8F2]">{system.display_name}</p>
                  <p className="font-mono text-xs text-[#8B97AD]">{system.system_name}</p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm',
                      system.status === 'active' ? 'text-[#22C55E]' : 'text-[#5A6478]',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        system.status === 'active' ? 'bg-[#22C55E]' : 'bg-[#5A6478]',
                      )}
                    />
                    {system.status === 'active' ? '운영 중' : '비활성'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-[#8B97AD]">
                  {formatKST(system.created_at, 'date')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEdit(system)}
                      aria-label="수정"
                      className="rounded-sm p-1.5 text-[#8B97AD] hover:bg-[rgba(0,212,255,0.06)] hover:text-[#00D4FF] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(system)}
                      aria-label="삭제"
                      className="rounded-sm p-1.5 text-[#EF4444] hover:bg-[rgba(239,68,68,0.08)] focus:ring-1 focus:ring-[#EF4444] focus:outline-none"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-sm bg-[#1E2127] px-6 py-4 text-sm text-[#8B97AD] shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
            삭제 중...
          </div>
        </div>
      )}
    </>
  )
}
