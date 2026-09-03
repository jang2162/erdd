import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, type ProjectModel } from '@erdd/core'
import { readBase, writeConfig } from '../config.js'
import { seedPulled, TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { importCommand } from './import.js'

let dir: string
let out: string[]
let err: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-import-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, {
    ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], namingRules: { ...TEST_CONFIG.namingRules },
  })
})
afterEach(() => vi.restoreAllMocks())

function model(): ProjectModel {
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
  return m
}

const DDL = `CREATE TABLE ORD (
  ORD_NO bigint NOT NULL,
  ORD_STTUS varchar(20),
  PRIMARY KEY (ORD_NO)
);`
const DBML = `Table "PRD" {
  "PRD_NO" bigint [pk]
  "PRD_NM" varchar(100)
}`

async function ddlFile(name = 'schema.sql', body = DDL): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, body, 'utf8')
  return p
}

const base = { strict: false } as const
const yes = { yes: true, ...base } as const

describe('import', () => {
  it('.sql 은 DDL 로 읽고 테이블 파일을 만든다', async () => {
    await seedPulled(dir, model())
    const code = await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: false })
    expect(code).toBe(0)
    const names = await readdir(join(dir, 'erdd/tables'))
    expect(names.sort()).toEqual(['MBR.yaml', 'ORD.yaml'])
  })

  it('.dbml 은 DBML 로 읽는다', async () => {
    await seedPulled(dir, model())
    const code = await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('schema.dbml', DBML), dryRun: false,
    })
    expect(code).toBe(0)
    expect((await readdir(join(dir, 'erdd/tables'))).sort()).toEqual(['MBR.yaml', 'PRD.yaml'])
  })

  it('--format 이 확장자를 이긴다', async () => {
    await seedPulled(dir, model())
    // 확장자는 .sql 인데 내용은 DBML 이다 — --format 을 안 보면 테이블이 하나도 안 생긴다.
    const code = await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('weird.sql', DBML),
      format: 'dbml', dryRun: false,
    })
    expect(code).toBe(0)
    expect((await readdir(join(dir, 'erdd/tables'))).sort()).toEqual(['MBR.yaml', 'PRD.yaml'])
  })

  it('확장자로 형식을 못 정하면 내용을 추정하지 않고 USAGE(2)로 끝난다', async () => {
    await seedPulled(dir, model())
    const code = await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('schema.txt'), dryRun: false,
    })
    expect(code).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })

  it('DDL 의 방언은 --dialect > detectDialect > config.dialects[0] 순이다', async () => {
    await seedPulled(dir, model())
    // (1) 아무 단서가 없으면 config 의 첫 방언
    await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: true })
    expect(JSON.parse(out.join('')).dialect).toBe('postgresql')
    // (2) 본문에 mysql 특징 토큰이 있으면 detectDialect 가 이긴다
    out.length = 0
    const mysqlDdl = 'CREATE TABLE ORD (ORD_NO bigint NOT NULL AUTO_INCREMENT, PRIMARY KEY (ORD_NO));'
    await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('m.sql', mysqlDdl), dryRun: true,
    })
    expect(JSON.parse(out.join('')).dialect).toBe('mysql')
    // (3) --dialect 가 그 위다
    out.length = 0
    await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('m2.sql', mysqlDdl),
      dialect: 'oracle', dryRun: true,
    })
    expect(JSON.parse(out.join('')).dialect).toBe('oracle')
  })

  it('머지다 — 기존 테이블의 id 를 지키고 DDL 에 없는 테이블을 지우지 않는다', async () => {
    await seedPulled(dir, model())
    await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: false })
    const tree = await readTree(dir)
    expect((tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['id']).toBe('tb1')
    expect(tree['erdd/tables/ORD.yaml']).toBeDefined()
  })

  it('새 엔티티 id 를 uuidv7 로 파일에 바로 박는다 — new: 임시 id 가 새지 않는다', async () => {
    await seedPulled(dir, model())
    // 사용자가 손으로 만든 id 없는 테이블 파일. filesToModel 이 임시 id 를 붙이는 자리다.
    await writeFile(join(dir, 'erdd/tables/CUST.yaml'), 'name: CUST\nlogicalName: 고객\ncolumns:\n  - name: CUST_NO\n    logicalName: 고객번호\n    type: BIGINT\n    pk: true\n', 'utf8')
    const code = await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: false })
    expect(code).toBe(0)
    const names = await readdir(join(dir, 'erdd/tables'))
    for (const n of names) {
      const raw = await readFile(join(dir, 'erdd/tables', n), 'utf8')
      expect(raw).not.toContain('new:')
    }
    const tree = await readTree(dir)
    const ordId = (tree['erdd/tables/ORD.yaml'] as Record<string, unknown>)['id']
    expect(ordId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('--dry-run 은 파일을 하나도 건드리지 않는다', async () => {
    await seedPulled(dir, model())
    const before = await readTree(dir)
    const code = await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: true })
    expect(code).toBe(0)
    expect(await readTree(dir)).toEqual(before)
    const parsed = JSON.parse(out.join('')) as { dryRun: boolean; added: number; written: string[] }
    expect(parsed.dryRun).toBe(true)
    expect(parsed.added).toBe(1)
    expect(parsed.written).toEqual([])
  })

  it('--yes 가 없으면 확인을 받고 거절하면 CANCELLED 로 아무것도 쓰지 않는다', async () => {
    await seedPulled(dir, model())
    const before = await readTree(dir)
    const confirm = vi.fn(async () => false)
    const code = await importCommand({
      cwd: dir, json: true, yes: false, ...base, confirm, file: await ddlFile(), dryRun: false,
    })
    expect(confirm).toHaveBeenCalled()
    expect(code).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('CANCELLED')
    expect(await readTree(dir)).toEqual(before)
  })

  it('비대화형에서 확인할 수 없으면 --yes 를 가리키며 멈춘다', async () => {
    await seedPulled(dir, model())
    const code = await importCommand({
      cwd: dir, json: true, yes: false, ...base, file: await ddlFile(), dryRun: false,
    })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join('')) as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('CANCELLED')
    expect(parsed.error.message).toContain('--yes')
  })

  it('가져오기 경고를 사람용 출력과 --json 양쪽에 싣는다', async () => {
    await seedPulled(dir, model())
    // 모르는 타입 → unknown-type 경고
    const odd = 'CREATE TABLE ORD (ORD_NO bigint NOT NULL, MEMO weirdtype(3), PRIMARY KEY (ORD_NO));'
    const file = await ddlFile('odd.sql', odd)
    await importCommand({ cwd: dir, json: true, ...yes, file, dryRun: true })
    const parsed = JSON.parse(out.join('')) as { warnings: Array<{ kind: string }> }
    expect(parsed.warnings.map((w) => w.kind)).toContain('unknown-type')
    out.length = 0
    await importCommand({ cwd: dir, json: false, ...yes, file, dryRun: true })
    expect(out.join('')).toContain('unknown-type')
  })

  it('base·sync 를 건드리지 않는다 — status 가 로컬 변경으로 봐야 한다', async () => {
    await seedPulled(dir, model())
    const baseBefore = await readBase(dir)
    await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: false })
    expect(await readBase(dir)).toEqual(baseBefore)
  })

  it('파일이 없으면 NOT_FOUND 로 1이다', async () => {
    await seedPulled(dir, model())
    const code = await importCommand({
      cwd: dir, json: true, ...yes, file: join(dir, 'nope.sql'), dryRun: false,
    })
    expect(code).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NOT_FOUND')
  })

  it('로컬 파일 파싱 오류면 validate 와 같은 봉투로 1이고 아무것도 쓰지 않는다', async () => {
    await seedPulled(dir, model())
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['group'] = '없는그룹'
    await writeTree(dir, tree)
    out.length = 0
    const code = await importCommand({ cwd: dir, json: true, ...yes, file: await ddlFile(), dryRun: false })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join('')) as { ok: boolean; parseErrors: unknown[] }
    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed.parseErrors)).toContain('없는그룹')
    expect((await readdir(join(dir, 'erdd/tables'))).sort()).toEqual(['MBR.yaml'])
  })
  /**
   * ⚠️ **DBML 에는 detectDialect 를 쓰지 않는다.** DBML 의 속성 문법(`[pk, increment, …]`)이
   * detectDialect 의 mssql 대괄호 식별자 시그니처를 **항상** 때려서, 다른 시그니처가 없으면
   * 모든 DBML 이 mssql 로 탐지된다(스모크에서 mysql 프로젝트가 낸 DBML 이 실제로 mssql 로
   * 읽혔다). 웹 다이얼로그와 같이 `Project { database_type }` 을 본다.
   */
  it('DBML 의 방언은 database_type 을 따르고, 없으면 config 로 떨어진다 — mssql 로 새지 않는다', async () => {
    await seedPulled(dir, model())   // config.dialects 는 ['postgresql']
    // (1) database_type 이 있으면 그것이다
    const withType = `Project "P" {
  database_type: 'MySQL'
}
Table "PRD" {
  "PRD_NO" bigint [pk]
}`
    await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('a.dbml', withType), dryRun: true,
    })
    expect(JSON.parse(out.join('')).dialect).toBe('mysql')
    // (2) 없으면 config.dialects[0] — detectDialect 를 태웠다면 여기서 mssql 이 나온다
    out.length = 0
    await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('b.dbml', DBML), dryRun: true,
    })
    expect(JSON.parse(out.join('')).dialect).toBe('postgresql')
    // (3) --dialect 가 그 위다
    out.length = 0
    await importCommand({
      cwd: dir, json: true, ...yes, file: await ddlFile('c.dbml', withType),
      dialect: 'oracle', dryRun: true,
    })
    expect(JSON.parse(out.join('')).dialect).toBe('oracle')
  })

  it('어느 방언을 왜 골랐는지 사람용 출력에 적는다 — 조용히 고르지 않는다', async () => {
    await seedPulled(dir, model())
    await importCommand({ cwd: dir, json: false, ...yes, file: await ddlFile(), dryRun: true })
    expect(out.join('')).toContain('erdd.config.yaml')
    out.length = 0
    const mysqlDdl = 'CREATE TABLE ORD (ORD_NO bigint NOT NULL AUTO_INCREMENT, PRIMARY KEY (ORD_NO));'
    await importCommand({
      cwd: dir, json: false, ...yes, file: await ddlFile('m3.sql', mysqlDdl), dryRun: true,
    })
    expect(out.join('')).toContain('본문에서 감지')
    out.length = 0
    await importCommand({
      cwd: dir, json: false, ...yes, file: await ddlFile(), dialect: 'oracle', dryRun: true,
    })
    expect(out.join('')).toContain('--dialect')
  })
})
