import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export interface WebSocketMessage {
  type: 'alert_fired' | 'alert_resolved' | 'log_analysis_complete'
  timestamp: string
  data: Record<string, unknown>
}

interface UseWebSocketOptions {
  url?: string
  onMessage?: (message: WebSocketMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
  autoReconnect?: boolean
  reconnectAttempts?: number
  reconnectDelay?: number
}

/**
 * WebSocket 실시간 대시보드 알림 수신
 * - 자동 재연결 (exponential backoff)
 * - 자동 heartbeat (ping-pong)
 * - React Query invalidation 지원
 */
export function useWebSocketDashboard(options: UseWebSocketOptions = {}) {
  const {
    url,
    onMessage,
    onConnect,
    onDisconnect,
    autoReconnect = true,
    reconnectAttempts = 5,
    reconnectDelay = 3000,
  } = options

  // 콜백을 ref에 저장 — connect의 useCallback 의존성에서 제외해 재연결 루프 방지
  const onMessageRef = useRef(onMessage)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  useEffect(() => {
    onMessageRef.current = onMessage
    onConnectRef.current = onConnect
    onDisconnectRef.current = onDisconnect
  })

  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const reconnectCountRef = useRef(0)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queryClient = useQueryClient()

  // WebSocket URL 결정 (개발/운영 환경)
  const wsUrl =
    url ||
    (() => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      return `${protocol}//${host}/api/v1/ws/dashboard`
    })()

  // 연결 함수 — 콜백 ref 사용으로 의존성 최소화
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      setIsConnecting(true)
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('[WebSocket] Connected to dashboard')
        setIsConnected(true)
        setIsConnecting(false)
        reconnectCountRef.current = 0
        onConnectRef.current?.()

        // Heartbeat 시작 (30초마다 ping)
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping')
          }
        }, 30000)
      }

      ws.onmessage = (event) => {
        // pong 응답 무시
        if (event.data === 'pong') return

        try {
          const message: WebSocketMessage = JSON.parse(event.data as string)
          console.log('[WebSocket] Message:', message.type)

          onMessageRef.current?.(message)

          // React Query 자동 갱신 (타입별)
          if (message.type === 'alert_fired' || message.type === 'alert_resolved') {
            queryClient.invalidateQueries({ queryKey: ['dashboardHealth'], exact: true })
          } else if (message.type === 'log_analysis_complete') {
            queryClient.invalidateQueries({ queryKey: ['systemDetailHealth'] })
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err)
        }
      }

      ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event)
        setIsConnected(false)
      }

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected')
        setIsConnected(false)
        setIsConnecting(false)
        onDisconnectRef.current?.()

        // Heartbeat 정리
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current)
        }

        // 자동 재연결
        if (autoReconnect && reconnectCountRef.current < reconnectAttempts) {
          const delay = reconnectDelay * Math.pow(2, reconnectCountRef.current)
          console.log(
            `[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectCountRef.current + 1}/${reconnectAttempts})`,
          )
          reconnectCountRef.current += 1
          setTimeout(() => connect(), delay)
        }
      }

      wsRef.current = ws
    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err)
      setIsConnecting(false)
    }
  }, [wsUrl, autoReconnect, reconnectAttempts, reconnectDelay, queryClient])

  // 연결 해제 함수
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
    }
  }, [])

  // 마운트 시 연결, 언마운트 시 정리
  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected,
    isConnecting,
    reconnectCount: reconnectCountRef.current,
    disconnect,
    reconnect: connect,
  }
}
