import { adminApi } from '@/lib/ky-client'
import type {
  LoginRequest,
  LoginResponse,
  User,
  RegisterRequest,
  UserAdminOut,
  UserStatusUpdateRequest,
  UserRoleUpdateRequest,
  UserUpdateRequest,
  UserAdminUpdateRequest,
} from '@/types/auth'

export interface PrimarySystemOut {
  system_id: number
  system_name: string
  display_name: string
}

export const authApi = {
  login: (body: LoginRequest) =>
    adminApi.post('api/v1/auth/login', { json: body }).json<LoginResponse>(),

  refresh: () => adminApi.post('api/v1/auth/refresh').json<{ access_token: string }>(),

  logout: () => adminApi.post('api/v1/auth/logout'),

  me: () => adminApi.get('api/v1/auth/me').json<User>(),

  myPrimarySystems: () => adminApi.get('api/v1/auth/me/primary-systems').json<PrimarySystemOut[]>(),

  register: (body: RegisterRequest) =>
    adminApi.post('api/v1/auth/register', { json: body }).json<{ message: string }>(),

  getApprovedUsers: () => adminApi.get('api/v1/auth/users/approved').json<User[]>(),

  getUsers: () => adminApi.get('api/v1/auth/users').json<UserAdminOut[]>(),

  updateUserStatus: (id: number, body: UserStatusUpdateRequest) =>
    adminApi.patch(`api/v1/auth/users/${id}/status`, { json: body }).json<UserAdminOut>(),

  updateUserRole: (id: number, body: UserRoleUpdateRequest) =>
    adminApi.patch(`api/v1/auth/users/${id}/role`, { json: body }).json<UserAdminOut>(),

  updateUser: (id: number, body: UserAdminUpdateRequest) =>
    adminApi.patch(`api/v1/auth/users/${id}`, { json: body }).json<UserAdminOut>(),

  updateMe: (body: UserUpdateRequest) =>
    adminApi.patch('api/v1/auth/me', { json: body }).json<User>(),

  deleteUser: (id: number) => adminApi.delete(`api/v1/auth/users/${id}`),
}
