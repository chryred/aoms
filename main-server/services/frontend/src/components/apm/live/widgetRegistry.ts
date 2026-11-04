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
  /** 리사이즈 하한(그리드 칸). 이보다 작아지면 내용이 깨진다 */
  minSize: { w: number; h: number }
  component: FC<WidgetProps>
}

const chart = (title: string, component: FC<WidgetProps>): WidgetDef => ({
  title,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 3 },
  component,
})

/** 12열 그리드 기준 기본 크기. 차트는 한 행에 2개(w=6, h=4 약 190px)가 들어가도록 컴팩트하게. */
export const widgetRegistry: Record<WidgetType, WidgetDef> = {
  queue: {
    title: '액티브 큐',
    defaultSize: { w: 7, h: 6 },
    minSize: { w: 4, h: 4 },
    component: QueueWidget,
  },
  scatter: {
    title: '트랜잭션 모니터링',
    defaultSize: { w: 5, h: 6 },
    minSize: { w: 4, h: 4 },
    component: ScatterWidget,
  },
  active_list: {
    title: '진행 중 트랜잭션',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    component: ActiveListWidget,
  },
  tps: chart('TPS', TpsWidget),
  avg_ms: chart('평균 응답시간', AvgMsWidget),
  err_rate: chart('에러율', ErrRateWidget),
  uri_top: {
    title: 'URL 상위',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    component: UriTopWidget,
  },
  sql_top: {
    title: 'SQL 상위',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    component: SqlTopWidget,
  },
  jvm_users_threads: chart('동시 사용자·JVM 스레드', JvmUsersThreadsWidget),
  jvm_cpu: chart('JVM CPU', JvmCpuWidget),
  jvm_heap_gc: chart('힙·GC', JvmHeapGcWidget),
  jvm_conn_pool: chart('DB 커넥션 풀', JvmConnPoolWidget),
}

export const WIDGET_TYPES = Object.keys(widgetRegistry) as WidgetType[]

/** 화면당 위젯 상한 (D3 레이아웃 검증 규칙). */
export const MAX_WIDGETS = 30
