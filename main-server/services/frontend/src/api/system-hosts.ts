import { adminApi } from '@/lib/ky-client'
import type { SystemHost, SystemHostCreate } from '@/types/system'

export const systemHostsApi = {
  getSystemHosts: (systemId: number) =>
    adminApi.get(`api/v1/systems/${systemId}/hosts`).json<SystemHost[]>(),

  addSystemHost: (systemId: number, body: SystemHostCreate) =>
    adminApi.post(`api/v1/systems/${systemId}/hosts`, { json: body }).json<SystemHost>(),

  removeSystemHost: (systemId: number, hostId: number) =>
    adminApi.delete(`api/v1/systems/${systemId}/hosts/${hostId}`),
}
