import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createEmptyModel, filesToModel, type Dialect, type ProjectModel,
} from '@erdd/core'
import { writeConfig } from '../config.js'
import { seedPulled, TEST_CONFIG } from '../testing/harness.js'
import { readTree } from '../tree.js'
import { dbmlProjectName, exportCommand } from './export.js'
import { importCommand } from './import.js'

let out: string[]
let err: string[]
beforeEach(() => {
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
})
afterEach(() => vi.restoreAllMocks())

async function project(dialect: Dialect = 'postgresql'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-rt-'))
  await writeConfig(dir, {
    ...TEST_CONFIG, dialects: [dialect], namingRules: { ...TEST_CONFIG.namingRules },
  })
  return dir
}

/** id·좌표를 뺀 모델의 모양. 왕복 비교의 기준이다. */
function shape(m: ProjectModel) {
  return {
    tables: Object.values(m.tables)
      .map((t) => ({ physicalName: t.physicalName, logicalName: t.logicalName, comment: t.comment }))
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
    columns: Object.values(m.columns)
      .map((c) => ({
        table: m.tables[c.tableId]!.physicalName,
        physicalName: c.physicalName, logicalName: c.logicalName, type: c.type,
        isPk: c.isPk, nullable: c.nullable, autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue, order: c.order,
      }))
      .sort((a, b) => (a.table + a.physicalName).localeCompare(b.table + b.physicalName)),
    indexes: Object.values(m.indexes)
      .map((ix) => ({
        table: m.tables[ix.tableId]!.physicalName, name: ix.name, unique: ix.unique,
        columns: ix.columns.map((c) => m.columns[c.columnId]!.physicalName),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: Object.values(m.relationships)
      .map((r) => ({
        parent: m.tables[r.parentTableId]!.physicalName,
        child: m.tables[r.childTableId]!.physicalName,
        cardinality: r.cardinality, identifying: r.identifying,
        columns: r.columnMappings.map((cm) => ({
          child: m.columns[cm.childColumnId]!.physicalName,
          parent: m.columns[cm.parentColumnId]!.physicalName,
        })),
      }))
      .sort((a, b) => (a.parent + a.child).localeCompare(b.parent + b.child)),
  }
}

async function modelOf(dir: string): Promise<ProjectModel> {
  const r = filesToModel(await readTree(dir))
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.issues)}`)
  return r.model
}

function sourceModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: '회원 기본 정보',
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: null, position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: true, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM', type: 'VARCHAR(100)',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 1,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: false, autoIncrement: false, nullable: false, defaultValue: null, order: 1,
    comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: false, name: null,
  }
  return m
}

const yes = { yes: true, strict: false, json: true } as const

describe('erdd export → erdd import 왕복', () => {
  it('DDL 왕복 — 빈 프로젝트에 되읽으면 같은 모델이 나온다(id·좌표 제외)', async () => {
    const from = await project()
    await seedPulled(from, sourceModel())
    const file = join(from, 'schema.sql')
    expect(await exportCommand({ cwd: from, ...yes, format: 'ddl', out: file })).toBe(0)

    const to = await project()
    expect(await importCommand({ cwd: to, ...yes, file, dryRun: false })).toBe(0)
    expect(shape(await modelOf(to))).toEqual(shape(await modelOf(from)))
  })

  it('DBML 왕복 — 빈 프로젝트에 되읽으면 같은 모델이 나온다(id·좌표 제외)', async () => {
    const from = await project()
    await seedPulled(from, sourceModel())
    const file = join(from, 'schema.dbml')
    expect(await exportCommand({ cwd: from, ...yes, format: 'dbml', out: file })).toBe(0)

    const to = await project()
    expect(await importCommand({ cwd: to, ...yes, file, dryRun: false })).toBe(0)
    expect(shape(await modelOf(to))).toEqual(shape(await modelOf(from)))
  })

  /**
   * ⚠️ **CLI 자신이 낸 DBML 을 되읽는 경로다.** 위의 두 왕복은 방언이 같은 프로젝트끼리 오가서
   * `config.dialects[0]` 이 우연히 맞아떨어져도 통과한다 — 그래서 **`export` 가 `Project` 블록을
   * 아예 안 싣던 구멍을 아무도 못 잡았다**(리뷰가 실측으로 찾았다). 방언이 **다른** 프로젝트로
   * 되읽어야 `database_type` 이 실렸는지가 드러난다.
   */
  it('DBML 왕복 — 방언이 다른 프로젝트로 되읽어도 원본 방언이 실려 간다', async () => {
    const from = await project('mysql')
    await seedPulled(from, sourceModel())
    const file = join(from, 'schema.dbml')
    expect(await exportCommand({ cwd: from, ...yes, format: 'dbml', out: file })).toBe(0)
    // 산출물 자체에 방언이 박혀 있어야 한다 — 이것이 없으면 아래는 config 로 떨어진다.
    expect(await readFile(file, 'utf8')).toContain("database_type: 'MySQL'")

    const to = await project('postgresql')
    out.length = 0
    expect(await importCommand({ cwd: to, ...yes, file, dryRun: true })).toBe(0)
    const parsed = JSON.parse(out.join('')) as { dialect: string; dialectSource: string }
    expect(parsed.dialect).toBe('mysql')
    expect(parsed.dialectSource).toBe('Project의 database_type')
  })

  /**
   * 경계 — 디렉터리 이름을 이름으로 쓰므로 **이름이 빈 문자열이 되는 자리**(파일시스템 루트)가
   * 있다. 그때는 `Project` 블록이 빠지고 방언은 `config.dialects[0]` 으로 떨어진다 — 이 수정
   * 이전의 동작이라 회귀가 아니다. 갈래가 있다는 사실을 여기서 못 박는다.
   */
  it('작업 디렉터리 이름이 비면 Project 블록 없이 낸다(루트 경계)', () => {
    expect(dbmlProjectName('/tmp/my-project')).toBe('my-project')
    expect(dbmlProjectName('/')).toBeUndefined()
  })

  /** 공백·한글·하이픈이 든 디렉터리 이름도 `quoteDbmlIdent` 가 감싸 파싱되는 DBML 이 된다. */
  it('디렉터리 이름에 공백·한글이 있어도 되읽힌다', async () => {
    const base = await mkdtemp(join(tmpdir(), 'erdd-rt-'))
    const from = join(base, '내 프로젝트 v2')
    await mkdir(from)
    await writeConfig(from, {
      ...TEST_CONFIG, dialects: ['mysql'], namingRules: { ...TEST_CONFIG.namingRules },
    })
    await seedPulled(from, sourceModel())
    const file = join(from, 'schema.dbml')
    expect(await exportCommand({ cwd: from, ...yes, format: 'dbml', out: file })).toBe(0)
    expect(await readFile(file, 'utf8')).toContain('Project "내 프로젝트 v2"')

    const to = await project('postgresql')
    out.length = 0
    expect(await importCommand({ cwd: to, ...yes, file, dryRun: true })).toBe(0)
    expect((JSON.parse(out.join('')) as { dialect: string }).dialect).toBe('mysql')
  })

  /**
   * 피드백 1·2번을 닫은 자리다. **예전에는 이 테스트가 「현재 유실된다」를 단언하고 있었다** —
   * 부호 없음이 담길 자리가 없고 테이블 옵션도 모델에 자리가 없어 둘 다 경고 한 줄 없이
   * 사라졌다. 2026-09-03 사이클이 단언을 뒤집었다(유실 → 보존).
   *
   * ⚠️ **이 왕복이 닫히려면 `erdd import` 가 `erdd.config.yaml` 에 테이블 옵션을 써야 한다**
   * (설계 §5.5). 그 반영을 없애면 여기의 ENGINE·CHARSET 단언이 곧바로 빨개진다 — 둘은 한 몸이다.
   *
   * ⚠️ **경고 집합은 그대로 `{'unknown-word'}` 다.** 테이블이 하나라 다수결 충돌이 없고, 부호
   * 없음은 이제 정상 해석이라 경고를 내지 않는다. **이 단언을 지우지 마라** — 새 경고가
   * 조용히 늘면 여기서 걸린다.
   */
  it('MySQL INT UNSIGNED·ENGINE·CHARSET 이 왕복에서 보존된다 (피드백 1·2번)', async () => {
    const dir = await project('mysql')
    const src = join(dir, 'mysql.sql')
    await writeFile(src, `CREATE TABLE ORD (
  ORD_NO int unsigned NOT NULL AUTO_INCREMENT,
  QTY smallint unsigned NOT NULL,
  PRIMARY KEY (ORD_NO)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`, 'utf8')

    out.length = 0
    expect(await importCommand({ cwd: dir, ...yes, file: src, dryRun: false })).toBe(0)
    const kinds = (JSON.parse(out.join('')) as { warnings: Array<{ kind: string }> })
      .warnings.map((w) => w.kind)
    expect(new Set(kinds)).toEqual(new Set(['unknown-word']))

    out.length = 0
    const back = join(dir, 'back.sql')
    expect(await exportCommand({ cwd: dir, ...yes, format: 'ddl', out: back })).toBe(0)
    const ddl = await readFile(back, 'utf8')

    // 원본에 있던 것이 전부 돌아온다.
    expect(ddl).toContain('ORD_NO INT UNSIGNED AUTO_INCREMENT NOT NULL')
    expect(ddl).toContain('QTY SMALLINT UNSIGNED NOT NULL')
    expect(ddl).toContain('ENGINE=InnoDB')
    expect(ddl).toContain('CHARSET=utf8mb4')
  })
})
