import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOP_LEVEL_FILES, TREE_ROOT, type LibraryItem } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { writeConfig } from '../config.js'
import { CliError } from '../output.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { dictList } from './dict-list.js'
import { DICTIONARY_FILES, fetchItems, guardFeature, resolveLibrary, type LibraryRow } from './dict-shared.js'

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

describe('DICTIONARY_FILES', () => {
  it('최상위 파일 중 그룹 파일만 뺀다', () => {
    expect(DICTIONARY_FILES).toEqual(TOP_LEVEL_FILES.filter((p) => p !== `${TREE_ROOT}/groups.yaml`))
    expect(DICTIONARY_FILES).toHaveLength(TOP_LEVEL_FILES.length - 1)
  })
})

describe('fetchItems', () => {
  const item = (id: string): LibraryItem =>
    ({ id, kind: 'word', version: 1, payload: { logicalName: id, abbreviation: id, englishName: null, description: null } })
  // 서버가 id 역순으로 준다고 치자 — 기본은 결정성을 위해 id 순으로 다시 세운다.
  const reversed: ApiClient = {
    query: (async () => [item('S3'), item('S2'), item('S1')]) as ApiClient['query'],
    mutate: (async () => { throw new Error('unexpected mutate') }) as ApiClient['mutate'],
  }
  it('기본은 id 오름차순이다', async () => {
    expect((await fetchItems(reversed, 'L1')).map((i) => i.id)).toEqual(['S1', 'S2', 'S3'])
  })
  it("order: 'server' 는 서버 순서를 그대로 둔다", async () => {
    expect((await fetchItems(reversed, 'L1', { order: 'server' })).map((i) => i.id)).toEqual(['S3', 'S2', 'S1'])
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

  // guardFeature 를 거치는 배선 잠금 — listLibraries 가 그것을 벗으면 옛 서버의 거절이 날것으로 나간다.
  it('옛 서버의 세션 전용 거절은 업그레이드 안내로 나간다', async () => {
    await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects] })
    const old: ApiClient = {
      query: (async () => { throw new CliError('UNAUTHORIZED', '이 작업은 액세스 토큰으로 할 수 없습니다') }) as ApiClient['query'],
      mutate: (async () => { throw new Error('unexpected mutate') }) as ApiClient['mutate'],
    }
    expect(await dictList({ cwd: dir, json: true, yes: false, strict: false, client: old })).toBe(1)
    expect(JSON.parse(out.join(''))).toMatchObject({
      error: { code: 'UNAUTHORIZED', message: expect.stringContaining('서버를 업그레이드') },
    })
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
