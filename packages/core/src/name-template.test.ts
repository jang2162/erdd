import { describe, expect, it } from 'vitest'
import { buildSampleModel } from './testing/fixtures.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import { composeTablePhysicalName, parseTemplate } from './name-template.js'
import type { ProjectModel } from './model.js'

/** g1 에 별칭 MBR 을 주고 t2 를 ORD/주문으로 바꾼 모델. */
function model(): ProjectModel {
  const m = buildSampleModel()
  m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: '회원관리', alias: 'MBR' }
  m.tables['t2'] = { ...m.tables['t2']!, physicalName: 'ORD', logicalName: '주문' }
  return m
}
const rulesWith = (tablePhysicalTemplate: string): NamingRules =>
  ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate })
const compose = (tpl: string, m: ProjectModel = model()) =>
  composeTablePhysicalName(m.tables['t2']!, m, rulesWith(tpl))

describe('parseTemplate', () => {
  it('리터럴과 변수를 쪼갠다', () => {
    expect(parseTemplate('TB_{그룹별칭}_{물리명}')).toEqual([
      { kind: 'lit', text: 'TB_' },
      { kind: 'var', name: '그룹별칭' },
      { kind: 'lit', text: '_' },
      { kind: 'var', name: '물리명' },
    ])
  })

  it('짝이 맞지 않는 중괄호는 리터럴로 남긴다', () => {
    expect(parseTemplate('TB_{물리명')).toEqual([{ kind: 'lit', text: 'TB_{물리명' }])
  })

  it('빈 템플릿은 빈 배열이다', () => {
    expect(parseTemplate('')).toEqual([])
  })
})

describe('composeTablePhysicalName', () => {
  // ⚠️ 이것이 「소비처가 템플릿을 몰라도 된다」를 성립시키는 계약이다(설계 3.1).
  it('템플릿이 비면 물리명을 그대로 낸다', () => {
    expect(compose('')).toBe('ORD')
  })

  it('변수 네 종을 해석한다', () => {
    expect(compose('{그룹별칭}')).toBe('MBR')
    expect(compose('{그룹명}')).toBe('회원관리')
    expect(compose('{물리명}')).toBe('ORD')
    expect(compose('{논리명}')).toBe('주문')
  })

  it('커스텀 항목을 정의 이름으로 지목한다', () => {
    const m = model()
    m.customFields['cf9'] = {
      id: 'cf9', name: '서브시스템', target: 'table', type: 'text',
      options: [], required: false, defaultValue: null, order: 0, origin: null,
    }
    m.tables['t2'] = { ...m.tables['t2']!, custom: { cf9: 'SLS' } }
    expect(compose('{커스텀:서브시스템}', m)).toBe('SLS')
  })

  it('커스텀 항목 정의가 없으면 빈 값이다', () => {
    expect(compose('TB_{커스텀:없는항목}_{물리명}')).toBe('TB_ORD')
  })

  // ⚠️ 커스텀은 「값 > 정의 기본값 > 빈 문자열」이다(custom-field.ts 의 resolveCustomValue 와 같은 정책).
  it('커스텀 값이 없으면 정의 기본값을 쓴다', () => {
    const m = model()
    m.customFields['cf9'] = {
      id: 'cf9', name: '서브시스템', target: 'table', type: 'text',
      options: [], required: false, defaultValue: 'COM', order: 0, origin: null,
    }
    expect(compose('{커스텀:서브시스템}', m)).toBe('COM')
  })

  it('컬럼용 커스텀 항목은 테이블 변수로 잡히지 않는다', () => {
    const m = model()
    m.customFields['cf8'] = {
      id: 'cf8', name: '서브시스템', target: 'column', type: 'text',
      options: [], required: false, defaultValue: 'X', order: 0, origin: null,
    }
    expect(compose('TB_{커스텀:서브시스템}_{물리명}', m)).toBe('TB_ORD')
  })

  it('알 수 없는 변수는 빈 값이다', () => {
    expect(compose('TB_{없는것}_{물리명}')).toBe('TB_ORD')
  })

  it('전체 조합', () => {
    expect(compose('TB_{그룹별칭}_{물리명}')).toBe('TB_MBR_ORD')
  })
})

// ⚠️ 이 사이클의 급소. 설계 3.2 의 표 그대로다.
describe('빈 구간 접기', () => {
  /** 그룹을 떼어 {그룹별칭}·{그룹명} 이 비게 만든다. */
  function noGroup(): ProjectModel {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, groupId: null }
    return m
  }
  /** 물리명을 비운다. */
  function noPhysical(): ProjectModel {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: '' }
    return m
  }

  it('가운데 변수가 비면 뒤 구분자와 함께 접는다', () => {
    expect(compose('TB_{그룹별칭}_{물리명}', noGroup())).toBe('TB_ORD')
  })

  it('맨 앞 변수가 비면 뒤 구분자와 함께 접는다', () => {
    expect(compose('{그룹별칭}_{물리명}', noGroup())).toBe('ORD')
  })

  it('맨 뒤 변수가 비면 앞 구분자를 지운다', () => {
    expect(compose('{그룹별칭}_{물리명}', noPhysical())).toBe('MBR')
  })

  it('연속으로 비어도 접힌다', () => {
    expect(compose('TB_{그룹별칭}_{그룹명}_{물리명}', noGroup())).toBe('TB_ORD')
  })

  it('전부 비면 빈 문자열이다', () => {
    const m = noGroup()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: '' }
    expect(compose('{그룹별칭}_{물리명}', m)).toBe('')
  })

  // ⚠️ 정규식 후처리(`_{2,}` → `_`)로 흉내내면 이 케이스가 깨진다(설계 3.2).
  it('부분 이름 안의 연속 밑줄은 접지 않는다', () => {
    const m = model()
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: 'A__B' }
    expect(compose('TB_{물리명}', m)).toBe('TB_A__B')
  })
})
