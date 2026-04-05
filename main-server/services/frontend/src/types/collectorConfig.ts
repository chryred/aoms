export type CollectorType = 'node_exporter' | 'jmx_exporter' | 'db_exporter' | 'custom'

export interface CollectorConfig {
  id: number
  system_id: number
  collector_type: CollectorType
  metric_group: string
  enabled: boolean
  prometheus_job: string | null
  custom_config: string | null
  created_at: string
  updated_at: string
}

export interface CollectorConfigCreate {
  system_id: number
  collector_type: CollectorType
  metric_group: string
  enabled?: boolean
  prometheus_job?: string
  custom_config?: string
}

export interface CollectorConfigUpdate {
  enabled?: boolean
  prometheus_job?: string
  custom_config?: string
}

export interface CollectorTemplateItem {
  metric_group: string
  description: string
}

export interface CollectorTemplate {
  collector_type: CollectorType
  metric_groups: CollectorTemplateItem[]
}

export interface CollectorTypeOption {
  value: CollectorType
  label: string
  description: string
  iconName: string
}

export interface WizardState {
  systemId: number | null
  step: 1 | 2 | 3 | 4 | 5
  collectorType: CollectorType | null
  selectedMetricGroups: string[]
  customMetricGroup: string
  prometheusJob: string
  customConfig: string
  setStep: (step: WizardState['step']) => void
  setCollectorType: (type: CollectorType) => void
  toggleMetricGroup: (group: string) => void
  addCustomMetricGroup: (group: string) => void
  removeMetricGroup: (group: string) => void
  setPrometheusJob: (job: string) => void
  setCustomConfig: (config: string) => void
  reset: (systemId?: number) => void
}
