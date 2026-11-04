import type { StackSample } from '@/types/apm'

export interface MethodStat {
  method: string
  /** 메소드가 스택 어디에든 나타난 샘플 수 */
  inclusive: number
  /** 최상위 프레임인 샘플 수 */
  self: number
  /** 전체 샘플 대비 inclusive 비율 (0~100) */
  ratio: number
  /** 추정 시간(ms) = inclusive 비율 × 미계측 시간 */
  estMs: number
}

const FRAMEWORK_PREFIXES = [
  'java.',
  'javax.',
  'jakarta.',
  'sun.',
  'jdk.',
  'org.apache.catalina.',
  'org.apache.coyote.',
  'org.apache.tomcat.',
  'jeus.',
  // JDBC 드라이버·커넥션 풀 — 앱 코드가 아니라 DB 호출 내부 프레임
  'oracle.',
  'com.mysql.',
  'org.postgresql.',
  'com.microsoft.sqlserver.',
  'org.mariadb.',
  'com.zaxxer.hikari.',
  'org.apache.commons.dbcp',
  // 프레임워크·런타임 라이브러리
  'org.springframework.',
  'org.hibernate.',
  'org.apache.ibatis.',
  'org.mybatis.',
  'com.sun.',
  'kotlin.',
  'scala.',
  'weblogic.',
  'org.eclipse.jetty.',
  'io.netty.',
]

export function isFrameworkMethod(method: string): boolean {
  return FRAMEWORK_PREFIXES.some((p) => method.startsWith(p))
}

/** "pkg.Class.method(File.java:12)" → "pkg.Class.method" */
export function frameMethod(frame: string): string {
  const i = frame.indexOf('(')
  return (i >= 0 ? frame.slice(0, i) : frame).trim()
}

export function aggregateMethodStats(stacks: StackSample[], unmeasuredMs: number): MethodStat[] {
  const total = stacks.reduce((a, s) => a + s.c, 0)
  if (total === 0) return []
  const map = new Map<string, { inclusive: number; self: number }>()
  for (const s of stacks) {
    const methods = s.f.map(frameMethod).filter(Boolean)
    if (methods.length === 0) continue
    for (const m of new Set(methods)) {
      const e = map.get(m) ?? { inclusive: 0, self: 0 }
      e.inclusive += s.c
      map.set(m, e)
    }
    map.get(methods[0])!.self += s.c
  }
  const un = Math.max(0, unmeasuredMs)
  return [...map.entries()]
    .map(([method, e]) => ({
      method,
      inclusive: e.inclusive,
      self: e.self,
      ratio: (e.inclusive / total) * 100,
      estMs: (e.inclusive / total) * un,
    }))
    .sort((a, b) => b.inclusive - a.inclusive || a.method.localeCompare(b.method))
}

export interface StackGroup {
  frames: string[]
  count: number
  /** 전체 샘플 대비 비율 (0~100) */
  ratio: number
  /** 추정 시간(ms) = 비율 × 미계측 시간 */
  estMs: number
  /** 첫 애플리케이션(프레임워크 아님) 프레임 — 없으면 최상위 프레임 */
  headline: string
  /** 실제 실행 중인 프레임(stack[0]) */
  top: string
  category: StackCategory
}

export type StackCategory =
  | '네트워크 응답 대기'
  | 'DB 응답 대기'
  | '잠금·대기'
  | 'sleep'
  | '정규식 연산(CPU)'
  | '애플리케이션 코드 실행'

/** 상위 프레임 문자열 패턴으로 추정한 분류 — 확정이 아니라 휴리스틱이다 */
export function classifyStack(frames: string[]): StackCategory {
  const top = frames.slice(0, 4).join('\n')
  if (/Thread\.sleep/.test(top)) return 'sleep'
  if (/socketRead|NioSocket|SocketInputStream|\.read0\b|SocketChannelImpl\.read/.test(top))
    return /jdbc|oracle/i.test(frames.slice(0, 12).join('\n'))
      ? 'DB 응답 대기'
      : '네트워크 응답 대기'
  if (/\.jdbc\.|oracle\./i.test(top)) return 'DB 응답 대기'
  if (/Object\.wait|LockSupport\.park|Unsafe\.park|monitorenter|synchronized/.test(top))
    return '잠금·대기'
  if (/java\.util\.regex|Pattern/.test(top)) return '정규식 연산(CPU)'
  return '애플리케이션 코드 실행'
}

/** 스택 샘플을 그룹별(많이 관측된 순) 비율·추정 시간·분류와 함께 정리한다 */
export function buildStackGroups(stacks: StackSample[], unmeasuredMs: number): StackGroup[] {
  const total = stacks.reduce((a, s) => a + s.c, 0)
  if (total === 0) return []
  const un = Math.max(0, unmeasuredMs)
  return [...stacks]
    .filter((s) => s.f.length > 0)
    .sort((a, b) => b.c - a.c)
    .map((s) => ({
      frames: s.f,
      count: s.c,
      ratio: (s.c / total) * 100,
      estMs: (s.c / total) * un,
      headline: s.f.find((f) => !isFrameworkMethod(frameMethod(f))) ?? s.f[0],
      top: s.f[0],
      category: classifyStack(s.f),
    }))
}
