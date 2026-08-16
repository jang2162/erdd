import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, filesToModel, modelToFiles, type ProjectModel } from '@erdd/core'
import { CliError } from './output.js'
import { canonical, diffTrees, readTree, writeTree } from './tree.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'erdd-tree-')) })

const TREE = {
  'erdd/tables/MBR.yaml': { id: 'tb1', name: 'MBR', columns: [] },
  'erdd/groups.yaml': { groups: [] },
  'erdd/words.yaml': { words: [] },
  'erdd/terms.yaml': { terms: [] },
  'erdd/domains.yaml': { domains: [] },
  'erdd/custom-fields.yaml': { customFields: [] },
}

describe('tree', () => {
  it('쓰고 읽으면 같다', async () => {
    await writeTree(dir, TREE)
    expect(await readTree(dir)).toEqual(TREE)
  })

  it('YAML로 쓴다', async () => {
    await writeTree(dir, TREE)
    const raw = await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')
    expect(raw).toContain('name: MBR')
    expect(raw).not.toContain('"name"')
  })

  it('이번 트리에 없는 테이블 파일을 지운다', async () => {
    await writeTree(dir, TREE)
    await writeFile(join(dir, 'erdd/tables/GONE.yaml'), 'id: x\n', 'utf8')
    const { deleted } = await writeTree(dir, TREE)
    expect(deleted).toEqual(['erdd/tables/GONE.yaml'])
    expect(await readdir(join(dir, 'erdd/tables'))).toEqual(['MBR.yaml'])
  })

  it('소유하지 않은 파일은 지우지 않는다', async () => {
    await writeTree(dir, TREE)
    await mkdir(join(dir, 'erdd/docs'), { recursive: true })
    await writeFile(join(dir, 'erdd/docs/note.md'), '메모\n', 'utf8')
    await writeFile(join(dir, 'erdd/README.md'), '읽어줘\n', 'utf8')
    const { deleted } = await writeTree(dir, TREE)
    expect(deleted).toEqual([])
    expect(await readFile(join(dir, 'erdd/docs/note.md'), 'utf8')).toBe('메모\n')
    expect(await readFile(join(dir, 'erdd/README.md'), 'utf8')).toBe('읽어줘\n')
  })

  it('diffTrees가 추가·수정·삭제를 가른다', () => {
    const base = { a: { v: 1 }, b: { v: 2 }, c: { v: 3 } }
    const cur = { a: { v: 1 }, b: { v: 9 }, d: { v: 4 } }
    expect(diffTrees(base, cur)).toEqual({ added: ['d'], modified: ['b'], deleted: ['c'] })
  })

  it('키 순서만 다른 파일은 수정으로 보지 않는다', () => {
    const base = { a: { x: 1, y: 2 } }
    const cur = { a: { y: 2, x: 1 } }
    expect(diffTrees(base, cur).modified).toEqual([])
  })

  it('순환 참조는 무한 재귀 대신 무엇을 하면 되는지 아는 오류가 된다', () => {
    // YAML anchor/alias(`&a … *a`)가 만드는 자기 참조. 잡지 않으면 walk가 무한 재귀해
    // RangeError가 나고, 그것이 명령의 catch-all에 걸려 엉뚱한 코드로 보고된다.
    const cyclic: Record<string, unknown> = { name: 'CYC' }
    cyclic['self'] = cyclic
    expect(() => diffTrees({ 'erdd/tables/CYC.yaml': { name: 'CYC' } }, { 'erdd/tables/CYC.yaml': cyclic }))
      .toThrow(CliError)
    try {
      canonical(cyclic, 'erdd/tables/CYC.yaml')
      expect.unreachable('순환 참조인데 던지지 않았다')
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).code).toBe('VALIDATION')
      expect((err as CliError).message).toContain('erdd/tables/CYC.yaml')
    }
  })

  it('순환이 아닌 공유 참조는 그대로 통과한다', () => {
    // alias가 늘 순환인 것은 아니다 — 두 자리가 같은 값을 나눠 쓰기만 하는 파일은 walk가
    // 정상 종료한다. "이미 본 것 전부"를 순환으로 세면 지금 도는 파일이 막힌다.
    const shared = { postgresql: 'BIGINT' }
    expect(canonical({ a: shared, b: shared }, 'erdd/domains.yaml'))
      .toBe(canonical({ a: { postgresql: 'BIGINT' }, b: { postgresql: 'BIGINT' } }, 'erdd/domains.yaml'))
  })

  it('대소문자만 다른 이름으로 바뀌어도 새 파일이 남는다', async () => {
    await writeTree(dir, { ...TREE, 'erdd/tables/MBR.yaml': { id: 'tb1', name: 'MBR', columns: [] } })
    // 서버에서 MBR → mbr로 개명된 상황.
    const renamed = { ...TREE }
    delete (renamed as Record<string, unknown>)['erdd/tables/MBR.yaml']
    const next = { ...renamed, 'erdd/tables/mbr.yaml': { id: 'tb1', name: 'mbr', columns: [] } }
    await writeTree(dir, next)
    const after = await readTree(dir)
    // 대소문자 무시 파일시스템에서도 테이블 파일이 살아 있어야 한다.
    const tablePaths = Object.keys(after).filter((p) => p.startsWith('erdd/tables/'))
    expect(tablePaths).toHaveLength(1)
    expect(after[tablePaths[0]!]).toMatchObject({ id: 'tb1' })
  })

  it('.yaml로 끝나는 디렉터리가 있어도 최상위 파일 정리를 계속한다', async () => {
    await writeTree(dir, TREE)
    await mkdir(join(dir, 'erdd/tables/WEIRD.yaml'), { recursive: true })
    await writeFile(join(dir, 'erdd/tables/GONE.yaml'), 'id: x\n', 'utf8')
    // 최상위 파일 하나가 빠진 트리 — 그것도 지워져야 한다.
    const partial = { ...TREE }
    delete (partial as Record<string, unknown>)['erdd/terms.yaml']
    const { deleted } = await writeTree(dir, partial)
    expect(deleted).toContain('erdd/tables/GONE.yaml')
    expect(deleted).toContain('erdd/terms.yaml')   // EISDIR로 중단되면 여기까지 못 온다
  })

  it('디스크를 거친 왕복이 모델을 보존한다', async () => {
    const original = richModel()
    const { tree, issues } = modelToFiles(original)
    expect(issues).toEqual([])
    await writeTree(dir, tree)
    const fromDisk = await readTree(dir)
    // YAML 인코딩·디코딩을 거쳐도 트리가 같아야 한다.
    expect(diffTrees(tree, fromDisk)).toEqual({ added: [], modified: [], deleted: [] })
    const result = filesToModel(fromDisk)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 파일에 담지 않는 것만 깎고 비교한다.
    const expected: ProjectModel = JSON.parse(JSON.stringify(original))
    expected.notes = {}
    for (const t of Object.values(expected.tables)) { t.position = { x: 0, y: 0 }; t.groupPosition = null }
    for (const d of Object.values(expected.domains)) d.origin = null
    for (const w of Object.values(expected.words)) w.origin = null
    for (const t of Object.values(expected.terms)) t.origin = null
    for (const f of Object.values(expected.customFields)) f.origin = null
    expect(result.model).toEqual(expected)
  })
})

/** 디스크를 거친 왕복이 실제로 전 경로를 지나가게 하는 모델. */
function richModel(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['g1'] = { id: 'g1', name: '회원관리', color: '#eef', comment: '회원 도메인', alias: '' }
  m.domains['d1'] = {
    id: 'd1', name: '명', category: '문자', logicalType: 'VARCHAR(100)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: ['Y', 'N'], description: null, origin: null,
  }
  m.words['w1'] = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null, origin: null }
  m.terms['t1'] = { id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: 'd1', description: null, origin: null }
  m.customFields['cf1'] = {
    id: 'cf1', name: '개인정보여부', target: 'column', type: 'select',
    options: ['Y', 'N'], required: true, defaultValue: 'N', order: 0, origin: null,
  }
  m.tables['tb1'] = {
    id: 'tb1', logicalName: '회원', physicalName: 'MBR', comment: '가입 회원\n두 줄 코멘트',
    groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.tables['tb2'] = {
    id: 'tb2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: true, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 'tb1', logicalName: '회원명', physicalName: 'MBR_NM', type: 'VARCHAR(100)',
    // YAML이 불리언·숫자로 강제할 수 있는 값들을 일부러 넣는다.
    isPk: false, autoIncrement: false, nullable: true, defaultValue: "'0123'", order: 1,
    comment: null, domainId: 'd1', custom: { '개인정보여부': 'Y' },
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 'tb2', logicalName: '주문번호', physicalName: 'ORD_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 'tb2', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: false, autoIncrement: false, nullable: false, defaultValue: null, order: 1,
    comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 'tb2', name: 'IX_ORD_01',
    columns: [{ columnId: 'c4', direction: 'desc' }], unique: false,
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 'tb1', childTableId: 'tb2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:1', identifying: false, name: null,
  }
  return m
}
