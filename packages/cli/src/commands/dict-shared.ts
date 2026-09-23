import {
  TOP_LEVEL_FILES, filesToModel,
  type FileTree, type LibraryItem, type ProjectModel,
} from '@erdd/core'
import { uuidv7 } from 'uuidv7'
import type { ApiClient } from '../client.js'
import { CONFIG_FILE, type Connection, type ErddConfig } from '../config.js'
import { CliError } from '../output.js'
import { readTree } from '../tree.js'

export type LibraryRow = {
  id: string; scope: 'global' | 'org'; orgId: string | null; name: string
  description: string; itemCount: number; canWrite: boolean
}

/**
 * 사전 동기화가 쓰는 파일. 그룹·테이블 파일은 재동기화가 건드리지 않으므로 쓰지 않는다 —
 * modelToFiles 가 다시 만든 테이블 파일을 쓰면 손으로 다듬은 YAML 이 이유 없이 정규화된다.
 */
export const DICTIONARY_FILES: readonly string[] = TOP_LEVEL_FILES.filter((p) => p !== 'erdd/groups.yaml')

/** 사전 명령의 연결 관문. 로컬 전용 프로젝트에는 서버 프로젝트를 만들어 붙이는 길을 가리킨다. */
export function requireDictConnection(config: ErddConfig): Connection {
  if (config.serverUrl === null || config.projectId === null) {
    throw new CliError(
      'NO_CONFIG',
      `서버에 연결되지 않은 프로젝트입니다. erdd init --server <url> --create 로 연결하세요 (${CONFIG_FILE})`,
    )
  }
  return { serverUrl: config.serverUrl, projectId: config.projectId }
}

/**
 * 새로 토큰에 연 프로시저를 옛 서버에 부르면 둘 중 하나로 떨어진다 — 세션 전용 거절(401,
 * 서버 `authedProcedure` 의 문구)이거나 프로시저 부재(404, tRPC 의 `No "…"-procedure on path`).
 * 둘 다 사용자가 고칠 수 있는 것은 서버 업그레이드뿐이라 그렇게 말한다.
 * 토큰 자체가 틀린 401 은 문구가 달라 여기 걸리지 않는다.
 */
export async function guardFeature<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (err instanceof CliError && (
      (err.code === 'UNAUTHORIZED' && err.message.includes('액세스 토큰으로 할 수 없습니다'))
      || (err.code === 'NOT_FOUND' && /procedure on path/i.test(err.message)))) {
      throw new CliError(err.code, '서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요')
    }
    throw err
  }
}

export function listLibraries(client: ApiClient, projectId: string): Promise<LibraryRow[]> {
  return guardFeature(() => client.query<LibraryRow[]>('resource.library.listForProject', { projectId }))
}

/**
 * 기본은 id 순으로 정렬해 넘긴다 — planResync 의 순회 순서가 결과를 흔들지 않게(결정성).
 *
 * `order: 'server'` 는 서버가 준 순서(`loadLibraryItems` 의 createdAt 오름차순)를 그대로 둔다 —
 * dict push 전용이다. 서버의 `resource.promote`·`promotion.create` 는 그 순서로 `planPromote` 를
 * **다시 계산**하고, 동명 항목이 둘이면 먼저 나온 쪽이 `name-match` 대상이 된다. CLI 가 id 순으로
 * 계산하면 `expectedTargetItemId` 가 서버와 어긋나 그 항목이 `plan-changed` 로 조용히 건너뛰어진다.
 */
export async function fetchItems(
  client: ApiClient, libraryId: string, opts: { order: 'id' | 'server' } = { order: 'id' },
): Promise<LibraryItem[]> {
  const items = await guardFeature(() => client.query<LibraryItem[]>('resource.items.list', { libraryId }))
  return opts.order === 'server' ? items : [...items].sort((a, b) => a.id.localeCompare(b.id))
}

/** id 가 정확히 맞으면 그것, 아니면 이름. 이름이 여럿에 맞으면 고르지 않는다 — 엉뚱한 사전을 받는다. */
export function resolveLibrary(rows: readonly LibraryRow[], ref: string): LibraryRow {
  const byId = rows.find((r) => r.id === ref)
  if (byId !== undefined) return byId
  const byName = rows.filter((r) => r.name === ref)
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    throw new CliError('USAGE', [
      `이름이 ${ref}인 라이브러리가 여럿입니다 — id로 지정하세요:`,
      ...byName.map((r) => `  ${r.id}  ${r.scope === 'global' ? '전역' : '조직'}  ${r.name}`),
    ].join('\n'))
  }
  throw new CliError('NOT_FOUND', `라이브러리 ${ref}을(를) 찾지 못했습니다 — erdd dict list 로 확인하세요`)
}

/**
 * 로컬 파일 모델. id 없는 항목(사람이 직접 추가한 것)에는 **실제 uuid** 를 준다 — 임시 id(`new:…`)
 * 로 조립하면 사전 파일을 다시 쓸 때 그 임시 id 가 파일에 새어 나간다.
 */
export async function readLocalModel(cwd: string): Promise<{ tree: FileTree; model: ProjectModel }> {
  const tree = await readTree(cwd)
  const result = filesToModel(tree, { newId: uuidv7 })
  if (!result.ok) {
    throw new CliError('VALIDATION', [
      `파일 오류 ${result.issues.length}건 — erdd validate로 확인하세요`,
      ...result.issues.map((i) => `  ${i.path}: ${i.message}`),
    ].join('\n'))
  }
  return { tree, model: result.model }
}
