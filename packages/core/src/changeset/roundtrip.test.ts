import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Column, type ProjectModel } from '../model.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from '../naming.js'
import { deleteColumnCascade, deleteRelationship, deleteTableCascade } from '../relationship.js'
import { projectSchema } from './projection.js'
import { diffProjection } from './diff.js'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import { applyChangeset } from './replay.js'
import { CHANGESET_FORMAT, emptyProjection } from './types.js'

/**
 * 왕복 불변식 — 재생이 기준선의 유일한 원천이므로(guide 「재생은 `@id` 로 대상을 찾는다」)
 * 「a → b 기록을 직렬화·파싱해 a 에 적용하면 b 가 된다」가 깨지면 모든 기준선이 조용히 틀린다.
 * 무작위 편집을 시드 고정으로 돌린다.
 */

type State = { model: ProjectModel; rules: NamingRules }
const DIALECTS = ['postgresql', 'mysql'] as const

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const TYPES = ['VARCHAR(10)', 'VARCHAR(20)', 'BIGINT', 'INT UNSIGNED', 'DECIMAL(10, 2)', 'CHAR(1)']
const DEFAULTS = [null, "'Y'", 'CURRENT_TIMESTAMP', "it's `x`\\n"]
const COMMENTS = [null, '설명', "따옴표'와\n줄바꿈"]

function initial(): ProjectModel {
  const m = createEmptyModel()
  m.domains['d1'] = {
    id: 'd1', name: '코드', category: null, logicalType: 'VARCHAR(10)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
  return m
}

function mutate(state: State, rand: () => number, counter: { n: number }): State {
  let m: ProjectModel = structuredClone(state.model)
  let rules = state.rules
  const pick = <T,>(xs: readonly T[]): T | undefined => (xs.length === 0 ? undefined : xs[Math.floor(rand() * xs.length)])
  const fresh = (p: string) => { counter.n += 1; return `${p}${counter.n}` }
  const tables = () => Object.values(m.tables)
  const cols = (tid: string) => Object.values(m.columns).filter((c) => c.tableId === tid).sort((a, b) => a.order - b.order)
  const renumber = (list: Column[]) => list.forEach((c, i) => { m.columns[c.id] = { ...m.columns[c.id]!, order: i } })
  const newColumn = (tid: string): Column => ({
    id: fresh('c'), tableId: tid, logicalName: '', physicalName: fresh('COL_'), type: pick(TYPES)!,
    isPk: false, autoIncrement: false, nullable: rand() < 0.5, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  })

  switch (Math.floor(rand() * 15)) {
    case 0: {
      const id = fresh('t')
      m.tables[id] = { id, logicalName: '', physicalName: fresh('TB_'), comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
      const n = 1 + Math.floor(rand() * 3)
      for (let i = 0; i < n; i += 1) {
        const c = { ...newColumn(id), order: i }
        if (i === 0) Object.assign(c, { isPk: true, type: 'BIGINT', nullable: false, autoIncrement: rand() < 0.5 })
        m.columns[c.id] = c
      }
      break
    }
    case 1: { const t = pick(tables()); if (t) m = deleteTableCascade(m, t.id); break }
    case 2: { const t = pick(tables()); if (t) m.tables[t.id] = { ...t, physicalName: fresh('RN_') }; break }
    case 3: {
      const t = pick(tables())
      if (t) {
        const list = cols(t.id)
        const c = newColumn(t.id)
        m.columns[c.id] = c
        list.splice(Math.floor(rand() * (list.length + 1)), 0, c)
        renumber(list)
      }
      break
    }
    case 4: { const c = pick(Object.values(m.columns)); if (c) m = deleteColumnCascade(m, c.id); break }
    case 5: { const c = pick(Object.values(m.columns)); if (c) m.columns[c.id] = { ...c, physicalName: fresh('RC_') }; break }
    case 6: {
      const c = pick(Object.values(m.columns))
      if (c) {
        const next = { ...c }
        switch (Math.floor(rand() * 7)) {
          case 0: next.type = pick(TYPES)!; break
          case 1: next.nullable = !c.nullable; break
          case 2: next.defaultValue = pick(DEFAULTS)!; break
          case 3: next.comment = pick(COMMENTS)!; break
          case 4: next.isPk = !c.isPk; break
          case 5: next.autoIncrement = !c.autoIncrement; break
          case 6: next.domainId = c.domainId === null ? 'd1' : null; break
        }
        m.columns[c.id] = next
      }
      break
    }
    case 7: {
      const t = pick(tables())
      if (t) {
        const list = cols(t.id)
        if (list.length > 1) {
          const [moved] = list.splice(Math.floor(rand() * list.length), 1)
          list.splice(Math.floor(rand() * (list.length + 1)), 0, moved!)
          renumber(list)
        }
      }
      break
    }
    case 8: {
      const t = pick(tables())
      const list = t ? cols(t.id) : []
      if (t && list.length > 0) {
        const chosen = list.filter(() => rand() < 0.6)
        const id = fresh('i')
        m.indexes[id] = {
          id, tableId: t.id, name: fresh('IX_'),
          columns: (chosen.length > 0 ? chosen : [list[0]!]).map((c) => ({ columnId: c.id, direction: rand() < 0.5 ? 'asc' as const : 'desc' as const })),
          unique: rand() < 0.5,
        }
      }
      break
    }
    case 9: {
      const ix = pick(Object.values(m.indexes))
      if (ix) {
        const r = rand()
        if (r < 0.33) delete m.indexes[ix.id]
        else if (r < 0.66) m.indexes[ix.id] = { ...ix, name: fresh('IX_') }
        else m.indexes[ix.id] = { ...ix, unique: !ix.unique }
      }
      break
    }
    case 10: {
      const child = pick(tables())
      const parent = pick(tables())
      const cc = child ? pick(cols(child.id)) : undefined
      const pc = parent ? pick(cols(parent.id)) : undefined
      if (child && parent && cc && pc) {
        const id = fresh('r')
        m.relationships[id] = {
          id, parentTableId: parent.id, childTableId: child.id,
          columnMappings: [{ childColumnId: cc.id, parentColumnId: pc.id }],
          cardinality: rand() < 0.5 ? '1:1' : '1:N', identifying: false, name: rand() < 0.5 ? null : fresh('FK_'),
        }
      }
      break
    }
    case 11: { const r = pick(Object.values(m.relationships)); if (r) m = deleteRelationship(m, r.id); break }
    case 12: {
      const d = m.domains['d1']!
      m.domains['d1'] = {
        ...d, logicalType: pick(TYPES)!,
        dialectTypes: { ...d.dialectTypes, postgresql: rand() < 0.5 ? null : 'TEXT' },
        allowedValues: rand() < 0.5 ? [] : ['Y', 'N'], defaultValue: pick(DEFAULTS)!,
      }
      break
    }
    case 13: { rules = { ...rules, tablePhysicalTemplate: rules.tablePhysicalTemplate === '' ? 'X_{물리명}' : '' }; break }
    case 14: {
      const t = pick(tables())
      if (t) m.tables[t.id] = { ...t, comment: pick(COMMENTS)!, logicalName: pick(['', '회원', '주문 상세'])! }
      break
    }
  }
  return { model: m, rules }
}

describe('왕복 불변식 — 기록을 쌓아 재생하면 매 시점의 투영이 된다', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('시드 %i', (seed) => {
    const rand = rng(seed)
    const counter = { n: 0 }
    let state: State = { model: initial(), rules: DEFAULT_NAMING_RULES }
    const replayed = emptyProjection()
    for (let step = 0; step < 60; step += 1) {
      let next = state
      const edits = 1 + Math.floor(rand() * 4)
      for (let e = 0; e < edits; e += 1) next = mutate(next, rand, counter)
      const a = projectSchema(state.model, { rules: state.rules, dialects: DIALECTS })
      const b = projectSchema(next.model, { rules: next.rules, dialects: DIALECTS })
      const d = diffProjection(a, b)
      if (!d.ok) throw new Error(`시드 ${seed} 단계 ${step}: ${d.message}`)
      const text = formatChangeset({ header: { format: CHANGESET_FORMAT, name: `s${step}`, created: '2026-09-23T00:00:00Z', baseline: false }, statements: d.statements })
      const parsed = parseChangeset(text)
      if (!parsed.ok) throw new Error(`시드 ${seed} 단계 ${step} ${parsed.line}행: ${parsed.message}\n${text}`)
      expect(applyChangeset(replayed, parsed.changeset)).toEqual([])
      expect(replayed).toEqual(b)
      state = next
    }
  })
})
