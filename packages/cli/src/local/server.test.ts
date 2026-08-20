import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLocalServer, type LocalServer } from './server.js'
import { LOCAL_PROJECT_ID } from '../config.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let running: LocalServer | null = null
afterEach(async () => { await running?.close(); running = null })

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-server-'))
  await writeFile(join(dir, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  await mkdir(join(dir, 'erdd/tables'), { recursive: true })
  return dir
}

async function start(cwd: string, webDist?: string): Promise<LocalServer> {
  // port 0 = 커널이 빈 포트를 준다. 테스트끼리 포트를 다투지 않는다.
  running = await startLocalServer({ cwd, port: 0, webDist })
  return running
}

describe('startLocalServer', () => {
  it('tRPC 로 모델을 읽을 수 있다', async () => {
    const s = await start(await project())
    const url = `${s.url}/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const body = await res.json() as { result: { data: { seq: number } } }
    expect(body.result.data.seq).toBe(0)
  })

  it('/ 는 프로젝트 경로로 리다이렉트한다', async () => {
    const s = await start(await project())
    const res = await fetch(`${s.url}/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/p/${LOCAL_PROJECT_ID}`)
  })

  it('127.0.0.1 에만 바인딩한다', async () => {
    const s = await start(await project())
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('web/dist 가 있으면 SPA 경로를 index.html 로 돌린다', async () => {
    const cwd = await project()
    const dist = await mkdtemp(join(tmpdir(), 'erdd-dist-'))
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>erdd</title>', 'utf8')
    const s = await start(cwd, dist)
    const res = await fetch(`${s.url}/p/${LOCAL_PROJECT_ID}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('erdd')
  })

  it('외부 파일 변경을 SSE 로 알린다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()
    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), [
      'id: 018f6b0e-0000-7000-8000-000000000001',
      'name: MBR',
      'logicalName: 회원',
      'columns: []',
      '',
    ].join('\n'), 'utf8')

    expect(await chunk).toContain('reload')
    await reader.cancel()
  }, 10_000)

  it('자기 쓰기는 SSE 로 알리지 않는다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()

    let got = ''
    void (async () => {
      const { value } = await reader.read()
      got = new TextDecoder().decode(value ?? new Uint8Array())
    })()

    await sleep(100)
    // 라우터를 통한 편집 = 자기 쓰기. 디바운스(300ms) + 감시 디바운스를 넉넉히 기다린다.
    const url = `${s.url}/trpc/model.mutate`
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: LOCAL_PROJECT_ID,
        ops: [{
          action: 'create', entity: 'table', entityId: '018f6b0e-0000-7000-8000-000000000001',
          data: {
            id: '018f6b0e-0000-7000-8000-000000000001', logicalName: '회원', physicalName: 'MBR',
            comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
          },
        }],
      }),
    })
    await sleep(1500)
    expect(got).toBe('')
    await reader.cancel()
  }, 10_000)

  it('파일이 깨지면 blocked 를 보낸다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()
    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')

    expect(await chunk).toContain('blocked')
    await reader.cancel()
  }, 10_000)

  it('감시가 잡은 변경이 모델에 반영된다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), [
      'id: 018f6b0e-0000-7000-8000-000000000001',
      'name: MBR',
      'logicalName: 회원',
      'columns: []',
      '',
    ].join('\n'), 'utf8')
    await sleep(500)
    const url = `${s.url}/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    const body = await (await fetch(url)).json() as {
      result: { data: { model: { tables: Record<string, { physicalName: string }> } } }
    }
    expect(Object.values(body.result.data.model.tables)[0]!.physicalName).toBe('MBR')
  }, 10_000)
})
