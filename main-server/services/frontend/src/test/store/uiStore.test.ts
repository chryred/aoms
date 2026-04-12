import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '@/store/uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({
      sidebarCollapsed: false,
      sidebarOpen: false,
      criticalCount: 0,
    })
  })

  it('초기 상태', () => {
    const s = useUiStore.getState()
    expect(s.sidebarCollapsed).toBe(false)
    expect(s.sidebarOpen).toBe(false)
    expect(s.criticalCount).toBe(0)
  })

  it('toggleSidebar — false → true', () => {
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
  })

  it('toggleSidebar — true → false', () => {
    useUiStore.setState({ sidebarCollapsed: true })
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarCollapsed).toBe(false)
  })

  it('toggleMobileSidebar — false → true', () => {
    useUiStore.getState().toggleMobileSidebar()
    expect(useUiStore.getState().sidebarOpen).toBe(true)
  })

  it('toggleMobileSidebar — true → false', () => {
    useUiStore.setState({ sidebarOpen: true })
    useUiStore.getState().toggleMobileSidebar()
    expect(useUiStore.getState().sidebarOpen).toBe(false)
  })

  it('closeMobileSidebar — 닫힘', () => {
    useUiStore.setState({ sidebarOpen: true })
    useUiStore.getState().closeMobileSidebar()
    expect(useUiStore.getState().sidebarOpen).toBe(false)
  })

  it('setCriticalCount', () => {
    useUiStore.getState().setCriticalCount(5)
    expect(useUiStore.getState().criticalCount).toBe(5)
  })

  it('setCriticalCount — 0으로 초기화', () => {
    useUiStore.setState({ criticalCount: 10 })
    useUiStore.getState().setCriticalCount(0)
    expect(useUiStore.getState().criticalCount).toBe(0)
  })
})
