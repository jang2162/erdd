import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, type ProjectModel } from '@erdd/core'
import { writeConfig, CONFIG_FILE } from '../config.js'
import { seedPulled, TEST_CONFIG as CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import type { ApiClient } from '../client.js'
import { pull } from './pull.js'
import { status } from './status.js'
import { validate } from './validate.js'

let dir: string
let out: string[]
let err: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-cmd-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, {
    serverUrl: 'https://erdd.example.com',
    projectId: '018f6b0e-0000-7000-8000-000000000000',
    dialects: ['postgresql'],
    namingRules: {
      case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
      tablePhysicalTemplate: '', tableLogicalTemplate: '',
    },
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

function stubClient(overrides: Partial<Record<string, unknown>> = {}): ApiClient {
  return {
    query: vi.fn(async (path: string) => {
      if (path === 'project.get') {
        return {
          id: 'p1', name: '커머스', dialects: ['postgresql'],
          namingRules: {
      case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
      tablePhysicalTemplate: '', tableLogicalTemplate: '',
    },
          ...(overrides['project.get'] as object ?? {}),
        }
      }
      if (path === 'model.get') return { model: model(), seq: 42, ...(overrides['model.get'] as object ?? {}) }
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: vi.fn(async (path: string) => {
      throw new Error(`unexpected mutate ${path}`)
    }) as ApiClient['mutate'],
  }
}

describe('pull', () => {
  it('파일 트리·base·sync를 쓴다', async () => {
    const code = await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    expect(code).toBe(0)
    const tree = await readTree(dir)
    expect(Object.keys(tree)).toContain('erdd/tables/MBR.yaml')
    expect(JSON.parse(await readFile(join(dir, '.erdd/sync.json'), 'utf8'))).toMatchObject({ revisionSeq: 42 })
    expect(JSON.parse(out.join(''))).toMatchObject({ revisionSeq: 42, tables: 1 })
  })

  it('서버의 방언·명명 규칙을 config에 갱신한다', async () => {
    await pull({
      cwd: dir, json: true, yes: false, strict: false,
      client: stubClient({ 'project.get': { dialects: ['oracle'], namingRules: { case: 'lower_snake', separator: '', logicalSeparator: '_', maxLengthBytes: 20 } } }),
    })
    const raw = await readFile(join(dir, 'erdd.config.yaml'), 'utf8')
    expect(raw).toContain('oracle')
    expect(raw).toContain('lower_snake')
  })

  it('로컬 변경이 있으면 확인을 받고, 거절하면 CANCELLED로 끝난다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'id: tb1\nname: CHANGED\n', 'utf8')
    const confirm = vi.fn(async () => false)
    const code = await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient(), confirm })
    expect(confirm).toHaveBeenCalled()
    expect(code).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('CANCELLED')
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('CHANGED')
  })

  it('--yes면 확인 없이 덮어쓴다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'id: tb1\nname: CHANGED\n', 'utf8')
    const confirm = vi.fn(async () => false)
    const code = await pull({ cwd: dir, json: true, yes: true, strict: false, client: stubClient(), confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('MBR')
  })

  it('최초 pull은 base가 없으므로 확인하지 않는다', async () => {
    const confirm = vi.fn(async () => false)
    const code = await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient(), confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(code).toBe(0)
  })

  it('연결 설정이 없으면 pull이 NO_CONFIG로 실패한다', async () => {
    await writeFile(join(dir, CONFIG_FILE), [
      'dialects: [postgresql]',
      'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
      '',
    ].join('\n'), 'utf8')
    const code = await pull({ cwd: dir, json: true, yes: true, strict: false })
    expect(code).toBe(1)
  })
})

describe('status', () => {
  it('pull 직후에는 변경이 없다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    const code = await status({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({
      revisionSeq: 42, changes: { added: [], modified: [], deleted: [] },
    })
  })

  it('파일을 고치면 modified로 잡는다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'id: tb1\nname: CHANGED\n', 'utf8')
    await status({ cwd: dir, json: true, yes: false, strict: false })
    expect(JSON.parse(out.join('')).changes.modified).toEqual(['erdd/tables/MBR.yaml'])
  })

  it('status는 서버를 부르지 않는다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    const client = stubClient()
    await status({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('validate', () => {
  it('정상 트리는 0으로 끝난다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    const code = await validate({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, parseErrors: [], integrityIssues: [] })
  })

  it('해소되지 않는 이름 참조는 parseErrors로 잡고 1로 끝난다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['group'] = '없는그룹'
    await writeTree(dir, tree)
    out.length = 0
    const code = await validate({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join(''))
    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed.parseErrors)).toContain('없는그룹')
  })

  it('명명 경고만 있으면 0이지만 --strict면 1이다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    // 사전이 비어 있으므로 MBR_NO는 미등록 단어 경고가 난다.
    const lenient = await validate({ cwd: dir, json: true, yes: false, strict: false })
    const warnings = JSON.parse(out.join('')).warnings as unknown[]
    expect(warnings.length).toBeGreaterThan(0)
    expect(lenient).toBe(0)
    out.length = 0
    expect(await validate({ cwd: dir, json: true, yes: false, strict: true })).toBe(1)
  })

  it('--strict로 실패하면 JSON의 ok도 false다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    const code = await validate({ cwd: dir, json: true, yes: false, strict: true })
    const parsed = JSON.parse(out.join(''))
    expect(parsed.warnings.length).toBeGreaterThan(0)
    // 종료 코드와 JSON의 ok가 같은 것을 말해야 한다 — 어긋나면 --json을 믿는 스크립트가 오판한다.
    expect(code).toBe(1)
    expect(parsed.ok).toBe(false)
  })

  it('YAML alias로 같은 항목을 재사용한 파일을 통과시키지 않는다', async () => {
    // push는 파일 오류에서 "erdd validate로 확인하세요"라고 안내한다(plan.ts). alias 검사가
    // push 갈래(newId 있음)에서만 성립하면, 그 지시를 따른 사용자·에이전트는 여기서
    // "문제 없음"을 받고 막힌다 — 두 명령의 판정이 갈리면 안 된다. 파서가 실제로 같은
    // 객체를 두 자리에 놓는지까지 보려면 트리를 직접 만들지 말고 YAML 원문을 써야 한다.
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    await writeFile(
      join(dir, 'erdd/tables/MBR.yaml'),
      'id: tb1\nname: MBR\nlogicalName: 회원\ncolumns:\n  - &c\n    id: c1\n    name: MBR_NO\n    logicalName: 회원번호\n    type: BIGINT\n  - *c\n',
      'utf8',
    )
    out.length = 0
    const code = await validate({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join('')) as { ok: boolean; parseErrors: unknown[] }
    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed.parseErrors)).toContain('anchor/alias')
  })

  it('validate는 서버를 부르지 않는다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    const client = stubClient()
    await validate({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('validate 경고 좌표', () => {
  /** 컬럼 경고·관계 경고가 함께 나는 최소 모델. 관계는 부모(MBR)와 자식(ORD)이 갈린다. */
  function locatedModel(): ProjectModel {
    const m = createEmptyModel()
    m.tables['tb1'] = {
      id: 'tb1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['tb2'] = {
      id: 'tb2', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c1'] = {
      id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    m.columns['c2'] = {
      id: 'c2', tableId: 'tb2', logicalName: '주문번호', physicalName: 'ORD_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    // 부모 PK(BIGINT)와 타입이 달라 관계 경고(type-mismatch)가 난다.
    m.columns['c3'] = {
      id: 'c3', tableId: 'tb2', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'VARCHAR(20)',
      isPk: false, autoIncrement: false, nullable: false, defaultValue: null, order: 1,
      comment: null, domainId: null, custom: {},
    }
    m.relationships['r1'] = {
      id: 'r1', parentTableId: 'tb1', childTableId: 'tb2',
      columnMappings: [{ childColumnId: 'c3', parentColumnId: 'c1' }],
      cardinality: '1:N', identifying: false, name: null,
    }
    return m
  }

  type Located = { kind: string; scope: string; entityId: string; message: string; path: string | null; label: string | null }
  const warningsOf = (): Located[] => JSON.parse(out.join('')).warnings as Located[]

  it('컬럼 경고는 파일 경로와 "테이블.컬럼"을 함께 낸다', async () => {
    await seedPulled(dir, locatedModel())
    out.length = 0
    await validate({ cwd: dir, json: false, yes: false, strict: false })
    // 경로가 줄 머리에 오고 뒤에 라벨·메시지가 붙는다 — 경로를 그대로 복사해 열 수 있어야 한다.
    expect(out.join('')).toMatch(
      /\n {2}erdd\/tables\/MBR\.yaml {2}MBR\.MBR_NO {2}등록되지 않은 단어가 있습니다: 회원번호(\n|$)/,
    )
  })

  it('관계 경고는 부모가 아니라 자식 테이블 파일을 가리킨다', async () => {
    await seedPulled(dir, locatedModel())
    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const w = warningsOf().find((x) => x.kind === 'type-mismatch')
    // 관계는 자식 테이블 파일에 실린다(FILE_FIELDS의 childTableId: '(소속 테이블)').
    // 부모 파일을 가리키면 사용자가 연 파일에 그 관계가 없다.
    expect(w).toMatchObject({ scope: 'relationship', entityId: 'r1', path: 'erdd/tables/ORD.yaml' })
    expect(w?.label).toBe('→ MBR')
  })

  it('템플릿이 걸려도 좌표는 파일에 든 부분 이름을 적는다', async () => {
    // 🔥 구분력은 이 픽스처의 템플릿에 있다. 템플릿이 있으면 too-long 메시지는 조합된 최종
    // 이름("TB_MBR_...")을, 좌표는 파일에 든 부분 이름("MBR_...")을 말해 둘이 갈린다.
    // 템플릿을 빼면 둘이 같아져 이 테스트는 아무것도 잠그지 못한다.
    // (부분 이름 자체가 이미 31바이트라, 템플릿이 없어도 too-long 경고는 그대로 난다.)
    await writeConfig(dir, {
      ...CONFIG,
      dialects: [...CONFIG.dialects],
      namingRules: { ...CONFIG.namingRules, tablePhysicalTemplate: 'TB_{물리명}' },
    })
    const m = createEmptyModel()
    m.tables['tb1'] = {
      id: 'tb1', logicalName: '회원_가입_이력_상세', physicalName: 'MBR_REGISTRATION_HISTORY_DETAIL',
      comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c1'] = {
      id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    await seedPulled(dir, m)
    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const w = warningsOf().find((x) => x.kind === 'too-long' && x.scope === 'table')
    expect(w?.path).toBe('erdd/tables/MBR_REGISTRATION_HISTORY_DETAIL.yaml')
    expect(w?.label).toBe('MBR_REGISTRATION_HISTORY_DETAIL')
  })

  it('경고 하나가 좌표로 부분 이름을, 메시지로 최종 이름을 함께 보인다', async () => {
    // 🔥 다리의 **나머지 절반**. 위 테스트는 좌표가 부분 이름이라는 쪽만 잠근다 — 메시지가
    // 조합된 최종 이름을 말한다는 쪽은 core 의 문구에 달려 있는데 그것을 잠그는 자리가
    // 어디에도 없었다(core 의 too-long 문구를 부분 이름으로 되돌려도 core·cli 스위트가 전부
    // 초록이었다). 그러면 한 줄에 같은 이름이 두 번 서서 다리가 사라지는데 아무도 모른다.
    // 여기서 **같은 경고 객체**의 두 끝을 함께 못 박는다: 좌표는 파일에서 찾을 수 있는 이름,
    // 메시지는 실제로 DB 에 나갈 이름, 그리고 둘은 서로 다르다.
    // ⚠️ 위 테스트와 픽스처를 나눠 갖지 않는 것은 의도다. 「템플릿을 빼면 위 테스트가 초록으로
    // 돌아온다」와 「core 문구를 되돌리면 이 테스트만 빨개진다」는 서로 다른 것을 겨냥하는
    // 실증인데, 픽스처를 공유하면 한쪽 변형이 다른 쪽까지 흔들어 겨냥이 흐려진다.
    await writeConfig(dir, {
      ...CONFIG,
      dialects: [...CONFIG.dialects],
      namingRules: { ...CONFIG.namingRules, tablePhysicalTemplate: 'TB_{물리명}' },
    })
    const m = createEmptyModel()
    m.tables['tb1'] = {
      id: 'tb1', logicalName: '회원_가입_이력_상세', physicalName: 'MBR_REGISTRATION_HISTORY_DETAIL',
      comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c1'] = {
      id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    await seedPulled(dir, m)
    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const w = warningsOf().find((x) => x.kind === 'too-long' && x.scope === 'table')
    const quoted = /물리명 "([^"]+)"/.exec(w?.message ?? '')?.[1]
    expect(w?.label).toBe('MBR_REGISTRATION_HISTORY_DETAIL')    // 파일에서 찾을 수 있는 부분 이름
    expect(quoted).toBe('TB_MBR_REGISTRATION_HISTORY_DETAIL')   // 실제로 DB 에 나갈 최종 이름
    expect(quoted).not.toBe(w?.label)                           // 다리가 필요한 이유 그 자체
  })

  it('개명 직후에도 좌표가 디스크의 실제 파일을 가리킨다', async () => {
    // 🔥 이것은 손편집 일탈이 아니라 **정규 동선**이다. SKILL.md 가 "테이블 파일 이름을 직접
    // 바꾸지 않는다 … 이름을 바꾸려면 파일 안의 name을 고친다"고 시킨다 — 파일명은 다음
    // pull이 따라온다. 그래서 개명 직후에는 파일이 MBR.yaml 인데 물리명은 MEMBER 다.
    // 물리명에서 경로를 재조립하면 erdd/tables/MEMBER.yaml — **없는 파일**을 가리킨다.
    // validate 는 push 전 검사라 바로 이 창에서 돌아간다. 수렴(pull)은 그 뒤에나 온다.
    // ⚠️ 구분력은 픽스처의 이 어긋남이 진다 — name 을 MBR 로 두면 재조립과 실제 경로가
    // 같은 값이 되어 아무것도 잠기지 않는다.
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
    await seedPulled(dir, m)
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['name'] = 'MEMBER'
    await writeTree(dir, tree)

    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const warnings = warningsOf()
    expect(warnings.length).toBeGreaterThan(0)
    // 열면 그 경고가 실제로 들어 있는 파일이라야 한다.
    expect(warnings.every((w) => w.path === 'erdd/tables/MBR.yaml')).toBe(true)
    // 라벨은 파일에 적힌 이름 그대로다 — 개명 뒤 파일에는 MEMBER 라고 적혀 있다.
    expect(warnings.some((w) => w.label === 'MEMBER.MBR_NO')).toBe(true)

    out.length = 0
    await validate({ cwd: dir, json: false, yes: false, strict: false })
    expect(out.join('')).not.toContain('erdd/tables/MEMBER.yaml')
  })

  it('이름을 맞바꾼 두 테이블이 서로의 파일을 가리키지 않는다', async () => {
    // 🔥 개명의 **최악 형태**다. 재조립은 여기서 없는 경로가 아니라 **있는 남의 파일**을
    // 낸다 — 없는 경로는 열다가 알아채지만 있는 남의 경로는 조용히 틀린 파일을 고치게 만든다.
    // ⚠️ 구분력은 픽스처의 맞바꿈이 진다. 한쪽만 바꾸면 물리명이 중복돼 파싱 오류로 끝나고,
    // 아무것도 안 바꾸면 재조립과 실제 경로가 같아져 잠기지 않는다.
    // 관계가 없는 두 테이블을 쓰는 것은 의도다 — 관계는 부모를 물리명으로 참조하므로
    // 맞바꿈이 그 참조를 흔들어 이 테스트가 겨냥하지 않은 오류를 부른다.
    const m = createEmptyModel()
    m.tables['tb1'] = {
      id: 'tb1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['tb2'] = {
      id: 'tb2', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    await seedPulled(dir, m)
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['name'] = 'ORD'
    ;(tree['erdd/tables/ORD.yaml'] as Record<string, unknown>)['name'] = 'MBR'
    await writeTree(dir, tree)

    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const byLabel = new Map(
      warningsOf().filter((w) => w.scope === 'table').map((w) => [w.label, w.path]))
    // 파일에 ORD 라고 적힌 테이블은 MBR.yaml 에 들어 있다 — 재조립하면 정확히 뒤바뀐다.
    expect(byLabel.get('ORD')).toBe('erdd/tables/MBR.yaml')
    expect(byLabel.get('MBR')).toBe('erdd/tables/ORD.yaml')
  })

  it('물리명이 비어도 좌표가 그 테이블이 들어 있는 실제 파일을 가리킨다', async () => {
    // ⚠️ 이 테스트는 **의미가 바뀌었다.** 예전에는 「없는 경로를 가리키지 않는다」였다 —
    // 좌표를 물리명에서 재조립하던 시절에는 물리명이 비면 'erdd/tables/.yaml'이라는 없는
    // 파일이 나와서, 좌표를 아예 내지 않는 것(path: null)이 할 수 있는 최선이었다.
    // 이제 좌표는 filesToModel이 실제로 읽어 온 경로다. 만들 거짓 경로 자체가 없으므로
    // 좌표를 버릴 이유도 없다 — 물리명이 빈 테이블도 자기가 들어 있는 파일을 올바로
    // 가리킨다. **막던 것이 고쳐졌다.**
    // 라벨은 그대로 둔다 — 파일에 그렇게 적혀 있는 것이 사실이다.
    // 🔥 구분력은 픽스처의 빈 물리명이 진다. 그것을 되돌리면 재조립과 실제 경로가 같은 값이
    // 되어(둘 다 erdd/tables/MBR.yaml) 이 테스트는 아무것도 잠그지 못한다.
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
    await seedPulled(dir, m)
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['name'] = ''
    await writeTree(dir, tree)

    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const warnings = warningsOf()
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.every((w) => w.path === 'erdd/tables/MBR.yaml')).toBe(true)
    expect(warnings.some((w) => w.label === '.MBR_NO')).toBe(true)

    out.length = 0
    await validate({ cwd: dir, json: false, yes: false, strict: false })
    // ⚠️ 이 줄은 **잠금이 아니다.** 재조립으로 되돌려도 바로 위 경로 단언이 먼저 잡고,
    // 커밋 전 원형(가드가 좌표를 버리던 시절)에서도 통과했다 — 검출력이 0 이다.
    // 옛 거짓 경로의 모양을 기록으로 남기는 줄이니 여기에 기대지 마라.
    expect(out.join('')).not.toContain('erdd/tables/.yaml')
  })

  it('--json의 경고 객체에 path·label이 실린다', async () => {
    await seedPulled(dir, locatedModel())
    out.length = 0
    await validate({ cwd: dir, json: true, yes: false, strict: false })
    const warnings = warningsOf()
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.every((w) => 'path' in w && 'label' in w)).toBe(true)
    // 가산 변경이다 — 기존 필드는 그대로 있어야 한다.
    expect(warnings.find((w) => w.kind === 'unknown-word' && w.entityId === 'c1')).toMatchObject({
      kind: 'unknown-word', scope: 'column', entityId: 'c1', tableId: 'tb1',
      message: '등록되지 않은 단어가 있습니다: 회원번호',
      path: 'erdd/tables/MBR.yaml', label: 'MBR.MBR_NO',
    })
  })
})
