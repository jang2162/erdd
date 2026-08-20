import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { DIALECTS, type Dialect, type FileTree, type NamingRules } from '@erdd/core'
import { CliError } from './output.js'

export type ErddConfig = {
  /** 로컬 전용 프로젝트에는 없다. 서버가 필요한 명령은 requireConnection 을 지난다. */
  serverUrl: string | null
  projectId: string | null
  dialects: Dialect[]
  namingRules: NamingRules
}
export type SyncState = { revisionSeq: number; pulledAt: string }

// 정의는 core 에 있다(웹도 같은 값을 쓴다). 여기서는 CLI 안에서 짧게 쓰기 위해 넘겨만 준다.
export { LOCAL_PROJECT_ID } from '@erdd/core'

export const CONFIG_FILE = 'erdd.config.yaml'
export const STATE_DIR = '.erdd'

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function readConfig(cwd: string): Promise<ErddConfig> {
  let raw: string
  try {
    raw = await readFile(join(cwd, CONFIG_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError('NO_CONFIG', `${CONFIG_FILE}이 없습니다. erdd init을 먼저 실행하세요`)
    }
    throw err
  }
  const parsed: unknown = parseYaml(raw)
  if (!isRec(parsed)) throw new CliError('VALIDATION', `${CONFIG_FILE}의 최상위가 객체가 아닙니다`)
  const { serverUrl, projectId, dialects, namingRules } = parsed
  const hasServer = typeof serverUrl === 'string'
  const hasProject = typeof projectId === 'string'
  // 둘 다 없으면 로컬 전용이다. **하나만 있는 것은 오타로 본다** — 삼키면 사용자는 서버에 붙은
  // 줄 알고 편집하다 push 할 때가 되어서야 연결이 없다는 것을 안다.
  if (hasServer !== hasProject) {
    throw new CliError(
      'VALIDATION',
      `${CONFIG_FILE}에 serverUrl과 projectId는 함께 있어야 합니다(둘 다 없으면 로컬 전용입니다)`,
    )
  }
  if (!Array.isArray(dialects) || dialects.length === 0
      || !dialects.every((d): d is Dialect => (DIALECTS as readonly string[]).includes(d as string))) {
    throw new CliError('VALIDATION', `${CONFIG_FILE}의 dialects가 올바르지 않습니다`)
  }
  if (!isRec(namingRules) || typeof namingRules['case'] !== 'string'
      || typeof namingRules['separator'] !== 'string'
      || typeof namingRules['maxLengthBytes'] !== 'number') {
    throw new CliError('VALIDATION', `${CONFIG_FILE}의 namingRules가 올바르지 않습니다`)
  }
  // 옛 config 에는 이 키가 없다. 필수로 요구하면 기존 사용자의 pull 이 깨지므로 **누락만**
  // 기본값으로 채운다. ⚠️ 잘못 적은 값은 삼키지 않는다 — 조용히 '_' 로 돌면 erdd validate 의
  // 결과가 웹의 「모델 검사」와 갈리고, 사용자는 자기가 적은 값이 무시된 줄 모른다.
  const ls = namingRules['logicalSeparator']
  if (ls !== undefined && ls !== '' && ls !== '_') {
    throw new CliError(
      'VALIDATION',
      `${CONFIG_FILE}의 namingRules.logicalSeparator 는 "_" 또는 "" 여야 합니다`,
    )
  }
  const logicalSeparator = ls === '' ? '' as const : '_' as const
  // 템플릿은 임의 문자열이라 「잘못 적은 값」이 없다 — logicalSeparator 와 달리 검증하지 않고
  // 누락만 빈 문자열로 채운다(빈 문자열 = 템플릿을 쓰지 않음).
  const tpl = namingRules['tablePhysicalTemplate']
  const tablePhysicalTemplate = typeof tpl === 'string' ? tpl : ''
  const ltpl = namingRules['tableLogicalTemplate']
  const tableLogicalTemplate = typeof ltpl === 'string' ? ltpl : ''
  return {
    serverUrl: hasServer ? serverUrl : null,
    projectId: hasProject ? projectId : null,
    dialects,
    namingRules: {
      ...(namingRules as unknown as NamingRules),
      logicalSeparator, tablePhysicalTemplate, tableLogicalTemplate,
    },
  }
}

export async function writeConfig(cwd: string, config: ErddConfig): Promise<void> {
  await writeFile(join(cwd, CONFIG_FILE), stringifyYaml(config), 'utf8')
}

export async function readSync(cwd: string): Promise<SyncState | null> {
  const v = await readJsonIfExists(join(cwd, STATE_DIR, 'sync.json'))
  return v === null ? null : (v as SyncState)
}

export async function writeSync(cwd: string, state: SyncState): Promise<void> {
  await mkdir(join(cwd, STATE_DIR), { recursive: true })
  await writeFile(join(cwd, STATE_DIR, 'sync.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export async function readBase(cwd: string): Promise<FileTree | null> {
  const v = await readJsonIfExists(join(cwd, STATE_DIR, 'base.json'))
  return v === null ? null : (v as FileTree)
}

export async function writeBase(cwd: string, tree: FileTree): Promise<void> {
  await mkdir(join(cwd, STATE_DIR), { recursive: true })
  await writeFile(join(cwd, STATE_DIR, 'base.json'), `${JSON.stringify(tree, null, 2)}\n`, 'utf8')
}

export async function resolveToken(cwd: string): Promise<string | null> {
  const fromEnv = process.env['ERDD_TOKEN']
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const v = await readJsonIfExists(join(cwd, STATE_DIR, 'credentials.json'))
  if (isRec(v) && typeof v['token'] === 'string') return v['token']
  return null
}

export async function writeToken(cwd: string, token: string): Promise<void> {
  await mkdir(join(cwd, STATE_DIR), { recursive: true })
  const path = join(cwd, STATE_DIR, 'credentials.json')
  await writeFile(path, `${JSON.stringify({ token }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  // writeFile의 mode는 파일 생성 시에만 적용된다 — 이미 있는 파일의 권한이 넓어져 있으면
  // 그대로 남아 평문 토큰이 노출된다. 매번 명시적으로 좁힌다.
  await chmod(path, 0o600)
}

/** .erdd/를 .gitignore에 한 번만 추가한다. 기존 내용은 건드리지 않는다. */
export async function ensureGitignore(cwd: string): Promise<void> {
  const path = join(cwd, '.gitignore')
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (raw.split('\n').some((line) => line.trim() === `${STATE_DIR}/`)) return
  const prefix = raw === '' || raw.endsWith('\n') ? raw : `${raw}\n`
  await writeFile(path, `${prefix}${STATE_DIR}/\n`, 'utf8')
}

/** 서버가 필요한 명령의 단일 관문. 여기 하나면 pull·push·diff 가 같은 문구로 실패한다. */
export function requireConnection(config: ErddConfig): { serverUrl: string; projectId: string } {
  if (config.serverUrl === null || config.projectId === null) {
    throw new CliError(
      'NO_CONFIG',
      `${CONFIG_FILE}에 연결 설정이 없습니다. erdd init으로 서버에 연결하거나 erdd serve로 로컬에서 여세요`,
    )
  }
  return { serverUrl: config.serverUrl, projectId: config.projectId }
}
