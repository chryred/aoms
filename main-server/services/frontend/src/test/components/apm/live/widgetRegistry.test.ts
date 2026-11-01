import { describe, it, expect } from 'vitest'
import { MAX_WIDGETS, WIDGET_TYPES, widgetRegistry } from '@/components/apm/live/widgetRegistry'
import type { WidgetType } from '@/types/apm'

const ALL: WidgetType[] = [
  'queue',
  'scatter',
  'active_list',
  'tps',
  'avg_ms',
  'err_rate',
  'uri_top',
  'sql_top',
  'jvm_users_threads',
  'jvm_cpu',
  'jvm_heap_gc',
  'jvm_conn_pool',
]

describe('widgetRegistry', () => {
  it('WidgetType 12종을 모두 등록한다', () => {
    expect(Object.keys(widgetRegistry).sort()).toEqual([...ALL].sort())
    expect(WIDGET_TYPES).toHaveLength(12)
  })
  it('각 항목은 제목·12열 안의 기본 크기·컴포넌트를 가진다', () => {
    for (const t of ALL) {
      const d = widgetRegistry[t]
      expect(d.title).not.toBe('')
      expect(d.defaultSize.w).toBeGreaterThan(0)
      expect(d.defaultSize.w).toBeLessThanOrEqual(12)
      expect(d.defaultSize.h).toBeGreaterThan(0)
      expect(typeof d.component).toBe('function')
    }
  })
  it('위젯 상한은 30', () => {
    expect(MAX_WIDGETS).toBe(30)
  })
})
