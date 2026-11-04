import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TabBar } from '@/components/layout/tabs/TabBar'
import { useTabStore, type Tab } from '@/store/tabStore'

const tab = (key: string, title: string): Tab => ({
  key,
  title,
  pinned: false,
  mounted: true,
  lastActive: 1,
  location: { pathname: key, search: '', hash: '', state: null, key },
})

/** 목록 폭 300px 에 탭 각 100px 을 이어 붙인 가짜 레이아웃 (jsdom 은 레이아웃이 없다) */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute('role') === 'tablist') {
      return { left: 0, right: 300, width: 300, top: 0, bottom: 32, height: 32 } as DOMRect
    }
    const idx = Array.from(document.querySelectorAll('[role="presentation"]')).indexOf(this)
    if (idx < 0) return { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0 } as DOMRect
    const list = document.querySelector('[role="tablist"]') as HTMLElement
    const left = idx * 100 - list.scrollLeft
    return { left, right: left + 100, width: 100, top: 0, bottom: 32, height: 32 } as DOMRect
  })
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  stubLayout()
  useTabStore.getState().reset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const setup = (tabs: Tab[], activeKey: string) => {
  useTabStore.setState({ tabs, activeKey })
  return render(
    <MemoryRouter>
      <TabBar />
    </MemoryRouter>,
  )
}

describe('TabBar', () => {
  const tabs = ['/a', '/b', '/c', '/d', '/e'].map((k) => tab(k, k.slice(1)))

  it('가려진 활성 탭을 목록 안쪽(가장자리 여백 포함)으로 스크롤한다', () => {
    setup(tabs, '/e')
    const list = screen.getByRole('tablist')
    // 탭 e 는 400..500, 목록 폭 300, 여백 24 -> scrollLeft = 500 - (300 - 24)
    expect(list.scrollLeft).toBe(224)
  })

  it('활성 탭의 제목이 나중에 바뀌어도 다시 스크롤을 맞춘다', () => {
    setup(tabs, '/e')
    const list = screen.getByRole('tablist')
    act(() => {
      list.scrollLeft = 0
      useTabStore.getState().setTitle('/e', '에이전트 10.0.0.1')
    })
    expect(list.scrollLeft).toBe(224)
  })

  it('⋯ 버튼은 스크롤 영역 밖에 있고 목록 끝에 여백이 있다', () => {
    setup(tabs, '/a')
    const list = screen.getByRole('tablist')
    expect(list).not.toContainElement(screen.getByRole('button', { name: '탭 메뉴' }))
    expect(list.className).toContain('pr-2')
  })

  it('활성 탭은 1px 테두리로 비활성 탭과 구분된다', () => {
    setup(tabs, '/b')
    const active = screen.getByRole('tab', { name: 'b' }).parentElement!
    const idle = screen.getByRole('tab', { name: 'a' }).parentElement!
    expect(active.className).toContain('border-border-alt')
    expect(idle.className).toContain('border-transparent')
  })

  it('숨은 내용이 있는 쪽에만 가장자리 페이드 마스크를 건다', () => {
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500)
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    setup(tabs, '/a')
    const list = screen.getByRole('tablist')
    expect(list).toHaveAttribute('data-fade-right', 'true')
    expect(list).not.toHaveAttribute('data-fade-left')
    sw.mockRestore()
    cw.mockRestore()
  })

  it('Delete 키로 탭을 닫으면 새 활성 탭 버튼으로 포커스가 옮겨간다', async () => {
    const user = userEvent.setup()
    setup(tabs, '/b')
    screen.getByRole('tab', { name: 'b' }).focus()
    await user.keyboard('{Delete}')
    act(() => useTabStore.setState({ activeKey: '/c' })) // 탭 워크스페이스가 라우트 전환을 반영
    const active = screen
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true')!
    expect(screen.queryByRole('tab', { name: 'b' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(active)
  })

  it('× 로 탭을 닫아도 새 활성 탭 버튼으로 포커스가 옮겨간다', async () => {
    const user = userEvent.setup()
    setup(tabs, '/c')
    await user.click(screen.getByRole('button', { name: 'c 탭 닫기' }))
    act(() => useTabStore.setState({ activeKey: '/d' }))
    const active = screen
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true')!
    expect(document.activeElement).toBe(active)
    expect(document.activeElement).not.toBe(document.body)
  })
})
