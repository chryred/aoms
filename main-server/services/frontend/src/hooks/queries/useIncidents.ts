import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addIncidentComment,
  aiAnalyzeIncident,
  generateIncidentReport,
  getIncident,
  listIncidents,
  updateIncident,
  type IncidentListParams,
  type IncidentUpdate,
} from '@/api/incidents'

const qk = {
  list: (params: IncidentListParams) => ['incidents', params] as const,
  detail: (id: number) => ['incidents', id] as const,
}

export function useIncidents(params: IncidentListParams = {}) {
  return useQuery({
    queryKey: qk.list(params),
    queryFn: () => listIncidents(params),
  })
}

export function useIncident(id: number) {
  return useQuery({
    queryKey: qk.detail(id),
    queryFn: () => getIncident(id),
    enabled: !!id,
  })
}

export function useUpdateIncident(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: IncidentUpdate) => updateIncident(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.detail(id) })
      qc.invalidateQueries({ queryKey: ['incidents'] })
    },
  })
}

export function useAddIncidentComment(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (comment: string) => addIncidentComment(id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.detail(id) })
    },
  })
}

export function useGenerateIncidentIncidentReport() {
  return useMutation({
    mutationFn: (incidentId: number) => generateIncidentReport(incidentId),
  })
}

export function useAiAnalyzeIncident() {
  return useMutation({
    mutationFn: (incidentId: number) => aiAnalyzeIncident(incidentId),
  })
}
