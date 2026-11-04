import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueueWidget } from '@/components/apm/live/widgets/QueueWidget'

const events = {
  active: [
    { system_id: 1, instance_role: 'was1', ts: 1, slow_ms: 3000, buckets: [5, 2, 1], top: [] },
  ],
} as never

function renderQueue(keys = ['1:was1', '1:was2']) {
  return render(
    <QueueWidget
      events={events}
      target={{ systemIds: [1], instanceKeys: keys } as never}
      slowMs={3000}
    />,
  )
}

describe('QueueWidget', () => {
  it('접근성 라벨에 호스트별 총 건수가 담기고 0건 호스트도 나온다', () => {
    renderQueue()
    const c = screen.getByRole('img', { name: /액티브 트랜잭션 큐/ })
    expect(c.getAttribute('aria-label')).toContain('was1 8건')
    expect(c.getAttribute('aria-label')).toContain('was2 0건')
  })

  it('호버하면 호스트 이름과 단계별 건수 툴팁이 뜬다', () => {
    renderQueue()
    const c = screen.getByRole('img', { name: /액티브 트랜잭션 큐/ })
    fireEvent.mouseMove(c, { clientX: 10, clientY: 10 })
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('was1')
    expect(tip).toHaveTextContent('총 8건')
    expect(tip).toHaveTextContent('심각 1')
    expect(tip).toHaveTextContent('경고 2')
    expect(tip).toHaveTextContent('정상 5')
    fireEvent.mouseLeave(c)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('0건 호스트 툴팁은 모두 0', () => {
    renderQueue()
    const c = screen.getByRole('img', { name: /액티브 트랜잭션 큐/ })
    fireEvent.mouseMove(c, { clientX: 290, clientY: 10 })
    expect(screen.getByRole('tooltip')).toHaveTextContent('총 0건')
  })
})
