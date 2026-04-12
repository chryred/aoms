import { memo } from 'react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'

interface SparklineProps {
  data: { v: number }[]
  color?: string
  height?: number
}

/**
 * 미니 스파크라인 — 대시보드 시스템 row에서 추세를 한눈에 파악.
 * 축/툴팁/그리드 없이 순수 라인만 표시.
 */
export const Sparkline = memo(function Sparkline({
  data,
  color = '#00D4FF',
  height = 36,
}: SparklineProps) {
  if (!data || data.length < 2) return null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})
