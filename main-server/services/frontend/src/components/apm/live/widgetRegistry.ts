import type { FC } from 'react'
import type { LiveData } from '@/hooks/useApmLiveStream'
import type { WidgetTarget } from '@/lib/apm/liveData'
import type { WidgetType } from '@/types/apm'
import { ActiveListWidget } from './widgets/ActiveListWidget'
import { AvgMsWidget } from './widgets/AvgMsWidget'
import { ErrRateWidget } from './widgets/ErrRateWidget'
import { JvmConnPoolWidget } from './widgets/JvmConnPoolWidget'
import { JvmCpuWidget } from './widgets/JvmCpuWidget'
import { JvmHeapGcWidget } from './widgets/JvmHeapGcWidget'
import { JvmUsersThreadsWidget } from './widgets/JvmUsersThreadsWidget'
import { QueueWidget } from './widgets/QueueWidget'
import { ScatterWidget } from './widgets/ScatterWidget'
import { SqlTopWidget } from './widgets/SqlTopWidget'
import { TpsWidget } from './widgets/TpsWidget'
import { UriTopWidget } from './widgets/UriTopWidget'

export interface WidgetProps {
  events: LiveData
  target: WidgetTarget
  slowMs: number
}

export interface WidgetDef {
  title: string
  defaultSize: { w: number; h: number }
  component: FC<WidgetProps>
}

/** 12열 그리드 기준 기본 크기. */
export const widgetRegistry: Record<WidgetType, WidgetDef> = {
  queue: { title: '액티브 큐', defaultSize: { w: 6, h: 6 }, component: QueueWidget },
  scatter: { title: '응답시간 산점도', defaultSize: { w: 6, h: 8 }, component: ScatterWidget },
  active_list: {
    title: '진행 중 트랜잭션',
    defaultSize: { w: 12, h: 8 },
    component: ActiveListWidget,
  },
  tps: { title: 'TPS', defaultSize: { w: 4, h: 5 }, component: TpsWidget },
  avg_ms: { title: '평균 응답시간', defaultSize: { w: 4, h: 5 }, component: AvgMsWidget },
  err_rate: { title: '에러율', defaultSize: { w: 4, h: 5 }, component: ErrRateWidget },
  uri_top: { title: 'URL 상위', defaultSize: { w: 6, h: 6 }, component: UriTopWidget },
  sql_top: { title: 'SQL 상위', defaultSize: { w: 6, h: 6 }, component: SqlTopWidget },
  jvm_users_threads: {
    title: '동시 사용자·스레드',
    defaultSize: { w: 3, h: 5 },
    component: JvmUsersThreadsWidget,
  },
  jvm_cpu: { title: 'JVM CPU', defaultSize: { w: 3, h: 5 }, component: JvmCpuWidget },
  jvm_heap_gc: { title: '힙·GC', defaultSize: { w: 3, h: 5 }, component: JvmHeapGcWidget },
  jvm_conn_pool: {
    title: 'DB 커넥션 풀',
    defaultSize: { w: 3, h: 5 },
    component: JvmConnPoolWidget,
  },
}

export const WIDGET_TYPES = Object.keys(widgetRegistry) as WidgetType[]

/** 화면당 위젯 상한 (D3 레이아웃 검증 규칙). */
export const MAX_WIDGETS = 30
