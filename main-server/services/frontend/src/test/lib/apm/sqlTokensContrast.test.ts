import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  return css.slice(start, css.indexOf('\n}', start))
}
const hexOf = (b: string, name: string) =>
  new RegExp(`--t-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(b)?.[1] ?? null

describe('SQL 뷰어 라이트 토큰 대비 (WCAG AA)', () => {
  const light = block(':root.light')
  const bg = hexOf(light, 'bg-deep')!
  it.each(['sql-keyword', 'sql-function', 'sql-string', 'sql-bind', 'sql-comment'])(
    '%s 는 bg-deep 위에서 4.5:1 이상',
    (name) => {
      const hex =
        hexOf(light, name) ??
        hexOf(light, name === 'sql-keyword' ? 'metric-alert-text' : 'warning-text')
      expect(hex).not.toBeNull()
      expect(ratio(hex!, bg)).toBeGreaterThanOrEqual(4.5)
    },
  )
  it('줄 번호는 3:1 이상', () => {
    expect(ratio(hexOf(light, 'sql-lineno')!, bg)).toBeGreaterThanOrEqual(3)
  })
  it('다크 줄 번호도 3:1 이상', () => {
    const dark = block(':root')
    expect(ratio(hexOf(dark, 'sql-lineno')!, hexOf(dark, 'bg-deep')!)).toBeGreaterThanOrEqual(3)
  })
})

describe('시리즈 팔레트 대비 (선 3:1)', () => {
  const names = Array.from({ length: 12 }, (_, i) => `series-${i + 1}`)
  const cases: [string, string, string][] = [
    ['라이트', ':root.light', 'bg-base'],
    ['다크', ':root', 'bg-base'],
  ]
  for (const [label, sel, bgName] of cases) {
    const b = block(sel)
    const bg = hexOf(b, bgName)!
    it.each(names)(`${label} %s 는 bg-base 위에서 3:1 이상`, (name) => {
      const hex = hexOf(b, name)
      expect(hex).not.toBeNull()
      expect(ratio(hex!, bg)).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('APM 상태 3색 텍스트 토큰 대비', () => {
  it.each(['apm-normal-text', 'apm-warning-text', 'apm-critical-text'])(
    '%s 는 라이트 bg-base 위 3:1 이상(큰 숫자·윤곽), 다크는 4.5:1 이상',
    (name) => {
      const light = block(':root.light')
      expect(ratio(hexOf(light, name)!, hexOf(light, 'bg-base')!)).toBeGreaterThanOrEqual(3)
      const dark = block(':root')
      expect(ratio(hexOf(dark, name)!, hexOf(dark, 'bg-base')!)).toBeGreaterThanOrEqual(4.5)
    },
  )
})

// OKLab 거리(ΔE_OK): 인스턴스 시리즈 색이 APM 상태 3색과, 그리고 1~5번이 서로 충분히 달라야 한다
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
const dE = (a: string, b: string) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]))

describe('시리즈 색과 상태 색 분리', () => {
  it.each([
    [':root', 'dark', ['apm-normal', 'apm-warning', 'apm-critical']],
    [
      ':root.light',
      'light',
      [
        'apm-normal',
        'apm-warning',
        'apm-critical',
        'apm-normal-text',
        'apm-warning-text',
        'apm-critical-text',
      ],
    ],
  ] as const)(
    '%s: 시리즈 1~12 는 상태 색과 ΔE 0.10 이상, 1~5 는 서로 0.10 이상',
    (sel, _n, status) => {
      const b = block(sel)
      const series = Array.from({ length: 12 }, (_, i) => hexOf(b, `series-${i + 1}`)!)
      const st = status.map((n) => hexOf(b, n)!)
      for (const c of series) for (const s of st) expect(dE(c, s)).toBeGreaterThanOrEqual(0.1)
      for (let i = 0; i < 5; i++)
        for (let j = i + 1; j < 5; j++) expect(dE(series[i], series[j])).toBeGreaterThanOrEqual(0.1)
    },
  )
})

// OKLCH 색상각: 채도 있는 시리즈 색은 상태 색(파랑·노랑·빨강) 색상각에서 충분히 떨어져야 한다.
// 채도가 낮은 색(C < 0.04)은 회색으로 읽히므로 제외한다.
const hueOf = (hex: string) => {
  const [, a, b] = oklab(hex)
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}
const chromaOf = (hex: string) => {
  const [, a, b] = oklab(hex)
  return Math.hypot(a, b)
}
const hueDist = (x: number, y: number) => {
  const d = Math.abs(x - y) % 360
  return d > 180 ? 360 - d : d
}
const MIN_HUE_DIST = 25

describe('시리즈 색상각 분리 (상태 색과 혼동 방지)', () => {
  it.each([':root', ':root.light'])('%s: 채도 0.04 이상 시리즈는 상태 색상각과 25° 이상', (sel) => {
    const b = block(sel)
    const statusHues = ['apm-normal', 'apm-warning', 'apm-critical'].map((n) => hueOf(hexOf(b, n)!))
    for (let i = 1; i <= 12; i++) {
      const hex = hexOf(b, `series-${i}`)!
      if (chromaOf(hex) < 0.04) continue
      for (const h of statusHues) {
        expect(hueDist(hueOf(hex), h), `series-${i} ${hex}`).toBeGreaterThanOrEqual(MIN_HUE_DIST)
      }
    }
  })
})
