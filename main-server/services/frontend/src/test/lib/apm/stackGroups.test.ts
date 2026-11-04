import { describe, expect, it } from 'vitest'
import {
  buildStackGroups,
  classifyStack,
  isFrameworkMethod,
  aggregateMethodStats,
} from '@/lib/apm/methodStats'

describe('classifyStack', () => {
  it.each([
    [
      ['java.net.SocketInputStream.socketRead0(Native Method)', 'a.B.c(B.java:1)'],
      '네트워크 응답 대기',
    ],
    [['oracle.jdbc.driver.T4CMAREngine.read(X.java:1)'], 'DB 응답 대기'],
    [['java.lang.Object.wait(Native Method)'], '잠금·대기'],
    [['java.lang.Thread.sleep(Native Method)'], 'sleep'],
    [['java.util.regex.Pattern$Loop.match(Pattern.java:1)'], '정규식 연산(CPU)'],
    [['com.app.Foo.bar(Foo.java:1)'], '애플리케이션 코드 실행'],
  ])('%j → %s', (frames, cat) => {
    expect(classifyStack(frames)).toBe(cat)
  })
})

describe('buildStackGroups', () => {
  it('비율·추정 시간·headline(첫 앱 프레임)·실행 프레임', () => {
    const g = buildStackGroups(
      [
        { f: ['com.app.A.x(A.java:1)'], c: 1 },
        {
          f: ['java.util.regex.Pattern.match(P.java:2)', 'com.app.Sanitizer.clean(S.java:9)'],
          c: 3,
        },
      ],
      1000,
    )
    expect(g[0].count).toBe(3)
    expect(g[0].ratio).toBe(75)
    expect(g[0].estMs).toBe(750)
    expect(g[0].headline).toBe('com.app.Sanitizer.clean(S.java:9)')
    expect(g[0].top).toContain('Pattern.match')
  })
  it('샘플이 없으면 빈 배열', () => {
    expect(buildStackGroups([], 100)).toEqual([])
  })
})

describe('isFrameworkMethod — JDBC·풀·프레임워크 접두', () => {
  it.each([
    'oracle.jdbc.driver.T4CPreparedStatement.executeForRows',
    'com.mysql.cj.jdbc.ClientPreparedStatement.execute',
    'org.postgresql.jdbc.PgStatement.execute',
    'com.microsoft.sqlserver.jdbc.SQLServerStatement.execute',
    'org.mariadb.jdbc.MariaDbStatement.execute',
    'com.zaxxer.hikari.pool.ProxyPreparedStatement.execute',
    'org.apache.commons.dbcp2.DelegatingStatement.execute',
    'org.springframework.jdbc.core.JdbcTemplate.query',
    'org.hibernate.loader.Loader.doQuery',
    'org.apache.ibatis.executor.SimpleExecutor.doQuery',
    'org.mybatis.spring.SqlSessionTemplate.selectList',
    'com.sun.proxy.$Proxy12.query',
    'kotlin.collections.CollectionsKt.map',
    'scala.collection.immutable.List.map',
  ])('%s 는 프레임워크', (m) => {
    expect(isFrameworkMethod(m)).toBe(true)
  })
  it('애플리케이션 메소드는 프레임워크가 아니다', () => {
    expect(isFrameworkMethod('com.app.OrderDao.select')).toBe(false)
    expect(isFrameworkMethod('com.oraclecorp.Foo.bar')).toBe(false)
  })
  it('JDBC 드라이버 프레임 위에 앱 프레임이 있으면 headline 은 앱 메소드', () => {
    const g = buildStackGroups(
      [
        {
          f: [
            'oracle.jdbc.driver.T4CPreparedStatement.executeForRows(T4C.java:1)',
            'com.zaxxer.hikari.pool.ProxyPreparedStatement.execute(P.java:2)',
            'com.app.OrderDao.select(OrderDao.java:30)',
          ],
          c: 2,
        },
      ],
      100,
    )
    expect(g[0].headline).toBe('com.app.OrderDao.select(OrderDao.java:30)')
    expect(g[0].category).toBe('DB 응답 대기')
  })
  it('메소드 통계 집계는 프레임워크 접두와 무관하게 모든 메소드를 유지', () => {
    const st = aggregateMethodStats(
      [{ f: ['oracle.jdbc.A.x(A.java:1)', 'com.app.OrderDao.select(O.java:3)'], c: 2 }],
      200,
    )
    expect(st.map((m) => m.method).sort()).toEqual(['com.app.OrderDao.select', 'oracle.jdbc.A.x'])
    expect(st.find((m) => m.method === 'oracle.jdbc.A.x')!.self).toBe(2)
  })
})
