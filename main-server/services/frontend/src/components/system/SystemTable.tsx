import { useState } from 'react'
import { Pencil, Trash2, Monitor, Terminal } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { useDeleteSystem } from '@/hooks/mutations/useDeleteSystem'
import { formatKST } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { System } from '@/types/system'

const TYPE_LABELS: Record<string, string> = {
  web: 'Web', was: 'WAS', db: 'DB', middleware: 'Middleware', other: '기타',
}

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
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative z-10 rounded-2xl bg-[#E8EBF0] p-6 w-80">
        <h3 className="text-base font-semibold text-[#1A1F2E]">시스템 삭제</h3>
        <p className="mt-2 text-sm text-[#4A5568]">
          <strong>{name}</strong> 시스템을 삭제하시겠습니까?<br />
          이 작업은 되돌릴 수 없습니다.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <NeuButton variant="ghost" size="sm" onClick={onCancel}>취소</NeuButton>
          <NeuButton variant="danger" size="sm" onClick={onConfirm}>삭제</NeuButton>
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
    return (
      s.display_name.toLowerCase().includes(q) ||
      s.system_name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q)
    )
  })

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={<Terminal className="w-12 h-12" />}
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
            <tr className="border-b border-[#D4D7DE]">
              {['시스템명', '호스트', '타입', 'OS', '상태', '등록일', ''].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[#4A5568]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8EBF0]">
            {filtered.map((system) => (
              <tr
                key={system.id}
                className="hover:bg-[rgba(99,102,241,0.04)] transition-colors"
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-[#1A1F2E]">{system.display_name}</p>
                  <p className="text-xs text-[#4A5568] font-mono">{system.system_name}</p>
                </td>
                <td className="px-4 py-3 text-sm text-[#4A5568] font-mono">{system.host}</td>
                <td className="px-4 py-3">
                  <NeuBadge variant="info">{TYPE_LABELS[system.system_type] ?? system.system_type}</NeuBadge>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1 text-sm text-[#4A5568]">
                    {system.os_type === 'linux'
                      ? <Terminal className="w-3.5 h-3.5" />
                      : <Monitor className="w-3.5 h-3.5" />}
                    {system.os_type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm',
                      system.status === 'active' ? 'text-[#16A34A]' : 'text-[#A0A4B0]'
                    )}
                  >
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        system.status === 'active' ? 'bg-[#16A34A]' : 'bg-[#A0A4B0]'
                      )}
                    />
                    {system.status === 'active' ? '운영 중' : '비활성'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-[#4A5568]">
                  {formatKST(system.created_at, 'date')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEdit(system)}
                      aria-label="수정"
                      className="rounded-lg p-1.5 text-[#4A5568] hover:bg-[rgba(99,102,241,0.08)]
                                 focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(system)}
                      aria-label="삭제"
                      className="rounded-lg p-1.5 text-[#DC2626] hover:bg-red-50
                                 focus:outline-none focus:ring-2 focus:ring-[#DC2626]"
                    >
                      <Trash2 className="w-4 h-4" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10">
          <div className="rounded-xl bg-[#E8EBF0] px-6 py-4 shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF] text-sm text-[#4A5568]">
            삭제 중...
          </div>
        </div>
      )}
    </>
  )
}
