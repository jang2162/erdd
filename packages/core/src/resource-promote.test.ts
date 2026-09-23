import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Domain, type ProjectModel, type Term, type Word } from './model.js'
import { applyPromotePlan, danglingDomain, planPromote, type PromoteEntry } from './resource-promote.js'
import { RESOURCE_KINDS } from './resource.js'
import { planResync, type LibraryItem } from './resource-sync.js'
import { diffModels } from './diff.js'
import { validateModelIntegrity } from './integrity.js'

const LIB = 'lib-1'

/** items.create가 zod로 파싱해 저장하는 형태 — 스키마의 모든 키가 들어 있다. */
function wordItem(id: string, logicalName: string, abbreviation: string, version = 1): LibraryItem {
  return {
    id, kind: 'word', version,
    payload: { logicalName, abbreviation, englishName: null, description: null },
  }
}
function domainItem(id: string, name: string, version = 1): LibraryItem {
  return {
    id, kind: 'domain', version,
    payload: {
      name, category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    },
  }
}

function localWord(id: string, logicalName: string, abbreviation: string): Word {
  return { id, logicalName, abbreviation, englishName: null, description: null, origin: null }
}
/** 대상 라이브러리에서 가져온 상태의 단어. base는 가져온 시점 payload다. */
function forkedWord(
  id: string, sourceId: string, logicalName: string, abbreviation: string, sourceVersion = 1,
): Word {
  const base = { logicalName, abbreviation, englishName: null, description: null }
  return { id, ...base, origin: { libraryId: LIB, sourceId, sourceVersion, base } }
}
/** domainItem과 같은 값 — 이 payload가 일치해야 "동기 상태"로 잡힌다. */
function domainPayload(name: string) {
  return {
    name, category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [] as string[], description: null,
  }
}
function localDomain(id: string, name: string): Domain {
  return { id, ...domainPayload(name), origin: null }
}
/** domainItem(sourceId, name)과 payload가 완전히 같은 프로젝트 도메인(= 동기 상태). */
function forkedDomain(id: string, sourceId: string, name: string): Domain {
  const base = domainPayload(name)
  return { id, ...base, origin: { libraryId: LIB, sourceId, sourceVersion: 1, base } }
}
function term(id: string, logicalName: string, physicalName: string, domainId: string | null): Term {
  return { id, logicalName, physicalName, domainId, description: null, origin: null }
}

describe('planPromote — 분류', () => {
  it('링크도 동명도 없으면 new', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({
      kind: 'word', entityId: 'w1', name: '회원', status: 'new',
      targetItemId: null, targetVersion: null, changedFields: [], domainRef: null,
    })
    expect(plan.entries[0]!.payload).toEqual({
      logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null,
    })
    expect(plan.syncedCount).toBe(0)
  })

  it('대상에서 왔고 값이 같으면 목록에서 빠지고 syncedCount로 센다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries).toHaveLength(0)
    expect(plan.syncedCount).toBe(1)
    expect(plan.linkedItemIds).toEqual({ w1: 's1' })
  })

  it('대상에서 왔고 프로젝트가 고쳤으면 update — 바뀐 필드를 싣는다', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR')
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR', 3)])
    expect(plan.entries[0]).toMatchObject({
      status: 'update', targetItemId: 's1', targetVersion: 3, changedFields: ['abbreviation'],
    })
  })

  /**
   * 링크된 엔티티의 payload 비교만으로는 「프로젝트가 고쳤다」와 「원본이 앞서 나갔다」를 가를 수 없다.
   * 원본이 앞선 항목을 그대로 올리면 남이 고친 값이 프로젝트의 옛 값으로 되돌아간다.
   */
  it('로컬 무변경 + 라이브러리가 앞서면 update 이고 sourceBehind 다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: forkedWord('w1', 's1', '고객', 'CSTMR', 2) },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '고객', 'CSTM', 3)])
    expect(plan.entries[0]).toMatchObject({
      status: 'update', targetVersion: 3, changedFields: ['abbreviation'], sourceBehind: true,
    })
  })

  it('로컬 수정 + 라이브러리 그대로면 sourceBehind 가 아니다', () => {
    const forked = forkedWord('w1', 's1', '고객', 'CSTMR', 2)
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'CST' } },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '고객', 'CSTMR', 2)])
    expect(plan.entries[0]).toMatchObject({ status: 'update', sourceBehind: false })
  })

  it('로컬 수정 + 라이브러리 앞섬이면 sourceBehind 다', () => {
    const forked = forkedWord('w1', 's1', '고객', 'CSTMR', 2)
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'CST' } },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '고객', 'CSTM', 3)])
    expect(plan.entries[0]).toMatchObject({ status: 'update', sourceBehind: true })
  })

  it('new·name-match 는 sourceBehind 가 아니다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: localWord('w1', '회원', 'MBR'), w2: localWord('w2', '고객', 'CST') },
    }
    const plan = planPromote(model, LIB, [wordItem('s9', '고객', 'CSTM', 7)])
    expect(plan.entries.map((e) => [e.status, e.sourceBehind])).toEqual([['name-match', false], ['new', false]])
  })

  it('링크는 없고 같은 종류에 같은 이름이 있으면 name-match', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MB') } }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries[0]).toMatchObject({
      status: 'name-match', targetItemId: 's1', targetVersion: 1, changedFields: ['abbreviation'],
    })
  })

  it('링크가 가리키는 원본이 사라졌으면 링크 없음으로 내려간다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: forkedWord('w1', 'gone', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries[0]!.status).toBe('new')
    expect(plan.linkedItemIds).toEqual({})
  })

  it('다른 라이브러리에서 온 항목도 승격 대상이다(상류를 갈아탄다)', () => {
    const other = forkedWord('w1', 's1', '회원', 'MBR')
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: { ...other, origin: { ...other.origin!, libraryId: 'lib-other' } } },
    }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries[0]!.status).toBe('new')
  })

  it('한 원본을 두 항목이 주장하지 못한다 — 먼저 나온 쪽이 선점하고 나머지는 new', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      words: { w1: localWord('w1', '회원', 'MB'), w2: localWord('w2', '회원', 'MEM') },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR')])
    expect(plan.entries.map((e) => [e.entityId, e.status])).toEqual([['w1', 'name-match'], ['w2', 'new']])
  })

  it('동명 선점 판정은 모델 객체의 키 삽입 순서가 아니라 엔티티 id 순서를 따른다', () => {
    // resourceEntitiesOf는 Object.values 순서를 낸다 — DB에서 다시 읽을 때(SELECT에
    // ORDER BY 없음) 이 순서는 보장되지 않는다. 클라(스토어 모델)와 서버(재조회 모델)가
    // 같은 두 엔티티를 반대 순서로 들고 있어도 planPromote는 같은 결과를 내야 한다 —
    // 그렇지 않으면 두 쪽이 서로 다른 엔티티를 선점자로 보고, 재시도해도 영원히
    // plan-changed로 건너뛴다(리뷰가 재현한 무한 skip).
    const later = localWord('id-b-later', '회원', 'MB')     // id 사전식으로 더 큼
    const earlier = localWord('id-a-earlier', '회원', 'MEM') // id 사전식으로 더 작음 → 먼저 나온 것으로 취급돼야 함
    const items = [wordItem('s1', '회원', 'MBR')]

    const modelLaterKeyFirst: ProjectModel = {
      ...createEmptyModel(), words: { 'id-b-later': later, 'id-a-earlier': earlier },
    }
    const modelEarlierKeyFirst: ProjectModel = {
      ...createEmptyModel(), words: { 'id-a-earlier': earlier, 'id-b-later': later },
    }

    const triples = (entries: { entityId: string; status: string; targetItemId: string | null }[]) =>
      entries.map((e) => [e.entityId, e.status, e.targetItemId])

    const planA = planPromote(modelLaterKeyFirst, LIB, items)
    const planB = planPromote(modelEarlierKeyFirst, LIB, items)
    expect(triples(planA.entries)).toEqual(triples(planB.entries))
    expect(triples(planA.entries)).toEqual([
      ['id-a-earlier', 'name-match', 's1'],
      ['id-b-later', 'new', null],
    ])
  })

  it('용어의 도메인이 대상에 링크돼 있으면 라이브러리 항목 id로 역투영한다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: forkedDomain('d1', 'sd', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [domainItem('sd', '금액')])
    expect(plan.syncedCount).toBe(1)                       // 도메인은 동기 상태라 목록에서 빠진다
    const entry = plan.entries[0]!
    expect(entry.kind).toBe('term')
    expect(entry.payload.domainId).toBe('sd')
    expect(entry.domainRef).toEqual({ entityId: 'd1', targetItemId: 'sd' })
  })

  it('도메인이 대상에 없으면 domainId를 비우고 domainRef.targetItemId가 null이다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    const entry = plan.entries.find((e) => e.kind === 'term')!
    expect(entry.payload.domainId).toBeNull()
    expect(entry.domainRef).toEqual({ entityId: 'd1', targetItemId: null })
  })

  it('domainId가 모델에 없는 용어는 domainRef가 null이다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(), terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'ghost') },
    }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries[0]!.domainRef).toBeNull()
    expect(plan.entries[0]!.payload.domainId).toBeNull()
  })

  it('종류 순서(도메인→단어→용어→커스텀 항목) 다음 이름 순으로 정렬한다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      words: { w2: localWord('w2', '주문', 'ORD'), w1: localWord('w1', '회원', 'MBR') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', null) },
      customFields: {
        f1: {
          id: 'f1', name: '비고', target: 'table', type: 'text',
          options: [], required: false, defaultValue: null, order: 0, origin: null,
        },
      },
    }
    const plan = planPromote(model, LIB, [])
    expect(plan.entries.map((e) => e.kind)).toEqual(['domain', 'word', 'word', 'term', 'customField'])
    expect(plan.entries.map((e) => e.name)).toEqual(['금액', '주문', '회원', '주문금액', '비고'])
  })

  it('모든 리소스 종류를 승격 대상으로 다룬다(완전성)', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      words: { w1: localWord('w1', '회원', 'MBR') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', null) },
      customFields: {
        f1: {
          id: 'f1', name: '비고', target: 'table', type: 'text',
          options: [], required: false, defaultValue: null, order: 0, origin: null,
        },
      },
    }
    const kinds = new Set(planPromote(model, LIB, []).entries.map((e) => e.kind))
    expect([...kinds].sort()).toEqual([...RESOURCE_KINDS].sort())
  })
})

/** 테스트마다 1부터 다시 세는 id 발급기 — 단언이 호출 순서에 흔들리지 않는다. */
function makeNewId(): () => string {
  let n = 0
  return () => `item-${++n}`
}

describe('applyPromotePlan', () => {
  it('선택이 비면 입력 모델을 그대로 돌려주고 write가 없다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const out = applyPromotePlan(model, plan, new Set(), makeNewId())
    expect(out.writes).toEqual([])
    expect(out.nextModel).toBe(model)
  })

  it('new는 insert write와 origin 부여를 낸다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    const payload = { logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null }
    expect(writes).toEqual([{ mode: 'insert', itemId: 'item-1', kind: 'word', payload, version: 1 }])
    expect(nextModel.words.w1!.origin).toEqual({
      libraryId: LIB, sourceId: 'item-1', sourceVersion: 1, base: payload,
    })
  })

  it('update는 targetVersion + 1로 올린다', () => {
    const forked = forkedWord('w1', 's1', '회원', 'MBR')
    const model: ProjectModel = {
      ...createEmptyModel(), words: { w1: { ...forked, abbreviation: 'MB' } },
    }
    const plan = planPromote(model, LIB, [wordItem('s1', '회원', 'MBR', 3)])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    expect(writes).toEqual([{
      mode: 'update', itemId: 's1', kind: 'word', version: 4,
      payload: { logicalName: '회원', abbreviation: 'MB', englishName: null, description: null },
    }])
    expect(nextModel.words.w1!.origin!.sourceVersion).toBe(4)
  })

  it('origin 외의 엔티티 필드는 절대 바꾸지 않는다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    expect({ ...nextModel.words.w1!, origin: null }).toEqual({ ...model.words.w1! })
  })

  it('diffModels가 origin 하나만 바꾸는 update op를 낸다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    const ops = diffModels(model, nextModel)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.action).toBe('update')
    expect(ops[0]!.entity).toBe('word')
    expect(Object.keys((ops[0] as { changes: Record<string, unknown> }).changes)).toEqual(['origin'])
    expect(validateModelIntegrity(nextModel)).toEqual([])
  })

  it('승격 직후 같은 라이브러리로 재동기화하면 그 항목은 동기 상태다 (두 엔진의 왕복)', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    const promoted: LibraryItem[] = writes.map((w) => ({
      id: w.itemId, kind: w.kind, version: w.version, payload: w.payload,
    }))
    const resync = planResync(nextModel, LIB, promoted)
    expect(resync.entries).toHaveLength(0)
    // keptSynced는 sourceVersion==version 장부 일치만 본다 — planResync는 버전이 같으면
    // base를 비교하지 않고 곧장 "동기"로 판정하므로 이 단언은 base의 내용을 검증하지 못한다.
    expect(resync.keptSynced).toBe(1)

    // base가 실제로 옳은지는 원본이 그 뒤에 갱신돼야 드러난다 — 버전이 갈라지면
    // planResync는 버전 분기를 지나 deepEqual(link.payload, origin.base)로 판정한다.
    // 프로젝트 쪽은 그대로이므로 base가 맞다면 auto-update, 틀리면 conflict가 나온다.
    const bumped: LibraryItem[] = promoted.map((item) => (
      { ...item, version: item.version + 1, payload: { ...item.payload, englishName: 'MEMBER' } }
    ))
    expect(planResync(nextModel, LIB, bumped).entries[0]!.status).toBe('auto-update')
  })

  it('도메인을 함께 승격하면 용어가 새 라이브러리 항목을 참조하고 base는 프로젝트 도메인 id다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['d1', 't1']), makeNewId())
    const domainWrite = writes.find((w) => w.kind === 'domain')!
    const termWrite = writes.find((w) => w.kind === 'term')!
    expect(termWrite.payload.domainId).toBe(domainWrite.itemId)
    expect(nextModel.terms.t1!.origin!.base).toMatchObject({ domainId: 'd1' })

    // 왕복: 승격 결과를 그대로 재동기화하면 둘 다 동기 상태다(버전 장부만 검증 — 위 주석 참고)
    const promoted: LibraryItem[] = writes.map((w) => ({
      id: w.itemId, kind: w.kind, version: w.version, payload: w.payload,
    }))
    expect(planResync(nextModel, LIB, promoted).keptSynced).toBe(2)

    // base 내용을 실제로 검증: 용어 원본만 그 뒤에 갱신되면 버전 분기를 지나 base와
    // 비교한다. 프로젝트 쪽 용어·도메인은 그대로이므로 auto-update여야 한다.
    const bumpedTerm: LibraryItem[] = promoted.map((item) => (
      item.id === termWrite.itemId
        ? { ...item, version: item.version + 1, payload: { ...item.payload, description: '설명 추가' } }
        : item
    ))
    expect(planResync(nextModel, LIB, bumpedTerm).entries[0]!.status).toBe('auto-update')
  })

  it('계획 이후 도메인 엔티티가 삭제되면 함께 선택된 용어에 유령 id가 남지 않는다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    // 계획을 세운 뒤 적용 직전에 도메인 엔티티가 사라진 상황(동시 편집)을 재현한다.
    const modelWithoutDomain: ProjectModel = { ...model, domains: {} }
    const { writes, nextModel } = applyPromotePlan(
      modelWithoutDomain, plan, new Set(['d1', 't1']), makeNewId())
    expect(writes.some((w) => w.kind === 'domain')).toBe(false)
    const termWrite = writes.find((w) => w.kind === 'term')!
    expect(termWrite.payload.domainId).toBeNull()
    expect(nextModel.terms.t1!.origin!.base).toMatchObject({ domainId: null })
  })

  it('도메인을 빼고 용어만 승격하면 연결이 비고, 다음 원본 변경은 auto-update가 아니라 conflict다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      domains: { d1: localDomain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'ORD_AMT', 'd1') },
    }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['t1']), makeNewId())
    const termWrite = writes[0]!
    expect(termWrite.payload.domainId).toBeNull()
    expect(nextModel.terms.t1!.origin!.base).toMatchObject({ domainId: null })

    const bumped: LibraryItem[] = [{
      id: termWrite.itemId, kind: 'term', version: 2,
      payload: { ...termWrite.payload, physicalName: 'ORD_AMOUNT' },
    }]
    expect(planResync(nextModel, LIB, bumped).entries[0]!.status).toBe('conflict')
  })

  it('커스텀 항목의 order는 payload에서 빠지고 프로젝트 값은 보존된다', () => {
    const model: ProjectModel = {
      ...createEmptyModel(),
      customFields: {
        f1: {
          id: 'f1', name: '비고', target: 'table', type: 'text',
          options: [], required: false, defaultValue: null, order: 4, origin: null,
        },
      },
    }
    const plan = planPromote(model, LIB, [])
    const { writes, nextModel } = applyPromotePlan(model, plan, new Set(['f1']), makeNewId())
    expect(writes[0]!.payload).not.toHaveProperty('order')
    expect(nextModel.customFields.f1!.order).toBe(4)
  })

  it('입력 모델을 변경하지 않는다', () => {
    const model: ProjectModel = { ...createEmptyModel(), words: { w1: localWord('w1', '회원', 'MBR') } }
    const before = structuredClone(model)
    const plan = planPromote(model, LIB, [])
    applyPromotePlan(model, plan, new Set(['w1']), makeNewId())
    expect(model).toEqual(before)
  })
})

describe('danglingDomain', () => {
  function entry(over: Partial<PromoteEntry> & Pick<PromoteEntry, 'entityId' | 'status'>): PromoteEntry {
    return {
      kind: 'word', name: '이름', targetItemId: null, targetVersion: null,
      payload: {}, changedFields: [], domainRef: null, sourceBehind: false, ...over,
    }
  }
  const term = entry({
    entityId: 't1', status: 'new', kind: 'term',
    domainRef: { entityId: 'd1', targetItemId: null },
  })

  it('도메인이 라이브러리에 없고 함께 선택되지도 않으면 연결이 빈다', () => {
    expect(danglingDomain(term, new Set(['t1']))).toBe(true)
  })

  it('도메인을 함께 선택하면 연결된다', () => {
    expect(danglingDomain(term, new Set(['t1', 'd1']))).toBe(false)
  })

  it('도메인이 이미 라이브러리에 있으면 선택과 무관하다', () => {
    const linked = entry({
      entityId: 't1', status: 'new', kind: 'term',
      domainRef: { entityId: 'd1', targetItemId: 'sd' },
    })
    expect(danglingDomain(linked, new Set(['t1']))).toBe(false)
  })

  it('도메인 참조가 없으면 false', () => {
    expect(danglingDomain(entry({ entityId: 'w1', status: 'new' }), new Set(['w1']))).toBe(false)
  })
})
