import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConfig, writeConfig, readSync, writeSync, readBase, writeBase,
  resolveToken, writeToken, ensureGitignore, requireConnection, LOCAL_PROJECT_ID, CONFIG_FILE,
} from './config.js'
import type { ErddConfig } from './config.js'
import { stringify as stringifyYaml } from 'yaml'
import { TEST_CONFIG } from './testing/harness.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'erdd-cli-')) })
afterEach(() => { delete process.env['ERDD_TOKEN'] })

const CONFIG: ErddConfig = {
  serverUrl: 'https://erdd.example.com',
  projectId: '018f6b0e-0000-7000-8000-000000000000',
  dialects: ['postgresql'],
  namingRules: {
    case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
    tablePhysicalTemplate: '', tableLogicalTemplate: '',
  },
  tableOptions: { postgresql: '', mysql: '', oracle: '', mssql: '' },
  dictionaries: [],
}

describe('config', () => {
  it('설정이 없으면 NO_CONFIG를 던진다', async () => {
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'NO_CONFIG' })
  })

  it('쓰고 읽으면 같다', async () => {
    await writeConfig(dir, CONFIG)
    expect(await readConfig(dir)).toEqual(CONFIG)
  })

  it('logicalSeparator 가 없는 옛 config 에 기본값을 채운다', async () => {
    // Task 1 이전에 writeConfig 가 내던 모양 그대로다.
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  maxLengthBytes: 30',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    const cfg = await readConfig(dir)
    expect(cfg.namingRules.logicalSeparator).toBe('_')
  })

  // 논리명 구분자와 **다른 정책**이다. logicalSeparator 는 값 집합이 '_' | '' 로 좁아 오타를
  // 거절할 수 있지만, 템플릿은 임의 문자열이라 「잘못 적은 값」이 없다 — 누락만 채우고
  // 검증하지 않는다.
  it('tablePhysicalTemplate 가 없는 옛 config 에 빈 문자열을 채운다', async () => {
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  logicalSeparator: "_"',
      '  maxLengthBytes: 30',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    expect((await readConfig(dir)).namingRules.tablePhysicalTemplate).toBe('')
  })

  // 테이블 옵션도 같은 정책이다 — 방언별 자유 문자열이라 「잘못 적은 값」이 없고, 필수로
  // 요구하면 옛 사용자의 pull 이 깨진다. **누락만** 기본값으로 채운다(설계 §5.2-2).
  it('tableOptions 가 없는 옛 config 에 기본값을 채운다', async () => {
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  logicalSeparator: "_"',
      '  maxLengthBytes: 30',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    expect((await readConfig(dir)).tableOptions).toEqual({
      postgresql: '', mysql: '', oracle: '', mssql: '',
    })
  })

  it('한 방언만 적힌 tableOptions 는 나머지를 빈 문자열로 채운다', async () => {
    const yaml = [
      'dialects:', '  - mysql',
      'namingRules: {case: UPPER_SNAKE, separator: "_", maxLengthBytes: 30}',
      'tableOptions:',
      '  mysql: ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    expect((await readConfig(dir)).tableOptions).toEqual({
      postgresql: '', mysql: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', oracle: '', mssql: '',
    })
  })

  it('적어 둔 테이블 옵션은 그대로 읽는다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      tableOptions: { postgresql: '', mysql: 'ENGINE=InnoDB', oracle: 'TABLESPACE users', mssql: '' },
    })
    expect((await readConfig(dir)).tableOptions).toEqual({
      postgresql: '', mysql: 'ENGINE=InnoDB', oracle: 'TABLESPACE users', mssql: '',
    })
  })

  it('적어 둔 템플릿은 그대로 읽는다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      namingRules: { ...CONFIG.namingRules, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' },
    })
    expect((await readConfig(dir)).namingRules.tablePhysicalTemplate).toBe('TB_{그룹별칭}_{물리명}')
  })

  // 논리 템플릿도 물리 템플릿과 **같은 정책**이다 — 임의 문자열이라 「잘못 적은 값」이 없다.
  it('tableLogicalTemplate 이 없는 옛 config 에 빈 문자열을 채운다', async () => {
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  logicalSeparator: "_"',
      '  maxLengthBytes: 30',
      '  tablePhysicalTemplate: "TB_{물리명}"',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    const cfg = await readConfig(dir)
    expect(cfg.namingRules.tableLogicalTemplate).toBe('')
    expect(cfg.namingRules.tablePhysicalTemplate).toBe('TB_{물리명}')
  })

  it('적어 둔 논리 템플릿은 그대로 읽는다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      namingRules: { ...CONFIG.namingRules, tableLogicalTemplate: '{그룹명}_{논리명}' },
    })
    expect((await readConfig(dir)).namingRules.tableLogicalTemplate).toBe('{그룹명}_{논리명}')
  })

  // ⚠️ 누락은 기본값으로 채우되(하위호환), **잘못 적은 값은 삼키지 않는다.** 조용히 '_' 로
  // 돌면 erdd validate 결과가 웹의 「모델 검사」와 갈린다 — 사용자는 자기가 적은 값이
  // 무시된 줄 모른다.
  it('잘못된 logicalSeparator 는 거부한다', async () => {
    const yaml = [
      'serverUrl: https://erdd.example.com',
      'projectId: 018f6b0e-0000-7000-8000-000000000000',
      'dialects:',
      '  - postgresql',
      'namingRules:',
      '  case: UPPER_SNAKE',
      '  separator: "_"',
      '  logicalSeparator: "-"',
      '  maxLengthBytes: 30',
    ].join('\n')
    await writeFile(join(dir, 'erdd.config.yaml'), yaml, 'utf8')
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('명시된 빈 logicalSeparator 는 그대로 둔다', async () => {
    await writeConfig(dir, {
      ...CONFIG,
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30,
        tablePhysicalTemplate: '', tableLogicalTemplate: '',
      },
    })
    expect((await readConfig(dir)).namingRules.logicalSeparator).toBe('')
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

  it('credentials는 0600이고 권한이 넓어져 있어도 다시 좁힌다', async () => {
    await writeToken(dir, 'erdd_pat_a')
    const path = join(dir, '.erdd', 'credentials.json')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    // 외부 요인으로 권한이 넓어진 상황을 만든다.
    await chmod(path, 0o644)
    await writeToken(dir, 'erdd_pat_b')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await resolveToken(dir)).toBe('erdd_pat_b')
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

describe('연결 설정이 없는 config', () => {
  const localYaml = [
    'dialects: [postgresql]',
    'namingRules:',
    '  case: UPPER_SNAKE',
    '  separator: _',
    '  maxLengthBytes: 30',
    '',
  ].join('\n')

  it('serverUrl·projectId 가 없어도 읽힌다', async () => {
    await writeFile(join(dir, CONFIG_FILE), localYaml, 'utf8')
    const config = await readConfig(dir)
    expect(config.serverUrl).toBeNull()
    expect(config.projectId).toBeNull()
    expect(config.dialects).toEqual(['postgresql'])
  })

  it('둘 중 하나만 있으면 거절한다 — 오타를 로컬 모드로 삼키지 않는다', async () => {
    await writeFile(join(dir, CONFIG_FILE), `serverUrl: https://e.example.com\n${localYaml}`, 'utf8')
    await expect(readConfig(dir)).rejects.toThrow(/serverUrl.*projectId|projectId.*serverUrl/)
  })

  it('requireConnection 이 연결 설정 없음을 NO_CONFIG 로 알린다', () => {
    expect(() => requireConnection({
      serverUrl: null, projectId: null, dialects: ['postgresql'],
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30,
        tablePhysicalTemplate: '', tableLogicalTemplate: '',
      },
      tableOptions: { postgresql: '', mysql: '', oracle: '', mssql: '' },
      dictionaries: [],
    })).toThrow(/erdd init/)
  })

  it('requireConnection 은 값이 있으면 그대로 돌려준다', () => {
    expect(requireConnection({
      serverUrl: 'https://e.example.com', projectId: 'p1', dialects: ['postgresql'],
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30,
        tablePhysicalTemplate: '', tableLogicalTemplate: '',
      },
      tableOptions: { postgresql: '', mysql: '', oracle: '', mssql: '' },
      dictionaries: [],
    })).toEqual({ serverUrl: 'https://e.example.com', projectId: 'p1' })
  })

  it('config 모듈이 LOCAL_PROJECT_ID 를 넘겨준다', () => {
    expect(LOCAL_PROJECT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('구독(dictionaries)', () => {
  it('dictionaries 가 없는 옛 config 는 빈 구독으로 읽고, 빈 구독은 파일에 쓰지 않는다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'), stringifyYaml({ ...TEST_CONFIG, dictionaries: undefined }))
    expect((await readConfig(dir)).dictionaries).toEqual([])
    await writeConfig(dir, await readConfig(dir))
    expect(await readFile(join(dir, 'erdd.config.yaml'), 'utf8')).not.toContain('dictionaries')
  })

  it('구독을 쓰고 읽으면 같다', async () => {
    const config = { ...CONFIG, dictionaries: [{ id: 'L1', name: '표준' }, { id: 'L2', name: '확장' }] }
    await writeConfig(dir, config)
    expect(await readConfig(dir)).toEqual(config)
  })

  it('dictionaries 가 배열이 아니거나 항목에 id·name 이 없으면 VALIDATION', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'), stringifyYaml({ ...TEST_CONFIG, dictionaries: [{ id: 'L1' }] }))
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
    await writeFile(join(dir, 'erdd.config.yaml'), stringifyYaml({ ...TEST_CONFIG, dictionaries: 'L1' }))
    await expect(readConfig(dir)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})
