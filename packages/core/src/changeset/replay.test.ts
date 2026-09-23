import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { deleteColumnCascade } from '../relationship.js'
import type { Column, ProjectModel } from '../model.js'
import { projectSchema } from './projection.js'
import { diffProjection } from './diff.js'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import { applyChangeset, replay } from './replay.js'
import { emptyProjection, type Changeset, type SchemaProjection } from './types.js'

const S = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }
const proj = (m: ProjectModel) => projectSchema(m, S)

/** a → b 의 기록을 직렬화했다가 되읽는다(실제 파일과 같은 길을 지나게). */
function changesetOf(a: SchemaProjection, b: ProjectModel, name = 'x'): Changeset {
  const r = diffProjection(a, proj(b))
  if (!r.ok) throw new Error(r.message)
  const parsed = parseChangeset(formatChangeset({ header: { format: 1, name, created: '2026-09-23T00:00:00Z', baseline: false }, statements: r.statements }))
  if (!parsed.ok) throw new Error(`${parsed.line}: ${parsed.message}`)
  return parsed.changeset
}
const withColumn = (m: ProjectModel, id: string, patch: Partial<Column>): ProjectModel => {
  const next = structuredClone(m)
  next.columns[id] = { ...next.columns[id]!, ...patch }
  return next
}
const HEAD = "changeset 'x' {\n  format: 1\n  created: '2026-01-01T00:00:00Z'\n}\n"

describe('replay', () => {
  it('빈 투영에서 샘플까지 재생하면 샘플의 투영이 된다', () => {
    const r = replay([{ file: 'a', changeset: changesetOf(emptyProjection(), buildSampleModel()) }])
    expect(r.error).toBeNull()
    expect(r.projection).toEqual(proj(buildSampleModel()))
  })

  it('넘긴 순서가 아니라 파일명 순으로 재생한다', () => {
    const base = buildSampleModel()
    const next = withColumn(base, 'c3', { type: 'VARCHAR(200)' })
    const r0 = changesetOf(emptyProjection(), base)
    const r1 = changesetOf(proj(base), next)
    const r = replay([{ file: 'b', changeset: r1 }, { file: 'a', changeset: r0 }])
    expect(r.error).toBeNull()
    expect(r.projection).toEqual(proj(next))
  })

  it('같은 속성을 두 기록이 다른 전제로 바꾸면 경고하고, 뒤 기록의 이후 값으로 계속한다', () => {
    const base = buildSampleModel()
    const a = withColumn(base, 'c3', { type: 'VARCHAR(200)' })
    const b = withColumn(base, 'c3', { type: 'VARCHAR(300)' })
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2', changeset: changesetOf(proj(base), a) },
      { file: '3', changeset: changesetOf(proj(base), b) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatchObject({ file: '3', message: 'MBR.MBR_NM type 의 이전 값이 VARCHAR(100) 이(가) 아니라 VARCHAR(200) 입니다' })
    expect(r.warnings[0]!.line).toEqual(expect.any(Number))
    expect(r.projection.columns['c3']!.type).toBe('VARCHAR(300)')
  })

  it('개명과 수정이 다른 기록에서 교차해도 @id 로 정확히 재생한다', () => {
    const base = buildSampleModel()
    const renamed = withColumn(base, 'c3', { physicalName: 'MBR_NAME' })
    const nullable = withColumn(base, 'c3', { nullable: true })
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2', changeset: changesetOf(proj(base), renamed) },
      { file: '3', changeset: changesetOf(proj(base), nullable) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings).toEqual([])
    expect(r.projection.columns['c3']).toMatchObject({ name: 'MBR_NAME', nullable: true })
  })

  it('두 컬럼의 이름을 맞바꿔도 재생 결과가 같다', () => {
    const base = buildSampleModel()
    const swapped = withColumn(withColumn(base, 'c3', { physicalName: 'GRD_CD' }), 'c4', { physicalName: 'MBR_NM' })
    const p = proj(base)
    expect(applyChangeset(p, changesetOf(proj(base), swapped))).toEqual([])
    expect(p).toEqual(proj(swapped))
  })

  it('after 는 최종 순서의 바로 앞 컬럼이다 — 추가·이동 문장의 순서를 뒤집어도 결과가 같다', () => {
    const base = buildSampleModel()
    const next = structuredClone(base)
    next.columns['c9'] = { ...next.columns['c3']!, id: 'c9', physicalName: 'NEW_A', order: -2 }
    next.columns['c4'] = { ...next.columns['c4']!, order: -1 }
    next.columns['c8'] = { ...next.columns['c3']!, id: 'c8', physicalName: 'NEW_B', order: 9 }
    delete next.indexes['i1']
    const cs = changesetOf(proj(base), next)
    const reversed = structuredClone(cs)
    for (const s of reversed.statements) {
      if (s.kind !== 'alterTable') continue
      const drops = s.actions.filter((a) => a.kind === 'dropColumn' || a.kind === 'renameColumn')
      const rest = s.actions.filter((a) => a.kind !== 'dropColumn' && a.kind !== 'renameColumn')
      s.actions = [...drops, ...rest.reverse()]
    }
    const p1 = proj(base)
    const p2 = proj(base)
    applyChangeset(p1, cs)
    applyChangeset(p2, reversed)
    expect(p1.tables['t2']!.columnIds).toEqual(['c9', 'c4', 'c2', 'c3', 'c8'])
    expect(p2.tables['t2']!.columnIds).toEqual(['c9', 'c4', 'c2', 'c3', 'c8'])
  })

  it('없는 @id 를 고치면 그 파일·줄로 경고하고 건너뛴다', () => {
    const bad = parseChangeset(`${HEAD}alter table MBR {  @t404\n  rename column A -> B  @c404\n}\n`)
    if (!bad.ok) throw new Error(bad.message)
    const r = replay([{ file: 'bad.erddc', changeset: bad.changeset }])
    expect(r.error).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatchObject({ file: 'bad.erddc', line: 5 })
    expect(r.warnings[0]!.message).toContain('@t404')
  })

  it('이미 있는 테이블을 또 만들면 멈춘다', () => {
    const cs = changesetOf(emptyProjection(), buildSampleModel())
    const r = replay([{ file: '1', changeset: cs }, { file: '2', changeset: cs }])
    expect(r.error).toMatchObject({ file: '2' })
    expect(r.error!.message).toContain('이미 있습니다')
  })

  it('after 가 없는 컬럼을 가리키면 경고하고 그 컬럼을 테이블 끝에 둔다', () => {
    const p = proj(buildSampleModel())
    const bad = parseChangeset(`${HEAD}alter table MBR {  @t2\n  add column X INT [null, after: NOPE]  @c77\n}\n`)
    if (!bad.ok) throw new Error(bad.message)
    const warnings = applyChangeset(p, bad.changeset)
    expect(warnings).toEqual([{ line: 6, message: 'MBR.X 컬럼을 테이블 끝에 두었습니다 — MBR 테이블에 NOPE 컬럼이 없습니다(after)' }])
    expect(p.tables['t2']!.columnIds).toEqual(['c2', 'c3', 'c4', 'c77'])
  })

  it('한 블록 안에서 두 컬럼이 같은 자리를 가리키면 여전히 멈춘다', () => {
    const bad = parseChangeset(`${HEAD}alter table MBR {  @t2\n  add column X INT [null, after: MBR_NO]  @c77\n  add column Y INT [null, after: MBR_NO]  @c78\n}\n`)
    if (!bad.ok) throw new Error(bad.message)
    expect(() => applyChangeset(proj(buildSampleModel()), bad.changeset)).toThrow('같은 자리')
  })

  it('두 브랜치가 같은 컬럼을 지우면 뒤 기록에서 경고 1건이고 멈추지 않는다', () => {
    const base = structuredClone(buildSampleModel())
    base.columns['c9'] = { ...base.columns['c3']!, id: 'c9', physicalName: 'MEMO', order: 9 }
    const dropped = structuredClone(base)
    delete dropped.columns['c9']
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2', changeset: changesetOf(proj(base), dropped) },
      { file: '3', changeset: changesetOf(proj(base), dropped) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings).toEqual([{ file: '3', line: expect.any(Number), message: 'MBR 테이블에 컬럼 @c9(MEMO) 이(가) 없습니다 — 건너뜁니다' }])
    expect(r.projection).toEqual(proj(dropped))
  })

  it('A 가 지운 컬럼 뒤에 B 가 컬럼을 추가하면 경고하고 새 컬럼은 테이블 끝에 둔다', () => {
    const base = buildSampleModel()
    const dropped = structuredClone(base)
    delete dropped.columns['c3']
    delete dropped.indexes['i1']
    const added = structuredClone(base)
    added.columns['c9'] = { ...added.columns['c3']!, id: 'c9', physicalName: 'NICK_NM', order: 1.5 }
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2', changeset: changesetOf(proj(base), dropped) },
      { file: '3', changeset: changesetOf(proj(base), added) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatchObject({ file: '3', message: 'MBR.NICK_NM 컬럼을 테이블 끝에 두었습니다 — MBR 테이블에 MBR_NM 컬럼이 없습니다(after)' })
    expect(r.projection.tables['t2']!.columnIds).toEqual(['c2', 'c4', 'c9'])
  })
})

describe('drop column 은 그 컬럼을 쓰는 인덱스·FK 도 함께 지운다(결함 1 — 병합 잔재)', () => {
  it('B 가 c3 에 인덱스를 붙인 뒤(파일명 앞) A 가 c3 를 지우면(파일명 뒤) — 그 인덱스도 지우고 경고한다', () => {
    const base = buildSampleModel()
    const withIndex = structuredClone(base)
    withIndex.indexes['i9'] = { id: 'i9', tableId: 't2', name: 'IX_MBR_NM_02', columns: [{ columnId: 'c3', direction: 'asc' }], unique: false }
    const dropped = deleteColumnCascade(base, 'c3')
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2_b', changeset: changesetOf(proj(base), withIndex) },
      { file: '3_a', changeset: changesetOf(proj(base), dropped) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings.some((w) => w.file === '3_a' && w.message.includes('IX_MBR_NM_02'))).toBe(true)
    expect(r.projection).toEqual(proj(dropped))
  })

  it('A 가 c3 를 먼저 지우면(파일명 앞) B 의 인덱스 추가는(파일명 뒤) 경고하고 건너뛴다', () => {
    const base = buildSampleModel()
    const withIndex = structuredClone(base)
    withIndex.indexes['i9'] = { id: 'i9', tableId: 't2', name: 'IX_MBR_NM_02', columns: [{ columnId: 'c3', direction: 'asc' }], unique: false }
    const dropped = deleteColumnCascade(base, 'c3')
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2_a', changeset: changesetOf(proj(base), dropped) },
      { file: '3_b', changeset: changesetOf(proj(base), withIndex) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings.some((w) => w.file === '3_b' && w.message.includes('추가하지 않았습니다'))).toBe(true)
    expect(r.projection).toEqual(proj(dropped))
  })

  it('B 가 c3 를 FK 자식 컬럼으로 쓰는 관계를 만든 뒤(파일명 앞) A 가 c3 를 지우면(파일명 뒤) — 그 FK 도 지우고 경고한다', () => {
    const base = structuredClone(buildSampleModel())
    base.tables['t3'] = { id: 't3', logicalName: '참조', physicalName: 'REF', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    base.columns['c9'] = {
      id: 'c9', tableId: 't3', logicalName: '참조번호', physicalName: 'REF_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const withFk = structuredClone(base)
    withFk.relationships['r9'] = {
      id: 'r9', parentTableId: 't3', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c3', parentColumnId: 'c9' }], cardinality: '1:1', identifying: false, name: null,
    }
    const dropped = deleteColumnCascade(base, 'c3')
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2_b', changeset: changesetOf(proj(base), withFk) },
      { file: '3_a', changeset: changesetOf(proj(base), dropped) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings.some((w) => w.file === '3_a' && w.message.includes('FK') && w.message.includes('REF'))).toBe(true)
    expect(r.projection).toEqual(proj(dropped))
  })

  it('A 가 c3 를 먼저 지우면(파일명 앞) B 의 FK 추가는(파일명 뒤) 경고하고 건너뛴다', () => {
    const base = structuredClone(buildSampleModel())
    base.tables['t3'] = { id: 't3', logicalName: '참조', physicalName: 'REF', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    base.columns['c9'] = {
      id: 'c9', tableId: 't3', logicalName: '참조번호', physicalName: 'REF_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const withFk = structuredClone(base)
    withFk.relationships['r9'] = {
      id: 'r9', parentTableId: 't3', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c3', parentColumnId: 'c9' }], cardinality: '1:1', identifying: false, name: null,
    }
    const dropped = deleteColumnCascade(base, 'c3')
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2_a', changeset: changesetOf(proj(base), dropped) },
      { file: '3_b', changeset: changesetOf(proj(base), withFk) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings.some((w) => w.file === '3_b' && w.message.includes('추가하지 않았습니다'))).toBe(true)
    expect(r.projection).toEqual(proj(dropped))
  })

  it('B 가 c3 를 FK 부모 컬럼으로 쓰는 관계를 만든 뒤(파일명 앞) A 가 c3 를 지우면(파일명 뒤) — 그 FK 도 지우고 경고한다', () => {
    const base = structuredClone(buildSampleModel())
    base.tables['t3'] = { id: 't3', logicalName: '참조', physicalName: 'REF', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    base.columns['c9'] = {
      id: 'c9', tableId: 't3', logicalName: '참조명', physicalName: 'REF_NM', type: 'VARCHAR(100)',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    const withFk = structuredClone(base)
    withFk.relationships['r9'] = {
      id: 'r9', parentTableId: 't2', childTableId: 't3',
      columnMappings: [{ childColumnId: 'c9', parentColumnId: 'c3' }], cardinality: '1:1', identifying: false, name: null,
    }
    const dropped = deleteColumnCascade(base, 'c3')
    const r = replay([
      { file: '1', changeset: changesetOf(emptyProjection(), base) },
      { file: '2_b', changeset: changesetOf(proj(base), withFk) },
      { file: '3_a', changeset: changesetOf(proj(base), dropped) },
    ])
    expect(r.error).toBeNull()
    expect(r.warnings.some((w) => w.file === '3_a' && w.message.includes('FK') && w.message.includes('REF'))).toBe(true)
    expect(r.projection).toEqual(proj(dropped))
  })
})
