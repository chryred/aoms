export type UserRole = 'admin' | 'operator'

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  user: User
}

// Phase 3c 추가 타입

export type UserStatus = 'pending' | 'active' | 'disabled'

export type TabFilter = 'all' | 'pending' | 'active' | 'disabled'

export interface UserAdminOut {
  id: number
  email: string
  name: string
  role: UserRole
  is_active: boolean
  is_approved: boolean
  created_at: string
}

export function toUserStatus(user: Pick<UserAdminOut, 'is_active' | 'is_approved'>): UserStatus {
  if (!user.is_active) return 'disabled'
  if (!user.is_approved) return 'pending'
  return 'active'
}

export interface RegisterRequest {
  name: string
  email: string
  password: string
}

export interface UserStatusUpdateRequest {
  is_approved?: boolean
  is_active?: boolean
}

export interface UserRoleUpdateRequest {
  role: UserRole
}

export interface UserUpdateRequest {
  name?: string
  current_password?: string
  new_password?: string
}
