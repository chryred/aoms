import { format } from 'sql-formatter'

export type SqlStatementType =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'MERGE'
  | 'CALL'
  | 'OTHER'

export type SqlTokenType =
  | 'keyword'
  | 'function'
  | 'string'
  | 'bind'
  | 'comment'
  | 'number'
  | 'text'

export interface SqlToken {
  type: SqlTokenType
  text: string
}

// /* Some.Mapper.method */ : 선행 키워드(SELECT 등) 한 단어 뒤 또는 맨 앞의 점 구분 식별자 주석
const MAPPER_RE = /^\s*(?:[A-Za-z]+\s+)?\/\*\s*([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)+)\s*\*\//

export function extractMapperId(sql: string): string | null {
  const m = MAPPER_RE.exec(sql)
  return m ? m[1] : null
}

function stripLeadingComments(sql: string): string {
  let s = sql.trimStart()
  for (;;) {
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      if (end < 0) return ''
      s = s.slice(end + 2).trimStart()
    } else if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      if (nl < 0) return ''
      s = s.slice(nl + 1).trimStart()
    } else return s
  }
}

export function statementType(sql: string): SqlStatementType {
  const s = stripLeadingComments(sql).replace(/^[({\s]+/, '')
  const w = /^[A-Za-z]+/.exec(s)?.[0].toUpperCase()
  switch (w) {
    case 'SELECT':
    case 'WITH':
      return 'SELECT'
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'MERGE':
      return w
    case 'CALL':
    case 'EXEC':
    case 'EXECUTE':
    case 'BEGIN':
    case 'DECLARE':
      return 'CALL'
    default:
      return 'OTHER'
  }
}

/** 한 줄 요약: 매퍼 ID 가 있으면 그것, 없으면 공백 정리한 앞 max 자 */
export function summarizeSql(sql: string, max = 80): string {
  const mapper = extractMapperId(sql)
  if (mapper) return mapper
  const one = sql.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** 정렬 출력. 포매터가 실패하면 원문을 그대로 돌려준다. */
export function formatSql(sql: string): string {
  try {
    const out = format(sql, {
      language: 'plsql',
      tabWidth: 2,
      keywordCase: 'preserve',
      paramTypes: { positional: true },
    })
    return out.trim() ? out : sql
  } catch {
    return sql
  }
}

const KEYWORDS = new Set(
  (
    'SELECT FROM WHERE AND OR NOT IN EXISTS BETWEEN LIKE IS NULL AS ON JOIN INNER LEFT RIGHT FULL OUTER CROSS ' +
    'GROUP BY ORDER HAVING UNION ALL INTERSECT MINUS DISTINCT UNIQUE CONNECT START WITH PRIOR LEVEL SIBLINGS NOCYCLE ' +
    'INSERT INTO VALUES UPDATE SET DELETE MERGE USING WHEN THEN ELSE END CASE ASC DESC FETCH FIRST NEXT ROWS ONLY ' +
    'OFFSET LIMIT FOR OVER PARTITION CREATE ALTER DROP TABLE INDEX VIEW BEGIN DECLARE CALL EXEC EXECUTE ANY SOME ' +
    'ROWNUM ROWID SYSDATE SYSTIMESTAMP DUAL'
  ).split(' '),
)

const TOKEN_RE = new RegExp(
  [
    '(\\/\\*[\\s\\S]*?(?:\\*\\/|$))', // 1 block comment
    '(--[^\\n]*)', // 2 line comment
    "('(?:[^']|'')*'?)", // 3 string
    '(\\?|(?<![:\\w]):[A-Za-z_]\\w*|#\\{[^}]*\\})', // 4 bind
    '(\\d+(?:\\.\\d+)?)', // 5 number
    '([A-Za-z_][\\w$#]*)', // 6 word
  ].join('|'),
  'g',
)

/** 가벼운 SQL 토크나이저 (구문 강조 전용). 모든 입력 문자를 순서대로 보존한다. */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  const push = (type: SqlTokenType, text: string) => {
    if (!text) return
    const last = tokens[tokens.length - 1]
    if (last && last.type === type && type === 'text') last.text += text
    else tokens.push({ type, text })
  }
  let pos = 0
  for (const m of sql.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    push('text', sql.slice(pos, idx))
    pos = idx + m[0].length
    if (m[1] !== undefined || m[2] !== undefined) push('comment', m[0])
    else if (m[3] !== undefined) push('string', m[0])
    else if (m[4] !== undefined) push('bind', m[0])
    else if (m[5] !== undefined) push('number', m[0])
    else {
      const upper = m[0].toUpperCase()
      if (KEYWORDS.has(upper)) push('keyword', m[0])
      else if (/^\s*\(/.test(sql.slice(pos))) push('function', m[0])
      else push('text', m[0])
    }
  }
  push('text', sql.slice(pos))
  return tokens
}
