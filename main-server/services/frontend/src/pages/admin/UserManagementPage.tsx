import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useUsers } from '@/hooks/queries/useUsers'
import { useUpdateUserStatus } from '@/hooks/mutations/useUpdateUserStatus'
import { useUpdateUserRole } from '@/hooks/mutations/useUpdateUserRole'
import { PageHeader } from '@/components/common/PageHeader'
import { UserStatusBadge, UserRoleBadge } from '@/components/user/UserStatusBadge'
import { ConfirmDialog } from '@/components/user/ConfirmDialog'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { cn } from '@/lib/utils'
import { toUserStatus } from '@/types/auth'
import type { UserAdminOut, TabFilter } from '@/types/auth'

function filterUsers(users: UserAdminOut[], tab: TabFilter): UserAdminOut[] {
  if (tab === 'all') return users
  return users.filter((u) => toUserStatus(u) === tab)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

type ActionType = 'approve' | 'reject' | 'disable' | 'reactivate'

const confirmMessages: Record<ActionType, { title: string; description: string; label: string; variant: 'default' | 'destructive' }> = {
  approve:    { title: '사용자 승인',   description: '이 사용자의 가입을 승인합니까?',       label: '승인',    variant: 'default' },
  reject:     { title: '가입 거부',     description: '이 사용자의 가입 신청을 거부합니까?',   label: '거부',    variant: 'destructive' },
  disable:    { title: '계정 비활성화', description: '이 계정을 비활성화합니까?',             label: '비활성화', variant: 'destructive' },
  reactivate: { title: '계정 재활성화', description: '이 계정을 다시 활성화합니까?',           label: '재활성화', variant: 'default' },
}

export function UserManagementPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    userId: number
    action: ActionType
  } | null>(null)

  const { data: users = [], isLoading } = useUsers()
  const { mutate: updateStatus, isPending: isStatusPending } = useUpdateUserStatus()
  const { mutate: updateRole } = useUpdateUserRole()

  const pendingCount = users.filter((u) => toUserStatus(u) === 'pending').length
  const filtered = filterUsers(users, activeTab)

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all',      label: `전체 (${users.length})` },
    { key: 'pending',  label: '승인 대기' },
    { key: 'active',   label: `활성 (${users.filter((u) => toUserStatus(u) === 'active').length})` },
    { key: 'disabled', label: `비활성 (${users.filter((u) => toUserStatus(u) === 'disabled').length})` },
  ]

  const handleConfirm = () => {
    if (!confirmState) return
    const { userId, action } = confirmState
    const bodyMap: Record<ActionType, { is_approved?: boolean; is_active?: boolean }> = {
      approve:    { is_approved: true },
      reject:     { is_active: false },
      disable:    { is_active: false },
      reactivate: { is_active: true, is_approved: true },
    }
    updateStatus(
      { id: userId, body: bodyMap[action] },
      { onSettled: () => setConfirmState(null) }
    )
  }

  if (isLoading) return <LoadingSkeleton shape="table" />

  const confirmMsg = confirmState ? confirmMessages[confirmState.action] : null

  return (
    <div className="space-y-6">
      <PageHeader title="사용자 승인 관리" />

      {/* 탭 */}
      <div className="flex gap-1 bg-[#E0E3E9] p-1 rounded-xl w-fit shadow-[inset_2px_2px_4px_#C8CBD4,inset_-2px_-2px_4px_#FFFFFF]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'relative px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-[#6366F1] text-white shadow-[2px_2px_4px_#C8CBD4,-2px_-2px_4px_#FFFFFF]'
                : 'text-[#4A5568] hover:bg-[rgba(99,102,241,0.08)]'
            )}
          >
            {tab.key === 'pending' ? (
              <span className="flex items-center gap-1.5">
                승인 대기
                {pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#DC2626] text-white text-xs">
                    {pendingCount}
                  </span>
                )}
              </span>
            ) : (
              tab.label
            )}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-[#E8EBF0] rounded-2xl shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#D4D7DE] text-[#4A5568] text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left font-semibold">이름</th>
                <th className="px-4 py-3 text-left font-semibold">이메일</th>
                <th className="px-4 py-3 text-left font-semibold">권한</th>
                <th className="px-4 py-3 text-left font-semibold">상태</th>
                <th className="px-4 py-3 text-left font-semibold">신청일</th>
                <th className="px-4 py-3 text-left font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#4A5568]">
                    해당 사용자가 없습니다
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const userStatus = toUserStatus(user)
                  const isSelf = currentUser?.id === user.id
                  return (
                    <tr
                      key={user.id}
                      className="border-b border-[#D4D7DE] last:border-0 hover:bg-[rgba(99,102,241,0.04)]"
                    >
                      <td className="px-4 py-3 font-medium text-[#1A1F2E]">{user.name}</td>
                      <td className="px-4 py-3 text-[#4A5568]">{user.email}</td>
                      <td className="px-4 py-3">
                        {isSelf ? (
                          <UserRoleBadge role={user.role} />
                        ) : (
                          <select
                            value={user.role}
                            disabled={isSelf}
                            onChange={(e) =>
                              updateRole({
                                id: user.id,
                                body: { role: e.target.value as 'admin' | 'operator' },
                              })
                            }
                            className="text-xs rounded-lg border border-[#D4D7DE] bg-[#E8EBF0] px-2 py-1 text-[#4A5568] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                          >
                            <option value="operator">운영자</option>
                            <option value="admin">관리자</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <UserStatusBadge status={userStatus} />
                      </td>
                      <td className="px-4 py-3 text-[#4A5568]">{formatDate(user.created_at)}</td>
                      <td className="px-4 py-3">
                        {isSelf ? (
                          <span
                            className="text-xs text-[#4A5568] cursor-not-allowed"
                            title="본인 계정은 변경할 수 없습니다"
                          >
                            —
                          </span>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            {userStatus === 'pending' && (
                              <>
                                <button
                                  className="text-xs font-medium text-[#16A34A] hover:underline"
                                  onClick={() =>
                                    setConfirmState({ open: true, userId: user.id, action: 'approve' })
                                  }
                                >
                                  승인
                                </button>
                                <button
                                  className="text-xs font-medium text-[#DC2626] hover:underline"
                                  onClick={() =>
                                    setConfirmState({ open: true, userId: user.id, action: 'reject' })
                                  }
                                >
                                  거부
                                </button>
                              </>
                            )}
                            {userStatus === 'active' && (
                              <button
                                className="text-xs font-medium text-[#D97706] hover:underline"
                                onClick={() =>
                                  setConfirmState({ open: true, userId: user.id, action: 'disable' })
                                }
                              >
                                비활성화
                              </button>
                            )}
                            {userStatus === 'disabled' && (
                              <button
                                className="text-xs font-medium text-[#16A34A] hover:underline"
                                onClick={() =>
                                  setConfirmState({ open: true, userId: user.id, action: 'reactivate' })
                                }
                              >
                                재활성화
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ConfirmDialog */}
      {confirmState && confirmMsg && (
        <ConfirmDialog
          open={confirmState.open}
          onOpenChange={(open) => !open && setConfirmState(null)}
          title={confirmMsg.title}
          description={confirmMsg.description}
          confirmLabel={confirmMsg.label}
          confirmVariant={confirmMsg.variant}
          onConfirm={handleConfirm}
          isPending={isStatusPending}
        />
      )}
    </div>
  )
}
