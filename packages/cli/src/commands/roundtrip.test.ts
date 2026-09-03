import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createEmptyModel, filesToModel, type Dialect, type ProjectModel,
} from '@erdd/core'
import { writeConfig } from '../config.js'
import { seedPulled, TEST_CONFIG } from '../testing/harness.js'
import { readTree } from '../tree.js'
import { exportCommand } from './export.js'
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
   * ⚠️ **이 테스트는 「고쳐진 동작」이 아니라 「현재 유실된다」를 단언한다 — 피드백 1·2번이고
   * 별도 설계 사이클에서 다룬다.**
   *
   * 컬럼 타입은 방언 중립 논리 타입 17종이라 `INT UNSIGNED`의 부호 없음이 담길 자리가 없고,
   * 테이블 옵션(`ENGINE`·`DEFAULT CHARSET`)도 모델에 자리가 없다. 둘 다 **경고 한 줄 없이**
   * 조용히 사라진다(실측: `planDdlImport`의 warnings 에 unknown-type·ambiguous-type 도 없다).
   *
   * 나중에 그것을 고치면 **이 테스트가 빨개져서** 사람을 이 자리로 데려온다. 그때 단언을
   * 뒤집어라(유실 → 보존).
   */
  it('MySQL INT UNSIGNED·ENGINE·CHARSET 은 현재 왕복에서 유실된다 (피드백 1·2번)', async () => {
    const dir = await project('mysql')
    const src = join(dir, 'mysql.sql')
    await writeFile(src, `CREATE TABLE ORD (
  ORD_NO int unsigned NOT NULL AUTO_INCREMENT,
  QTY smallint unsigned NOT NULL,
  PRIMARY KEY (ORD_NO)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`, 'utf8')

    out.length = 0
    expect(await importCommand({ cwd: dir, ...yes, file: src, dryRun: false })).toBe(0)
    // 유실을 알리는 경고조차 없다 — 있는 경고는 사전에 없는 단어(unknown-word)뿐이다.
    const kinds = (JSON.parse(out.join('')) as { warnings: Array<{ kind: string }> })
      .warnings.map((w) => w.kind)
    expect(new Set(kinds)).toEqual(new Set(['unknown-word']))

    out.length = 0
    const back = join(dir, 'back.sql')
    expect(await exportCommand({ cwd: dir, ...yes, format: 'ddl', out: back })).toBe(0)
    const ddl = await readFile(back, 'utf8')

    // 원본에 있던 것 — 왕복 뒤에는 하나도 남지 않는다.
    expect(ddl).not.toContain('UNSIGNED')
    expect(ddl).not.toContain('unsigned')
    expect(ddl).not.toContain('ENGINE')
    expect(ddl).not.toContain('CHARSET')
    // 사라진 자리는 부호 있는 정수다.
    expect(ddl).toContain('ORD_NO INT AUTO_INCREMENT NOT NULL')
    expect(ddl).toContain('QTY SMALLINT NOT NULL')
  })
})
