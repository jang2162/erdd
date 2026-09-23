import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelToFiles, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { writeConfig } from '../config.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { writeTree } from '../tree.js'
import { main } from '../main.js'
import { changes } from './changes.js'

let dir: string
let out: string[]
let err: string[]
const LOCAL_CONFIG = {
  ...TEST_CONFIG, serverUrl: null, projectId: null,
  dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules },
}
const base = { json: false, yes: false, strict: false } as const
const status = (extra: Partial<{ json: boolean; check: boolean }> = {}) =>
  changes({ cwd: dir, ...base, sub: 'status', baseline: false, check: false, ...extra })
const create = (name: string, baseline = false) =>
  changes({ cwd: dir, ...base, sub: 'new', name, baseline, check: false })
const seed = (m: ProjectModel) => writeTree(dir, modelToFiles(m).tree)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-changes-cmd-'))
  out = []
  err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, LOCAL_CONFIG)
  await seed(buildSampleModel())
})
afterEach(() => vi.restoreAllMocks())

describe('erdd changes', () => {
  it('기록이 없으면 스키마 전체가 미기록으로 보인다', async () => {
    expect(await status()).toBe(0)
    const text = out.join('')
    expect(text).toContain('변경 기록 0건 (erdd/changes/)')
    expect(text).toContain('미기록 변경 4문장 — erdd changes new <이름> 으로 기록합니다')
    expect(text).toContain('  create table MBR ')
  })

  it('new 로 기록하면 미기록이 없어진다', async () => {
    expect(await create('초기')).toBe(0)
    expect(out.join('')).toMatch(/기록했습니다: erdd\/changes\/\d{14}_초기\.erddc \(문장 4개\)/)
    out = []
    expect(await status()).toBe(0)
    expect(out.join('')).toContain('변경 기록 1건 (erdd/changes/)')
    expect(out.join('')).toContain('미기록 변경 없음')
  })

  it('--check 는 미기록이 있을 때만 1 이다', async () => {
    await create('초기')
    expect(await status({ check: true })).toBe(0)
    const m = buildSampleModel()
    m.columns['c3'] = { ...m.columns['c3']!, nullable: true }
    await seed(m)
    expect(await status({ check: true })).toBe(1)
    expect(err.join('')).toContain('미기록 변경이 있습니다 — erdd changes new <이름> 으로 기록하세요')
  })

  it('--json 은 LocalChangesStatus 모양이다', async () => {
    expect(await status({ json: true })).toBe(0)
    const payload = JSON.parse(out.join('')) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['error', 'pending', 'records', 'unsaved', 'warnings'])
    expect(payload['pending']).toMatchObject({ count: 4 })
  })

  it('서버에 연결된 프로젝트에서는 멈춘다', async () => {
    await writeConfig(dir, { ...LOCAL_CONFIG, serverUrl: TEST_CONFIG.serverUrl, projectId: TEST_CONFIG.projectId })
    expect(await status()).toBe(1)
    expect(err.join('')).toContain('변경 기록은 로컬 모드 전용입니다')
  })

  it('미저장 편집이 있으면 new 를 거절한다', async () => {
    await mkdir(join(dir, '.erdd'), { recursive: true })
    await writeFile(join(dir, '.erdd/draft.json'), '{}', 'utf8')
    expect(await create('초기')).toBe(1)
    expect(err.join('')).toContain('저장하지 않은 편집이 있습니다. 먼저 erdd serve 화면에서 저장한 뒤 변경 기록을 만드세요')
    await expect(readdir(join(dir, 'erdd/changes'))).rejects.toThrow()
  })

  it('--json 거절 봉투는 서버 연결이면 reason local-only 를 싣는다', async () => {
    await writeConfig(dir, { ...LOCAL_CONFIG, serverUrl: TEST_CONFIG.serverUrl, projectId: TEST_CONFIG.projectId })
    expect(await changes({ cwd: dir, ...base, json: true, sub: 'new', name: '초기', baseline: false, check: false })).toBe(1)
    expect(JSON.parse(out.join(''))).toEqual({
      error: { code: 'VALIDATION', message: '변경 기록은 로컬 모드 전용입니다 — 서버에 연결된 프로젝트에서는 쓸 수 없습니다', reason: 'local-only' },
    })
  })

  it('--json 거절 봉투는 미저장 편집이면 reason unsaved 를 싣는다', async () => {
    await mkdir(join(dir, '.erdd'), { recursive: true })
    await writeFile(join(dir, '.erdd/draft.json'), '{}', 'utf8')
    expect(await changes({ cwd: dir, ...base, json: true, sub: 'new', name: '초기', baseline: false, check: false })).toBe(1)
    expect(JSON.parse(out.join(''))).toMatchObject({ error: { code: 'VALIDATION', reason: 'unsaved' } })
  })

  it('--baseline 은 첫 기록에만 쓸 수 있다', async () => {
    expect(await create('운영', true)).toBe(0)
    const m = buildSampleModel()
    m.columns['c3'] = { ...m.columns['c3']!, nullable: true }
    await seed(m)
    expect(await create('또', true)).toBe(1)
    expect(err.join('')).toContain('--baseline 은 첫 변경 기록에만')
  })

  it('깨진 기록 파일은 파일·줄과 함께 1 로 멈춘다', async () => {
    await mkdir(join(dir, 'erdd/changes'), { recursive: true })
    await writeFile(join(dir, 'erdd/changes/20260101000000_x.erddc'), "changeset 'x' {\n  format: 1\n  created: 'c'\n}\nbogus  @t1\n", 'utf8')
    expect(await status()).toBe(1)
    expect(out.join('')).toContain('오류: erdd/changes/20260101000000_x.erddc 5행:')
  })

  it('깨진 기록이 있으면 new 도 파일·줄과 함께 거절한다', async () => {
    await mkdir(join(dir, 'erdd/changes'), { recursive: true })
    await writeFile(join(dir, 'erdd/changes/20260101000000_x.erddc'), "changeset 'x' {\n  format: 1\n  created: 'c'\n}\nbogus  @t1\n", 'utf8')
    expect(await create('초기')).toBe(1)
    expect(err.join('')).toContain('erdd/changes/20260101000000_x.erddc 5행:')
  })
})

describe('main 의 changes 분기', () => {
  it('new 에 이름이 없거나 모르는 하위 명령이면 사용법 오류(2)다', async () => {
    expect(await main(['changes', 'new'], dir)).toBe(2)
    expect(await main(['changes', 'new', '--baseline'], dir)).toBe(2)
    expect(await main(['changes', 'bogus'], dir)).toBe(2)
    expect(await main(['changes', '--baseline'], dir)).toBe(2)
  })
  it('changes 는 상태, changes new <이름> 은 생성으로 간다', async () => {
    expect(await main(['changes'], dir)).toBe(0)
    expect(await main(['changes', 'new', '초기'], dir)).toBe(0)
    expect(await main(['changes', '--check'], dir)).toBe(0)
  })
})
