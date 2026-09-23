import { describe, expect, it, vi } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { modelToFiles, TREE_ROOT, TOP_LEVEL_FILES } from './file-format.js'
import { filesToModel, isNewId, type FileTree } from './file-format.js'
import { fileVisibleModel } from './file-merge.js'
import { fullModel } from './testing/fixtures.js'

describe('modelToFiles', () => {
  it('테이블마다 파일 하나와 최상위 파일 5개를 만든다', () => {
    const { tree, issues } = modelToFiles(fullModel())
    expect(issues).toEqual([])
    expect(Object.keys(tree).sort()).toEqual([
      `${TREE_ROOT}/custom-fields.yaml`,
      `${TREE_ROOT}/domains.yaml`,
      `${TREE_ROOT}/groups.yaml`,
      `${TREE_ROOT}/tables/MBR.yaml`,
      `${TREE_ROOT}/tables/MBR_DTL.yaml`,
      `${TREE_ROOT}/tables/ORD.yaml`,
      `${TREE_ROOT}/terms.yaml`,
      `${TREE_ROOT}/words.yaml`,
    ].sort())
    // 여섯째는 origins.yaml 이다 — 출처가 0건이면 만들지 않아 위 목록에 없다.
    expect(TOP_LEVEL_FILES).toHaveLength(6)
  })

  it('그룹 별칭을 groups.yaml 에 싣고 빈 별칭은 생략한다', () => {
    const m = fullModel()
    m.tableGroups['g2'] = { id: 'g2', name: '주문관리', color: '#fee', comment: null, alias: '' }
    const groups = (modelToFiles(m).tree[`${TREE_ROOT}/groups.yaml`] as
      { groups: Array<Record<string, unknown>> }).groups
    expect(groups.find((g) => g['id'] === 'g1')!['alias']).toBe('MBR')
    expect(groups.find((g) => g['id'] === 'g2')).not.toHaveProperty('alias')
  })

  it('컬럼·인덱스·관계를 테이블 파일 안에 이름으로 적는다', () => {
    const { tree } = modelToFiles(fullModel())
    expect(tree[`${TREE_ROOT}/tables/MBR.yaml`]).toEqual({
      id: 'tb1', name: 'MBR', logicalName: '회원', group: '회원관리', comment: '서비스 가입 회원',
      columns: [
        { id: 'c1', name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, autoIncrement: true, nullable: false, comment: '회원 식별자' },
        { id: 'c2', name: 'MBR_NM', logicalName: '회원명', domain: '명', type: 'VARCHAR(100)', nullable: false, default: "''", custom: { '개인정보여부': 'true' } },
      ],
      indexes: [{ id: 'ix1', name: 'UX_MBR_01', columns: ['MBR_NM'], unique: true }],
    })
    expect(tree[`${TREE_ROOT}/tables/ORD.yaml`]).toEqual({
      id: 'tb2', name: 'ORD', logicalName: '주문',
      columns: [
        { id: 'c3', name: 'ORD_NO', logicalName: '주문번호', type: 'BIGINT', pk: true, nullable: false },
        { id: 'c4', name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, nullable: false },
      ],
      indexes: [{ id: 'ix2', name: 'IX_ORD_01', columns: ['MBR_NO DESC'] }],
      relations: [{
        id: 'r1', name: 'FK_ORD_MBR', to: 'MBR',
        columns: { MBR_NO: 'MBR_NO' }, identifying: true,
      }],
    })
  })

  it('notes·position은 어느 파일에도 나타나지 않는다', () => {
    const { tree } = modelToFiles(fullModel())
    const dumped = JSON.stringify(tree)
    expect(dumped).not.toContain('position')
    expect(dumped).not.toContain('메모')
  })

  it('물리명이 대소문자만 다르면 두 파일 모두에 id 접미사를 붙이고 경고한다', () => {
    const m = fullModel()
    // 컬렉션 키는 반드시 id와 같아야 한다(op.ts:90이 강제하는 리포 전역 불변식).
    m.tables['tb3abcdef-0000'] = {
      id: 'tb3abcdef-0000', logicalName: '회원소문자', physicalName: 'mbr', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const { tree, issues } = modelToFiles(m)
    expect(Object.keys(tree)).toContain(`${TREE_ROOT}/tables/MBR.tb1.yaml`)
    expect(Object.keys(tree)).toContain(`${TREE_ROOT}/tables/mbr.def-0000.yaml`)
    expect(Object.keys(tree)).not.toContain(`${TREE_ROOT}/tables/MBR.yaml`)
    expect(issues.some((i) => i.message.includes('대소문자'))).toBe(true)
  })

  it('id 앞부분이 같아도(같은 65초 창에 생성) 파일명이 갈린다', () => {
    const m = createEmptyModel()
    // uuidv7의 앞 12자는 48비트 ms 타임스탬프 — 같은 65초 창이면 앞 8자가 동일하다.
    const idA = '019fc671-b1ef-7e97-958b-4a888c73a323'
    const idB = '019fc671-c2aa-7000-8000-000000000001'
    expect(idA.slice(0, 8)).toBe(idB.slice(0, 8))   // 전제 확인
    m.tables[idA] = {
      id: idA, logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables[idB] = {
      id: idB, logicalName: '회원소문자', physicalName: 'mbr', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const names = Object.keys(modelToFiles(m).tree).filter((p) => p.startsWith(`${TREE_ROOT}/tables/`))
    expect(names).toHaveLength(2)
    // 대소문자를 구분하지 않는 파일시스템에서도 서로 다른 경로여야 한다.
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2)
  })

  it('뒤 8자까지 같으면 id 전체를 접미사로 쓴다', () => {
    const m = createEmptyModel()
    const idA = '019fc671-0000-7000-8000-4a888c73a323'
    const idB = '019fc671-1111-7000-8000-4a888c73a323'
    expect(idA.slice(-8)).toBe(idB.slice(-8))   // 전제 확인
    m.tables[idA] = {
      id: idA, logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables[idB] = {
      id: idB, logicalName: '회원소문자', physicalName: 'mbr', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const names = Object.keys(modelToFiles(m).tree)
    expect(names).toContain(`${TREE_ROOT}/tables/MBR.${idA}.yaml`)
    expect(names).toContain(`${TREE_ROOT}/tables/mbr.${idB}.yaml`)
  })

  it('경로 구분자나 ..가 든 물리명은 파일로 쓰지 않고 issue를 낸다', () => {
    const m = fullModel()
    m.tables['tbX'] = {
      id: 'tbX', logicalName: '탈출', physicalName: '../../ESCAPED', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['tbY'] = {
      id: 'tbY', logicalName: '중첩', physicalName: 'sub/NESTED', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const { tree, issues } = modelToFiles(m)
    // 트리 키가 erdd/tables/ 밖으로 나가지 않는다.
    for (const key of Object.keys(tree)) {
      expect(key.includes('..')).toBe(false)
      if (key.startsWith(`${TREE_ROOT}/tables/`)) {
        expect(key.slice(`${TREE_ROOT}/tables/`.length).includes('/')).toBe(false)
      }
    }
    expect(issues.filter((i) => i.message.includes('파일명으로 쓸 수 없어'))).toHaveLength(2)
  })
})

describe('filesToModel', () => {
  it('newId를 주면 신규 객체가 발급된 id를 받고 참조도 그 id로 조립된다', () => {
    const tree = {
      'erdd/groups.yaml': { groups: [{ name: '회원관리', color: '#eef' }] },
      'erdd/domains.yaml': { domains: [{ name: '명칭', logicalType: 'VARCHAR(100)', dialectTypes: {} }] },
      'erdd/words.yaml': { words: [{ logicalName: '회원', abbreviation: 'MBR' }] },
      'erdd/terms.yaml': { terms: [{ logicalName: '회원번호', physicalName: 'MBR_NO' }] },
      'erdd/custom-fields.yaml': { customFields: [{ name: 'cf1', target: 'table', type: 'text' }] },
      'erdd/tables/MBR.yaml': {
        name: 'MBR', logicalName: '회원', group: '회원관리',
        columns: [{ name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, nullable: false, domain: '명칭' }],
        indexes: [{ name: 'UX_MBR_01', columns: ['MBR_NO'], unique: true }],
      },
      'erdd/tables/ORD.yaml': {
        name: 'ORD', logicalName: '주문',
        columns: [{ name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', nullable: false }],
        relations: [{ to: 'MBR', columns: { MBR_NO: 'MBR_NO' } }],
      },
    }
    let n = 0
    const result = filesToModel(tree, { newId: () => `id-${++n}` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const m = result.model

    const allIds = [
      ...Object.keys(m.tableGroups), ...Object.keys(m.tables),
      ...Object.keys(m.columns), ...Object.keys(m.indexes), ...Object.keys(m.relationships),
      ...Object.keys(m.domains), ...Object.keys(m.words), ...Object.keys(m.terms), ...Object.keys(m.customFields),
    ]
    expect(allIds.every((id) => id.startsWith('id-'))).toBe(true)
    expect(allIds.some(isNewId)).toBe(false)

    // 참조가 발급된 id로 조립된다 — 별도의 리맵 단계 없이 무결하다.
    const mbr = Object.values(m.tables).find((t) => t.physicalName === 'MBR')!
    const ord = Object.values(m.tables).find((t) => t.physicalName === 'ORD')!
    const mbrCol = Object.values(m.columns).find((c) => c.tableId === mbr.id)!
    const ordCol = Object.values(m.columns).find((c) => c.tableId === ord.id)!
    const rel = Object.values(m.relationships)[0]!
    const ix = Object.values(m.indexes)[0]!

    expect(mbr.groupId).toBe(Object.keys(m.tableGroups)[0])
    expect(rel.parentTableId).toBe(mbr.id)
    expect(rel.childTableId).toBe(ord.id)
    expect(rel.columnMappings[0]!.childColumnId).toBe(ordCol.id)
    expect(rel.columnMappings[0]!.parentColumnId).toBe(mbrCol.id)
    expect(ix.columns[0]!.columnId).toBe(mbrCol.id)

    // domainId가 발급된 도메인 id를 가리킨다
    expect(mbrCol.domainId).toBe(Object.keys(m.domains)[0])
  })

  it('newId를 주지 않으면 기존 임시 id 동작 그대로다', () => {
    const result = filesToModel({
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.model.tables).every(isNewId)).toBe(true)
  })

  it('왕복이 항등이다 — 9개 컬렉션 전부', () => {
    const original = fullModel()
    const { tree } = modelToFiles(original)
    const result = filesToModel(tree)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model).toEqual(fileVisibleModel(original))
  })

  it('생략된 기본값을 복원한다', () => {
    const { tree } = modelToFiles(fullModel())
    const ord = tree['erdd/tables/ORD.yaml'] as Record<string, unknown>
    // 파일에는 unique·identifying이 없다(기본값이라 생략됐다).
    expect(JSON.stringify(ord)).not.toContain('"unique"')
    const result = filesToModel(tree)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ix = Object.values(result.model.indexes).find((i) => i.name === 'IX_ORD_01')!
    expect(ix.unique).toBe(false)
    expect(ix.columns[0]!.direction).toBe('desc')
  })

  it('이름 참조가 해소되지 않으면 issue를 낸다', () => {
    const { tree } = modelToFiles(fullModel())
    const mbr = tree['erdd/tables/MBR.yaml'] as Record<string, unknown>
    ;(mbr as { group: string }).group = '없는그룹'
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.message.includes('없는그룹'))).toBe(true)
  })

  it('관계가 없는 부모 테이블을 가리키면 issue를 낸다', () => {
    const { tree } = modelToFiles(fullModel())
    const ord = tree['erdd/tables/ORD.yaml'] as { relations: { to: string }[] }
    ord.relations[0]!.to = 'NOPE'
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.message.includes('NOPE'))).toBe(true)
  })

  it('id 없는 객체는 신규 표시가 붙은 유일한 임시 id를 받는다', () => {
    const { tree } = modelToFiles(fullModel())
    const mbr = tree['erdd/tables/MBR.yaml'] as { columns: Record<string, unknown>[] }
    mbr.columns.push({ name: 'NEW_COL', logicalName: '새컬럼', type: 'INT' })
    const result = filesToModel(tree)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const added = Object.values(result.model.columns).find((c) => c.physicalName === 'NEW_COL')!
    expect(isNewId(added.id)).toBe(true)
    expect(added.nullable).toBe(true)
  })

  it('같은 테이블에 id 없는 컬럼이 둘이어도 둘 다 남는다', () => {
    const { tree } = modelToFiles(fullModel())
    const mbr = tree['erdd/tables/MBR.yaml'] as { columns: Record<string, unknown>[] }
    mbr.columns.push({ name: 'NEW_A', logicalName: '가', type: 'INT' })
    mbr.columns.push({ name: 'NEW_B', logicalName: '나', type: 'INT' })
    const result = filesToModel(tree)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const names = Object.values(result.model.columns).map((c) => c.physicalName)
    expect(names).toContain('NEW_A')
    expect(names).toContain('NEW_B')
    // 키가 겹치지 않아야 한다 — 겹치면 하나가 사라진다.
    expect(new Set(Object.keys(result.model.columns)).size).toBe(Object.keys(result.model.columns).length)
  })

  it('id 없는 테이블이 둘이어도 둘 다 남는다', () => {
    const { tree } = modelToFiles(fullModel())
    tree['erdd/tables/NEW_A.yaml'] = { name: 'NEW_A', logicalName: '가', columns: [] }
    tree['erdd/tables/NEW_B.yaml'] = { name: 'NEW_B', logicalName: '나', columns: [] }
    const result = filesToModel(tree)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const names = Object.values(result.model.tables).map((t) => t.physicalName)
    expect(names).toContain('NEW_A')
    expect(names).toContain('NEW_B')
  })

  it('도메인 이름이 중복되면 issue를 낸다', () => {
    const { tree } = modelToFiles(fullModel())
    const file = tree['erdd/domains.yaml'] as { domains: Record<string, unknown>[] }
    file.domains.push({ id: 'd2', name: '명', logicalType: 'VARCHAR(50)', dialectTypes: {} })
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.message.includes('도메인 이름 명이 중복'))).toBe(true)
  })

  it('테이블 물리명이 중복되면 issue를 낸다', () => {
    const { tree } = modelToFiles(fullModel())
    tree['erdd/tables/MBR.copy.yaml'] = { id: 'tbX', name: 'MBR', logicalName: '회원사본', columns: [] }
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.message.includes('테이블 물리명 MBR이 중복'))).toBe(true)
  })

  /**
   * MBR_DTL.yaml을 **디스크에 복사한 것과 같은 상태**로 만든다 — 아무도 부모로 참조하지
   * 않는 테이블이라 id 충돌 말고 다른 이슈가 섞이지 않는다.
   *
   * 깊은 복사여야 한다. 얕은 전개(`{...file}`)는 `columns` 배열과 그 안의 객체를 두 파일이
   * **같은 객체로 공유**하게 만드는데, 파일마다 따로 파싱하는 실제 트리에서는 그런 공유가
   * 생길 수 없다. 그 상태는 alias 검사(같은 객체 재방문)에 걸려 "id 중복"이 아닌 다른
   * 오류를 부르므로, 테스트가 잡으려는 상황과 어긋난다.
   */
  const copiedFile = (tree: FileTree, name: string, logicalName: string): Record<string, unknown> => ({
    ...structuredClone(tree['erdd/tables/MBR_DTL.yaml'] as Record<string, unknown>), name, logicalName,
  })

  it('같은 id가 두 파일에 있으면 issue를 낸다 — 파일 복사가 원본을 조용히 덮어쓴다', () => {
    // 에이전트가 "이것과 비슷한 테이블"을 만들려고 MBR.yaml을 복사해 이름만 바꾼 상황이다.
    // 검사가 없으면 model.tables[tb1]이 뒤 파일로 덮어써져, 새 테이블은 생기지 않고
    // 원본이 PAY로 개명되는 update op가 나간다(충돌도 경고도 없이).
    // MBR_DTL을 복사한다 — 아무도 부모로 참조하지 않는 테이블이라 id 충돌 말고는
    // 다른 이슈가 섞이지 않는다(참조 오류로 우연히 ok:false가 되면 이 테스트는 무의미하다).
    const { tree } = modelToFiles(fullModel())
    tree['erdd/tables/PAY.yaml'] = copiedFile(tree, 'PAY', '결제')
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const dup = result.issues.find((i) => i.message.includes('tb3'))
    expect(dup).toBeDefined()
    expect(dup!.path).toBe('erdd/tables/PAY.yaml')               // 뒤에 온 파일에서 보고한다
    expect(dup!.message).toContain('erdd/tables/MBR_DTL.yaml')   // 먼저 쓴 파일도 짚어 준다
  })

  it('newId를 줘도(push 경로) 명시된 id 중복은 그대로 issue다', () => {
    // push는 newId를 넘겨 id 없는 객체에 uuid를 발급한다 — 그 경로에서도 막아야
    // 파괴적인 반영 전에 걸러진다.
    const { tree } = modelToFiles(fullModel())
    tree['erdd/tables/PAY.yaml'] = copiedFile(tree, 'PAY', '결제')
    let n = 0
    const result = filesToModel(tree, { newId: () => `gen-${(n += 1)}` })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.every((i) => i.message.includes('id'))).toBe(true)
  })

  it('한 파일 안에서 id가 중복돼도 issue를 낸다', () => {
    const { tree } = modelToFiles(fullModel())
    const mbr = tree['erdd/tables/MBR.yaml'] as { columns: Record<string, unknown>[] }
    mbr.columns.push({ ...mbr.columns[0]!, name: 'MBR_NO_2' })
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.message.includes('c1'))).toBe(true)
  })

  it('서로 다른 컬렉션이 같은 id를 써도 문제 삼지 않는다', () => {
    // 컬렉션 키는 컬렉션별로 독립이라 덮어쓰기가 일어나지 않는다.
    const result = filesToModel({
      'erdd/groups.yaml': { groups: [{ id: 'x1', name: '공통' }] },
      'erdd/tables/MBR.yaml': { id: 'x1', name: 'MBR', logicalName: '회원', columns: [] },
    })
    expect(result.ok).toBe(true)
  })

  /**
   * 🔥 구분력은 픽스처가 진다 — **파일명과 물리명이 달라야** 한다. 같으면 재조립
   * (`erdd/tables/${name}.yaml`)과 실제 경로가 같은 값이 되어 아무것도 잠기지 않는다.
   *
   * 이 상태는 예외가 아니라 **정규 동선이 만든다.** SKILL.md 가 "테이블 파일 이름을 직접
   * 바꾸지 않는다 … 이름을 바꾸려면 파일 안의 name을 고친다"고 시키므로, 개명 직후 파일은
   * MBR.yaml 인데 물리명은 MEMBER 다.
   */
  it('테이블마다 읽어 온 실제 파일 경로를 함께 돌려준다', () => {
    const result = filesToModel({
      // 물리명은 MEMBER 로 개명됐는데 파일명은 아직 MBR.yaml 이다.
      'erdd/tables/MBR.yaml': { id: 'tb1', name: 'MEMBER', logicalName: '회원', columns: [] },
      'erdd/tables/ORD.yaml': { id: 'tb2', name: 'ORD', logicalName: '주문', columns: [] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.tables['tb1']!.physicalName).toBe('MEMBER')
    expect(result.tableFiles).toEqual({
      tb1: 'erdd/tables/MBR.yaml',      // 물리명에서 재조립하면 MEMBER.yaml — 없는 파일이다
      tb2: 'erdd/tables/ORD.yaml',
    })
  })
})

/**
 * 9종 전부에 id가 빠진 항목이 있는 트리. groups·domains·words·terms·customFields·
 * table·columns·indexes·relations 각각이 idOf를 지나므로, 한 자리라도 되쓰기를
 * 빠뜨리면 아래 완전성 테스트가 잡는다.
 */
function treeWithNewEverywhere(): FileTree {
  return {
    'erdd/groups.yaml': { groups: [{ name: '회원관리', color: '#eef' }] },
    'erdd/domains.yaml': { domains: [{ name: '명칭', logicalType: 'VARCHAR(100)', dialectTypes: {} }] },
    'erdd/words.yaml': { words: [{ logicalName: '회원', abbreviation: 'MBR' }] },
    'erdd/terms.yaml': { terms: [{ logicalName: '회원번호', physicalName: 'MBR_NO' }] },
    'erdd/custom-fields.yaml': { customFields: [{ name: 'cf1', target: 'table', type: 'text' }] },
    'erdd/tables/MBR.yaml': {
      name: 'MBR', logicalName: '회원', group: '회원관리',
      columns: [{ name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, nullable: false, domain: '명칭' }],
      indexes: [{ name: 'UX_MBR_01', columns: ['MBR_NO'], unique: true }],
    },
    'erdd/tables/ORD.yaml': {
      name: 'ORD', logicalName: '주문',
      columns: [{ name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', nullable: false }],
      relations: [{ to: 'MBR', columns: { MBR_NO: 'MBR_NO' } }],
    },
  }
}

/** 모델이 쥔 모든 엔티티 id. 컬렉션 키가 곧 id다(op.ts:90). */
function idsOf(m: ProjectModel): string[] {
  return [
    ...Object.keys(m.tableGroups), ...Object.keys(m.tables),
    ...Object.keys(m.columns), ...Object.keys(m.indexes), ...Object.keys(m.relationships),
    ...Object.keys(m.domains), ...Object.keys(m.words), ...Object.keys(m.terms),
    ...Object.keys(m.customFields),
  ]
}

/** 재귀적으로 id 키를 걷어낸다 — "원본 + id뿐"임을 확인하는 데 쓴다. */
function stripIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIds)
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => k !== 'id')
        .map(([k, x]) => [k, stripIds(x)]),
    )
  }
  return v
}

describe('filesToModel — assignedTree (push 멱등성)', () => {
  it('id가 빠진 자리를 하나도 남기지 않는다', () => {
    let n = 0
    const first = filesToModel(treeWithNewEverywhere(), { newId: () => `id-${++n}` })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.assignedTree).toBeDefined()

    // 채운 트리를 newId 없이 다시 파싱하면 임시 id가 하나도 없어야 한다. 임시 id는 정확히
    // "id가 없는 자리"의 표식이라, 되쓰기를 한 자리라도 빠뜨리면 여기서 드러난다.
    // (idOf 한 자리에서 되쓰므로 구현은 새 배열을 자동으로 따라가지만, 이 단언이 그 자리를
    //  감시하려면 위 fixture에 그 자리를 함께 추가해야 한다.)
    const again = filesToModel(first.assignedTree!)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const allIds = idsOf(again.model)
    // 그룹1·도메인1·단어1·용어1·커스텀1·테이블2·컬럼2·인덱스1·관계1
    expect(allIds).toHaveLength(11)
    expect(allIds.some(isNewId)).toBe(false)

    // 그리고 그 id들은 첫 모델이 서버로 보낼 id와 **같은 것**이어야 한다. 이것이 이 커밋의
    // 유일한 계약이다 — 파일에 적은 id와 op가 나르는 id가 갈리면 다음 push가 파일의 id를
    // 서버에서 찾지 못해 원래 버그 그대로 사본을 만든다. 위 두 단언만으로는 "각 자리에
    // 아무 id나 채워 넣기"도 통과한다.
    expect(allIds.slice().sort()).toEqual(idsOf(first.model).slice().sort())
  })

  it('입력 트리를 변형하지 않는다', () => {
    const tree = treeWithNewEverywhere()
    const before = structuredClone(tree)
    filesToModel(tree, { newId: () => 'id-x' })
    expect(tree).toEqual(before)
  })

  it('채운 트리는 원본에 id만 더한 것이다', () => {
    const tree = treeWithNewEverywhere()
    let n = 0
    const result = filesToModel(tree, { newId: () => `id-${++n}` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(stripIds(result.assignedTree!)).toEqual(tree)
  })

  it('이미 적힌 id는 그대로 두고 새로 발급하지 않는다', () => {
    const result = filesToModel({
      'erdd/tables/MBR.yaml': {
        id: 'table-keep', name: 'MBR', logicalName: '회원',
        columns: [{ id: 'col-keep', name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT' }],
      },
    }, { newId: () => 'issued' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const file = result.assignedTree!['erdd/tables/MBR.yaml'] as { id: string; columns: { id: string }[] }
    expect(file.id).toBe('table-keep')
    expect(file.columns[0]!.id).toBe('col-keep')
    expect(Object.keys(result.model.tables)).toEqual(['table-keep'])
  })

  it('newId를 주지 않으면 assignedTree가 없다', () => {
    const result = filesToModel(treeWithNewEverywhere())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assignedTree).toBeUndefined()
  })

  it('newId가 없으면 트리를 복사하지 않는다', () => {
    // 복사는 되쓰기가 필요한 push 경로에서만 한다. 무조건 복사로 바꾸면 pull·validate·base
    // 파싱이 큰 트리를 매번 통째로 복사하게 되는데, 그 회귀는 테스트 없이는 안 보인다.
    const spy = vi.spyOn(globalThis, 'structuredClone')
    try {
      const result = filesToModel(treeWithNewEverywhere())
      expect(result.ok).toBe(true)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('같은 객체가 배열에 두 번 들어가면(YAML alias) 오류로 세운다', () => {
    // YAML anchor/alias(`&a` … `*a`)는 배열의 두 원소를 **같은 객체 하나**로 파싱한다.
    // structuredClone이 그 공유를 보존하므로 되쓴 id를 두 번째 방문이 그대로 읽는다 —
    // 잡지 않으면 컬럼 2개가 조용히 1개로 합쳐진 채 ok:true가 나간다.
    const shared = { name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT' }
    let n = 0
    const result = filesToModel({
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [shared, shared] },
    }, { newId: () => `id-${++n}` })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.path).toBe('erdd/tables/MBR.yaml')
    // 사용자 파일에는 지울 id 자체가 없다 — "id를 지우세요"는 실행 불가능한 지시다.
    expect(result.issues[0]!.message).toContain('anchor/alias')
    expect(result.issues[0]!.message).not.toContain('id를 지우세요')
  })

  it('newId가 없어도 같은 판정을 낸다 — validate와 push가 갈리면 안 된다', () => {
    // push는 파일 오류에서 "erdd validate로 확인하세요"라고 안내한다(plan.ts). 그런데
    // alias 검사가 되쓴 id로만 성립하면 validate(newId 없음)는 같은 파일을 ok:true로
    // 통과시켜, 그 지시를 따른 사용자·에이전트가 "문제 없음"을 받고 막힌다.
    // 참조 동일성은 id와 무관하게 보이므로 두 갈래의 판정이 같아야 한다.
    const shared = { name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT' }
    const tree = {
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [shared, shared] },
    }
    const result = filesToModel(tree)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.path).toBe('erdd/tables/MBR.yaml')
    expect(result.issues[0]!.message).toContain('anchor/alias')
  })

  it('id를 나르지 않는 값이 두 자리에서 공유돼도 오류가 아니다', () => {
    // 검사 대상은 "id를 가질 수 있는 항목"이 한 항목으로 합쳐지는 것뿐이다. 두 도메인이
    // 같은 dialectTypes 매핑을 alias로 공유하는 것 같은 자리는 idOf를 지나지 않으므로
    // 합쳐질 것이 없다 — 여기까지 오류로 세우면 멀쩡한 파일이 막힌다.
    const sharedTypes = { postgresql: 'BIGINT' }
    const result = filesToModel({
      'erdd/domains.yaml': {
        domains: [
          { id: 'd1', name: '식별자', logicalType: 'number', dialectTypes: sharedTypes },
          { id: 'd2', name: '수량', logicalType: 'number', dialectTypes: sharedTypes },
        ],
      },
    })
    expect(result.ok).toBe(true)
  })

  it('파싱에 실패하면 assignedTree를 내지 않는다', () => {
    // 없는 부모 테이블을 가리키는 관계 — 기존 테스트가 쓰는 것과 같은 실패 경로다.
    const result = filesToModel({
      'erdd/tables/ORD.yaml': {
        name: 'ORD', logicalName: '주문', columns: [],
        relations: [{ to: 'NOPE', columns: {} }],
      },
    }, { newId: () => 'id-x' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result).not.toHaveProperty('assignedTree')
  })
})

/**
 * 모델의 `type` 은 자유 문자열이라 부호 없음 표기는 파일 왕복을 **저절로** 견딘다(설계 §3.3).
 * 「저절로 된다」는 판단이 맞는지를 여기서 실제로 확인해 둔다 — 표기가 바뀌면 저장된 값 전체가
 * 어긋나므로 이 자리가 가장 싼 경보다.
 */
describe('파일 왕복 — 부호 없음 표기', () => {
  it('컬럼 타입과 도메인 논리 타입이 yaml 왕복을 견딘다', () => {
    const m = createEmptyModel()
    m.domains['d'] = {
      id: 'd', name: '수량', category: null, logicalType: 'BIGINT UNSIGNED',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    m.tables['t'] = {
      id: 't', logicalName: 'ORD', physicalName: 'ORD', comment: null, groupId: null,
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c'] = {
      id: 'c', tableId: 't', logicalName: 'ORD_NO', physicalName: 'ORD_NO', type: 'INT UNSIGNED',
      isPk: true, autoIncrement: true, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    const r = filesToModel(modelToFiles(m).tree)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.values(r.model.columns)[0]!.type).toBe('INT UNSIGNED')
    expect(Object.values(r.model.domains)[0]!.logicalType).toBe('BIGINT UNSIGNED')
  })
})

describe('origins.yaml', () => {
  const origin = {
    libraryId: 'L1', sourceId: 'S1', sourceVersion: 3,
    base: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null },
  }
  function withWord(o: typeof origin | null = origin) {
    const m = createEmptyModel()
    m.words['w1'] = {
      id: 'w1', logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null, origin: o,
    }
    return m
  }

  it('출처를 origins.yaml 로 쓰고, 사전 파일에는 싣지 않으며, 다시 읽으면 복원된다', () => {
    const { tree } = modelToFiles(withWord())
    expect(tree['erdd/origins.yaml']).toEqual({
      origins: [{ id: 'w1', kind: 'word', library: 'L1', item: 'S1', version: 3, base: origin.base }],
    })
    expect(tree['erdd/words.yaml']).toEqual({ words: [{ id: 'w1', logicalName: '고객', abbreviation: 'CUST' }] })
    const r = filesToModel(tree)
    expect(r.ok && r.model.words['w1']!.origin).toEqual(origin)
  })

  it('출처가 0건이면 origins.yaml 을 만들지 않는다', () => {
    expect(modelToFiles(withWord(null)).tree).not.toHaveProperty('erdd/origins.yaml')
  })

  it('여러 종류의 출처를 id 오름차순으로 쓴다', () => {
    const m = withWord()
    m.domains['d0'] = {
      id: 'd0', name: 'NO', category: null, logicalType: 'string',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
      origin: { libraryId: 'L1', sourceId: 'S0', sourceVersion: 1, base: {} },
    }
    const list = (modelToFiles(m).tree['erdd/origins.yaml'] as { origins: { id: string }[] }).origins
    expect(list.map((o) => o.id)).toEqual(['d0', 'w1'])
  })

  it('가리키는 엔티티가 없는 줄은 조용히 무시하고 다음 쓰기에서 사라진다', () => {
    const { tree } = modelToFiles(withWord())
    tree['erdd/words.yaml'] = { words: [] }   // 사람이 단어를 지웠다
    const r = filesToModel(tree)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([])
    expect(modelToFiles(r.model).tree).not.toHaveProperty('erdd/origins.yaml')
  })

  it('id 가 프로토타입 키여도 엔티티로 오인하지 않는다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: Record<string, unknown>[] }).origins
    tree['erdd/origins.yaml'] = { origins: [{ ...o, id: '__proto__' }, { ...o, id: 'constructor' }] }
    const r = filesToModel(tree)
    expect(r.ok).toBe(true)
    expect(({} as Record<string, unknown>)['origin']).toBeUndefined()
    expect((Object as unknown as Record<string, unknown>)['origin']).toBeUndefined()
  })

  it('같은 id 의 출처가 두 번이면 파일 오류다', () => {
    const { tree } = modelToFiles(withWord())
    const list = (tree['erdd/origins.yaml'] as { origins: unknown[] }).origins
    tree['erdd/origins.yaml'] = { origins: [list[0], list[0]] }
    const r = filesToModel(tree)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.message).join('\n')).toContain('두 번')
  })

  it('kind 가 실제 엔티티 종류와 다르면 파일 오류다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: Record<string, unknown>[] }).origins
    tree['erdd/origins.yaml'] = { origins: [{ ...o, kind: 'term' }] }
    const r = filesToModel(tree)
    expect(r.ok).toBe(false)
  })

  it('객체가 아닌 줄은 파일 오류이고, 좌표는 원래 배열의 번호다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: Record<string, unknown>[] }).origins
    tree['erdd/origins.yaml'] = { origins: ['garbage', 42, { ...o, version: '3' }] }
    const r = filesToModel(tree)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const messages = r.issues.map((i) => i.message)
    expect(messages.filter((m) => m.startsWith('origins[0]'))).toHaveLength(1)
    expect(messages.filter((m) => m.startsWith('origins[1]'))).toHaveLength(1)
    expect(messages.filter((m) => m.startsWith('origins[2]'))).toHaveLength(1)
  })

  it('종류가 다른 두 엔티티가 같은 id 를 쓰면 각자의 출처로 읽는다', () => {
    const m = withWord()
    m.terms['w1'] = {
      id: 'w1', logicalName: '고객', physicalName: 'CUST', domainId: null, description: null,
      origin: { ...origin, sourceId: 'S2' },
    }
    const r = filesToModel(modelToFiles(m).tree)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.words['w1']!.origin).toEqual(origin)
    expect(r.model.terms['w1']!.origin).toEqual({ ...origin, sourceId: 'S2' })
  })

  it('출처는 로캘이 아니라 코드 단위 순서로 정렬한다', () => {
    const m = createEmptyModel()
    for (const id of ['a1', 'B1']) {
      m.words[id] = { id, logicalName: id, abbreviation: id, englishName: null, description: null, origin }
    }
    const list = (modelToFiles(m).tree['erdd/origins.yaml'] as { origins: { id: string }[] }).origins
    // localeCompare 는 a1 → B1 이다. 코드 단위로는 대문자가 앞선다.
    expect(list.map((o) => o.id)).toEqual(['B1', 'a1'])
  })

  it('읽은 출처의 base 는 입력 트리와 참조를 공유하지 않는다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: { base: Record<string, unknown> }[] }).origins
    const r = filesToModel(tree)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.words['w1']!.origin!.base).toEqual(o!.base)
    expect(r.model.words['w1']!.origin!.base).not.toBe(o!.base)
  })

  it('필수 키가 빠지거나 version 이 정수가 아니면 파일 오류다', () => {
    const { tree } = modelToFiles(withWord())
    const [o] = (tree['erdd/origins.yaml'] as { origins: Record<string, unknown>[] }).origins
    tree['erdd/origins.yaml'] = { origins: [{ ...o, version: '3' }] }
    expect(filesToModel(tree).ok).toBe(false)
    tree['erdd/origins.yaml'] = { origins: [{ ...o, base: undefined }] }
    expect(filesToModel(tree).ok).toBe(false)
    tree['erdd/origins.yaml'] = { origins: [{ ...o, library: undefined }] }
    expect(filesToModel(tree).ok).toBe(false)
    tree['erdd/origins.yaml'] = { origins: [{ ...o, item: undefined }] }
    expect(filesToModel(tree).ok).toBe(false)
    tree['erdd/origins.yaml'] = { origins: [{ ...o, kind: 'foo' }] }
    expect(filesToModel(tree).ok).toBe(false)
    tree['erdd/origins.yaml'] = { origins: [{ ...o, base: [] }] }
    expect(filesToModel(tree).ok).toBe(false)
  })
})
