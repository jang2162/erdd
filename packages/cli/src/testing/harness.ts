import { modelToFiles, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { writeBase } from '../config.js'
import { writeTree } from '../tree.js'

export const TEST_CONFIG = {
  serverUrl: 'https://erdd.example.com',
  projectId: '018f6b0e-0000-7000-8000-000000000000',
  dialects: ['postgresql'] as const,
  namingRules: {
    case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
    tablePhysicalTemplate: '', tableLogicalTemplate: '',
  } as const,
  tableOptions: { postgresql: '', mysql: '', oracle: '', mssql: '' } as const,
}

/** 서버 모델을 pull한 직후 상태(트리 + base)를 만든다. */
export async function seedPulled(cwd: string, server: ProjectModel): Promise<void> {
  const { tree } = modelToFiles(server)
  await writeTree(cwd, tree)
  await writeBase(cwd, tree)
}

export type StubOpts = {
  /** model.get이 돌려줄 리비전. 기본 1. getImpl이 있으면 무시된다. */
  seq?: number
  /**
   * model.get을 호출할 때마다 새로 평가한다 — 정적인 seq/server 참조로는 "재시도가
   * 진짜로 최신 서버 상태를 다시 읽는지"를 표현할 수 없다(재시도 루프에서 계획을 매번
   * 다시 계산하는 대신 앞서 계산한 계획을 재사용하도록 퇴행해도, 고정된 seq를 쓰면
   * 두 번째 호출도 첫 번째와 똑같은 값을 돌려줘 회귀를 잡아내지 못한다). pushImpl이
   * 서버 상태를 바꾼 뒤 CONFLICT로 거절하는 시나리오에서 이 훅으로 그 변화를 드러낸다.
   */
  getImpl?: () => { model: ProjectModel; seq: number }
  /** model.push의 응답을 갈아끼운다(CONFLICT 재시도 검증용). */
  pushImpl?: (input: unknown) => Promise<{ seq: number }>
}

/** model.get·project.get만 아는 스텁. mutate 호출은 pushCalls에 그대로 쌓인다. */
export function stubClient(
  server: ProjectModel, opts: StubOpts = {},
): { client: ApiClient; pushCalls: unknown[] } {
  const pushCalls: unknown[] = []
  const client: ApiClient = {
    query: (async (path: string) => {
      if (path === 'model.get') {
        return opts.getImpl !== undefined ? opts.getImpl() : { model: server, seq: opts.seq ?? 1 }
      }
      if (path === 'project.get') {
        return { name: '커머스', dialects: ['postgresql'], namingRules: TEST_CONFIG.namingRules }
      }
      throw new Error(`unexpected query ${path}`)
    }) as ApiClient['query'],
    mutate: (async (_path: string, input: unknown) => {
      pushCalls.push(input)
      if (opts.pushImpl !== undefined) return opts.pushImpl(input)
      return { seq: (opts.seq ?? 1) + 1 }
    }) as ApiClient['mutate'],
  }
  return { client, pushCalls }
}
