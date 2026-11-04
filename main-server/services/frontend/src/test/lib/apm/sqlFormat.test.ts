import { describe, it, expect } from 'vitest'
import {
  extractMapperId,
  statementType,
  summarizeSql,
  formatSql,
  tokenizeSql,
} from '@/lib/apm/sqlFormat'

const ORACLE = `SELECT /* MyVocMngtMapper.doSearchTaskList */ A.VOC_ID /* VOC번호 */ , A.TITLE, DECODE(A.STAT, '1', '접수', '2', '처리', '기타') AS STAT_NM, NVL(B.CNT, 0) AS CNT, (SELECT COMN_CD_NM FROM TB_COMN_CD C WHERE C.COMN_CD = A.STAT AND C.USE_YN = ?) AS STAT_NAME FROM TB_VOC A, TB_VOC_DTL B WHERE A.VOC_ID = B.VOC_ID (+) AND A.REG_DT BETWEEN ? AND ? AND A.DEPT_CD IN (SELECT DEPT_CD FROM TB_DEPT START WITH DEPT_CD = ? CONNECT BY PRIOR DEPT_CD = UP_DEPT_CD) ORDER BY A.REG_DT DESC`

const count = (s: string, ch: string) => s.split(ch).length - 1

describe('sqlFormat', () => {
  it('매퍼 ID 를 추출한다', () => {
    expect(extractMapperId(ORACLE)).toBe('MyVocMngtMapper.doSearchTaskList')
    expect(extractMapperId('/* a.B.c */ UPDATE T SET X=1')).toBe('a.B.c')
    expect(extractMapperId('SELECT /*+ INDEX(a idx) */ 1 FROM a')).toBeNull()
    expect(extractMapperId('SELECT 1 FROM DUAL')).toBeNull()
  })

  it('구문 종류를 판별한다', () => {
    expect(statementType(ORACLE)).toBe('SELECT')
    expect(statementType('  /* M.x */ insert into t values (1)')).toBe('INSERT')
    expect(statementType('UPDATE t SET a=1')).toBe('UPDATE')
    expect(statementType('DELETE FROM t')).toBe('DELETE')
    expect(statementType('{call PKG.PROC(?)}')).toBe('CALL')
    expect(statementType('WITH x AS (SELECT 1 FROM DUAL) SELECT * FROM x')).toBe('SELECT')
    expect(statementType('COMMIT')).toBe('OTHER')
  })

  it('요약은 매퍼 ID 우선, 없으면 한 줄 80자 말줄임', () => {
    expect(summarizeSql(ORACLE)).toBe('MyVocMngtMapper.doSearchTaskList')
    const s = summarizeSql(`SELECT\n  ${'a'.repeat(200)}\nFROM t`)
    expect(s).not.toContain('\n')
    expect(s.length).toBe(81)
    expect(s.endsWith('…')).toBe(true)
  })

  it('Oracle 샘플을 예외 없이 정렬하고 ? 와 (+) 와 주석을 보존한다', () => {
    const out = formatSql(ORACLE)
    expect(out).not.toBe(ORACLE)
    expect(out.split('\n').length).toBeGreaterThan(10)
    expect(count(out, '?')).toBe(count(ORACLE, '?'))
    expect(out).toContain('(+)')
    expect(out).toContain('/* VOC번호 */')
    expect(out).toContain('/* MyVocMngtMapper.doSearchTaskList */')
    expect(out).toMatch(/CONNECT BY/i)
    expect(out).toMatch(/\n\s*ORDER BY/i)
  })

  it('빈 문자열 및 깨진 입력에서도 예외 없이 문자열을 돌려준다', () => {
    expect(formatSql('')).toBe('')
    expect(typeof formatSql("SELECT 'unterminated FROM t WHERE (")).toBe('string')
  })

  it('토크나이저는 입력을 손실 없이 분류한다', () => {
    const tokens = tokenizeSql(ORACLE)
    expect(tokens.map((t) => t.text).join('')).toBe(ORACLE)
    const of = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text)
    expect(of('keyword')).toContain('SELECT')
    expect(of('function')).toEqual(expect.arrayContaining(['DECODE', 'NVL']))
    expect(of('string')).toContain("'접수'")
    expect(of('bind')).toHaveLength(count(ORACLE, '?'))
    expect(of('comment')).toContain('/* VOC번호 */')
  })

  it('명명 바인드와 숫자, 라인 주석을 분류한다', () => {
    const t = tokenizeSql('SELECT a FROM t WHERE x = :id AND y = 10 -- note\n')
    const of = (type: string) => t.filter((x) => x.type === type).map((x) => x.text)
    expect(of('bind')).toEqual([':id'])
    expect(of('number')).toEqual(['10'])
    expect(of('comment')).toEqual(['-- note'])
  })
})
