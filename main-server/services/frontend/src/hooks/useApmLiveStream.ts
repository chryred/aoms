import { useEffect, useRef, useState } from 'react'
import { fetchWithRefresh, openSse } from '@/lib/sse'
import type { LiveActiveEvent, LiveAggEvent, LivePointsEvent, LiveSnapshot } from '@/types/apm'

export type LiveStatus = 'connecting' | 'open' | 'retrying' | 'fallback'

export interface LiveData {
  active: Map<string, LiveActiveEvent>
  points: LivePointsEvent[]
  agg: Map<string, LiveAggEvent[]>
  status: LiveStatus
}

const POINTS_WINDOW_MS = 10 * 60 * 1000
const AGG_MAX = 120
const FALLBACK_AFTER_FAILURES = 3
const POLL_INTERVAL_MS = 3_000
const FALLBACK_RETRY_MS = 30_000
const SNAPSHOT_TIMEOUT_MS = 10_000

/** parent 취소 또는 timeout 시 abort 되는 신호. AbortSignal.any/timeout 미지원 브라우저는 수동 결합. */
function signalWithTimeout(
  parent: AbortSignal,
  ms: number,
): { signal: AbortSignal; cancel: () => void } {
  if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.any([parent, AbortSignal.timeout(ms)]), cancel: () => {} }
  }
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  if (parent.aborted) ac.abort()
  else parent.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ac.abort(), ms)
  return {
    signal: ac.signal,
    cancel: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onAbort)
    },
  }
}

const liveKey = (e: { system_id: number; instance_role: string }) =>
  `${e.system_id}:${e.instance_role}`

function emptyData(): LiveData {
  return { active: new Map(), points: [], agg: new Map(), status: 'connecting' }
}

/**
 * 시스템 목록의 실시간 스트림(SSE) 구독. 끊기면 지수 백오프 재연결, 3회 연속 실패 시 snapshot polling 폴백.
 * enabled=false(숨겨진 탭)이면 연결·폴링을 모두 멈추고 받은 데이터는 유지한다. 다시 true 가 되면 snapshot 으로 재동기화한다.
 */
export function useApmLiveStream(systemIds: number[], enabled = true): LiveData {
  const [data, setData] = useState<LiveData>(emptyData)
  const lastIds = useRef<string | null>(null)
  // 배열 참조가 매 렌더 바뀌어도 재연결하지 않도록 값 기반 키 사용
  const idsKey = systemIds.join(',')

  useEffect(() => {
    // 시스템 구성이 바뀔 때만 비운다. 탭 재활성화 때는 이전 데이터를 보여 주며 snapshot 으로 이어 붙인다.
    if (lastIds.current !== idsKey) setData(emptyData())
    lastIds.current = idsKey
    if (!idsKey || !enabled) return
    setData((d) => (d.status === 'connecting' ? d : { ...d, status: 'connecting' }))
    const ac = new AbortController()
    const query = `system_ids=${idsKey}`
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      })

    const setStatus = (status: LiveStatus) =>
      setData((d) => (d.status === status ? d : { ...d, status }))

    const applySnapshot = (snap: LiveSnapshot) =>
      setData((d) => {
        const active = new Map(d.active)
        const agg = new Map(d.agg)
        for (const inst of snap.instances) {
          const k = liveKey(inst)
          if (inst.active) active.set(k, inst.active)
          agg.set(k, inst.agg.slice(-AGG_MAX))
        }
        return { ...d, active, agg }
      })

    const fetchSnapshot = async (): Promise<boolean> => {
      const { signal, cancel } = signalWithTimeout(ac.signal, SNAPSHOT_TIMEOUT_MS)
      try {
        const resp = await fetchWithRefresh(`/t/v1/snapshot?${query}`, { signal })
        if (!resp.ok) return false
        applySnapshot((await resp.json()) as LiveSnapshot)
        return true
      } catch {
        return false
      } finally {
        cancel()
      }
    }

    const onEvent = (event: string, payload: unknown) => {
      if (event === 'active') {
        const e = payload as LiveActiveEvent
        setData((d) => ({ ...d, active: new Map(d.active).set(liveKey(e), e) }))
      } else if (event === 'points') {
        const e = payload as LivePointsEvent
        const cutoff = Date.now() - POINTS_WINDOW_MS
        setData((d) => ({
          ...d,
          points: [...d.points, e]
            .map((p) => ({ ...p, points: p.points.filter((pt) => pt.ts >= cutoff) }))
            .filter((p) => p.points.length > 0),
        }))
      } else if (event === 'agg') {
        const e = payload as LiveAggEvent
        setData((d) => {
          const k = liveKey(e)
          const agg = new Map(d.agg)
          agg.set(k, [...(d.agg.get(k) ?? []), e].slice(-AGG_MAX))
          return { ...d, agg }
        })
      }
    }

    const run = async () => {
      await fetchSnapshot()
      let backoff = 1_000
      while (!ac.signal.aborted) {
        if (failures >= FALLBACK_AFTER_FAILURES) {
          // polling 폴백: snapshot 을 3초마다 갱신하면서 30초마다 스트림 재연결을 시도한다
          setStatus('fallback')
          let recovered = false
          let attempt: Promise<void> | null = null
          let inFlight = false
          let lastTry = Date.now()
          while (!ac.signal.aborted) {
            if (!inFlight && Date.now() - lastTry >= FALLBACK_RETRY_MS) {
              lastTry = Date.now()
              inFlight = true
              attempt = openSse(
                `/t/v1/stream?${query}`,
                (event, payload) => {
                  recovered = true
                  failures = 0
                  backoff = 1_000
                  setStatus('open')
                  onEvent(event, payload)
                },
                ac.signal,
              )
                .catch(() => {})
                .finally(() => {
                  inFlight = false
                })
            }
            if (recovered) break
            await fetchSnapshot()
            await sleep(POLL_INTERVAL_MS)
          }
          if (ac.signal.aborted) return
          await attempt // 복구된 스트림이 끝날 때까지 대기 후 일반 재연결 루프로 복귀
          if (ac.signal.aborted) return
          failures += 1
          continue
        }
        try {
          setStatus(failures === 0 ? 'connecting' : 'retrying')
          await openSse(
            `/t/v1/stream?${query}`,
            (event, payload) => {
              failures = 0
              backoff = 1_000
              setStatus('open')
              onEvent(event, payload)
            },
            ac.signal,
          )
        } catch {
          if (ac.signal.aborted) return
        }
        if (ac.signal.aborted) return
        failures += 1
        if (failures < FALLBACK_AFTER_FAILURES) {
          setStatus('retrying')
          await sleep(backoff)
          backoff *= 2
        }
      }
    }
    void run()

    return () => {
      ac.abort()
      if (timer) clearTimeout(timer)
    }
  }, [idsKey, enabled])

  return data
}
