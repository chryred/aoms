import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pin, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabStore } from '@/store/tabStore'
import { tabDomId, tabPanelDomId } from './tabMeta'

/** 스크롤 가장자리 페이드 폭과 활성 탭 가장자리 여백(px) */
const EDGE_PX = 24

const fadeMask = (left: boolean, right: boolean) => {
  if (!left && !right) return undefined
  const l = left ? `transparent 0, black ${EDGE_PX}px` : 'black 0'
  const r = right ? `black calc(100% - ${EDGE_PX}px), transparent 100%` : 'black 100%'
  const img = `linear-gradient(to right, ${l}, ${r})`
  return { maskImage: img, WebkitMaskImage: img }
}

export function TabBar() {
  const navigate = useNavigate()
  const tabs = useTabStore((s) => s.tabs)
  const activeKey = useTabStore((s) => s.activeKey)
  const closeTab = useTabStore((s) => s.closeTab)
  const closeOthers = useTabStore((s) => s.closeOthers)
  const closeAll = useTabStore((s) => s.closeAll)
  const [menuOpen, setMenuOpen] = useState(false)
  const [overflow, setOverflow] = useState({ left: false, right: false })
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusAfterClose = useRef(false)

  const handleClose = (key: string) => {
    const target = closeTab(key)
    if (target) navigate(target)
    focusAfterClose.current = true
  }

  // 키보드·× 로 탭을 닫으면 닫힌 버튼과 함께 포커스가 body 로 떨어지므로 새 활성 탭으로 옮긴다
  // 활성 탭이 바뀌는 것은 라우트 전환 뒤라서, 새 활성 탭 버튼이 나타날 때까지 요청을 유지한다.
  useEffect(() => {
    if (!focusAfterClose.current || !activeKey) return
    const btn = listRef.current?.querySelector<HTMLElement>(
      `[role="tab"][data-tab-key="${CSS.escape(activeKey)}"]`,
    )
    if (!btn) return
    focusAfterClose.current = false
    btn.focus()
  }, [tabs, activeKey])

  // 숨은 내용이 있는 쪽에만 가장자리 페이드를 켠다
  const measureOverflow = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const left = list.scrollLeft > 1
    const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }))
  }, [])

  // 활성 탭이 가려지지 않도록 가로 스크롤 보정. 제목이 나중에 바뀌어 폭이 달라지는 경우도 다시 맞춘다.
  // 스크롤 영역은 ⋯ 버튼 앞에서 끝나므로 이 영역 안에서만 맞추면 마지막 탭이 버튼 밑에 깔리지 않는다.
  const activeTitle = tabs.find((t) => t.key === activeKey)?.title
  useEffect(() => {
    if (!activeKey) return
    const raf = requestAnimationFrame(() => {
      const list = listRef.current
      const el = list?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(activeKey)}"]`)
      if (!list || !el) return
      const lr = list.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      const margin = Math.min(EDGE_PX, Math.max(0, (lr.width - er.width) / 2))
      if (er.right > lr.right - margin) list.scrollLeft += er.right - (lr.right - margin)
      else if (er.left < lr.left + margin) list.scrollLeft -= lr.left + margin - er.left
      measureOverflow()
    })
    return () => cancelAnimationFrame(raf)
  }, [activeKey, tabs.length, activeTitle, measureOverflow])

  useEffect(() => {
    measureOverflow()
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measureOverflow)
    ro.observe(list)
    return () => ro.disconnect()
  }, [measureOverflow, tabs.length])

  // 메뉴 외부 클릭 / Esc 닫기
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
    const idx = buttons.findIndex((b) => b === document.activeElement)
    if (idx < 0) return
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % buttons.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = buttons.length - 1
    else if (e.key === 'Delete') {
      const key = buttons[idx].dataset.tabKey
      if (key) {
        e.preventDefault()
        handleClose(key)
      }
      return
    }
    if (next >= 0) {
      e.preventDefault()
      buttons[next].focus()
    }
  }

  const closable = tabs.filter((t) => !t.pinned).length

  return (
    <div className="border-border bg-surface flex shrink-0 items-center gap-1 border-b px-2 py-1">
      <div
        ref={listRef}
        role="tablist"
        aria-label="열린 페이지"
        onKeyDown={onListKeyDown}
        onScroll={measureOverflow}
        data-fade-left={overflow.left || undefined}
        data-fade-right={overflow.right || undefined}
        style={fadeMask(overflow.left, overflow.right)}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          return (
            <div
              key={tab.key}
              role="presentation"
              data-tab-key={tab.key}
              className={cn(
                'group flex h-8 max-w-[260px] min-w-[96px] shrink-0 items-center rounded-sm border text-sm transition-[background-color,color,box-shadow] duration-150',
                active
                  ? 'bg-bg-base text-text-primary shadow-neu-pressed border-border-alt font-semibold'
                  : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary border-transparent',
              )}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button === 1 && !tab.pinned) {
                  e.preventDefault()
                  handleClose(tab.key)
                }
              }}
            >
              <button
                type="button"
                role="tab"
                id={tabDomId(tab.key)}
                data-tab-key={tab.key}
                aria-selected={active}
                aria-controls={tabPanelDomId(tab.key)}
                tabIndex={active ? 0 : -1}
                title={tab.title}
                onClick={() => navigate(tab.location.pathname + tab.location.search)}
                className="focus:ring-accent flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2.5 focus:ring-1 focus:outline-none"
              >
                {tab.pinned && <Pin className="h-3 w-3 shrink-0" aria-hidden="true" />}
                <span className="truncate">{tab.title}</span>
              </button>
              {!tab.pinned && (
                <button
                  type="button"
                  aria-label={`${tab.title} 탭 닫기`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => handleClose(tab.key)}
                  className={cn(
                    'text-text-secondary hover:text-text-primary focus:ring-accent mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm focus:opacity-100 focus:ring-1 focus:outline-none',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label="탭 메뉴"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="text-text-secondary hover:bg-hover-subtle focus:ring-accent flex h-8 w-8 items-center justify-center rounded-sm focus:ring-1 focus:outline-none"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="bg-surface border-border shadow-neu-flat absolute right-0 z-40 mt-1 w-40 rounded-sm border py-1"
          >
            <button
              type="button"
              role="menuitem"
              disabled={closable < 2}
              onClick={() => {
                if (activeKey) closeOthers(activeKey)
                setMenuOpen(false)
              }}
              className="text-text-primary hover:bg-hover-subtle disabled:text-text-disabled w-full px-3 py-2 text-left text-sm disabled:hover:bg-transparent"
            >
              다른 탭 닫기
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={closable < 1}
              onClick={() => {
                navigate(closeAll())
                setMenuOpen(false)
              }}
              className="text-text-primary hover:bg-hover-subtle disabled:text-text-disabled w-full px-3 py-2 text-left text-sm disabled:hover:bg-transparent"
            >
              모두 닫기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
