import { describe, it, expect } from 'vitest'
import { filterParams } from '@/lib/ky-client'

describe('filterParams', () => {
  it('undefined 값 제거', () => {
    const result = filterParams({ a: 1, b: undefined, c: 'hello' })
    expect(result).toEqual({ a: 1, c: 'hello' })
  })

  it('null 값 제거', () => {
    const result = filterParams({ a: 1, b: null as unknown as undefined })
    expect(result).toEqual({ a: 1 })
  })

  it('boolean 값 유지', () => {
    const result = filterParams({ active: true, disabled: false })
    expect(result).toEqual({ active: true, disabled: false })
  })

  it('숫자 값 유지', () => {
    const result = filterParams({ id: 42, offset: 0 })
    expect(result).toEqual({ id: 42, offset: 0 })
  })

  it('빈 객체 → 빈 객체', () => {
    const result = filterParams({})
    expect(result).toEqual({})
  })

  it('모든 값 undefined → 빈 객체', () => {
    const result = filterParams({ a: undefined, b: undefined })
    expect(result).toEqual({})
  })

  it('문자열 값 유지', () => {
    const result = filterParams({ name: 'test', type: 'synapse_agent' })
    expect(result).toEqual({ name: 'test', type: 'synapse_agent' })
  })
})
