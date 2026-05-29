import { adminApi } from '@/lib/ky-client'
import type {
  SslHaGroup,
  SslServer,
  SslServerCreate,
  SslServerUpdate,
  SslDeployment,
  SslCertSnapshot,
  SslCertStatus,
  RootCaInfo,
} from '@/types/ssl'

export const sslApi = {
  // ── HA 그룹 ────────────────────────────────────────────────
  getHaGroups: () => adminApi.get('api/v1/ssl/ha-groups').json<SslHaGroup[]>(),

  createHaGroup: (body: { group_name: string; system_code?: string; serial_size?: number }) =>
    adminApi.post('api/v1/ssl/ha-groups', { json: body }).json<SslHaGroup>(),

  deleteHaGroup: (id: number) => adminApi.delete(`api/v1/ssl/ha-groups/${id}`),

  // ── 서버 ───────────────────────────────────────────────────
  getServers: (params?: { network_zone?: string; status?: string }) =>
    adminApi
      .get('api/v1/ssl/servers', {
        searchParams: Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
        ),
      })
      .json<SslServer[]>(),

  createServer: (body: SslServerCreate) =>
    adminApi.post('api/v1/ssl/servers', { json: body }).json<SslServer>(),

  updateServer: (id: number, body: SslServerUpdate) =>
    adminApi.patch(`api/v1/ssl/servers/${id}`, { json: body }).json<SslServer>(),

  deleteServer: (id: number) => adminApi.delete(`api/v1/ssl/servers/${id}`),

  testSsh: (id: number) =>
    adminApi
      .post(`api/v1/ssl/servers/${id}/test-ssh`)
      .json<{ success: boolean; message: string }>(),

  // ── 배포 ───────────────────────────────────────────────────
  deployServer: (id: number) =>
    adminApi.post(`api/v1/ssl/servers/${id}/deploy`).json<SslDeployment>(),

  deployHaGroup: (id: number) =>
    adminApi
      .post(`api/v1/ssl/ha-groups/${id}/deploy`)
      .json<{ message: string; server_count: number }>(),

  getDeployments: (params?: { server_id?: number; limit?: number }) =>
    adminApi
      .get('api/v1/ssl/deployments', {
        searchParams: Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
        ),
      })
      .json<SslDeployment[]>(),

  getDeployment: (id: number) => adminApi.get(`api/v1/ssl/deployments/${id}`).json<SslDeployment>(),

  // ── 인증서 현황 ────────────────────────────────────────────
  getCertStatus: () => adminApi.get('api/v1/ssl/certs/status').json<SslCertStatus[]>(),

  getCertByServer: (serverId: number) =>
    adminApi.get(`api/v1/ssl/certs/${serverId}`).json<SslCertSnapshot>(),

  // ── DMZ 번들 ───────────────────────────────────────────────
  downloadDmzBundle: async (serverId: number) => {
    const response = await adminApi.get(`api/v1/ssl/dmz/bundle/${serverId}`)
    return response.blob()
  },

  // ── Root CA (인증 불필요) ───────────────────────────────────
  getRootCaInfo: () =>
    fetch('/api/v1/ssl/root-ca/info').then((r) => r.json()) as Promise<RootCaInfo>,
}
