import { describe, expect, it } from 'vitest'
import { createEmptyModel } from './model.js'
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
    expect(TOP_LEVEL_FILES).toHaveLength(5)
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

  it('notes·position·origin은 어느 파일에도 나타나지 않는다', () => {
    const { tree } = modelToFiles(fullModel())
    const dumped = JSON.stringify(tree)
    expect(dumped).not.toContain('position')
    expect(dumped).not.toContain('origin')
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

  it('같은 id가 두 파일에 있으면 issue를 낸다 — 파일 복사가 원본을 조용히 덮어쓴다', () => {
    // 에이전트가 "이것과 비슷한 테이블"을 만들려고 MBR.yaml을 복사해 이름만 바꾼 상황이다.
    // 검사가 없으면 model.tables[tb1]이 뒤 파일로 덮어써져, 새 테이블은 생기지 않고
    // 원본이 PAY로 개명되는 update op가 나간다(충돌도 경고도 없이).
    // MBR_DTL을 복사한다 — 아무도 부모로 참조하지 않는 테이블이라 id 충돌 말고는
    // 다른 이슈가 섞이지 않는다(참조 오류로 우연히 ok:false가 되면 이 테스트는 무의미하다).
    const { tree } = modelToFiles(fullModel())
    tree['erdd/tables/PAY.yaml'] = {
      ...(tree['erdd/tables/MBR_DTL.yaml'] as Record<string, unknown>), name: 'PAY', logicalName: '결제',
    }
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
    tree['erdd/tables/PAY.yaml'] = {
      ...(tree['erdd/tables/MBR_DTL.yaml'] as Record<string, unknown>), name: 'PAY', logicalName: '결제',
    }
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
    // 새 파일 종류나 새 배열이 붙어도 이 단언이 자동으로 따라간다.
    const again = filesToModel(first.assignedTree!)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const m = again.model
    const allIds = [
      ...Object.keys(m.tableGroups), ...Object.keys(m.tables),
      ...Object.keys(m.columns), ...Object.keys(m.indexes), ...Object.keys(m.relationships),
      ...Object.keys(m.domains), ...Object.keys(m.words), ...Object.keys(m.terms),
      ...Object.keys(m.customFields),
    ]
    // 그룹1·도메인1·단어1·용어1·커스텀1·테이블2·컬럼2·인덱스1·관계1
    expect(allIds).toHaveLength(11)
    expect(allIds.some(isNewId)).toBe(false)
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
