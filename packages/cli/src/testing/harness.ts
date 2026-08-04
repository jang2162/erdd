import { modelToFiles, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { writeBase } from '../config.js'
import { writeTree } from '../tree.js'

export const TEST_CONFIG = {
  serverUrl: 'https://erdd.example.com',
  projectId: '018f6b0e-0000-7000-8000-000000000000',
  dialects: ['postgresql'] as const,
  namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 } as const,
}

/** 서버 모델을 pull한 직후 상태(트리 + base)를 만든다. */
export async function seedPulled(cwd: string, server: ProjectModel): Promise<void> {
  const { tree } = modelToFiles(server)
  await writeTree(cwd, tree)
  await writeBase(cwd, tree)
}

export type StubOpts = {
  /** model.get이 돌려줄 리비전. 기본 1. */
  seq?: number
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
      if (path === 'model.get') return { model: server, seq: opts.seq ?? 1 }
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
