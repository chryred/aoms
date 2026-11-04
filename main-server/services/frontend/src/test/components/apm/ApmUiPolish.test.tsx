import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { InstanceChipBar } from '@/components/apm/live/InstanceChipBar'
import { HostTree } from '@/components/apm/live/HostTree'
import { TxSqlTab } from '@/components/apm/detail/TxSqlTab'
import { TxExceptionTab } from '@/components/apm/detail/TxExceptionTab'
import { TxFilterBar, type TxFilters } from '@/components/apm/TxFilterBar'
import type { TreeInstance, TreeSystem } from '@/lib/apm/liveScope'
import type { TxSql, TxSummary } from '@/types/apm'

const inst = (systemId: number, role: string): TreeInstance => ({
  key: `${systemId}:${role}`,
  systemId,
  role,
  host: `${role}-host`,
  colorVar: '--t-series-1',
  status: 'live',
  cpu: 12,
  heapPct: 30,
  tps: 5,
})
const names = (id: number) => (id === 1 ? 'crm' : 'payment')

describe('InstanceChipBar 라벨', () => {
  const noop = () => {}
  it('시스템이 둘 이상이면 "시스템·role", 하나면 role 만', () => {
    const { rerender } = render(
      <InstanceChipBar
        instances={[inst(1, 'was1'), inst(2, 'was1')]}
        systemName={names}
        hidden={new Set()}
        onToggle={noop}
        onShowAll={noop}
      />,
    )
    expect(screen.getByRole('button', { name: 'crm·was1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'payment·was1' })).toBeInTheDocument()
    rerender(
      <InstanceChipBar
        instances={[inst(1, 'was1'), inst(1, 'was2')]}
        systemName={names}
        hidden={new Set()}
        onToggle={noop}
        onShowAll={noop}
      />,
    )
    expect(screen.getByRole('button', { name: 'was1' })).toBeInTheDocument()
  })

  it('좁은 폭에서는 한 줄 가로 스크롤', () => {
    render(
      <InstanceChipBar
        instances={[inst(1, 'was1')]}
        hidden={new Set()}
        onToggle={noop}
        onShowAll={noop}
      />,
    )
    const bar = screen.getByTestId('chip-bar')
    expect(bar.className).toContain('flex-nowrap')
    expect(bar.className).toContain('overflow-x-auto')
  })
})

describe('HostTree 인스턴스 행', () => {
  it('이름은 첫 줄에 단독으로 보이고 전체 이름 툴팁이 있다', () => {
    const tree: TreeSystem[] = [
      { systemId: 1, name: 'crm', instances: [inst(1, 'was-long-name1')] },
    ]
    render(
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
    const name = screen.getByText('was-long-name1')
    expect(name.className).toContain('truncate')
    expect(name.parentElement).toHaveAttribute('title', expect.stringContaining('was-long-name1'))
    // WAS 뱃지·CPU 는 이름 아래 줄
    expect(name.parentElement).toContainElement(screen.getByTestId('type-badge'))
    expect(name.parentElement).not.toBe(screen.getByTestId('type-badge').parentElement)
  })
})

const mkSql = (over: Partial<TxSql>): TxSql => ({
  sql_id: 'x',
  sql_text: 'SELECT 1 FROM DUAL',
  cnt: 1,
  ms: 10,
  max_ms: 10,
  fetch_cnt: 0,
  fetch_ms: 0,
  err: 0,
  ...over,
})

describe('SQL 탭·예외 탭 DB 태그', () => {
  it('SQL 목록: 텍스트는 최소 폭을 갖고 db 태그는 잘리며 툴팁이 있다', () => {
    render(<TxSqlTab sql={[mkSql({ db: 'jdbc:oracle:thin:@very-long-host:1521/ORCL' })]} />)
    const row = screen.getByTestId('sql-row')
    expect(within(row).getByText(/SELECT 1/).className).toContain('min-w-[12ch]')
    const tag = within(row).getByTitle(/^DB /)
    expect(tag.className).toContain('max-w-[10rem]')
    expect(tag.className).toContain('truncate')
  })

  it('예외 탭: 에러 SQL 에도 db 태그를 보여 준다', () => {
    render(
      <TxExceptionTab
        summary={{ error: 0, exc_class: '' } as TxSummary}
        sql={[mkSql({ err: 2, db: 'ORCL' })]}
      />,
    )
    expect(screen.getByTitle('DB ORCL')).toHaveTextContent('ORCL')
  })
})

describe('TxFilterBar', () => {
  const f: TxFilters = {
    from: '2026-11-04',
    fromTime: '',
    to: '2026-11-04',
    toTime: '',
    systemIds: [],
    role: '',
    uri: '',
    userIp: '',
    userId: '',
    minElapsed: '',
    maxElapsed: '',
    minSql: '',
    errorOnly: false,
    traceId: '',
    spanId: '',
    bizKey: '',
    minFetch: '',
    minSqlCnt: '',
    minConn: '',
  }
  it('기간 필드는 xl 에서 3칸을 차지하고 줄바꿈 가능하다', () => {
    render(<TxFilterBar value={f} systemOptions={[]} onApply={vi.fn()} validate={() => null} />)
    const field = screen.getByLabelText('시작일 (KST)').closest('div')!.parentElement!
    expect(field.className).toContain('xl:col-span-3')
    expect(screen.getByLabelText('시작일 (KST)').parentElement!.className).toContain('flex-wrap')
  })

  it('기본/상세 토글: 선택은 pressed 그림자 + 기본 글자색, 미선택은 보조 글자색', () => {
    render(<TxFilterBar value={f} systemOptions={[]} onApply={vi.fn()} validate={() => null} />)
    const on = screen.getByRole('button', { name: '기본' })
    const off = screen.getByRole('button', { name: '상세' })
    expect(on.className).toContain('shadow-neu-pressed')
    expect(on.className).toContain('text-text-primary')
    expect(off.className).toContain('text-text-secondary')
    expect(off.className).not.toContain('shadow-neu-pressed')
  })
})
