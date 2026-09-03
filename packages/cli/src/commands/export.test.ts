import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, type ProjectModel } from '@erdd/core'
import { writeConfig } from '../config.js'
import { seedPulled, TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { exportCommand } from './export.js'

let dir: string
let out: string[]
let err: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-export-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules } })
})
afterEach(() => vi.restoreAllMocks())

/** 컬럼 하나짜리 테이블 + (옵션) 컬럼 없는 테이블(ddlWarnings 를 내는 자리). */
function model(withEmptyTable = false): ProjectModel {
  const m = createEmptyModel()
  m.tables['tb1'] = {
    id: 'tb1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  if (withEmptyTable) {
    m.tables['tb2'] = {
      id: 'tb2', logicalName: '빈테이블', physicalName: 'EMPTY_TB', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
  }
  return m
}

const base = { yes: false, strict: false } as const

describe('export', () => {
  it('기본은 DDL 을 stdout 으로 낸다', async () => {
    await seedPulled(dir, model())
    const code = await exportCommand({ cwd: dir, json: false, ...base, format: 'ddl' })
    expect(code).toBe(0)
    expect(out.join('')).toContain('CREATE TABLE MBR')
    expect(err.join('')).not.toContain('CREATE TABLE')
  })

  it('--format dbml 이면 DBML 을 낸다', async () => {
    await seedPulled(dir, model())
    const code = await exportCommand({ cwd: dir, json: false, ...base, format: 'dbml' })
    expect(code).toBe(0)
    // DBML 은 식별자를 따옴표로 감싼다 — 브리프 기대값('Table MBR')을 실제 출력으로 정정했다.
    expect(out.join('')).toContain('Table "MBR"')
    expect(out.join('')).not.toContain('CREATE TABLE')
  })

  it('-o 를 주면 파일에 쓰고 stdout 에는 DDL 을 내지 않는다', async () => {
    await seedPulled(dir, model())
    const target = join(dir, 'schema.sql')
    const code = await exportCommand({ cwd: dir, json: false, ...base, format: 'ddl', out: target })
    expect(code).toBe(0)
    expect(await readFile(target, 'utf8')).toContain('CREATE TABLE MBR')
    expect(out.join('')).not.toContain('CREATE TABLE MBR')
  })

  it('방언 기본값은 config.dialects[0] 이고 --dialect 로 덮는다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: ['mysql'], namingRules: { ...TEST_CONFIG.namingRules },
    })
    await seedPulled(dir, model())
    await exportCommand({ cwd: dir, json: true, ...base, format: 'ddl' })
    expect(JSON.parse(out.join('')).dialect).toBe('mysql')
    out.length = 0
    await exportCommand({ cwd: dir, json: true, ...base, format: 'ddl', dialect: 'oracle' })
    expect(JSON.parse(out.join('')).dialect).toBe('oracle')
  })

  it('config.dialects 에 없는 유효한 방언은 허용하되 stderr 로 한 줄 알린다', async () => {
    await seedPulled(dir, model())   // config.dialects 는 ['postgresql']
    const code = await exportCommand({ cwd: dir, json: false, ...base, format: 'ddl', dialect: 'oracle' })
    expect(code).toBe(0)
    expect(err.join('')).toContain('oracle')
    expect(err.join('')).toContain('erdd.config.yaml')
  })

  it('ddlWarnings 는 stderr 로 낸다 — stdout 파이프를 오염시키지 않는다', async () => {
    await seedPulled(dir, model(true))
    const code = await exportCommand({ cwd: dir, json: false, ...base, format: 'ddl' })
    expect(code).toBe(0)
    expect(err.join('')).toContain('EMPTY_TB')
    expect(out.join('')).not.toContain('EMPTY_TB')
  })

  it('--json 은 { format, dialect, path, content, warnings } 를 낸다', async () => {
    await seedPulled(dir, model(true))
    const code = await exportCommand({ cwd: dir, json: true, ...base, format: 'ddl' })
    expect(code).toBe(0)
    const parsed = JSON.parse(out.join('')) as {
      format: string; dialect: string; path: string | null
      content: string | null; warnings: string[]
    }
    expect(parsed.format).toBe('ddl')
    expect(parsed.dialect).toBe('postgresql')
    expect(parsed.path).toBeNull()
    expect(parsed.content).toContain('CREATE TABLE MBR')
    expect(parsed.warnings.join('')).toContain('EMPTY_TB')
  })

  it('--json + -o 면 content 는 null 이고 path 가 채워진다', async () => {
    await seedPulled(dir, model())
    const target = join(dir, 'out.sql')
    await exportCommand({ cwd: dir, json: true, ...base, format: 'ddl', out: target })
    const parsed = JSON.parse(out.join('')) as { path: string | null; content: string | null }
    expect(parsed.path).toBe(target)
    expect(parsed.content).toBeNull()
    expect(await readFile(target, 'utf8')).toContain('CREATE TABLE MBR')
  })

  it('파일 파싱 오류면 validate 와 같은 봉투로 1로 끝난다', async () => {
    await seedPulled(dir, model())
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['group'] = '없는그룹'
    await writeTree(dir, tree)
    out.length = 0
    const code = await exportCommand({ cwd: dir, json: true, ...base, format: 'ddl' })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join('')) as { ok: boolean; parseErrors: unknown[] }
    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed.parseErrors)).toContain('없는그룹')
  })
})

/**
 * ⚠️ **`generateDdl` 의 5번째 인자는 옵셔널이라 빠뜨려도 조용히 동작한다.** 이 배선은
 * core 테스트로는 절대 안 잡힌다 — 그래서 호출처마다 「설정한 옵션이 산출물에 있다」를
 * 따로 단언한다(설계 §5.4·§8.2). 웹 `export-dialog` 에도 짝이 되는 단언이 있다.
 */
describe('export — 테이블 옵션 배선', () => {
  it('erdd.config.yaml 의 테이블 옵션이 DDL 에 나간다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: ['mysql'], namingRules: { ...TEST_CONFIG.namingRules },
      tableOptions: { postgresql: '', mysql: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', oracle: '', mssql: '' },
    })
    await seedPulled(dir, model())
    const file = join(dir, 'out.sql')
    expect(await exportCommand({ cwd: dir, json: false, yes: true, strict: false, format: 'ddl', out: file })).toBe(0)
    // 옵션은 `)` 뒤, `COMMENT` **앞**이다(설계 §5.4 — 파서의 코멘트 스캔이 그대로 맞게).
    expect(await readFile(file, 'utf8'))
      .toContain(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '회원';")
  })

  it('그 방언의 칸이 비면 붙지 않는다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: ['postgresql'], namingRules: { ...TEST_CONFIG.namingRules },
      tableOptions: { postgresql: '', mysql: 'ENGINE=InnoDB', oracle: '', mssql: '' },
    })
    await seedPulled(dir, model())
    const file = join(dir, 'out.sql')
    expect(await exportCommand({ cwd: dir, json: false, yes: true, strict: false, format: 'ddl', out: file })).toBe(0)
    expect(await readFile(file, 'utf8')).not.toContain('ENGINE')
  })
})
