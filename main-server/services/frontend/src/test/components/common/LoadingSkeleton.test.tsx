import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

describe('LoadingSkeleton', () => {
  it('card shape — 기본 count=3', () => {
    const { container } = render(<LoadingSkeleton />)
    // grid 컨테이너 내부 SkeletonBox 3개
    const boxes = container.querySelectorAll('.animate-pulse')
    expect(boxes).toHaveLength(3)
  })

  it('card shape — count=5', () => {
    const { container } = render(<LoadingSkeleton count={5} />)
    const boxes = container.querySelectorAll('.animate-pulse')
    expect(boxes).toHaveLength(5)
  })

  it('table shape — count 행 + 헤더', () => {
    const { container } = render(<LoadingSkeleton shape="table" count={4} />)
    // 헤더(1) + 행(4) = 5
    const boxes = container.querySelectorAll('.animate-pulse')
    expect(boxes).toHaveLength(5)
  })

  it('table shape — h-10 헤더 박스 존재', () => {
    const { container } = render(<LoadingSkeleton shape="table" />)
    const header = container.querySelector('.h-10')
    expect(header).toBeInTheDocument()
  })

  it('className 전달', () => {
    const { container } = render(<LoadingSkeleton className="my-class" />)
    expect(container.firstChild as HTMLElement).toHaveClass('my-class')
  })
})
