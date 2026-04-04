import { adminApi } from '@/lib/ky-client'
import type { System, SystemCreate, SystemUpdate } from '@/types/system'

export const systemsApi = {
  getSystems: () => adminApi.get('api/v1/systems').json<System[]>(),

  getSystem: (id: number) => adminApi.get(`api/v1/systems/${id}`).json<System>(),

  createSystem: (body: SystemCreate) =>
    adminApi.post('api/v1/systems', { json: body }).json<System>(),

  updateSystem: (id: number, body: SystemUpdate) =>
    adminApi.patch(`api/v1/systems/${id}`, { json: body }).json<System>(),

  deleteSystem: (id: number) => adminApi.delete(`api/v1/systems/${id}`),
}
