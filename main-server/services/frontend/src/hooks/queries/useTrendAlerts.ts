import { useEffect } from 'react'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { useQuery } from '@tanstack/react-query'
import { aggregationsApi } from '@/api/aggregations'
import { qk } from '@/constants/queryKeys'
import { useUiStore } from '@/store/uiStore'

export function useTrendAlerts() {
  const active = useTabActive()
  const setCriticalCount = useUiStore((s) => s.setCriticalCount)

  const query = useQuery({
    queryKey: qk.aggregations.trends(),
    queryFn: () => aggregationsApi.getTrendAlerts(),
    staleTime: 30_000,
    refetchInterval: active ? 300_000 : false,
    select: (data) => {
      const order: Record<string, number> = { critical: 0, warning: 1, normal: 2 }
      return [...data].sort((a, b) => (order[a.llm_severity] ?? 2) - (order[b.llm_severity] ?? 2))
    },
  })

  useEffect(() => {
    const count = query.data?.filter((a) => a.llm_severity === 'critical').length ?? 0
    setCriticalCount(count)
  }, [query.data, setCriticalCount])

  return query
}
