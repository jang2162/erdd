import {
  DEFAULT_TABLE_OPTIONS, modelToFiles,
  type Dialect, type FileIssue, type NamingRules, type ProjectModel, type TableOptions,
} from '@erdd/core'
import type { ApiClient } from '../client.js'
import { writeBase, writeConfig, writeSync, type Connection } from '../config.js'
import { writeTree } from '../tree.js'

export type SyncDownResult = {
  projectName: string
  seq: number
  model: ProjectModel
  written: string[]
  deleted: string[]
  issues: FileIssue[]
}

/** 서버에서 받아 트리·base·sync·config를 쓴다. pull과 push(성공 후)가 공유한다. */
export async function syncDown(
  cwd: string, connection: Connection, client: ApiClient,
): Promise<SyncDownResult> {
  const project = await client.query<{
    name: string; dialects: Dialect[]; namingRules: NamingRules; tableOptions?: TableOptions
  }>(
    'project.get', { projectId: connection.projectId },
  )
  const { model, seq } = await client.query<{ model: ProjectModel; seq: number }>(
    'model.get', { projectId: connection.projectId },
  )

  const { tree, issues } = modelToFiles(model)
  // 네 쓰기는 원자적이지 않다. 중간에 중단되면(Ctrl+C 등) base가 트리보다 오래된 상태로
  // 남고, 다음 status가 사용자가 손대지 않은 파일을 "로컬 변경"으로 오탐한다.
  // 순서를 뒤집으면(base 먼저) base가 트리보다 새로워져 status가 "변경 없음"이라 말하며
  // 반쯤 낡은 트리를 숨긴다 — 그쪽이 더 나쁘다. 시끄럽게 틀리는 쪽을 의도적으로 고른다.
  // pull --yes 재실행으로 수렴한다. 진짜 원자성(임시 디렉터리 + rename)은 후속 과제.
  const { written, deleted } = await writeTree(cwd, tree)
  await writeBase(cwd, tree)
  await writeSync(cwd, { revisionSeq: seq, pulledAt: new Date().toISOString() })
  // 서버가 진실 원천이다 — 방언·명명 규칙을 매번 갱신한다.
  // ⚠️ 서버 값으로 config 를 통째로 덮어쓴다 — 연결된 프로젝트에서 config 의 테이블 옵션은
  // 서버의 거울이다(`namingRules` 가 이미 갖고 있는 성질).
  await writeConfig(cwd, {
    ...connection, dialects: project.dialects, namingRules: project.namingRules,
    tableOptions: project.tableOptions ?? { ...DEFAULT_TABLE_OPTIONS },
  })

  return { projectName: project.name, seq, model, written, deleted, issues }
}
