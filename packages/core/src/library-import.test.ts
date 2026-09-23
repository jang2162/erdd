import { describe, expect, it } from 'vitest'
import { exportLibraryFile, parseLibraryFile, type LibraryFileDoc } from './library-file.js'
import {
  materializeLibraryImport, planLibraryImport, summarizeLibraryImport, type LibraryImportPlan,
} from './library-import.js'
import type { LibraryItem } from './resource-sync.js'

const LIB = 'lib-1'
const word = (id: string, logicalName: string, abbreviation: string, version = 1, extra: Record<string, unknown> = {}): LibraryItem =>
  ({ id, kind: 'word', version, payload: { logicalName, abbreviation, englishName: null, description: null, ...extra } })
const domain = (id: string, name: string, version = 1): LibraryItem => ({
  id, kind: 'domain', version,
  payload: { name, category: null, logicalType: 'VARCHAR(10)', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null }, defaultValue: null, allowedValues: [], description: null },
})
const term = (id: string, logicalName: string, domainId: string | null, version = 1): LibraryItem =>
  ({ id, kind: 'term', version, payload: { logicalName, physicalName: logicalName.toUpperCase(), domainId, description: null } })

const source = (kinds: LibraryFileDoc['kinds'], id?: string): LibraryFileDoc =>
  ({ library: { ...(id !== undefined ? { id } : {}), name: '파일', description: '' }, kinds })
const statusOf = (plan: LibraryImportPlan) => plan.entries.map((e) => `${e.status}:${e.name}`)
let seq = 0
const newId = () => `new-${++seq}`

describe('planLibraryImport — 매칭', () => {
  it('같은 라이브러리 id 면 항목 id 로 매칭한다(이름이 바뀌어도)', () => {
    const plan = planLibraryImport([word('w1', '고객', 'CUST')],
      source({ word: [{ id: 'w1', version: 1, fields: { logicalName: '손님', abbreviation: 'CUST' } }] }, LIB), LIB)
    expect(plan.entries).toEqual([expect.objectContaining({ status: 'update', targetId: 'w1', changedFields: ['logicalName'] })])
  })

  it('다른 라이브러리 id 면 id 를 보지 않고 이름으로 매칭한다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'CUST')],
      source({ word: [{ id: 'w1', version: 1, fields: { logicalName: '손님', abbreviation: 'CUST' } }] }, 'other'), LIB)
    expect(statusOf(plan)).toEqual(['add:손님', 'remove:고객'])
  })

  it('id 매칭이 먼저 자리를 차지하고 이름 매칭은 남은 항목만 본다', () => {
    const existing = [word('w1', '고객', 'A'), word('w2', '고객2', 'B')]
    const plan = planLibraryImport(existing, source({ word: [
      { fields: { logicalName: '고객', abbreviation: 'X' } },           // 이름으로는 w1 이지만
      { id: 'w1', version: 1, fields: { logicalName: '고객', abbreviation: 'A' } },   // w1 은 id 매칭이 가져간다
    ] }, LIB), LIB)
    expect(plan.entries.map((e) => [e.status, e.targetId])).toEqual([['add', null], ['unchanged', 'w1'], ['remove', 'w2']])
  })

  it('기존 동명이 여럿이면 먼저 만든(existing 순서) 항목과 맞추고 경고한다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'A'), word('w2', '고객', 'B')],
      source({ word: [{ fields: { logicalName: '고객', abbreviation: 'A' } }] }), LIB)
    expect(plan.entries[0]).toMatchObject({ status: 'unchanged', targetId: 'w1' })
    expect(plan.warnings).toEqual([expect.stringContaining('같은 이름이 2개')])
  })

  it('커스텀 항목은 target 까지 같아야 매칭한다', () => {
    const cf = (id: string, target: string): LibraryItem =>
      ({ id, kind: 'customField', version: 1, payload: { name: '비고', target, type: 'text', options: [], required: false, defaultValue: null } })
    const plan = planLibraryImport([cf('c1', 'table')],
      source({ customField: [{ fields: { name: '비고', target: 'column', type: 'text' } }] }), LIB)
    expect(statusOf(plan)).toEqual(['add:비고', 'remove:비고'])
  })
})

describe('planLibraryImport — 병합·상태', () => {
  it('적힌 키만 덮는다 — 빠진 키의 기존 값은 그대로(Excel 컬럼 누락)', () => {
    const plan = planLibraryImport([word('w1', '고객', 'CUST', 1, { englishName: 'CUSTOMER', description: '설명' })],
      source({ word: [{ fields: { logicalName: '고객', abbreviation: 'CSTMR' } }] }), LIB)
    expect(plan.entries[0]).toMatchObject({
      status: 'update', changedFields: ['abbreviation'],
      payload: { logicalName: '고객', abbreviation: 'CSTMR', englishName: 'CUSTOMER', description: '설명' },
    })
  })

  it('dialectTypes 는 한 단계 병합한다', () => {
    const plan = planLibraryImport([domain('d1', '코드')],
      source({ domain: [{ fields: { name: '코드', logicalType: 'VARCHAR(10)', dialectTypes: { mysql: 'varchar(10)' } } }] }), LIB)
    expect(plan.entries[0]!.payload.dialectTypes).toEqual({ postgresql: null, mysql: 'varchar(10)', oracle: null, mssql: null })
  })

  it('add 는 기본값 위에 적힌 키를 얹는다', () => {
    const plan = planLibraryImport([], source({ word: [{ fields: { logicalName: '고객' } }] }), LIB)
    expect(plan.entries[0]).toMatchObject({ status: 'add', payload: { logicalName: '고객', abbreviation: '', englishName: null, description: null } })
  })

  it('stale — id 매칭이고 파일 버전이 서버보다 낮고 내용이 다를 때만', () => {
    const existing = [word('w1', '고객', 'NEW', 4), word('w2', '주문', 'ORD', 4)]
    const plan = planLibraryImport(existing, source({ word: [
      { id: 'w1', version: 2, fields: { logicalName: '고객', abbreviation: 'OLD' } },
      { id: 'w2', version: 2, fields: { logicalName: '주문', abbreviation: 'ORD' } },     // 내용 같으면 unchanged
    ] }, LIB), LIB)
    expect(plan.entries.map((e) => e.status)).toEqual(['stale', 'unchanged'])
  })

  it('이름 매칭은 파일 version 이 낮아도 stale 이 아니다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'NEW', 4)],
      source({ word: [{ id: 'x', version: 1, fields: { logicalName: '고객', abbreviation: 'OLD' } }] }, 'other'), LIB)
    expect(plan.entries[0]!.status).toBe('update')
  })

  it('내보낸 파일을 그대로 다시 가져오면 전부 unchanged 다', () => {
    const existing = [domain('d1', '금액', 3), word('w1', '고객', 'CUST', 2), term('t1', '고객금액', 'd1', 5)]
    const parsed = parseLibraryFile(exportLibraryFile({ id: LIB, name: 'x', description: '' }, existing).text, 'source')
    if (!parsed.ok) throw new Error('parse')
    const plan = planLibraryImport(existing, parsed.doc, LIB)
    expect(plan.entries.every((e) => e.status === 'unchanged')).toBe(true)
    expect(materializeLibraryImport(plan, { prune: true, includeStale: true }, newId))
      .toEqual({ inserts: [], updates: [], removes: [] })
  })

  it('다른 라이브러리에서 온 파일도 재매핑 뒤 같으면 unchanged 다(용어의 도메인 참조)', () => {
    const existing = [domain('d1', '금액'), term('t1', '금액합계', 'd1')]
    const plan = planLibraryImport(existing, source({
      domain: [{ id: 'fd', fields: { name: '금액', logicalType: 'VARCHAR(10)' } }],
      term: [{ fields: { logicalName: '금액합계', physicalName: '금액합계'.toUpperCase(), domainId: 'fd' } }],
    }, 'other'), LIB)
    expect(plan.entries.map((e) => e.status)).toEqual(['unchanged', 'unchanged'])
  })
})

describe('planLibraryImport — 용어의 도메인', () => {
  it('새로 추가될 도메인은 자리표시로 가리키고 materialize 가 같은 id 로 푼다', () => {
    const plan = planLibraryImport([], source({
      domain: [{ id: 'fd', fields: { name: '금액', logicalType: 'DECIMAL' } }],
      term: [{ fields: { logicalName: '금액합계', physicalName: 'AMT_SUM', domainId: 'fd' } }],
    }), LIB)
    const writes = materializeLibraryImport(plan, { prune: false, includeStale: false }, newId)
    const dom = writes.inserts.find((i) => i.kind === 'domain')!
    expect(writes.inserts.find((i) => i.kind === 'term')!.payload.domainId).toBe(dom.id)
  })

  it('domainName 은 파일 도메인 → 대상 라이브러리 도메인 순으로 찾고, 없으면 비우고 경고한다', () => {
    const existing = [domain('d1', '식별번호'), term('t1', '고객번호', 'd1')]
    const plan = planLibraryImport(existing, source({ term: [
      { domainName: '식별번호', fields: { logicalName: '고객번호', physicalName: '고객번호'.toUpperCase() } },
      { domainName: '없는도메인', fields: { logicalName: '주문번호', physicalName: 'ORD_NO' } },
    ] }), LIB)
    expect(plan.entries[0]).toMatchObject({ status: 'unchanged' })
    expect(plan.entries[1]!.payload.domainId).toBeNull()
    expect(plan.warnings).toEqual([expect.stringContaining('없는도메인')])
  })

  it('용어가 도메인을 말하지 않으면(domainId·domainName 둘 다 없음) 기존 연결을 건드리지 않는다', () => {
    const plan = planLibraryImport([domain('d1', '식별번호'), term('t1', '고객번호', 'd1')],
      source({ term: [{ fields: { logicalName: '고객번호', physicalName: 'CUST_NO' } }] }), LIB)
    expect(plan.entries[0]!.payload.domainId).toBe('d1')
  })
})

describe('planLibraryImport — 삭제', () => {
  it('종류 키가 없으면 그 종류는 삭제 후보가 아니고, [] 면 후보다', () => {
    const existing = [word('w1', '고객', 'C'), domain('d1', '금액')]
    expect(statusOf(planLibraryImport(existing, source({ word: [] }), LIB))).toEqual(['remove:고객'])
  })

  it('남는 용어가 가리키는 도메인은 지우지 않고 경고한다', () => {
    const existing = [domain('d1', '금액'), term('t1', '금액합계', 'd1')]
    const plan = planLibraryImport(existing, source({ domain: [] }), LIB)   // 용어는 말하지 않음 = 남는다
    expect(plan.entries).toEqual([expect.objectContaining({ status: 'remove', targetId: 'd1', referencedBy: 1 })])
    expect(plan.warnings).toEqual([expect.stringContaining('금액')])
    expect(materializeLibraryImport(plan, { prune: true, includeStale: false }, newId).removes).toEqual([])
  })

  it('prune 이 아니면 아무것도 지우지 않는다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'C')], source({ word: [] }), LIB)
    expect(materializeLibraryImport(plan, { prune: false, includeStale: false }, newId).removes).toEqual([])
    expect(materializeLibraryImport(plan, { prune: true, includeStale: false }, newId).removes).toEqual(['w1'])
  })
})

describe('materializeLibraryImport', () => {
  it('update 는 version + 1, stale 은 includeStale 일 때만', () => {
    const plan = planLibraryImport([word('w1', '고객', 'NEW', 4), word('w2', '주문', 'ORD', 1)], source({ word: [
      { id: 'w1', version: 2, fields: { logicalName: '고객', abbreviation: 'OLD' } },
      { id: 'w2', version: 1, fields: { logicalName: '주문', abbreviation: 'ORDER' } },
    ] }, LIB), LIB)
    expect(materializeLibraryImport(plan, { prune: false, includeStale: false }, newId).updates.map((u) => [u.id, u.version])).toEqual([['w2', 2]])
    expect(materializeLibraryImport(plan, { prune: false, includeStale: true }, newId).updates.map((u) => [u.id, u.version])).toEqual([['w1', 5], ['w2', 2]])
  })
})

describe('summarizeLibraryImport', () => {
  it('unchanged 는 건수만, 나머지는 필드별 전후 값과 함께', () => {
    const existing = [word('w1', '고객', 'CUST'), word('w2', '주문', 'ORD')]
    const plan = planLibraryImport(existing, source({ word: [
      { fields: { logicalName: '고객', abbreviation: 'CSTMR' } }, { fields: { logicalName: '주문', abbreviation: 'ORD' } },
    ] }), LIB)
    const summary = summarizeLibraryImport(plan, existing)
    expect(summary.counts).toMatchObject({ update: 1, unchanged: 1, add: 0, remove: 0, stale: 0, removeBlocked: 0 })
    expect(summary.entries).toEqual([expect.objectContaining({
      status: 'update', name: '고객', changes: [{ field: 'abbreviation', from: 'CUST', to: 'CSTMR' }],
    })])
  })

  it('용어의 도메인 변경은 id 가 아니라 도메인 이름으로 보인다', () => {
    const existing = [domain('d1', '금액'), term('t1', '합계', 'd1')]
    const plan = planLibraryImport(existing, source({
      domain: [{ id: 'fd', fields: { name: '수량', logicalType: 'INT' } }],
      term: [{ fields: { logicalName: '합계', physicalName: '합계'.toUpperCase(), domainId: 'fd' } }],
    }), LIB)
    const change = summarizeLibraryImport(plan, existing).entries.find((e) => e.kind === 'term')!.changes[0]
    expect(change).toEqual({ field: 'domainId', from: '금액', to: '수량' })
  })
})
