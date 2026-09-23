import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../client.js'
import { libraryExport, libraryImport, libraryList, type LibraryImportCtx } from './library.js'

let dir: string
let out: string[]
let err: string[]
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-library-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
})
afterEach(() => vi.restoreAllMocks())

const GLOBAL = { id: 'g1', scope: 'global', orgId: null, name: '표준', description: '', itemCount: 2, canWrite: true }
const ORG = { id: 'o-lib', scope: 'org', orgId: 'o1', name: '팀표준', description: '', itemCount: 0, canWrite: false }
const SUMMARY = (counts: Partial<Record<string, number>>, entries: unknown[] = []) => ({
  counts: { add: 0, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0, ...counts }, warnings: [], entries,
})

function stub(opts: { imports?: unknown[]; onImport?: (input: Record<string, unknown>) => unknown } = {}) {
  const calls: { path: string; input: Record<string, unknown> }[] = []
  const client: ApiClient = {
    query: (async (path: string, input: Record<string, unknown>) => {
      calls.push({ path, input })
      if (path === 'resource.library.list') return input.scope === 'global' ? [GLOBAL] : [ORG]
      if (path === 'org.list') return [{ id: 'o1', name: '팀' }]
      if (path === 'resource.library.export') return { libraryId: 'g1', name: '표준', text: 'format: erdd-library\n', danglingDomainRefs: 1 }
      if (path === 'resource.items.list') return []
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async (path: string, input: Record<string, unknown>) => {
      calls.push({ path, input })
      if (path === 'resource.library.import') return opts.onImport?.(input)
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['mutate'],
  }
  return { client, calls }
}
const base = { cwd: '', json: false, yes: false, strict: false }

describe('erdd library', () => {
  it('list — 전역과 내 조직의 라이브러리를 쓰기 가능 여부와 함께 보인다', async () => {
    const { client } = stub()
    expect(await libraryList({ ...base, cwd: dir, client })).toBe(0)
    expect(out.join('')).toContain('표준 — 전역 · 항목 2 · 쓰기 가능 · g1')
    expect(out.join('')).toContain('팀표준 — 조직 팀 · 항목 0 · o-lib')
  })

  it('export -o — 파일로 쓰고 끊긴 도메인 참조를 알린다', async () => {
    const { client } = stub()
    const path = join(dir, 'std.erdd-lib.yaml')
    expect(await libraryExport({ ...base, cwd: dir, client, ref: '표준', out: path })).toBe(0)
    expect(await readFile(path, 'utf8')).toBe('format: erdd-library\n')
    expect(err.join('')).toContain('삭제된 도메인을 가리키던 용어 1건')
  })

  it('import — 미리보기 후 확인을 받고, 미리보기의 해시를 실어 적용한다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords:\n  - { logicalName: 고객 }\n')
    const { client, calls } = stub({ onImport: (input) => ({
      libraryId: 'g1', applied: !input.dryRun, stateHash: 'h1', summary: SUMMARY({ add: 1 }),
    }) })
    const ctx: LibraryImportCtx = {
      ...base, cwd: dir, client, file: path, library: '표준', prune: false, includeStale: false, dryRun: false,
      confirm: async () => true,
    }
    expect(await libraryImport(ctx)).toBe(0)
    const imports = calls.filter((c) => c.path === 'resource.library.import').map((c) => c.input)
    expect(imports).toEqual([
      expect.objectContaining({ target: { libraryId: 'g1' }, dryRun: true }),
      expect.objectContaining({ target: { libraryId: 'g1' }, dryRun: false, expectedStateHash: 'h1' }),
    ])
    expect(out.join('')).toContain('추가 1')
  })

  it('import --yes — 미리보기 없이 해시 없이 한 번에 적용한다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords: []\n')
    const { client, calls } = stub({ onImport: () => ({ libraryId: 'g1', applied: true, stateHash: 'h', summary: SUMMARY({}) }) })
    await libraryImport({ ...base, yes: true, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: false })
    const imports = calls.filter((c) => c.path === 'resource.library.import').map((c) => c.input)
    expect(imports).toHaveLength(1)
    expect(imports[0]).not.toHaveProperty('expectedStateHash')
  })

  it('import — 파일 오류는 서버를 부르기 전에 위치와 함께 멈춘다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords:\n  - { logicalName: 고객, x: 1 }\n')
    const { client, calls } = stub()
    expect(await libraryImport({ ...base, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: false })).toBe(1)
    expect(err.join('')).toContain('words[0] (고객)')
    expect(calls.filter((c) => c.path === 'resource.library.import')).toEqual([])
  })

  it('import — --library 와 --create 는 정확히 하나, --create 에는 --scope 가 필요하다', async () => {
    const { client } = stub()
    const common = { ...base, cwd: dir, client, file: 'x.yaml', prune: false, includeStale: false, dryRun: false }
    expect(await libraryImport(common)).toBe(2)
    expect(await libraryImport({ ...common, library: 'a', create: 'b', scope: 'global' })).toBe(2)
    expect(await libraryImport({ ...common, create: 'b' })).toBe(2)
    expect(await libraryImport({ ...common, create: 'b', scope: 'org' })).toBe(2)   // --org 없음
  })

  it('import --dry-run — 미리보기만 하고 적용하지 않는다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords: []\n')
    const { client, calls } = stub({ onImport: () => ({ libraryId: 'g1', applied: false, stateHash: 'h', summary: SUMMARY({ remove: 2 }) }) })
    expect(await libraryImport({ ...base, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: true })).toBe(0)
    expect(calls.filter((c) => c.path === 'resource.library.import')).toHaveLength(1)
    expect(out.join('')).toContain('--prune 이 없어 파일에 없는 2건은 남김')
  })

  it('import .xlsx — Excel 을 원천 파일로 바꿔 보낸다(커스텀 항목 키 없음)', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('단어사전')
    ws.addRow(['논리명', '약어']); ws.addRow(['고객', 'CUST'])
    const path = join(dir, '표준.xlsx')
    await wb.xlsx.writeFile(path)
    const { client, calls } = stub({ onImport: () => ({ libraryId: 'g1', applied: true, stateHash: 'h', summary: SUMMARY({ add: 1 }) }) })
    await libraryImport({ ...base, yes: true, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: false })
    const sent = calls.find((c) => c.path === 'resource.library.import')!.input.text as string
    expect(sent).toContain('logicalName: 고객')
    expect(sent).not.toContain('customFields')
  })
})
