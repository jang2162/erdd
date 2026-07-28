import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel, type Word } from './model.js'
import { validateModelIntegrity } from './integrity.js'
import { diffModels } from './diff.js'
import { applyResyncPlan, planResync, type LibraryItem } from './resource-sync.js'

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
  const payload = { logicalName, abbreviation, description: null }
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
    const local: Word = { id: 'w9', logicalName: '쿠폰', abbreviation: 'CPN', description: null, origin: null }
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
    const local: Word = { id: 'w9', logicalName: '회원', abbreviation: 'MEM', description: null, origin: null }
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
