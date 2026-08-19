import { describe, expect, it } from 'vitest'
import { buildNameMeta, parseNameMeta, serializeNameMeta, type NameMeta } from './name-meta.js'
import type { ProjectModel } from './model.js'
import { buildSampleModel } from './testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from './naming.js'

const META: NameMeta = {
  tables: { TB_MBR_ORD: { p: 'ORD', l: '주문', g: '회원관리' } },
  groups: { 회원관리: { name: '회원관리', a: 'MBR', c: '#4A90D9', n: '회원 도메인' } },
}

/** v1 머릿말 한 줄과 그것을 읽었을 때의 결과. 스캔 규칙·하위호환 케이스가 함께 쓴다. */
const V1_BODY = '{"TB_MBR_ORD":{"p":"ORD","l":"주문"}}'
const V1_LINE = `-- erdd:v1 ${V1_BODY}`
const V1_PARSED: NameMeta = { tables: { TB_MBR_ORD: { p: 'ORD', l: '주문' } }, groups: {} }

describe('serializeNameMeta', () => {
  it('한 줄로 낸다', () => {
    const line = serializeNameMeta(META, '--')!
    expect(line.startsWith('-- erdd:v2 ')).toBe(true)
    expect(line).not.toContain('\n')            // ⚠️ 줄바꿈이 들어가면 주석이 아닌 줄이 생긴다
  })

  it('접두만 갈린다', () => {
    expect(serializeNameMeta(META, '//')!.startsWith('// erdd:v2 ')).toBe(true)
  })

  // ⚠️ 그룹 키가 곧 원문 이름이다 — name 을 따로 싣지 않는다(설계 3.1).
  it('그룹 구획의 키가 원문 이름이고 name 키는 없다', () => {
    const line = serializeNameMeta(META, '--')!
    expect(line).toContain('"g":{"회원관리":{"a":"MBR","c":"#4A90D9","n":"회원 도메인"}}')
    expect(line).not.toContain('"name"')
  })

  // ⚠️ 설계 D4 — 실을 것이 없으면 머릿말을 아예 내지 않는다.
  it('테이블도 그룹도 없으면 null 이다', () => {
    expect(serializeNameMeta({ tables: {}, groups: {} }, '--')).toBeNull()
  })
})

describe('parseNameMeta — v2', () => {
  it('직렬화한 것을 되읽는다', () => {
    expect(parseNameMeta(serializeNameMeta(META, '--')!)).toEqual(META)
  })

  it('조회 키는 대문자로 정규화하고 원문 이름은 name 이 나른다', () => {
    const m = parseNameMeta('-- erdd:v2 {"t":{"tb_mbr_ord":{"p":"ORD","l":"주문","g":"sales"}},"g":{"sales":{"a":"SLS"}}}')!
    expect(m.tables['TB_MBR_ORD']).toEqual({ p: 'ORD', l: '주문', g: 'sales' })
    expect(m.groups['SALES']).toEqual({ name: 'sales', a: 'SLS' })
  })

  it('그룹 구획이 없어도 읽는다', () => {
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}}}'))
      .toEqual({ tables: { X: { p: 'A', l: '가' } }, groups: {} })
  })

  it('형태가 다르면 null 이다', () => {
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A"}}}')).toBeNull()             // l 없음
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가","g":1}}}')).toBeNull() // g 가 문자열 아님
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}},"g":{"G":"x"}}')).toBeNull() // 그룹 값이 객체 아님
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}},"g":{"G":{"a":1}}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v2 {"t":{"X":{"p":"A","l":"가"}},"g":[]}')).toBeNull() // g 구획이 객체 아님
    expect(parseNameMeta('-- erdd:v2 {"g":{}}')).toBeNull()                          // t 없음
  })
})

describe('parseNameMeta — v1 하위호환', () => {
  // ⚠️ 이미 내보낸 덤프가 그대로 살아야 한다. groups 는 빈 객체다.
  it('v1 머릿말을 읽으면 groups 가 비어 있다', () => {
    expect(parseNameMeta(V1_LINE)).toEqual(V1_PARSED)
  })

  it('조회 키는 대문자로 정규화한다', () => {
    expect(parseNameMeta('-- erdd:v1 {"tb_mbr_ord":{"p":"ORD","l":"주문"}}'))
      .toEqual(V1_PARSED)
  })

  it('v1 의 형태 검사는 그대로다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":"ORD"}}')).toBeNull()          // l 없음
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":1,"l":"주문"}}')).toBeNull()   // 문자열 아님
    expect(parseNameMeta('-- erdd:v1 ["ORD"]')).toBeNull()                     // 배열
    expect(parseNameMeta('-- erdd:v1 null')).toBeNull()
  })

  // ⚠️ 마커 **바로 뒤가 공백이거나 줄 끝**일 때만 그 버전으로 본다.
  // 경계 검사가 실제로 갈라 내는 것은 **공백 없이 JSON 이 바로 붙은 입력**뿐이다 —
  // erdd:v11 같은 것은 경계 검사가 없어도 마커 뒤에 남는 `1 {...}` 를 JSON.parse 가 못 읽어
  // 어차피 null 이 된다. 그래서 마지막 줄이 이 규칙을 잠그는 유일한 단언이다.
  // ⚠️ 이것은 옛 v1 파서보다 **엄격해진 동작 변경**이다 — 옛 파서는 `-- erdd:v1{...}` 를 읽었다.
  // ERDD 가 내는 덤프는 마커 뒤에 늘 공백을 넣으므로 실사용 영향은 없고, 우리 산출물이 아닌
  // 입력은 읽지 않는 쪽을 택했다.
  it('모르는 버전은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v9 {"t":{}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v11 {"TB":{"p":"ORD","l":"주문"}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v21 {"t":{"X":{"p":"A","l":"가"}}}')).toBeNull()
    expect(parseNameMeta('-- erdd:v1{"TB":{"p":"ORD","l":"주문"}}')).toBeNull()   // 공백이 없다
  })
})

// ⚠️ 이 블록이 지키는 것은 버전이 아니라 **스캔 규칙**이다 — 그래서 입력을 v1 로 둔다.
describe('parseNameMeta — 스캔 규칙', () => {
  it('DBML 접두도 읽는다', () => {
    expect(parseNameMeta(`// erdd:v1 ${V1_BODY}`)).toEqual(V1_PARSED)
  })

  it('앞선 다른 주석과 빈 줄은 지나친다', () => {
    const raw = ['', '-- 사람이 쓴 주석', '', V1_LINE, 'CREATE TABLE X ();'].join('\n')
    expect(parseNameMeta(raw)).toEqual(V1_PARSED)
  })

  // ⚠️ 이 태스크의 급소(설계 3.2) — 첫 비주석 줄이 나오면 멈춘다.
  it('첫 문장 뒤의 마커는 줍지 않는다', () => {
    const raw = ['CREATE TABLE X ();', V1_LINE].join('\n')
    expect(parseNameMeta(raw)).toBeNull()
  })

  it('마커가 없으면 null 이다', () => {
    expect(parseNameMeta('CREATE TABLE X ();')).toBeNull()
    expect(parseNameMeta('')).toBeNull()
  })

  // ⚠️ 설계 D6 — 깨진 입력은 전부 null. 예외를 던지지 않는다.
  it('깨진 JSON 은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":"ORD"')).toBeNull()
  })
})

describe('buildNameMeta', () => {
  // buildSampleModel 은 테이블 둘(MBR_GRD·MBR)이 모두 그룹 g1(회원관리) 소속이다.
  const grouped = (): ProjectModel => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR', comment: '회원 도메인' }
    return m
  }
  const tables = (m: ProjectModel) => Object.values(m.tables)

  // ⚠️ 설계 D4 가 좁아진 자리 — 템플릿이 없어도 그룹이 있으면 싣는다.
  it('조합 결과가 부분과 같아도 그룹에 속하면 싣는다', () => {
    const m = grouped()
    const meta = buildNameMeta(m, tables(m), DEFAULT_NAMING_RULES)
    expect(meta.tables['MBR']).toEqual({ p: 'MBR', l: '회원', g: '회원관리' })
    expect(meta.groups['회원관리']).toEqual({ name: '회원관리', a: 'MBR', c: '#4A90D9', n: '회원 도메인' })
  })

  it('빈 별칭·빈 코멘트는 키를 생략한다', () => {
    const m = buildSampleModel()                       // alias '' · comment null
    const meta = buildNameMeta(m, tables(m), DEFAULT_NAMING_RULES)
    expect(meta.groups['회원관리']).toEqual({ name: '회원관리', c: '#4A90D9' })
  })

  // ⚠️ 좁아진 보장 — 그룹도 템플릿도 없으면 여전히 빈 메타다.
  it('그룹도 템플릿도 없으면 빈 메타다', () => {
    const m = buildSampleModel()
    m.tables['t1'] = { ...m.tables['t1']!, groupId: null }
    m.tables['t2'] = { ...m.tables['t2']!, groupId: null }
    const meta = buildNameMeta(m, tables(m), DEFAULT_NAMING_RULES)
    expect(meta).toEqual({ tables: {}, groups: {} })
    expect(serializeNameMeta(meta, '--')).toBeNull()
  })

  it('내보내는 목록에 없는 테이블의 그룹은 싣지 않는다', () => {
    const m = grouped()
    m.tableGroups['g2'] = { id: 'g2', name: '상품', color: '#111', comment: null, alias: 'PRD' }
    m.tables['t9'] = { ...m.tables['t2']!, id: 't9', physicalName: 'PRD', groupId: 'g2' }
    const meta = buildNameMeta(m, [m.tables['t1']!, m.tables['t2']!], DEFAULT_NAMING_RULES)
    expect(Object.keys(meta.groups)).toEqual(['회원관리'])
  })
})
