import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  group: string
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: '대시보드', group: '운영' },
  { to: '/grafana-dashboard', label: 'Grafana 대시보드', group: '운영' },
  { to: '/trends', label: '장애 예측', group: '운영' },
  { to: '/alerts', label: '알림 이력', group: '알림' },
  { to: '/feedback', label: '피드백', group: '알림' },
  { to: '/feedback/search', label: '해결책 검색', group: '알림' },
  { to: '/reports', label: '안정성 리포트', group: '분석' },
  { to: '/search', label: '유사 장애 검색', group: '분석' },
  { to: '/agents', label: '에이전트 관리', group: '관리' },
  { to: '/systems', label: '시스템 관리', group: '관리' },
  { to: '/contacts', label: '담당자 관리', group: '관리' },
  { to: '/profile', label: '내 프로필', group: '계정' },
  { to: '/admin/users', label: '사용자 관리', group: '계정', adminOnly: true },
  { to: '/vector-health', label: '벡터 상태', group: '계정', adminOnly: true },
]

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export function CommandSearch() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && user?.role !== 'admin') return false
    return item.label.includes(query)
  })

  const close = useCallback(() => {
    setOpen(false)
    setFocused(false)
    setQuery('')
    setActiveIdx(0)
    inputRef.current?.blur()
  }, [])

  const select = useCallback(
    (to: string) => {
      navigate(to)
      close()
    },
    [navigate, close],
  )

  // 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [close])

  // ⌘K / Ctrl+K 전역 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        setFocused(true)
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && filtered[activeIdx]) {
      select(filtered[activeIdx].to)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex items-center gap-2 rounded-sm border px-3 py-1.5 transition-all duration-200',
          'bg-bg-base',
          focused ? 'border-accent ring-accent ring-1' : 'border-border hover:border-border-alt',
        )}
      >
        {/* 아이콘: 기본도 밝게, 포커스 시 더 밝게 */}
        <Search
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-colors duration-200',
            focused ? 'text-accent' : 'text-text-secondary',
          )}
        />

        {/* 입력창: 포커스 시 너비 확장 */}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActiveIdx(0)
          }}
          onFocus={() => {
            setFocused(true)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder="메뉴명, 기능 검색..."
          className={cn(
            'text-text-primary placeholder-text-disabled bg-transparent text-sm outline-none',
            'transition-[width] duration-200',
            focused ? 'w-56 md:w-72' : 'w-36 md:w-52',
          )}
        />

        {/* 단축키 힌트 — 비포커스 시만 표시 */}
        {!focused && (
          <kbd className="text-border-alt hidden shrink-0 items-center gap-0.5 font-mono text-[10px] select-none md:inline-flex">
            {isMac ? '⌘' : 'Ctrl'}
            <span>K</span>
          </kbd>
        )}
      </div>

      {open && (
        <div className="border-border bg-bg-base shadow-neu-flat absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-sm border">
          {filtered.length === 0 ? (
            <p className="text-text-disabled px-3 py-3 text-center text-xs">결과 없음</p>
          ) : (
            <ul role="listbox">
              {filtered.map((item, idx) => {
                const prevGroup = idx > 0 ? filtered[idx - 1].group : null
                const showGroup = item.group !== prevGroup
                return (
                  <li key={item.to}>
                    {showGroup && (
                      <div className="text-text-disabled px-3 pt-2 pb-1 text-[10px] tracking-[0.08em] uppercase">
                        {item.group}
                      </div>
                    )}
                    <button
                      role="option"
                      aria-selected={idx === activeIdx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => select(item.to)}
                      className={cn(
                        'w-full px-3 py-2 text-left text-sm transition-colors',
                        idx === activeIdx
                          ? 'bg-glass-bg text-text-primary'
                          : 'text-text-secondary hover:bg-accent-muted hover:text-text-primary',
                      )}
                    >
                      {item.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
