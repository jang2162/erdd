import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
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

const MBR_TABLE = [
  'id: 018f6b0e-0000-7000-8000-000000000001',
  'name: MBR',
  'logicalName: 회원',
  'columns: []',
  '',
].join('\n')

async function start(cwd: string, webDist?: string): Promise<LocalServer> {
  // port 0 = 커널이 빈 포트를 준다. 테스트끼리 포트를 다투지 않는다.
  running = await startLocalServer({ cwd, port: 0, webDist })
  return running
}

/**
 * Host 헤더를 마음대로 주는 요청. `fetch`(undici)는 `host` 를 **금지 헤더로 지워** 버려서
 * DNS 리바인딩 요청을 흉내 낼 수 없다 — 그래서 node:http 로 직접 만든다.
 */
function rawGet(url: string, host: string): Promise<{ status: number; body: string }> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: 'GET', headers: { Host: host } },
      (res) => {
        let body = ''
        res.on('data', (c: Buffer) => { body += c.toString('utf8') })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
      },
    )
    req.on('error', reject)
    req.end()
  })
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

  /**
   * 127.0.0.1 바인딩(설계 D8)은 **네트워크 경로**만 막는다. 공격자 도메인이 DNS 를 127.0.0.1 로
   * 리바인딩하면 그 페이지는 브라우저가 보기에 이 서버와 동일 출처가 되어 preflight 없이
   * 읽고 쓴다 — 인증이 없으므로 `model.mutate`(파일 쓰기 프리미티브)까지 그대로 열린다
   * (최종 리뷰 I-1, 실제로 200 + 디스크에 파일 생성까지 실증됨).
   */
  it('낯선 Host 헤더는 거절한다(DNS 리바인딩) — 정상 Host 는 그대로 통과한다', async () => {
    const s = await start(await project())
    const path = `/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`

    const evil = await rawGet(`${s.url}${path}`, 'evil.example.com')
    expect(evil.status).toBe(403)
    // 모델이 새어 나가면 안 된다 — 상태 코드만이 아니라 본문도 본다.
    expect(evil.body).not.toContain('"seq"')

    // 대조군: 이 검사가 정상 사용을 막지 않는다.
    const port = new URL(s.url).port
    expect((await rawGet(`${s.url}${path}`, `127.0.0.1:${port}`)).status).toBe(200)
    expect((await rawGet(`${s.url}${path}`, `localhost:${port}`)).status).toBe(200)
    // 브라우저가 실제로 보내는 형태(= fetch 가 스스로 채우는 Host)도 통과해야 한다.
    expect((await fetch(`${s.url}${path}`)).status).toBe(200)
  })

  it('낯선 Host 로는 쓰기(model.mutate)도 닿지 않는다', async () => {
    const s = await start(await project())
    const res = await new Promise<number>((resolve, reject) => {
      const u = new URL(`${s.url}/trpc/model.mutate`)
      const req = httpRequest(
        {
          host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
          headers: { Host: 'evil.example.com', 'content-type': 'application/json' },
        },
        (r) => { r.resume(); r.on('end', () => { resolve(r.statusCode ?? 0) }) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ projectId: LOCAL_PROJECT_ID, ops: [] }))
    })
    expect(res).toBe(403)
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

  it('접속 시 현재 상태 스냅샷을 한 번 보내고, 그 뒤 외부 파일 변경을 SSE 로 알린다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()

    // 접속 시점의(정상) 상태 스냅샷이 먼저 온다 — 그것부터 소비한다.
    const initial = await reader.read()
    expect(new TextDecoder().decode(initial.value)).toContain('reload')

    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')

    expect(await chunk).toContain('reload')
    await reader.cancel()
  }, 10_000)

  it('erdd/ 가 기동 시점에 없어도, 나중에 생기면 그 안의 변경을 SSE 로 알린다', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'erdd-server-'))
    await writeFile(join(cwd, 'erdd.config.yaml'), [
      'dialects: [postgresql]',
      'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
      '',
    ].join('\n'), 'utf8')
    // erdd/ 는 일부러 만들지 않는다 — `init --local` 직후 첫 `serve` 상태를 그대로 재현한다.
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()

    // 접속 시점의(정상) 상태 스냅샷이 먼저 온다 — 그것부터 소비한다.
    const initial = await reader.read()
    expect(new TextDecoder().decode(initial.value)).toContain('reload')

    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await mkdir(join(cwd, 'erdd/tables'), { recursive: true })
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')

    expect(await chunk).toContain('reload')
    await reader.cancel()
  }, 10_000)

  it('자기 쓰기는 SSE 로 알리지 않는다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()

    // 접속 시 스냅샷 1건을 먼저 소비한다.
    const initial = await reader.read()
    expect(new TextDecoder().decode(initial.value)).toContain('reload')

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

    // 접속 시 스냅샷(정상) 1건을 먼저 소비한다.
    const initial = await reader.read()
    expect(new TextDecoder().decode(initial.value)).toContain('reload')

    const chunk = (async () => {
      const { value } = await reader.read()
      return new TextDecoder().decode(value)
    })()

    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')

    expect(await chunk).toContain('blocked')
    await reader.cancel()
  }, 10_000)

  it('이미 blocked 인 상태로 접속해도 즉시 blocked 를 받는다', async () => {
    const cwd = await project()
    // 기동 전에 미리 깨뜨려 둔다 — 기동 로드 자체가 실패한 채로 뜬다.
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    // 새 변경이 없어도, 접속 자체가 현재(잠긴) 상태를 즉시 흘려보낸다.
    expect(new TextDecoder().decode(value)).toContain('blocked')
    await reader.cancel()
  }, 10_000)

  it('감시가 잡은 변경이 모델에 반영된다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    await sleep(100)
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')
    await sleep(500)
    const url = `${s.url}/trpc/model.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    const body = await (await fetch(url)).json() as {
      result: { data: { model: { tables: Record<string, { physicalName: string }> } } }
    }
    expect(Object.values(body.result.data.model.tables)[0]!.physicalName).toBe('MBR')
  }, 10_000)

  it('외부 erdd.config.yaml 편집이 project.get 에 반영된다', async () => {
    const cwd = await project()
    const s = await start(cwd)
    await sleep(100)
    await writeFile(join(cwd, 'erdd.config.yaml'), [
      'dialects: [mysql]',
      'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
      '',
    ].join('\n'), 'utf8')
    await sleep(500)
    const url = `${s.url}/trpc/project.get?input=${encodeURIComponent(JSON.stringify({ projectId: LOCAL_PROJECT_ID }))}`
    const body = await (await fetch(url)).json() as { result: { data: { dialects: string[] } } }
    expect(body.result.data.dialects).toEqual(['mysql'])
  }, 10_000)

  it('같은 내용의 외부 변경이 반복돼도 reload 가 중복해서 나가지 않는다 — changed 필터', async () => {
    const cwd = await project()
    const s = await start(cwd)
    const res = await fetch(`${s.url}/local/events`)
    const reader = res.body!.getReader()

    const messages: string[] = []
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        messages.push(new TextDecoder().decode(value))
      }
    })()

    // 접속 시 스냅샷 1건.
    await sleep(100)
    expect(messages.length).toBe(1)

    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')
    await sleep(500)
    expect(messages.length).toBe(2)

    // 같은 내용을 그대로 다시 쓴다 — 모델은 바뀌지 않는다. 감시는 다시 발화해도(플랫폼에
    // 따라 다름) 필터가 걸러 reload 가 늘지 않아야 한다.
    await writeFile(join(cwd, 'erdd/tables/MBR.yaml'), MBR_TABLE, 'utf8')
    await sleep(500)
    expect(messages.length).toBe(2)

    await reader.cancel()
  }, 10_000)
})
