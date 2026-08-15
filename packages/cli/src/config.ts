import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { DIALECTS, type Dialect, type FileTree, type NamingRules } from '@erdd/core'
import { CliError } from './output.js'

export type ErddConfig = {
  serverUrl: string
  projectId: string
  dialects: Dialect[]
  namingRules: NamingRules
}
export type SyncState = { revisionSeq: number; pulledAt: string }

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
  if (typeof serverUrl !== 'string' || typeof projectId !== 'string') {
    throw new CliError('VALIDATION', `${CONFIG_FILE}에 serverUrl 또는 projectId가 없습니다`)
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
  return {
    serverUrl, projectId, dialects,
    namingRules: { ...(namingRules as unknown as NamingRules), logicalSeparator },
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
