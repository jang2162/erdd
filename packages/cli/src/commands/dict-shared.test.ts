import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../client.js'
import { writeConfig } from '../config.js'
import { CliError } from '../output.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { dictList } from './dict-list.js'
import { guardFeature, resolveLibrary, type LibraryRow } from './dict-shared.js'

const row = (id: string, name: string, scope: 'org' | 'global' = 'org'): LibraryRow =>
  ({ id, scope, orgId: scope === 'org' ? 'o1' : null, name, description: '', itemCount: 0, canWrite: false })

describe('resolveLibrary', () => {
  it('id 가 정확히 맞으면 그것을 고른다', () => {
    expect(resolveLibrary([row('L1', '표준'), row('L2', '표준')], 'L2').id).toBe('L2')
  })
  it('이름이 하나면 그것을 고른다', () => {
    expect(resolveLibrary([row('L1', '표준'), row('L2', '확장')], '확장').id).toBe('L2')
  })
  it('이름이 모호하면 후보를 보이며 USAGE', () => {
    expect(() => resolveLibrary([row('L1', '표준'), row('L2', '표준', 'global')], '표준'))
      .toThrow(expect.objectContaining({ code: 'USAGE', message: expect.stringContaining('L2') }))
  })
  it('없으면 NOT_FOUND 로 dict list 를 가리킨다', () => {
    expect(() => resolveLibrary([], '표준'))
      .toThrow(expect.objectContaining({ code: 'NOT_FOUND', message: expect.stringContaining('erdd dict list') }))
  })
})

describe('guardFeature', () => {
  // 문구는 서버 trpc.ts 의 authedProcedure 가 던지는 것 그대로다.
  it('세션 전용 거절(옛 서버)을 업그레이드 안내로 바꾼다', async () => {
    await expect(guardFeature(async () => {
      throw new CliError('UNAUTHORIZED', '이 작업은 액세스 토큰으로 할 수 없습니다')
    })).rejects.toMatchObject({ message: expect.stringContaining('서버를 업그레이드') })
  })
  // 문구는 @trpc/server 의 callProcedure 가 만드는 것 그대로다.
  it('프로시저가 없는 서버도 같은 안내다', async () => {
    await expect(guardFeature(async () => {
      throw new CliError('NOT_FOUND', 'No "query"-procedure on path "resource.items.list"')
    })).rejects.toMatchObject({ message: expect.stringContaining('서버를 업그레이드') })
  })
  it('토큰 자체가 틀린 401 은 그대로 올린다', async () => {
    await expect(guardFeature(async () => { throw new CliError('UNAUTHORIZED', '로그인이 필요합니다') }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', message: '로그인이 필요합니다' })
  })
  it('프로시저 부재가 아닌 NOT_FOUND 는 그대로 올린다', async () => {
    await expect(guardFeature(async () => { throw new CliError('NOT_FOUND', '라이브러리를 찾을 수 없습니다') }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: '라이브러리를 찾을 수 없습니다' })
  })
  it('그 밖의 오류는 그대로 올린다', async () => {
    await expect(guardFeature(async () => { throw new CliError('FORBIDDEN', '권한 없음') }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: '권한 없음' })
  })
})

describe('dict list', () => {
  let dir: string
  let out: string[]
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erdd-dict-list-'))
    out = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(() => vi.restoreAllMocks())

  const client: ApiClient = {
    query: (async (path: string) => {
      if (path === 'resource.library.listForProject') return [row('L1', '표준'), row('L2', '확장')]
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async () => { throw new Error('unexpected mutate') }) as ApiClient['mutate'],
  }

  it('구독한 라이브러리를 표시한다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], dictionaries: [{ id: 'L1', name: '표준' }],
    })
    expect(await dictList({ cwd: dir, json: true, yes: false, strict: false, client })).toBe(0)
    expect(JSON.parse(out.join(''))).toEqual([
      expect.objectContaining({ id: 'L1', subscribed: true }),
      expect.objectContaining({ id: 'L2', subscribed: false }),
    ])
  })

  it('사람용 출력은 구독한 줄에 * 를 붙인다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], dictionaries: [{ id: 'L2', name: '확장' }],
    })
    expect(await dictList({ cwd: dir, json: false, yes: false, strict: false, client })).toBe(0)
    const lines = out.join('').trimEnd().split('\n')
    expect(lines).toEqual([
      '  표준 — 조직 · 항목 0 · L1',
      '* 확장 — 조직 · 항목 0 · L2',
    ])
  })

  it('서버에 연결되지 않은 프로젝트는 NO_CONFIG 로 init --create 를 가리킨다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, serverUrl: null, projectId: null, dialects: [...TEST_CONFIG.dialects],
    })
    expect(await dictList({ cwd: dir, json: true, yes: false, strict: false, client })).toBe(1)
    expect(JSON.parse(out.join(''))).toMatchObject({
      error: { code: 'NO_CONFIG', message: expect.stringContaining('--create') },
    })
  })
})
