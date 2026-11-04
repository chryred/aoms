import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TxSqlTab } from '@/components/apm/detail/TxSqlTab'
import type { TxSql } from '@/types/apm'

const ORACLE = `SELECT /* MyVocMngtMapper.doSearchTaskList */ A.VOC_ID /* VOC번호 */ , A.TITLE FROM TB_VOC A, TB_VOC_DTL B WHERE A.VOC_ID = B.VOC_ID (+) AND A.REG_DT BETWEEN ? AND ? ORDER BY A.REG_DT DESC`

const mk = (over: Partial<TxSql>): TxSql => ({
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

const DATA: TxSql[] = [
  mk({ sql_id: 'a', sql_text: 'UPDATE T SET A=1 WHERE ID=?', cnt: 9, ms: 50, max_ms: 20 }),
  mk({ sql_id: 'b', sql_text: ORACLE, cnt: 3, ms: 1200, max_ms: 800, fetch_cnt: 40, fetch_ms: 60 }),
  mk({ sql_id: 'c', sql_text: 'DELETE FROM T WHERE ID=?', cnt: 1, ms: 300, max_ms: 300, err: 2 }),
]

const rowsText = () => screen.getAllByTestId('sql-row').map((r) => r.textContent ?? '')

describe('TxSqlTab', () => {
  it('SQL 이 없으면 빈 상태를 표시한다', () => {
    render(<TxSqlTab sql={[]} />)
    expect(screen.getByText('실행된 SQL이 없습니다')).toBeInTheDocument()
  })

  it('요약 행: 구문 종류, 매퍼 ID, 지표를 표시하고 시간 내림차순으로 정렬한다', () => {
    render(<TxSqlTab sql={DATA} />)
    const rows = rowsText()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('MyVocMngtMapper.doSearchTaskList')
    expect(rows[0]).toContain('SELECT')
    expect(rows[0]).toContain('1,200')
    expect(rows[1]).toContain('DELETE')
    expect(rows[2]).toContain('UPDATE')
    expect(screen.getByText('UPDATE T SET A=1 WHERE ID=?')).toBeInTheDocument()
  })

  it('반응형: 고정 최소 폭 없이, 좁은 폭에서는 최대/fetch(ms) 열을 숨긴다', () => {
    const { container } = render(<TxSqlTab sql={DATA} />)
    expect(container.querySelector('[class*="min-w-[760px]"]')).toBeNull()
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
    const th = (label: string) =>
      screen.getByRole('button', { name: new RegExp(label) }).parentElement
    expect(th('최대')).toHaveClass('hidden', '@min-[860px]:block')
    expect(th('fetch\\(ms\\)')).toHaveClass('hidden', '@min-[860px]:block')
    expect(th('fetch 건수')).toHaveClass('hidden', '@min-[520px]:block')
    expect(th('실행 횟수')).not.toHaveClass('hidden')
    expect(th('시간')).not.toHaveClass('hidden')
    // 행의 같은 열도 숨겨진다: 최대(800) 와 fetch(ms)(60)
    const cells = within(screen.getAllByTestId('sql-row')[0]).getAllByText('800')
    expect(cells[0]).toHaveClass('hidden', '@min-[860px]:block')
  })

  it('시간 막대: 별도 열에서 최소 폭을 보장하고 0 은 비운다', () => {
    render(
      <TxSqlTab
        sql={[
          mk({ sql_id: 'big', ms: 10000 }),
          mk({ sql_id: 'tiny', ms: 1 }),
          mk({ sql_id: 'zero', ms: 0 }),
        ]}
      />,
    )
    const widths = screen.getAllByTestId('sql-time-bar').map((b) => (b as HTMLElement).style.width)
    expect(widths).toEqual(['100%', '8%', '0px'])
    expect(screen.getAllByTestId('sql-time-bar')[0].parentElement).toHaveClass('h-1.5')
  })

  it('펼친 뷰어의 도구줄(정렬/원문/복사)은 코드 스크롤 영역 밖에 있다', () => {
    render(<TxSqlTab sql={DATA} />)
    const copy = screen.getByRole('button', { name: /복사/ })
    const code = screen.getByTestId('sql-code')
    expect(copy.closest('.overflow-auto')).toBeNull()
    expect(code.closest('.overflow-auto')).not.toBeNull()
  })

  it('선택된 표시 방식은 본문 색 텍스트 + 눌린 면, 비선택은 보조 텍스트', async () => {
    render(<TxSqlTab sql={DATA} />)
    const a = screen.getByRole('button', { name: '정렬' })
    const b = screen.getByRole('button', { name: '원문' })
    expect(a).toHaveClass('text-text-primary', 'shadow-neu-pressed')
    expect(a).not.toHaveClass('text-accent')
    expect(b).not.toHaveClass('shadow-neu-pressed')
    await userEvent.click(b)
    expect(b).toHaveClass('text-text-primary', 'shadow-neu-pressed')
  })

  it('가장 느린 SQL 만 처음에 펼쳐진다', () => {
    render(<TxSqlTab sql={DATA} />)
    const buttons = screen.getAllByRole('button', { expanded: true })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('MyVocMngtMapper.doSearchTaskList')
    expect(screen.getAllByTestId('sql-code')).toHaveLength(1)
  })

  it('행을 클릭하면 펼치고 다시 클릭하면 접는다', async () => {
    const user = userEvent.setup()
    render(<TxSqlTab sql={DATA} />)
    const del = screen.getByRole('button', { name: /DELETE/ })
    expect(del).toHaveAttribute('aria-expanded', 'false')
    await user.click(del)
    expect(del).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('sql-code')).toHaveLength(2)
    await user.click(del)
    expect(del).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByTestId('sql-code')).toHaveLength(1)
  })

  it('키보드(Enter)로 펼칠 수 있다', async () => {
    const user = userEvent.setup()
    render(<TxSqlTab sql={DATA} />)
    const upd = screen.getByRole('button', { name: /UPDATE/ })
    upd.focus()
    await user.keyboard('{Enter}')
    expect(upd).toHaveAttribute('aria-expanded', 'true')
  })

  it('헤더 클릭으로 정렬 기준과 방향을 바꾼다', async () => {
    const user = userEvent.setup()
    render(<TxSqlTab sql={DATA} />)
    await user.click(screen.getByRole('button', { name: /실행 횟수/ }))
    expect(rowsText()[0]).toContain('UPDATE')
    await user.click(screen.getByRole('button', { name: /실행 횟수/ }))
    expect(rowsText()[0]).toContain('DELETE')
    await user.click(screen.getByRole('button', { name: /에러/ }))
    expect(rowsText()[0]).toContain('DELETE')
  })

  it('정렬/원문 토글: 원문은 입력 그대로, 정렬은 줄바꿈 + ? 보존', async () => {
    const user = userEvent.setup()
    render(<TxSqlTab sql={DATA} />)
    const code = screen.getByTestId('sql-code')
    expect(code.textContent).toContain('\nFROM')
    expect(code.textContent).toContain('(+)')
    expect(code.textContent?.split('?').length).toBe(ORACLE.split('?').length)
    await user.click(screen.getByRole('button', { name: '원문' }))
    expect(screen.getByTestId('sql-code').textContent).toBe(ORACLE)
    await user.click(screen.getByRole('button', { name: '정렬' }))
    expect(screen.getByTestId('sql-code').textContent).not.toBe(ORACLE)
  })

  describe('복사', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      writeText.mockClear()
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    })
    afterEach(() => vi.useRealTimers())

    it('원본 SQL 을 복사하고 잠시 "복사됨" 을 표시한다', async () => {
      render(<TxSqlTab sql={DATA} />)
      const viewer = screen.getByTestId('sql-code').parentElement!.parentElement!
      await act(async () => {
        fireEvent.click(within(viewer).getByRole('button', { name: '복사' }))
      })
      expect(writeText).toHaveBeenCalledWith(ORACLE)
      expect(within(viewer).getByRole('button', { name: '복사됨' })).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(1600)
      })
      expect(within(viewer).getByRole('button', { name: '복사' })).toBeInTheDocument()
    })
  })
})
