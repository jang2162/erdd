import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serve } from './serve.js'

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
