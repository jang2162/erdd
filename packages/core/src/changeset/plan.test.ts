import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { createEmptyModel, type Column, type ProjectModel } from '../model.js'
import {
  changesetFileName, changesetStamp, composeChangeset, formatChangeIssue, planChanges, stampToIso,
  type ChangesetSource,
} from './plan.js'

const SETTINGS = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }
const input = (sources: ChangesetSource[], model: ProjectModel) => ({ sources, model, settings: SETTINGS })
const withColumn = (m: ProjectModel, id: string, patch: Partial<Column>): ProjectModel => {
  const next = structuredClone(m)
  next.columns[id] = { ...next.columns[id]!, ...patch }
  return next
}

/** sources 위에 model 까지의 기록 하나를 만든다. */
function record(sources: ChangesetSource[], model: ProjectModel, file: string, name = file): ChangesetSource {
  const i = input(sources, model)
  const r = composeChangeset(planChanges(i), i, { name, created: '2026-09-23T00:00:00Z', baseline: false })
  if (!r.ok) throw new Error(r.message)
  return { file, text: r.text }
}

describe('planChanges', () => {
  it('기록이 없으면 스키마 전체가 미기록이다', () => {
    const plan = planChanges(input([], buildSampleModel()))
    expect(plan.error).toBeNull()
    expect(plan.records).toEqual([])
    expect(plan.pending?.map((s) => s.kind)).toEqual(['createTable', 'createTable', 'addIndex', 'addForeignKey'])
  })

  it('기록을 만든 뒤에는 미기록이 없고, 목록에 이름·문장 수가 보인다', () => {
    const r0 = record([], buildSampleModel(), 'erdd/changes/20260101000000_초기.erddc', '초기')
    const plan = planChanges(input([r0], buildSampleModel()))
    expect(plan.pending).toEqual([])
    expect(plan.records).toEqual([{ file: r0.file, name: '초기', created: '2026-09-23T00:00:00Z', baseline: false, statementCount: 4, text: r0.text }])
  })

  it('겹치지 않는 두 브랜치의 기록을 합치면 미기록이 0 이다 — 중복 기록이 없다', () => {
    const base = buildSampleModel()
    const r0 = record([], base, '1_base')
    const a = withColumn(base, 'c3', { type: 'VARCHAR(200)' })
    const b = structuredClone(base)
    b.tables['t1'] = { ...b.tables['t1']!, physicalName: 'GRD' }
    const ra = record([r0], a, '2_a')
    const rb = record([r0], b, '3_b')
    const merged = structuredClone(a)
    merged.tables['t1'] = { ...merged.tables['t1']!, physicalName: 'GRD' }
    const plan = planChanges(input([r0, ra, rb], merged))
    expect(plan.error).toBeNull()
    expect(plan.warnings).toEqual([])
    expect(plan.pending).toEqual([])
  })

  it('같은 속성을 두 브랜치가 바꾸면 경고한다 — 병합 결과가 뒤 기록과 같으면 미기록은 없다', () => {
    const base = buildSampleModel()
    const r0 = record([], base, '1_base')
    const ra = record([r0], withColumn(base, 'c3', { type: 'VARCHAR(200)' }), '2_a')
    const rb = record([r0], withColumn(base, 'c3', { type: 'VARCHAR(300)' }), '3_b')
    const plan = planChanges(input([r0, ra, rb], withColumn(base, 'c3', { type: 'VARCHAR(300)' })))
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]!.file).toBe('3_b')
    expect(plan.pending).toEqual([])
  })

  it('중간 기록이 지워지면 뒤 기록의 파일·줄에서 멈춘다', () => {
    const base = buildSampleModel()
    const r0 = record([], base, '1_base')
    const next = structuredClone(base)
    next.columns['c9'] = { ...next.columns['c3']!, id: 'c9', physicalName: 'ADDED', order: 9 }
    const r1 = record([r0], next, '2_add')
    const r2 = record([r0, r1], withColumn(next, 'c9', { nullable: true }), '3_modify')
    const plan = planChanges(input([r0, r2], withColumn(next, 'c9', { nullable: true })))
    expect(plan.pending).toBeNull()
    expect(plan.error).toMatchObject({ file: '3_modify', line: expect.any(Number) })
    expect(plan.error!.message).toContain('@c9')
  })

  it('기록 파일이 깨졌으면 그 파일·줄을 알린다', () => {
    const plan = planChanges(input([{ file: 'x.erddc', text: "changeset 'x' {\n  format: 1\n" }], buildSampleModel()))
    expect(plan.error).toMatchObject({ file: 'x.erddc' })
    expect(plan.pending).toBeNull()
  })

  it('id 가 없는 항목(파일에서 새로 만든 것)이 있으면 멈춘다', () => {
    const m = buildSampleModel()
    m.tables['new:erdd/tables/X.yaml#table[0]'] = { ...m.tables['t1']!, id: 'new:erdd/tables/X.yaml#table[0]', physicalName: 'X' }
    const plan = planChanges(input([], m))
    expect(plan.error?.message).toContain('erdd serve')
    expect(plan.error?.message).toContain('erdd/tables/X.yaml')
  })

  it('큰 스키마와 기록 30건도 2초 안에 상태를 낸다', () => {
    const m = createEmptyModel()
    for (let t = 0; t < 200; t += 1) {
      m.tables[`t${t}`] = { id: `t${t}`, logicalName: '', physicalName: `TB_${t}`, comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
      for (let c = 0; c < 20; c += 1) {
        m.columns[`t${t}c${c}`] = { id: `t${t}c${c}`, tableId: `t${t}`, logicalName: '', physicalName: `COL_${c}`, type: 'VARCHAR(10)', isPk: c === 0, autoIncrement: false, nullable: c !== 0, defaultValue: null, order: c, comment: null, domainId: null, custom: {} }
      }
    }
    const sources: ChangesetSource[] = [record([], m, 'r000')]
    let cur = m
    for (let i = 1; i <= 29; i += 1) {
      cur = withColumn(cur, `t${i}c1`, { type: `VARCHAR(${20 + i})` })
      sources.push(record(sources, cur, `r${String(i).padStart(3, '0')}`))
    }
    const started = performance.now()
    const plan = planChanges(input(sources, cur))
    expect(performance.now() - started).toBeLessThan(2000)
    expect(plan.pending).toEqual([])
  }, 60_000)
})

describe('composeChangeset', () => {
  it('미기록이 없으면 empty, 이름이 비면 name, 기록이 있는데 baseline 이면 baseline 으로 거절한다', () => {
    const m = buildSampleModel()
    const r0 = record([], m, '1')
    const done = input([r0], m)
    expect(composeChangeset(planChanges(done), done, { name: 'x', created: 'c', baseline: false })).toMatchObject({ ok: false, reason: 'empty', message: '기록할 변경이 없습니다' })
    const fresh = input([], m)
    expect(composeChangeset(planChanges(fresh), fresh, { name: '  ', created: 'c', baseline: false })).toMatchObject({ ok: false, reason: 'name' })
    const more = input([r0], withColumn(m, 'c3', { nullable: true }))
    expect(composeChangeset(planChanges(more), more, { name: 'x', created: 'c', baseline: true })).toMatchObject({ ok: false, reason: 'baseline' })
  })

  it('첫 기록은 baseline 으로 만들 수 있고 머릿말에 실린다', () => {
    const fresh = input([], buildSampleModel())
    const r = composeChangeset(planChanges(fresh), fresh, { name: '운영 DB', created: '2026-09-23T00:00:00Z', baseline: true })
    if (!r.ok) throw new Error(r.message)
    expect(r.text).toContain('  baseline: true')
    expect(r.statementCount).toBe(4)
  })

  it('자기검증 — 재생 결과가 현재 투영과 다르면 파일을 만들지 않는다', () => {
    const fresh = input([], buildSampleModel())
    const plan = planChanges(fresh)
    // 재생 결과와 어긋나는 현재(target)를 흉내 낸다 — 직렬화·재생 버그가 있을 때와 같은 상황이다.
    plan.target!.columns['c3']!.type = 'TAMPERED'
    const r = composeChangeset(plan, fresh, { name: 'x', created: 'c', baseline: false })
    expect(r).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('상태 오류로 거절할 때 파일·줄을 메시지에 싣는다', () => {
    const broken = input([{ file: 'x.erddc', text: "changeset 'x' {\n  format: 1\n" }], buildSampleModel())
    const r = composeChangeset(planChanges(broken), broken, { name: 'n', created: 'c', baseline: false })
    expect(r).toMatchObject({ ok: false, reason: 'invalid' })
    if (r.ok) throw new Error('unreachable')
    expect(r.message.startsWith('x.erddc 2행: ')).toBe(true)
  })
})

describe('파일명 규칙', () => {
  it('시각은 max(지금, 마지막 기록 + 1초) 다', () => {
    const now = new Date('2026-09-23T04:12:00.500Z')
    expect(changesetStamp(now, [])).toBe('20260923041200')
    expect(changesetStamp(now, ['erdd/changes/20260923041200_a.erddc'])).toBe('20260923041201')
    expect(changesetStamp(now, ['erdd/changes/29990101000000_future.erddc', 'README.md'])).toBe('29990101000001')
    expect(changesetStamp(now, ['erdd/changes/29990101000000_note.txt'])).toBe('20260923041200')
  })
  it('시각을 ISO 로 바꾼다', () => {
    expect(stampToIso('20260923041200')).toBe('2026-09-23T04:12:00Z')
  })
  it('이름에서 파일명에 쓸 수 없는 문자를 빼고 공백은 - 로 바꾼다', () => {
    expect(changesetFileName('20260923041200', '회원 등급 추가')).toBe('20260923041200_회원-등급-추가.erddc')
    expect(changesetFileName('20260923041200', '../a/b: c*?')).toBe('20260923041200_ab-c.erddc')
    expect(changesetFileName('20260923041200', ' ./ ')).toBe('20260923041200_changes.erddc')
    expect(changesetFileName('20260923041200', `${'a'.repeat(59)} b`)).toBe(`20260923041200_${'a'.repeat(59)}.erddc`)
  })
  it('오류 위치는 「파일 줄행: 메시지」', () => {
    expect(formatChangeIssue({ file: 'a.erddc', line: 3, message: 'm' })).toBe('a.erddc 3행: m')
    expect(formatChangeIssue({ file: null, line: null, message: 'm' })).toBe('m')
  })
})
