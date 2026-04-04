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
} from '@/types/auth'

export const authApi = {
  login: (body: LoginRequest) =>
    adminApi.post('api/v1/auth/login', { json: body }).json<LoginResponse>(),

  refresh: () =>
    adminApi.post('api/v1/auth/refresh').json<{ access_token: string }>(),

  logout: () => adminApi.post('api/v1/auth/logout'),

  me: () => adminApi.get('api/v1/auth/me').json<User>(),

  register: (body: RegisterRequest) =>
    adminApi.post('api/v1/auth/register', { json: body }).json<{ message: string }>(),

  getUsers: () =>
    adminApi.get('api/v1/auth/users').json<UserAdminOut[]>(),

  updateUserStatus: (id: number, body: UserStatusUpdateRequest) =>
    adminApi.patch(`api/v1/auth/users/${id}/status`, { json: body }).json<UserAdminOut>(),

  updateUserRole: (id: number, body: UserRoleUpdateRequest) =>
    adminApi.patch(`api/v1/auth/users/${id}/role`, { json: body }).json<UserAdminOut>(),

  updateMe: (body: UserUpdateRequest) =>
    adminApi.patch('api/v1/auth/me', { json: body }).json<User>(),
}
