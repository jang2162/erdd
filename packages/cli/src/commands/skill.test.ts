import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skill } from './skill.js'

let dir: string
let out: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-skill-'))
  out = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => vi.restoreAllMocks())

const ctx = (over: Record<string, unknown> = {}) => ({
  cwd: dir, json: true, yes: false, strict: false, sub: 'install', force: false, ...over,
})

describe('skill install', () => {
  it('.claude/skills/erdd/SKILL.md에 설치한다', async () => {
    expect(await skill(ctx())).toBe(0)
    const body = await readFile(join(dir, '.claude/skills/erdd/SKILL.md'), 'utf8')
    expect(body).toContain('name: erdd')
    expect(body).toContain('erdd pull')
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, overwritten: false })
  })

  it('이미 있으면 --force 없이는 덮어쓰지 않는다', async () => {
    await mkdir(join(dir, '.claude/skills/erdd'), { recursive: true })
    await writeFile(join(dir, '.claude/skills/erdd/SKILL.md'), '내 것', 'utf8')
    expect(await skill(ctx())).toBe(1)
    expect(await readFile(join(dir, '.claude/skills/erdd/SKILL.md'), 'utf8')).toBe('내 것')
    expect(out.join('')).toContain('--force')
  })

  it('--force면 덮어쓴다', async () => {
    await mkdir(join(dir, '.claude/skills/erdd'), { recursive: true })
    await writeFile(join(dir, '.claude/skills/erdd/SKILL.md'), '내 것', 'utf8')
    expect(await skill(ctx({ force: true }))).toBe(0)
    expect(await readFile(join(dir, '.claude/skills/erdd/SKILL.md'), 'utf8')).toContain('name: erdd')
    expect(JSON.parse(out.join(''))).toMatchObject({ overwritten: true })
  })

  it('--dir로 위치를 바꾼다', async () => {
    expect(await skill(ctx({ dir: 'docs/skills/erdd' }))).toBe(0)
    expect(await readFile(join(dir, 'docs/skills/erdd/SKILL.md'), 'utf8')).toContain('name: erdd')
  })

  it('install 외의 하위 명령은 사용법 오류다', async () => {
    expect(await skill(ctx({ sub: 'remove' }))).toBe(2)
  })
})
