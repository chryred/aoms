import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CriticalBanner } from '@/components/common/CriticalBanner'
import { useUiStore } from '@/store/uiStore'

const renderWithRouter = () =>
  render(
    <MemoryRouter>
      <CriticalBanner />
    </MemoryRouter>,
  )

describe('CriticalBanner', () => {
  beforeEach(() => {
    useUiStore.setState({ criticalCount: 0 })
  })

  it('criticalCount=0일 때 미렌더링', () => {
    renderWithRouter()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('criticalCount>0일 때 렌더링', () => {
    useUiStore.setState({ criticalCount: 3 })
    renderWithRouter()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('건수 표시', () => {
    useUiStore.setState({ criticalCount: 5 })
    renderWithRouter()
    expect(screen.getByText(/5건/)).toBeInTheDocument()
  })

  it('fixed 위치 클래스', () => {
    useUiStore.setState({ criticalCount: 1 })
    renderWithRouter()
    expect(screen.getByRole('alert').className).toContain('fixed')
  })
})
