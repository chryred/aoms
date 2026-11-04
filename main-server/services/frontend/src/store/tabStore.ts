import { create } from 'zustand'
import {
  HOME_PATH,
  normalizeTabPath,
  resolveTabTitle,
  tabKeyFor,
  tabPathOf,
} from '@/components/layout/tabs/tabMeta'

export const MAX_TABS = 12
const STORAGE_KEY = 'synapse.tabs.v1'

export interface TabLocation {
  pathname: string
  search: string
  hash: string
  state: unknown
  key: string
}

export interface Tab {
  /** 탭 식별자 — 정규화된 pathname (트랜잭션 조회 범위 탭은 pathname?from=..&to=..) */
  key: string
  title: string
  pinned: boolean
  location: TabLocation
  /** 한 번이라도 활성화되어 라우트 엘리먼트가 마운트됐는지 (세션 복원 탭은 지연 마운트) */
  mounted: boolean
  /** LRU 용 단조 증가 카운터 */
  lastActive: number
}

interface TabState {
  tabs: Tab[]
  activeKey: string | null
  /** LRU 정리 등 사용자에게 알릴 메시지 (소비 후 clearNotice) */
  notice: string | null
  syncLocation: (location: TabLocation, navType: string) => void
  /** 탭을 닫는다. 닫힌 탭이 활성이었다면 이동해야 할 이웃 탭의 경로(pathname+search)를 반환 */
  closeTab: (key: string) => string | null
  closeOthers: (key: string) => void
  /** 고정 탭(홈)만 남기고 모두 닫는다. 이동해야 할 경로를 반환 */
  closeAll: () => string
  setTitle: (key: string, title: string) => void
  clearNotice: () => void
  reset: () => void
}

let tick = 0

function homeTab(): Tab {
  return {
    key: HOME_PATH,
    title: resolveTabTitle(HOME_PATH) ?? '대시보드',
    pinned: true,
    location: { pathname: HOME_PATH, search: '', hash: '', state: null, key: 'home' },
    mounted: false,
    lastActive: ++tick,
  }
}

function loadTabs(): Tab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Array<{ key: string; title: string; search?: string }>
      const tabs: Tab[] = []
      for (const p of parsed) {
        if (typeof p?.key !== 'string') continue
        const path = tabPathOf(p.key)
        const search = typeof p.search === 'string' ? p.search : ''
        const base = resolveTabTitle(path, search)
        if (!base) continue
        if (tabs.some((t) => t.key === p.key)) continue
        tabs.push({
          key: p.key,
          title: typeof p.title === 'string' && p.title ? p.title : base,
          pinned: p.key === HOME_PATH,
          location: {
            pathname: path,
            search,
            hash: '',
            state: null,
            key: `restored-${p.key}`,
          },
          mounted: false,
          lastActive: ++tick,
        })
      }
      if (tabs.length > 0) return withHomeFirst(tabs)
    }
  } catch {
    /* sessionStorage 사용 불가 — 빈 상태로 시작 */
  }
  return [homeTab()]
}

function withHomeFirst(tabs: Tab[]): Tab[] {
  const home = tabs.find((t) => t.key === HOME_PATH) ?? homeTab()
  return [home, ...tabs.filter((t) => t.key !== HOME_PATH)]
}

const pathOf = (t: Tab) => t.location.pathname + t.location.search + t.location.hash

export const useTabStore = create<TabState>((set, get) => ({
  tabs: loadTabs(),
  activeKey: null,
  notice: null,

  syncLocation: (location, navType) => {
    const path = normalizeTabPath(location.pathname)
    const key = tabKeyFor(path, location.search)
    const title = resolveTabTitle(path, location.search)
    if (!title) return
    const { tabs, activeKey } = get()
    const existing = tabs.find((t) => t.key === key)

    if (existing) {
      const sameLoc =
        existing.location.key === location.key && existing.location.search === location.search
      if (activeKey === key && sameLoc && existing.mounted) return
      set({
        activeKey: key,
        tabs: tabs.map((t) =>
          t.key === key
            ? { ...t, mounted: true, lastActive: ++tick, location: { ...location, pathname: path } }
            : t,
        ),
      })
      return
    }

    let next = withHomeFirst(tabs)
    // redirect(replace)로 떠난 직전 활성 탭은 의미 없는 임시 탭이므로 제거 (예: 권한 없음 → 대시보드)
    if (navType === 'REPLACE' && activeKey) {
      next = next.filter((t) => t.key !== activeKey || t.pinned)
    }
    let notice: string | null = null
    if (next.length >= MAX_TABS) {
      const victim = [...next]
        .filter((t) => !t.pinned)
        .sort((a, b) => a.lastActive - b.lastActive)[0]
      if (victim) {
        next = next.filter((t) => t.key !== victim.key)
        notice = `탭이 ${MAX_TABS}개를 넘어 가장 오래 사용하지 않은 '${victim.title}' 탭을 닫았습니다`
      }
    }
    next = [
      ...next,
      {
        key,
        title,
        pinned: key === HOME_PATH,
        location: { ...location, pathname: path },
        mounted: true,
        lastActive: ++tick,
      },
    ]
    set({ tabs: next, activeKey: key, notice: notice ?? get().notice })
  },

  closeTab: (key) => {
    const { tabs, activeKey } = get()
    const idx = tabs.findIndex((t) => t.key === key)
    if (idx < 0 || tabs[idx].pinned) return null
    const next = tabs.filter((t) => t.key !== key)
    set({ tabs: next })
    if (activeKey !== key) return null
    const neighbor = next[idx] ?? next[idx - 1] ?? next[0]
    return neighbor ? pathOf(neighbor) : HOME_PATH
  },

  closeOthers: (key) => set((s) => ({ tabs: s.tabs.filter((t) => t.pinned || t.key === key) })),

  closeAll: () => {
    set((s) => ({ tabs: s.tabs.filter((t) => t.pinned) }))
    return HOME_PATH
  },

  setTitle: (key, title) =>
    set((s) =>
      s.tabs.some((t) => t.key === key && t.title !== title)
        ? { tabs: s.tabs.map((t) => (t.key === key ? { ...t, title } : t)) }
        : s,
    ),

  clearNotice: () => set({ notice: null }),

  reset: () => set({ tabs: [homeTab()], activeKey: null, notice: null }),
}))

// 열린 탭 목록(경로·제목·검색어)만 sessionStorage 에 영속화 — 페이지 상태는 저장하지 않는다
useTabStore.subscribe((state, prev) => {
  if (state.tabs === prev.tabs) return
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        state.tabs.map((t) => ({ key: t.key, title: t.title, search: t.location.search })),
      ),
    )
  } catch {
    /* 저장 실패는 무시 */
  }
})
