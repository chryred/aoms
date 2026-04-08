import { adminApi, filterParams } from '@/lib/ky-client'
import type {
  AgentInstance,
  AgentInstanceCreate,
  AgentInstanceUpdate,
  AgentInstallJob,
  AgentInstallRequest,
  AgentStatusOut,
  AgentConfigResponse,
  SSHSessionCreate,
  SSHSessionOut,
} from '@/types/agent'

export interface AgentFilterParams {
  system_id?: number
  agent_type?: string
}

/** SSH 세션 토큰을 헤더에 담아 반환하는 헬퍼 */
function withSession(token: string) {
  return { headers: { 'X-SSH-Session': token } }
}

export const agentsApi = {
  // ── SSH 세션 ──────────────────────────────────────────────
  createSession: (body: SSHSessionCreate) =>
    adminApi.post('api/v1/ssh/session', { json: body }).json<SSHSessionOut>(),

  deleteSession: (token: string) =>
    adminApi.delete('api/v1/ssh/session', withSession(token)),

  // ── 에이전트 CRUD ─────────────────────────────────────────
  getAgents: (params?: AgentFilterParams) =>
    adminApi
      .get('api/v1/agents', {
        searchParams: filterParams(params ?? {}),
      })
      .json<AgentInstance[]>(),

  getAgent: (id: number) =>
    adminApi.get(`api/v1/agents/${id}`).json<AgentInstance>(),

  createAgent: (body: AgentInstanceCreate) =>
    adminApi.post('api/v1/agents', { json: body }).json<AgentInstance>(),

  updateAgent: (id: number, body: AgentInstanceUpdate) =>
    adminApi.patch(`api/v1/agents/${id}`, { json: body }).json<AgentInstance>(),

  deleteAgent: (id: number) => adminApi.delete(`api/v1/agents/${id}`),

  // ── 제어 (동기) ───────────────────────────────────────────
  startAgent: (id: number, token: string) =>
    adminApi.post(`api/v1/agents/${id}/start`, withSession(token)).json<AgentStatusOut>(),

  stopAgent: (id: number, token: string) =>
    adminApi.post(`api/v1/agents/${id}/stop`, withSession(token)).json<AgentStatusOut>(),

  restartAgent: (id: number, token: string) =>
    adminApi.post(`api/v1/agents/${id}/restart`, withSession(token)).json<AgentStatusOut>(),

  getStatus: (id: number, token: string) =>
    adminApi.get(`api/v1/agents/${id}/status`, withSession(token)).json<AgentStatusOut>(),

  // ── 설정 파일 ─────────────────────────────────────────────
  getConfig: (id: number, token: string) =>
    adminApi.get(`api/v1/agents/${id}/config`, withSession(token)).json<AgentConfigResponse>(),

  uploadConfig: (id: number, token: string, content: string) =>
    adminApi
      .post(`api/v1/agents/${id}/config`, {
        json: { config_content: content },
        ...withSession(token),
      })
      .json<AgentStatusOut>(),

  // ── 설치 Job (비동기) ─────────────────────────────────────
  installAgent: (body: AgentInstallRequest, token: string) =>
    adminApi
      .post('api/v1/agents/install', { json: body, ...withSession(token) })
      .json<AgentInstallJob>(),

  getInstallJob: (jobId: string) =>
    adminApi.get(`api/v1/agents/jobs/${jobId}`).json<AgentInstallJob>(),
}
