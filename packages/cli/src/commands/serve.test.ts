import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openBrowser, serve } from './serve.js'

// openBrowser가 spawn()의 반환값에 'error' 리스너를 붙이는지 잠근다 — 실제로 브라우저를
// 못 찾는 명령을 spawn하면 테스트 환경에서 진짜 브라우저가 뜨거나 플랫폼마다 결과가
// 달라지므로, spawn 자체를 목으로 바꿔 EventEmitter를 돌려주고 직접 'error'를 emit한다.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
const { spawn } = await import('node:child_process')
const mockSpawn = vi.mocked(spawn)

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-serve-'))
  await writeFile(join(dir, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  return dir
}

describe('serve', () => {
  it('config 가 없으면 실패한다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-serve-'))
    expect(await serve({ cwd: dir, json: true, yes: true, strict: false, open: false })).toBe(1)
  })

  it('포트가 이미 쓰이면 자동 증가시키지 않고 실패한다', async () => {
    const dir = await project()
    const blocker = createServer(() => {})
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const port = (blocker.address() as { port: number }).port
    try {
      const code = await serve({ cwd: dir, json: true, yes: true, strict: false, port, open: false })
      expect(code).toBe(1)
    } finally { blocker.close() }
  })
})

describe('openBrowser', () => {
  it('spawn 실패가 비동기 error 이벤트로 와도 프로세스를 죽이지 않는다', async () => {
    const fakeChild = Object.assign(new EventEmitter(), { unref: vi.fn() })
    mockSpawn.mockReturnValue(fakeChild as unknown as ReturnType<typeof spawn>)
    await openBrowser('http://127.0.0.1:4300')
    // 리스너가 없는 EventEmitter에 'error'를 emit하면 Node가 그 자리에서 다시 던진다 —
    // 리스너가 붙어 있어야 여기서 던지지 않는다(붙어 있지 않으면 실제로는 이 emit이 서버
    // 프로세스를 통째로 죽이는 unhandled 'error' 예외가 된다).
    expect(() => fakeChild.emit('error', new Error('ENOENT 흉내'))).not.toThrow()
  })
})
