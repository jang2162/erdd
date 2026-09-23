import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Origin, type ProjectModel, type Word } from './model.js'
import { validateModelIntegrity } from './integrity.js'
import { diffModels } from './diff.js'
import { adoptTargetOf, applyResyncPlan, planResync, type LibraryItem } from './resource-sync.js'

const LIB = 'lib-1'

function wordItem(id: string, logicalName: string, abbreviation: string, version = 1): LibraryItem {
  return { id, kind: 'word', version, payload: { logicalName, abbreviation, description: null } }
}
function domainItem(id: string, name: string, version = 1): LibraryItem {
  return {
    id, kind: 'domain', version,
    payload: {
      name, category: null, logicalType: 'VARCHAR(100)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    },
  }
}
function termItem(id: string, logicalName: string, physicalName: string,
  domainSourceId: string | null, version = 1): LibraryItem {
  return {
    id, kind: 'term', version,
    payload: { logicalName, physicalName, domainId: domainSourceId, description: null },
  }
}
function customFieldItem(id: string, name: string, version = 1): LibraryItem {
  return {
    id, kind: 'customField', version,
    payload: { name, target: 'column', type: 'text', options: [], required: false, defaultValue: null },
  }
}

/** 이 라이브러리 항목을 가져온 상태의 프로젝트 단어. */
function forkedWord(
  id: string, sourceId: string, logicalName: string, abbreviation: string, sourceVersion = 1,
): Word {
  const payload = { logicalName, abbreviation, englishName: null, description: null }
  return { id, ...payload, origin: { libraryId: LIB, sourceId, sourceVersion, base: payload } }
}

let seq = 0
const newId = () => `new-${++seq}`

describe('planResync — 분류', () => {
  it('프로젝트에 사본이 없으면 added', () => {
    const plan = planResync(createEmptyModel(), LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]!.status).toBe('added')
    expect(plan.entries[0]!.name).toBe('회원')
    expect(plan.entries[0]!.fromVersion).toBeNull()
    expect(plan.entries[0]!.projectEntityId).toBeNull()
  })

  it('버전이 같으면 목록에 없고 keptSynced로 센다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR', 1)])
    expect(plan.entries).toHaveLength(0)
    expect(plan.keptSynced).toBe(1)
  })

  it('원본만 바뀌면 auto-update', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    expect(plan.entries[0]!.status).toBe('auto-update')
    expect(plan.entries[0]!.fromVersion).toBe(1)
    expect(plan.entries[0]!.version).toBe(2)
    expect(plan.entries[0]!.changedFields).toEqual(['abbreviation'])
  })

  it('원본도 바뀌고 프로젝트도 고쳤으면 conflict', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR', 1)
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    expect(plan.entries[0]!.status).toBe('conflict')
  })

  it('origin이 없는 항목은 keptLocal이고 계획에 영향이 없다', () => {
    const local: Word = {
      id: 'w9', logicalName: '쿠폰', abbreviation: 'CPN',
      englishName: null, description: null, origin: null,
    }
    const model: ProjectModel = { ...createEmptyModel(), words: { w9: local } }
    const plan = planResync(model, LIB, [])
    expect(plan.keptLocal).toBe(1)
    expect(plan.entries).toHaveLength(0)
  })

  it('원본에서 사라진 항목은 keptDetached로만 센다 (삭제 제안 없음)', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [])
    expect(plan.keptDetached).toBe(1)
    expect(plan.entries).toHaveLength(0)
  })

  it('다른 라이브러리에서 온 항목은 어느 카운트에도 넣지 않는다', () => {
    const other = forkedWord('w1', 's1', '회원', 'MBR', 1)
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: { ...other, origin: { ...other.origin!, libraryId: 'lib-other' } } },
    }
    const plan = planResync(model, LIB, [])
    expect(plan).toMatchObject({ keptLocal: 0, keptSynced: 0, keptDetached: 0 })
    expect(plan.entries).toHaveLength(0)
  })

  it('added인데 같은 종류에 같은 이름이 있으면 nameClash', () => {
    const local: Word = {
      id: 'w9', logicalName: '회원', abbreviation: 'MEM',
      englishName: null, description: null, origin: null,
    }
    const model: ProjectModel = { ...createEmptyModel(), words: { w9: local } }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries[0]!.nameClash).toBe(true)
  })

  it('entries를 종류 순서(도메인→단어→용어→커스텀 항목)로 정렬한다', () => {
    const plan = planResync(createEmptyModel(), LIB, [
      customFieldItem('s4', '비고'),
      wordItem('s2', '회원', 'MBR'),
      termItem('s3', '회원번호', 'MBR_NO', null),
      domainItem('s1', '금액'),
    ])
    expect(plan.entries.map((e) => e.kind)).toEqual(['domain', 'word', 'term', 'customField'])
  })
})

describe('applyResyncPlan', () => {
  it('added + apply가 origin을 달고 엔티티를 만든다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR', 3)])
    const next = applyResyncPlan(model, plan, { s1: 'apply' }, newId)
    const created = Object.values(next.words)[0]!
    expect(created.logicalName).toBe('회원')
    expect(created.origin).toEqual({
      libraryId: LIB, sourceId: 's1', sourceVersion: 3,
      base: { logicalName: '회원', abbreviation: 'MBR', description: null },
    })
  })

  it('defer(기본)는 아무것도 하지 않는다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(applyResyncPlan(model, plan, {}, newId)).toBe(model)
  })

  it('auto-update + apply가 내용과 origin을 함께 갱신한다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR', 1) },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    const next = applyResyncPlan(model, plan, { s1: 'apply' }, newId)
    expect(next.words.w1!.abbreviation).toBe('MEMBER')
    expect(next.words.w1!.origin!.sourceVersion).toBe(2)
  })

  it('conflict + keep은 내용을 유지하고 origin만 갱신한다 — 다음엔 안 뜨고, 원본이 또 바뀌면 다시 충돌', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR', 1)
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MEMBER', 2)])
    const kept = applyResyncPlan(model, plan, { s1: 'keep' }, newId)

    expect(kept.words.w1!.abbreviation).toBe('MB')          // 프로젝트 값 유지
    expect(kept.words.w1!.origin!.sourceVersion).toBe(2)
    expect(kept.words.w1!.origin!.base).toEqual(
      { logicalName: '회원', abbreviation: 'MEMBER', description: null })  // 원본 현재값

    // 같은 원본으로 다시 계획하면 목록에 없다
    expect(planResync(kept, LIB, [wordItem('s1', '회원', 'MEMBER', 2)]).entries).toHaveLength(0)
    // 원본이 또 바뀌면 자동 갱신이 아니라 다시 충돌이다(로컬 수정이 조용히 덮이지 않는다)
    const again = planResync(kept, LIB, [wordItem('s1', '회원', 'MBRS', 3)])
    expect(again.entries[0]!.status).toBe('conflict')
  })

  it('도메인과 용어를 함께 추가하면 term.domainId가 새 프로젝트 도메인 id로 투영된다', () => {
    const model = createEmptyModel()
    const items = [domainItem('sd', '금액'), termItem('st', '주문금액', 'ORD_AMT', 'sd')]
    const plan = planResync(model, LIB, items)
    const next = applyResyncPlan(model, plan, { sd: 'apply', st: 'apply' }, newId)
    const domain = Object.values(next.domains)[0]!
    const term = Object.values(next.terms)[0]!
    expect(term.domainId).toBe(domain.id)
    expect(term.origin!.base).toMatchObject({ domainId: domain.id })
  })

  it('도메인을 빼고 용어만 추가하면 domainId는 null', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [domainItem('sd', '금액'), termItem('st', '주문금액', 'ORD_AMT', 'sd')])
    const next = applyResyncPlan(model, plan, { st: 'apply' }, newId)
    expect(Object.values(next.terms)[0]!.domainId).toBeNull()
    expect(Object.keys(next.domains)).toHaveLength(0)
  })

  it('커스텀 항목 추가는 같은 target 최대 order+1을 받고, 자동 갱신은 order를 보존한다', () => {
    const existing = {
      f0: {
        id: 'f0', name: '기존', target: 'column' as const, type: 'text' as const,
        options: [], required: false, defaultValue: null, order: 4, origin: null,
      },
    }
    const model: ProjectModel = { ...createEmptyModel(), customFields: existing }
    const added = applyResyncPlan(
      model, planResync(model, LIB, [customFieldItem('s1', '비고')]), { s1: 'apply' }, newId)
    const created = Object.values(added.customFields).find((f) => f.name === '비고')!
    expect(created.order).toBe(5)

    const bumped = planResync(added, LIB, [customFieldItem('s1', '비고 수정', 2)])
    const updated = applyResyncPlan(added, bumped, { s1: 'apply' }, newId)
    expect(Object.values(updated.customFields).find((f) => f.id === created.id)!.order).toBe(5)
  })

  it('결과 모델이 무결성을 통과하고 diffModels가 정상 op 배치를 낸다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [domainItem('sd', '금액'), termItem('st', '주문금액', 'ORD_AMT', 'sd')])
    const next = applyResyncPlan(model, plan, { sd: 'apply', st: 'apply' }, newId)
    expect(validateModelIntegrity(next)).toEqual([])
    const ops = diffModels(model, next)
    expect(ops.map((o) => o.entity)).toEqual(['domain', 'term'])   // 부모 우선 순서
    expect(ops.every((o) => o.action === 'create')).toBe(true)
  })

  it('입력 모델을 변경하지 않는다', () => {
    const model = createEmptyModel()
    const plan = planResync(model, LIB, [wordItem('s1', '회원', 'MBR')])
    applyResyncPlan(model, plan, { s1: 'apply' }, newId)
    expect(Object.keys(model.words)).toHaveLength(0)
  })
})

describe('adopt', () => {
  const libWord = (id: string, version: number, payload: Record<string, unknown>) =>
    ({ id, kind: 'word' as const, version, payload })
  function localWord(id: string, abbreviation: string, origin: Origin | null = null) {
    return { id, logicalName: '고객', abbreviation, englishName: null, description: null, origin }
  }

  it('같은 이름의 로컬 항목에 내용은 두고 출처만 붙인다 — base 는 투영된 원본 값', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST')
    const items = [libWord('S1', 4, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })]
    const plan = planResync(m, 'L1', items)
    expect(plan.entries[0]).toMatchObject({ status: 'added', nameClash: true })
    const next = applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused')
    expect(Object.keys(next.words)).toEqual(['w1'])
    expect(next.words['w1']).toMatchObject({ abbreviation: 'CUST' })
    expect(next.words['w1']!.origin).toEqual({
      libraryId: 'L1', sourceId: 'S1', sourceVersion: 4,
      base: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null },
    })
    expect(planResync(next, 'L1', items).entries).toEqual([])   // 곧바로 동기 상태
  })

  it('내용이 다르게 연결된 항목은 원본이 바뀌면 충돌로 뜬다', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CSTMR')
    const v1 = [libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })]
    const adopted = applyResyncPlan(m, planResync(m, 'L1', v1), { S1: 'adopt' }, () => 'unused')
    const v2 = [libWord('S1', 2, { logicalName: '고객', abbreviation: 'CUS', englishName: null, description: null })]
    expect(planResync(adopted, 'L1', v2).entries[0]).toMatchObject({ status: 'conflict' })
  })

  it('같은 배치에서 연결한 도메인을 용어의 base.domainId 가 프로젝트 id 로 가리킨다', () => {
    const m = createEmptyModel()
    m.domains['d1'] = {
      id: 'd1', name: 'NO', category: null, logicalType: 'string',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    m.terms['t1'] = { id: 't1', logicalName: '고객번호', physicalName: 'CUST_NO', domainId: 'd1', description: null, origin: null }
    const items = [
      { id: 'SD', kind: 'domain' as const, version: 1, payload: { name: 'NO', category: null, logicalType: 'string', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null }, defaultValue: null, allowedValues: [], description: null } },
      { id: 'ST', kind: 'term' as const, version: 1, payload: { logicalName: '고객번호', physicalName: 'CUST_NO', domainId: 'SD', description: null } },
    ]
    const next = applyResyncPlan(m, planResync(m, 'L1', items), { SD: 'adopt', ST: 'adopt' }, () => 'unused')
    expect(next.terms['t1']!.origin!.base).toMatchObject({ domainId: 'd1' })
    expect(planResync(next, 'L1', items).entries).toEqual([])
  })

  it('이미 다른 출처가 붙은 항목은 대상이 아니다', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST', { libraryId: 'L0', sourceId: 'X', sourceVersion: 1, base: {} })
    const plan = planResync(m, 'L1', [libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })])
    expect(adoptTargetOf(m, plan.entries[0]!)).toBeNull()
    expect(applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused')).toEqual(m)
  })

  it('후보가 둘이면 id 오름차순 첫 항목에 붙인다', () => {
    const m = createEmptyModel()
    m.words['w2'] = localWord('w2', 'CUST')
    m.words['w1'] = localWord('w1', 'CUST')
    const plan = planResync(m, 'L1', [libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })])
    const next = applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused')
    expect(next.words['w1']!.origin).not.toBeNull()
    expect(next.words['w2']!.origin).toBeNull()
  })

  it('두 원본이 같은 엔티티를 고르면 계획 순서상 먼저 온 쪽만 연결한다', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST')
    const items = [
      libWord('S1', 1, { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null }),
      libWord('S2', 1, { logicalName: '고객', abbreviation: 'CSTMR', englishName: null, description: null }),
    ]
    const plan = planResync(m, 'L1', items)
    expect(plan.entries.map((e) => e.sourceId)).toEqual(['S1', 'S2'])
    const next = applyResyncPlan(m, plan, { S1: 'adopt', S2: 'adopt' }, () => 'unused')
    expect(Object.keys(next.words)).toEqual(['w1'])
    expect(next.words['w1']!.origin).toMatchObject({ sourceId: 'S1' })
    // 밀려난 원본은 연결되지 않은 채 다음 계획에 다시 added 로 뜬다
    expect(planResync(next, 'L1', items).entries)
      .toEqual([expect.objectContaining({ sourceId: 'S2', status: 'added', nameClash: true })])
  })

  it('added 가 아닌 항목의 adopt 는 무시한다(keep 으로 새지 않는다)', () => {
    const m = createEmptyModel()
    m.words['w1'] = localWord('w1', 'CUST', { libraryId: 'L1', sourceId: 'S1', sourceVersion: 1, base: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null } })
    const plan = planResync(m, 'L1', [libWord('S1', 2, { logicalName: '고객', abbreviation: 'CUS', englishName: null, description: null })])
    expect(plan.entries[0]!.status).toBe('auto-update')
    expect(applyResyncPlan(m, plan, { S1: 'adopt' }, () => 'unused').words['w1']!.origin!.sourceVersion).toBe(1)
  })
})
