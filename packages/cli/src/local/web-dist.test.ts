import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveWebDist, startLocalServer, webDistCandidates, type LocalServer } from './server.js'
import { LOCAL_PROJECT_ID } from '../config.js'

/**
 * `erdd serve` 의 web 번들 경로 해석. 설치본(`<패키지 루트>/web`)과 저장소(`apps/web/dist`)의
 * 배치가 다르다 — 한쪽으로 고정하면 다른 한쪽에서 정적 서빙이 통째로 빠지고 `/p/<id>` 가
 * 404 를 낸다(게시 전 실측으로 확인된 사고다).
 */

const dirs: string[] = []
let running: LocalServer | null = null

afterEach(async () => {
  await running?.close()
  running = null
  // 임시 디렉터리는 반드시 정리한다.
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** `<루트>/packages/cli/src/local` 까지 만들고, 그 경로(= `from`)와 루트를 돌려준다. */
async function layout(opts: { pkgWeb?: boolean; repoDist?: boolean }): Promise<{ root: string; from: string }> {
  const root = await mkdtemp(join(tmpdir(), 'erdd-webdist-'))
  dirs.push(root)
  const from = join(root, 'packages/cli/src/local')
  await mkdir(from, { recursive: true })
  if (opts.pkgWeb) await mkdir(join(root, 'packages/cli/web'), { recursive: true })
  if (opts.repoDist) await mkdir(join(root, 'apps/web/dist'), { recursive: true })
  return { root, from }
}

describe('web 번들 경로 해석', () => {
  it('후보는 설치본 배치와 저장소 배치 둘뿐이고, 설치본이 앞선다', async () => {
    const { root, from } = await layout({})
    expect(webDistCandidates(from)).toEqual([
      join(root, 'packages/cli/web'),
      join(root, 'apps/web/dist'),
    ])
  })

  it('게시된 패키지 배치(<pkg>/web)만 있으면 그것을 고른다', async () => {
    const { root, from } = await layout({ pkgWeb: true })
    expect(resolveWebDist(from)).toBe(join(root, 'packages/cli/web'))
  })

  it('저장소 배치(apps/web/dist)만 있으면 그것을 고른다', async () => {
    const { root, from } = await layout({ repoDist: true })
    expect(resolveWebDist(from)).toBe(join(root, 'apps/web/dist'))
  })

  it('둘 다 있으면 설치본 배치가 이긴다', async () => {
    const { root, from } = await layout({ pkgWeb: true, repoDist: true })
    expect(resolveWebDist(from)).toBe(join(root, 'packages/cli/web'))
  })

  it('둘 다 없으면 undefined 다', async () => {
    const { from } = await layout({})
    expect(resolveWebDist(from)).toBeUndefined()
  })
})

/** 서버 옵션과의 결합. 여기서 확인하는 것은 "override 가 최우선"과 "없으면 그냥 뜬다"이다. */
describe('startLocalServer 와 webDist', () => {
  async function project(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-webdist-cwd-'))
    dirs.push(dir)
    await writeFile(join(dir, 'erdd.config.yaml'), [
      'dialects: [postgresql]',
      'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
      '',
    ].join('\n'), 'utf8')
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    return dir
  }

  it('webDist 를 명시하면 기본 후보 탐색을 이긴다', async () => {
    const cwd = await project()
    const dist = await mkdtemp(join(tmpdir(), 'erdd-webdist-explicit-'))
    dirs.push(dist)
    // 기본 후보(저장소의 apps/web/dist)와 구별되는 표식을 넣는다.
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>명시-override</title>', 'utf8')
    running = await startLocalServer({ cwd, port: 0, webDist: dist })
    const res = await fetch(`${running.url}/p/${LOCAL_PROJECT_ID}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('명시-override')
  })

  it('번들이 없으면 정적 서빙을 등록하지 않되 서버는 그대로 뜬다', async () => {
    const cwd = await project()
    const missing = join(await mkdtemp(join(tmpdir(), 'erdd-webdist-none-')), '없는-디렉터리')
    dirs.push(missing)
    running = await startLocalServer({ cwd, port: 0, webDist: missing })
    // tRPC 는 살아 있다 — 서버가 뜨는 것 자체는 번들과 무관하다.
    const url = `${running.url}/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    expect((await fetch(url)).status).toBe(200)
    // SPA 경로는 Fastify 기본 404 로 떨어진다(지금 동작 유지).
    expect((await fetch(`${running.url}/p/${LOCAL_PROJECT_ID}`)).status).toBe(404)
  })
})
