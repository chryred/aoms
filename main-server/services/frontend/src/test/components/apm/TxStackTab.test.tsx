import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TxStackTab } from '@/components/apm/detail/TxStackTab'

const stacks = [
  {
    f: [
      'java.lang.Thread.sleep(Native Method)',
      'com.app.A.a(A.java:1)',
      'x.B.b(B.java:2)',
      'x.C.c(C.java:3)',
      'x.D.d(D.java:4)',
    ],
    c: 3,
  },
  { f: ['com.app.E.e(E.java:5)'], c: 1 },
]

describe('TxStackTab', () => {
  it('설명문·추정 시간·분류를 표시하고 프레임은 3개까지만 보인다', async () => {
    const onMethod = vi.fn()
    render(<TxStackTab stacks={stacks} unmeasuredMs={1000} onOpenMethodStats={onMethod} />)
    expect(screen.getByTestId('stack-intro')).toHaveTextContent('1,000ms')
    expect(screen.getByTestId('stack-intro')).toHaveTextContent('4번')
    expect(screen.getByText(/약 750ms \(75%\)/)).toBeInTheDocument()
    expect(screen.getByText(/^sleep/)).toBeInTheDocument()
    expect(screen.queryByText('x.D.d(D.java:4)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '프레임 2개 더 보기' }))
    expect(screen.getByText('x.D.d(D.java:4)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '메소드 통계에서 보기' }))
    expect(onMethod).toHaveBeenCalled()
  })
  it('샘플이 없으면 이유를 한 문장으로 안내한다', () => {
    render(<TxStackTab stacks={[]} />)
    expect(screen.getByText(/샘플링 기준보다 빠르게/)).toBeInTheDocument()
  })
})
