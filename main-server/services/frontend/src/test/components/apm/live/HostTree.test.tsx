import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { HostTree } from '@/components/apm/live/HostTree'
import type { TreeSystem } from '@/lib/apm/liveScope'

const inst = (systemId: number, role: string) => ({
  key: `${systemId}:${role}`,
  systemId,
  role,
  host: `${role}-host`,
  colorVar: '--t-series-1',
  status: 'live' as const,
  cpu: 12,
  heapPct: 30,
  tps: 5,
})

const tree: TreeSystem[] = [
  { systemId: 3, name: '시스템3', instances: [inst(3, 'was1'), inst(3, 'was2')] },
]

function setup() {
  return render(
    <HostTree
      tree={tree}
      scope={{ kind: 'all' }}
      onScope={vi.fn()}
      excluded={new Set()}
      onCheck={vi.fn()}
      loaded
      collapsed={false}
      onToggleCollapsed={vi.fn()}
      mobileOpen
      onToggleMobile={vi.fn()}
    />,
  )
}

describe('HostTree 트리 구조', () => {
  it('깊이별 aria-level: 전체 1, 시스템 2, 인스턴스 3', () => {
    setup()
    const items = screen.getAllByRole('treeitem')
    const levels = items.map((el) => el.getAttribute('aria-level'))
    expect(levels).toEqual(['1', '2', '3', '3'])
  })

  it('인스턴스는 부모 시스템의 group 안에 렌더링된다', () => {
    setup()
    const sys = screen.getAllByRole('treeitem')[1]
    const group = within(sys).getByRole('group')
    expect(within(group).getAllByRole('treeitem')).toHaveLength(2)
    expect(within(group).getByRole('checkbox', { name: 'was1 포함' })).toBeInTheDocument()
  })

  it('하위가 없는 행(전체·인스턴스)에는 chevron 자리 spacer 가 있다', () => {
    setup()
    const [all, , was1] = screen.getAllByRole('treeitem')
    expect(within(all).getAllByTestId('chevron-spacer').length).toBeGreaterThan(0)
    expect(within(was1).getByTestId('chevron-spacer')).toBeInTheDocument()
  })

  it('자식 가이드선: 마지막 자식은 세로선이 절반에서 끝난다', () => {
    setup()
    const v = screen.getAllByTestId('tree-guide-v')
    expect(v[0].style.height).toBe('100%')
    expect(v[1].style.height).toBe('50%')
    expect(screen.getAllByTestId('tree-guide-h')).toHaveLength(2)
  })

  it('시스템을 접으면 자식과 가이드선이 사라진다', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '시스템3 접기' }))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'was1 포함' })).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('tree-guide-v')).toHaveLength(0)
    expect(screen.getAllByRole('treeitem')).toHaveLength(2)
  })
})
