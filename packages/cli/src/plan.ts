import { uuidv7 } from 'uuidv7'
import {
  applyMerge, diffModels, filesToModel, fileVisibleModel, mergeModels,
  type MergeConflict, type Op, type PrunedRef, type ProjectModel,
} from '@erdd/core'
import type { ApiClient } from './client.js'
import { readBase, type ErddConfig } from './config.js'
import { CliError } from './output.js'
import { readTree } from './tree.js'

export type PushPlan = {
  /** model.get 시점의 서버 리비전 — model.push의 expectedSeq가 된다. */
  seq: number
  /** 정규화하지 않은 서버 모델. applyMerge가 좌표·origin·메모를 여기서 가져온다. */
  server: ProjectModel
  /** 파일 가시 공간의 셋 — diff의 표시가 이 셋을 쓴다. */
  base: ProjectModel
  local: ProjectModel
  serverVisible: ProjectModel
  /** 충돌이 있으면 빈 배열이다(충돌 필드에 서버 값이 남은 merged로 op를 내면 틀린다). */
  ops: Op[]
  conflicts: MergeConflict[]
  pruned: PrunedRef[]
}

export async function buildPlan(
  cwd: string, config: ErddConfig, client: ApiClient,
): Promise<PushPlan> {
  const baseTree = await readBase(cwd)
  if (baseTree === null) {
    throw new CliError('VALIDATION', '기준 시점이 없습니다. 먼저 erdd pull을 실행하세요')
  }
  const localTree = await readTree(cwd)
  if (Object.keys(localTree).length === 0 && Object.keys(baseTree).length > 0) {
    // erdd/를 통째로 지운 상태를 "전부 삭제"로 해석하지 않는다 — rm -rf 사고를 막는다.
    throw new CliError(
      'VALIDATION',
      'erdd/ 아래에 파일이 없습니다. 전체 삭제가 의도라면 파일을 개별로 지우고, 아니라면 erdd pull로 되돌리세요',
    )
  }

  const localResult = filesToModel(localTree, { newId: uuidv7 })
  if (!localResult.ok) {
    throw new CliError('VALIDATION', [
      `파일 오류 ${localResult.issues.length}건 — erdd validate로 확인하세요`,
      ...localResult.issues.map((i) => `  ${i.path}: ${i.message}`),
    ].join('\n'))
  }
  // base는 항상 서버가 쓴 트리라 id가 완전하다 — newId가 필요 없다.
  const baseResult = filesToModel(baseTree)
  if (!baseResult.ok) {
    throw new CliError('VALIDATION', '.erdd/base.json이 손상됐습니다. erdd pull로 다시 받으세요')
  }

  const { model: server, seq } = await client.query<{ model: ProjectModel; seq: number }>(
    'model.get', { projectId: config.projectId },
  )
  const serverVisible = fileVisibleModel(server)
  const { merged, conflicts } = mergeModels(baseResult.model, localResult.model, serverVisible)
  const { model: applied, pruned } = applyMerge(server, merged)

  return {
    seq, server, base: baseResult.model, local: localResult.model, serverVisible,
    ops: conflicts.length > 0 ? [] : diffModels(server, applied),
    conflicts, pruned,
  }
}
