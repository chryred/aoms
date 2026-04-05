import { adminApi } from '@/lib/ky-client'
import type {
  CollectorConfig,
  CollectorConfigCreate,
  CollectorConfigUpdate,
  CollectorTemplate,
  CollectorType,
} from '@/types/collectorConfig'

export interface CollectorConfigFilterParams {
  system_id?: number
  collector_type?: CollectorType
}

export const collectorConfigApi = {
  getConfigs: (params?: CollectorConfigFilterParams) =>
    adminApi
      .get('api/v1/collector-config', {
        searchParams: (params ?? {}) as Record<string, string | number>,
      })
      .json<CollectorConfig[]>(),

  createConfig: (body: CollectorConfigCreate) =>
    adminApi.post('api/v1/collector-config', { json: body }).json<CollectorConfig>(),

  updateConfig: (id: number, body: CollectorConfigUpdate) =>
    adminApi.patch(`api/v1/collector-config/${id}`, { json: body }).json<CollectorConfig>(),

  deleteConfig: (id: number) =>
    adminApi.delete(`api/v1/collector-config/${id}`).json<{ deleted: boolean; id: number }>(),

  getTemplates: (type: CollectorType) =>
    adminApi.get(`api/v1/collector-config/templates/${type}`).json<CollectorTemplate>(),
}
