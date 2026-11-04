import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { configure } from '@testing-library/react'

// findBy*/waitFor 기본 1000ms 는 전체 스위트를 병렬(워커 다수)로 돌릴 때 무거운 페이지에서 모자란다.
// 조건이 충족되면 즉시 반환하므로 상한만 늘려도 정상 경로는 느려지지 않는다.
configure({ asyncUtilTimeout: 3000 })

// 파일 안에서 테스트가 서로 상태를 물려주지 않도록 매 테스트 뒤에 공통 상태를 비운다.
afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useRealTimers()
})
