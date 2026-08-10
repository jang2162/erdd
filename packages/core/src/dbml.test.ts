import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { generateDbml } from './dbml.js'

function baseModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: '회원 기본정보',
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  return m
}

describe('generateDbml', () => {
  it('식별자를 큰따옴표로 감싸고 컬럼 설정을 낸다', () => {
    const out = generateDbml(baseModel(), 'postgresql')
    expect(out).toContain('Table "MBR" [note: \'회원 - 회원 기본정보\'] {')
    expect(out).toContain('"MBR_NO" bigint [pk, increment, note: \'회원번호\']')
    expect(out).toContain('"MBR_NM" varchar(100) [not null, note: \'회원명\']')
  })

  it('projectName 을 주면 Project 블록을 낸다', () => {
    const out = generateDbml(baseModel(), 'oracle', { kind: 'all' }, { projectName: '회원 관리' })
    expect(out.startsWith('Project "회원 관리" {\n  database_type: \'Oracle\'\n}')).toBe(true)
  })

  it('projectName 이 없으면 Project 블록을 내지 않는다', () => {
    expect(generateDbml(baseModel(), 'postgresql')).not.toContain('Project ')
  })

  it('0컬럼 테이블과 빈 물리명 테이블은 제외한다', () => {
    const m = baseModel()
    m.tables['t2'] = {
      id: 't2', logicalName: '빈테이블', physicalName: 'EMPTY', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['t3'] = {
      id: 't3', logicalName: '이름없음', physicalName: '', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c9'] = {
      id: 'c9', tableId: 't3', logicalName: '컬럼', physicalName: 'C', type: 'INT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {},
    }
    const out = generateDbml(m, 'postgresql')
    expect(out).not.toContain('EMPTY')
    expect(out).not.toContain('이름없음')
  })

  it('작은따옴표·개행이 든 설명을 안전하게 낸다', () => {
    const m = baseModel()
    m.tables['t1']!.comment = "it's\n두 줄"
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain("note: '''회원 - it's\n두 줄'''")
  })

  describe('default 표현', () => {
    const withDefault = (v: string) => {
      const m = baseModel()
      m.columns['c2']!.defaultValue = v
      return generateDbml(m, 'postgresql')
    }
    it('문자열 리터럴', () => expect(withDefault("'ACTIVE'")).toContain("default: 'ACTIVE'"))
    it('숫자', () => expect(withDefault('0')).toContain('default: 0'))
    it('불리언', () => expect(withDefault('TRUE')).toContain('default: true'))
    it('NULL', () => expect(withDefault('NULL')).toContain('default: null'))
    it('표현식은 백틱', () => expect(withDefault('now()')).toContain('default: `now()`'))
  })

  it('autoIncrement 는 PK 이고 정수일 때만 increment 로 낸다', () => {
    const m = baseModel()
    m.columns['c2']!.autoIncrement = true            // PK 가 아니다
    expect(generateDbml(m, 'postgresql')).not.toContain('"MBR_NM" varchar(100) [increment')
  })

  it('커스텀 항목 값을 note 꼬리로 낸다', () => {
    const m = baseModel()
    m.customFields['f1'] = {
      id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 0, origin: null,
    }
    m.tables['t1']!.custom = { f1: '2' }
    expect(generateDbml(m, 'postgresql')).toContain('{"보안등급":"2"}')
  })
})
