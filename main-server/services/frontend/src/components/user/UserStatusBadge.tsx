import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import type { UserStatus, UserRole } from '@/types/auth'

interface UserStatusBadgeProps {
  status: UserStatus
}

export function UserStatusBadge({ status }: UserStatusBadgeProps) {
  const map: Record<UserStatus, { label: string; variant: 'warning' | 'normal' | 'critical' }> = {
    pending: { label: '승인 대기', variant: 'warning' },
    active: { label: '활성', variant: 'normal' },
    disabled: { label: '비활성', variant: 'critical' },
  }
  const { label, variant } = map[status]
  return <NeuBadge variant={variant}>{label}</NeuBadge>
}

interface UserRoleBadgeProps {
  role: UserRole
}

export function UserRoleBadge({ role }: UserRoleBadgeProps) {
  return (
    <NeuBadge
      className={
        role === 'admin'
          ? 'border border-[rgba(0,212,255,0.20)] bg-[rgba(0,212,255,0.10)] text-[#00D4FF]'
          : undefined
      }
      variant={role === 'admin' ? undefined : 'muted'}
    >
      {role === 'admin' ? '관리자' : '운영자'}
    </NeuBadge>
  )
}
