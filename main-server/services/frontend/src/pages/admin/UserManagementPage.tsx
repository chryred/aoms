import { useState } from 'react'
import { Pencil, Link, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUsers } from '@/hooks/queries/useUsers'
import { useUpdateUserStatus } from '@/hooks/mutations/useUpdateUserStatus'
import { useUpdateUserRole } from '@/hooks/mutations/useUpdateUserRole'
import { useDeleteUser } from '@/hooks/mutations/useDeleteUser'
import { PageHeader } from '@/components/common/PageHeader'
import { UserStatusBadge, UserRoleBadge } from '@/components/user/UserStatusBadge'
import { ConfirmDialog } from '@/components/user/ConfirmDialog'
import { UserFormDrawer } from '@/components/user/UserFormDrawer'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { cn } from '@/lib/utils'
import { toUserStatus } from '@/types/auth'
import type { UserAdminOut, TabFilter } from '@/types/auth'

function filterUsers(users: UserAdminOut[], tab: TabFilter): UserAdminOut[] {
  if (tab === 'all') return users
  return users.filter((u) => toUserStatus(u) === tab)
}

function formatDate(iso: string) {
  // naive UTC → KST 변환 후 포맷
  const normalized = !iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso) ? iso + 'Z' : iso
  const d = new Date(normalized)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10).replace(/-/g, '. ') + '.'
}

type ActionType = 'approve' | 'reject' | 'disable' | 'reactivate' | 'delete'

const confirmMessages: Record<
  ActionType,
  { title: string; description: string; label: string; variant: 'default' | 'destructive' }
> = {
  approve: {
    title: '사용자 승인',
    description: '이 사용자의 가입을 승인합니까?',
    label: '승인',
    variant: 'default',
  },
  reject: {
    title: '가입 거부',
    description: '이 사용자의 가입 신청을 거부합니까?',
    label: '거부',
    variant: 'destructive',
  },
  disable: {
    title: '계정 비활성화',
    description: '이 계정을 비활성화합니까?',
    label: '비활성화',
    variant: 'destructive',
  },
  reactivate: {
    title: '계정 재활성화',
    description: '이 계정을 다시 활성화합니까?',
    label: '재활성화',
    variant: 'default',
  },
  delete: {
    title: '사용자 삭제',
    description: '이 사용자 계정을 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
    label: '삭제',
    variant: 'destructive',
  },
}

export function UserManagementPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    userId: number
    action: ActionType
  } | null>(null)
  const [editTarget, setEditTarget] = useState<UserAdminOut | null>(null)

  const { data: users = [], isLoading } = useUsers()
  const { mutate: updateStatus, isPending: isStatusPending } = useUpdateUserStatus()
  const { mutate: updateRole } = useUpdateUserRole()
  const { mutate: deleteUser, isPending: isDeletePending } = useDeleteUser()

  const pendingCount = users.filter((u) => toUserStatus(u) === 'pending').length
  const filtered = filterUsers(users, activeTab)

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: `전체 (${users.length})` },
    { key: 'pending', label: '승인 대기' },
    { key: 'active', label: `활성 (${users.filter((u) => toUserStatus(u) === 'active').length})` },
    {
      key: 'disabled',
      label: `비활성 (${users.filter((u) => toUserStatus(u) === 'disabled').length})`,
    },
  ]

  const handleConfirm = () => {
    if (!confirmState) return
    const { userId, action } = confirmState
    if (action === 'delete') {
      deleteUser(userId, { onSettled: () => setConfirmState(null) })
      return
    }
    const bodyMap: Record<Exclude<ActionType, 'delete'>, { is_approved?: boolean; is_active?: boolean }> = {
      approve: { is_approved: true },
      reject: { is_active: false },
      disable: { is_active: false },
      reactivate: { is_active: true, is_approved: true },
    }
    updateStatus({ id: userId, body: bodyMap[action] }, { onSettled: () => setConfirmState(null) })
  }

  if (isLoading) return <LoadingSkeleton shape="table" />

  const confirmMsg = confirmState ? confirmMessages[confirmState.action] : null

  return (
    <div className="space-y-6">
      <PageHeader title="사용자 승인 관리" />

      {/* 탭 */}
      <div className="bg-bg-base shadow-neu-pressed flex w-fit gap-1 rounded-sm p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'relative rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
            )}
          >
            {tab.key === 'pending' ? (
              <span className="flex items-center gap-1.5">
                승인 대기
                {pendingCount > 0 && (
                  <span className="bg-critical inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-xs text-white">
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
      <div className="bg-bg-base shadow-neu-flat overflow-hidden rounded-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="type-label whitespace-nowrap px-4 py-3 text-left">이름</th>
                <th className="type-label whitespace-nowrap px-4 py-3 text-left">이메일</th>
                <th className="type-label hidden whitespace-nowrap px-4 py-3 text-left md:table-cell">권한</th>
                <th className="type-label whitespace-nowrap px-4 py-3 text-left">상태</th>
                <th className="type-label hidden whitespace-nowrap px-4 py-3 text-left md:table-cell">담당자</th>
                <th className="type-label hidden whitespace-nowrap px-4 py-3 text-left md:table-cell">신청일</th>
                <th className="type-label whitespace-nowrap px-4 py-3 text-left">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-text-secondary px-4 py-8 text-center">
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
                      className="border-border border-b last:border-0 hover:bg-hover-subtle"
                    >
                      <td className="text-text-primary whitespace-nowrap px-4 py-3 font-medium">{user.name}</td>
                      <td className="text-text-secondary max-w-[180px] truncate whitespace-nowrap px-4 py-3" title={user.email}>{user.email}</td>
                      <td className="hidden px-4 py-3 md:table-cell">
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
                            className="border-border bg-bg-base text-text-secondary focus:ring-accent rounded-sm border px-2 py-1 text-xs [color-scheme:dark] focus:ring-1 focus:outline-none"
                          >
                            <option value="operator">운영자</option>
                            <option value="admin">관리자</option>
                          </select>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <UserStatusBadge status={userStatus} />
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 md:table-cell">
                        {user.is_linked ? (
                          <span
                            className="text-accent inline-flex items-center gap-1 text-xs"
                            title="담당자로 연결됨"
                          >
                            <Link className="h-3 w-3" />
                            연결됨
                          </span>
                        ) : (
                          <span className="text-text-disabled text-xs">—</span>
                        )}
                      </td>
                      <td className="text-text-secondary hidden whitespace-nowrap px-4 py-3 md:table-cell">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setEditTarget(user)}
                            title="정보 수정"
                            className="text-text-secondary hover:text-accent focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() =>
                                setConfirmState({ open: true, userId: user.id, action: 'delete' })
                              }
                              title="사용자 삭제"
                              className="text-text-secondary hover:text-critical focus:ring-critical rounded-sm p-1 focus:ring-1 focus:outline-none"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!isSelf && userStatus === 'pending' && (
                              <>
                                <button
                                  className="text-normal text-xs font-medium hover:underline"
                                  onClick={() =>
                                    setConfirmState({
                                      open: true,
                                      userId: user.id,
                                      action: 'approve',
                                    })
                                  }
                                >
                                  승인
                                </button>
                                <button
                                  className="text-critical text-xs font-medium hover:underline"
                                  onClick={() =>
                                    setConfirmState({
                                      open: true,
                                      userId: user.id,
                                      action: 'reject',
                                    })
                                  }
                                >
                                  거부
                                </button>
                              </>
                            )}
                          {!isSelf && userStatus === 'active' && (
                            <button
                              className="text-warning text-xs font-medium hover:underline"
                              onClick={() =>
                                setConfirmState({
                                  open: true,
                                  userId: user.id,
                                  action: 'disable',
                                })
                              }
                            >
                              비활성화
                            </button>
                          )}
                          {!isSelf && userStatus === 'disabled' && (
                            <button
                              className="text-normal text-xs font-medium hover:underline"
                              onClick={() =>
                                setConfirmState({
                                  open: true,
                                  userId: user.id,
                                  action: 'reactivate',
                                })
                              }
                            >
                              재활성화
                            </button>
                          )}
                        </div>
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
          isPending={isStatusPending || isDeletePending}
        />
      )}

      {/* 사용자 정보 수정 Drawer */}
      <UserFormDrawer
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        editTarget={editTarget}
      />
    </div>
  )
}
