import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'

describe('NeuSelect', () => {
  it('기본 렌더링', () => {
    render(
      <NeuSelect>
        <option value="a">A</option>
      </NeuSelect>,
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('label 렌더링', () => {
    render(
      <NeuSelect id="select" label="유형">
        <option value="a">A</option>
      </NeuSelect>,
    )
    expect(screen.getByLabelText('유형')).toBeInTheDocument()
  })

  it('error 메시지 렌더링', () => {
    render(
      <NeuSelect error="선택 필요">
        <option value="a">A</option>
      </NeuSelect>,
    )
    expect(screen.getByText('선택 필요')).toBeInTheDocument()
  })

  it('error 있을 때 border 색상', () => {
    render(
      <NeuSelect error="오류">
        <option value="a">A</option>
      </NeuSelect>,
    )
    expect(screen.getByRole('combobox').className).toContain('border-critical')
  })

  it('disabled 상태', () => {
    render(
      <NeuSelect disabled>
        <option value="a">A</option>
      </NeuSelect>,
    )
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('children(options) 렌더링', () => {
    render(
      <NeuSelect>
        <option value="a">옵션A</option>
        <option value="b">옵션B</option>
      </NeuSelect>,
    )
    expect(screen.getByText('옵션A')).toBeInTheDocument()
    expect(screen.getByText('옵션B')).toBeInTheDocument()
  })

  it('displayName 설정', () => {
    expect(NeuSelect.displayName).toBe('NeuSelect')
  })
})
