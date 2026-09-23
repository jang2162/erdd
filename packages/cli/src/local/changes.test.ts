import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { modelToFiles, parseChangeset, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { CHANGES_DIR, loadChangesPlan, readChangeSources, toLocalStatus, writeChange } from './changes.js'

const CONFIG = { namingRules: { ...TEST_CONFIG.namingRules }, dialects: [...TEST_CONFIG.dialects] }
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'erdd-changes-')) })
const ctx = (model: ProjectModel = buildSampleModel()) => ({ cwd: dir, model, config: CONFIG })

describe('readChangeSources', () => {
  it('디렉터리가 없으면 빈 목록이다', async () => {
    expect(await readChangeSources(dir)).toEqual([])
  })
  it('`.erddc` 가 아닌 파일은 읽지 않고, 파일명 순으로 돌려준다', async () => {
    await mkdir(join(dir, CHANGES_DIR), { recursive: true })
    await writeFile(join(dir, CHANGES_DIR, 'b.erddc'), 'B', 'utf8')
    await writeFile(join(dir, CHANGES_DIR, 'a.erddc'), 'A', 'utf8')
    await writeFile(join(dir, CHANGES_DIR, 'README.md'), '#', 'utf8')
    await writeFile(join(dir, CHANGES_DIR, '.gitkeep'), '', 'utf8')
    expect(await readChangeSources(dir)).toEqual([
      { file: 'erdd/changes/a.erddc', text: 'A' },
      { file: 'erdd/changes/b.erddc', text: 'B' },
    ])
  })
})

describe('writeChange', () => {
  it('erdd/changes/<시각>_<이름>.erddc 를 쓰고, 다시 만들면 기록할 변경이 없다고 거절한다', async () => {
    const r = await writeChange(ctx(), { name: '초기 스키마', baseline: false, now: new Date('2026-09-23T04:12:00Z') })
    expect(r).toEqual({ ok: true, file: 'erdd/changes/20260923041200_초기-스키마.erddc', statementCount: 4 })
    const parsed = parseChangeset(await readFile(join(dir, 'erdd/changes/20260923041200_초기-스키마.erddc'), 'utf8'))
    expect(parsed).toMatchObject({ ok: true, changeset: { header: { name: '초기 스키마', created: '2026-09-23T04:12:00Z' } } })
    expect(await writeChange(ctx(), { name: '또', baseline: false })).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('미래 시각의 기록이 있어도 새 기록은 그 뒤 시각을 받는다', async () => {
    await writeChange(ctx(), { name: 'a', baseline: false, now: new Date('2999-01-01T00:00:00Z') })
    const m = buildSampleModel()
    m.columns['c3'] = { ...m.columns['c3']!, nullable: true }
    const r = await writeChange(ctx(m), { name: 'b', baseline: false, now: new Date('2026-01-01T00:00:00Z') })
    expect(r).toMatchObject({ ok: true, file: 'erdd/changes/29990101000001_b.erddc' })
  })

  it('위험한 이름도 erdd/changes 안의 안전한 파일명이 된다', async () => {
    const r = await writeChange(ctx(), { name: '../a/b: c*?', baseline: false, now: new Date('2026-09-23T04:12:00Z') })
    expect(r).toMatchObject({ ok: true, file: 'erdd/changes/20260923041200_ab-c.erddc' })
    expect(await readdir(join(dir, CHANGES_DIR))).toEqual(['20260923041200_ab-c.erddc'])
  })

  it('트리 로더는 erdd/changes 를 모델 파일로 읽지 않는다', async () => {
    await writeTree(dir, modelToFiles(buildSampleModel()).tree)
    await writeChange(ctx(), { name: 'x', baseline: false })
    expect(Object.keys(await readTree(dir)).some((k) => k.startsWith('erdd/changes'))).toBe(false)
  })
})

describe('toLocalStatus', () => {
  it('미기록 문장을 머릿말 없는 텍스트와 개수로 싣는다', async () => {
    const { plan } = await loadChangesPlan(ctx())
    const s = toLocalStatus(plan, true)
    expect(s).toMatchObject({ records: [], warnings: [], error: null, unsaved: true, pending: { count: 4 } })
    expect(s.pending!.text).toContain('create table MBR ')
    expect(s.pending!.text).not.toContain('changeset ')
  })
})
