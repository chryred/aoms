import { Info } from 'lucide-react'
import { jvmNum, mergeSeries, pickAgg, usersNum } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

const HINT =
  '동시 사용자: 최근 5분 동안 요청을 보낸 고유 사용자 수(사용자 ID, 없으면 IP 기준). ' +
  'JVM 스레드: WAS 가 아니라 JVM 전체의 살아 있는 스레드 수(요청 처리 스레드 + GC·시스템 스레드 등).'

/**
 * 동시 사용자(5분 고유) 와 JVM 스레드를 한 차트에 둘 다 선으로 그린다.
 * 요청이 수 ms 에 끝나 "진행 중 건수"는 항상 0 에 가까우므로, 사용자 수는 gateway 가 5분 창으로 센 값을 쓴다.
 * 인스턴스가 여럿이면 두 선 모두 합계(한 사용자가 두 WAS 에 닿으면 각각 센다).
 */
export function JvmUsersThreadsWidget({ events, target }: WidgetProps) {
  const lists = pickAgg(events.agg, target)
  const suffix = lists.length > 1 ? ' 합계' : ''
  const users = mergeSeries(lists, usersNum, 'sum')
  const threads = mergeSeries(lists, (e) => jvmNum(e, 'threads'), 'sum')
  const lines = [
    // 사용자 수는 구 gateway 면 값이 없으므로 선 자체를 생략한다
    ...(users.length > 0
      ? [{ label: `동시 사용자 (5분 고유)${suffix}`, colorVar: '--color-accent', points: users }]
      : []),
    { label: `JVM 스레드${suffix}`, colorVar: '--color-text-secondary', points: threads },
  ]
  return (
    <MiniChart
      lines={lines}
      format={(v) => String(Math.round(v))}
      hint={
        <span
          role="img"
          tabIndex={0}
          aria-label={HINT}
          title={HINT}
          data-testid="users-threads-hint"
          className="text-text-tertiary hover:text-text-primary inline-flex cursor-help items-center"
        >
          <Info size={13} aria-hidden />
        </span>
      }
    />
  )
}
