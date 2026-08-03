import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConfig, writeConfig, readSync, writeSync, readBase, writeBase,
  resolveToken, writeToken, ensureGitignore,
} from './config.js'
import type { ErddConfig } from './config.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'erdd-cli-')) })
afterEach(() => { delete process.env['ERDD_TOKEN'] })

const CONFIG: ErddConfig = {
  serverUrl: 'https://erdd.example.com',
  projectId: '018f6b0e-0000-7000-8000-000000000000',
  dialects: ['postgresql'],
  namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 },
}

describe('config', () => {
  it('설정이 없으면 NO_CONFIG를 던진다', async () => {
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'NO_CONFIG' })
  })

  it('쓰고 읽으면 같다', async () => {
    await writeConfig(dir, CONFIG)
    expect(await readConfig(dir)).toEqual(CONFIG)
  })

  it('설정 파일은 YAML이다', async () => {
    await writeConfig(dir, CONFIG)
    const raw = await readFile(join(dir, 'erdd.config.yaml'), 'utf8')
    expect(raw).toContain('serverUrl: https://erdd.example.com')
    expect(raw).not.toContain('{')
  })

  it('필수 필드가 빠지면 VALIDATION이다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'), 'serverUrl: https://x\n', 'utf8')
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('dialects에 알 수 없는 방언이 있으면 VALIDATION이다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'),
      'serverUrl: https://x\nprojectId: p1\ndialects: [nope]\n'
      + 'namingRules: {case: UPPER_SNAKE, separator: _, maxLengthBytes: 30}\n', 'utf8')
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('dialects가 빈 배열이면 VALIDATION이다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'),
      'serverUrl: https://x\nprojectId: p1\ndialects: []\n'
      + 'namingRules: {case: UPPER_SNAKE, separator: _, maxLengthBytes: 30}\n', 'utf8')
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('namingRules의 필드가 빠지면 VALIDATION이다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'),
      'serverUrl: https://x\nprojectId: p1\ndialects: [postgresql]\n'
      + 'namingRules: {case: UPPER_SNAKE}\n', 'utf8')
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('최상위가 객체가 아니면 VALIDATION이다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'), '- a\n- b\n', 'utf8')
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('sync와 base는 없으면 null이다', async () => {
    expect(await readSync(dir)).toBeNull()
    expect(await readBase(dir)).toBeNull()
  })

  it('sync와 base를 쓰고 읽는다', async () => {
    await writeSync(dir, { revisionSeq: 42, pulledAt: '2026-08-03T07:00:00.000Z' })
    expect(await readSync(dir)).toEqual({ revisionSeq: 42, pulledAt: '2026-08-03T07:00:00.000Z' })
    await writeBase(dir, { 'erdd/groups.yaml': { groups: [] } })
    expect(await readBase(dir)).toEqual({ 'erdd/groups.yaml': { groups: [] } })
  })

  it('ERDD_TOKEN이 credentials보다 우선한다', async () => {
    await writeToken(dir, 'erdd_pat_file')
    expect(await resolveToken(dir)).toBe('erdd_pat_file')
    process.env['ERDD_TOKEN'] = 'erdd_pat_env'
    expect(await resolveToken(dir)).toBe('erdd_pat_env')
  })

  it('토큰이 아무 데도 없으면 null이다', async () => {
    expect(await resolveToken(dir)).toBeNull()
  })

  it('ensureGitignore는 .erdd/를 한 번만 넣는다', async () => {
    await ensureGitignore(dir)
    await ensureGitignore(dir)
    const raw = await readFile(join(dir, '.gitignore'), 'utf8')
    expect(raw.match(/^\.erdd\/$/gm)).toHaveLength(1)
  })

  it('ensureGitignore는 기존 내용을 지우지 않는다', async () => {
    await writeFile(join(dir, '.gitignore'), 'node_modules\n', 'utf8')
    await ensureGitignore(dir)
    const raw = await readFile(join(dir, '.gitignore'), 'utf8')
    expect(raw).toContain('node_modules')
    expect(raw).toContain('.erdd/')
  })
})
