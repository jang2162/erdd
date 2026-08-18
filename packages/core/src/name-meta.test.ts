import { describe, expect, it } from 'vitest'
import { parseNameMeta, serializeNameMeta, type NameMeta } from './name-meta.js'

const META: NameMeta = { TB_MBR_ORD: { p: 'ORD', l: '주문' } }

describe('serializeNameMeta', () => {
  it('한 줄로 낸다', () => {
    const line = serializeNameMeta(META, '--')!
    expect(line.startsWith('-- erdd:v1 ')).toBe(true)
    expect(line).not.toContain('\n')            // ⚠️ 줄바꿈이 들어가면 주석이 아닌 줄이 생긴다
  })

  it('접두만 갈린다', () => {
    expect(serializeNameMeta(META, '//')!.startsWith('// erdd:v1 ')).toBe(true)
  })

  // ⚠️ 설계 D4 — 실을 것이 없으면 머릿말을 아예 내지 않는다.
  it('빈 메타는 null 이다', () => {
    expect(serializeNameMeta({}, '--')).toBeNull()
  })
})

describe('parseNameMeta', () => {
  it('직렬화한 것을 되읽는다', () => {
    expect(parseNameMeta(serializeNameMeta(META, '--')!)).toEqual(META)
  })

  it('DBML 접두도 읽는다', () => {
    expect(parseNameMeta(serializeNameMeta(META, '//')!)).toEqual(META)
  })

  it('조회 키는 대문자로 정규화한다', () => {
    expect(parseNameMeta('-- erdd:v1 {"tb_mbr_ord":{"p":"ORD","l":"주문"}}'))
      .toEqual({ TB_MBR_ORD: { p: 'ORD', l: '주문' } })
  })

  it('앞선 다른 주석과 빈 줄은 지나친다', () => {
    const raw = ['', '-- 사람이 쓴 주석', '', serializeNameMeta(META, '--')!, 'CREATE TABLE X ();']
      .join('\n')
    expect(parseNameMeta(raw)).toEqual(META)
  })

  // ⚠️ 이 태스크의 급소(설계 3.2) — 첫 비주석 줄이 나오면 멈춘다.
  it('첫 문장 뒤의 마커는 줍지 않는다', () => {
    const raw = ['CREATE TABLE X ();', serializeNameMeta(META, '--')!].join('\n')
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

  it('모르는 버전은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v2 {"TB":{"p":"ORD","l":"주문"}}')).toBeNull()
  })

  it('형태가 다른 값은 null 이다', () => {
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":"ORD"}}')).toBeNull()          // l 없음
    expect(parseNameMeta('-- erdd:v1 {"TB":{"p":1,"l":"주문"}}')).toBeNull()   // 문자열 아님
    expect(parseNameMeta('-- erdd:v1 ["ORD"]')).toBeNull()                     // 배열
    expect(parseNameMeta('-- erdd:v1 null')).toBeNull()
  })
})
