import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import {
  LOCAL_SAVE_PATH, MAX_OPS_PER_MUTATION, createEmptyModel, type ProjectModel,
} from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { useLocalSave } from './use-local-save.js'
import { useModelMutation } from './use-model.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

const PID = '018f6b0e-0000-7000-8000-0000000000aa'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

function withNotes(model: ProjectModel, n: number): ProjectModel {
  const notes = { ...model.notes }
  for (let i = 0; i < n; i++) {
    const id = `n${i}`
    notes[id] = { id, content: `메모${i}`, position: { x: 0, y: 0 }, color: '#fff' }
  }
  return { ...model, notes }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/**
 * 로컬 서버를 흉내 낸다. `events` 에 요청이 서버에 닿은 순서를 남기고, 저장은 **응답하는 순간**
 * 서버에 반영돼 있던 조각 수를 `saved` 에 남긴다 — 그 값이 0 도 전부도 아니면 조각 사이의 중간 상태가
 * 파일로 나간 것이다. ⚠️ 실제 `FileStore` 와 달리 요청을 **직렬화하지 않는다** — 그래서 웹 쪽 순서만으로
 * 저장이 조각 뒤에 서는지를 본다(서버 쪽 방어선은 cli `store.test.ts` 가 따로 잠근다).
 */
function mockLocalServer() {
  const events: string[] = []
  const saved: number[] = []
  let applied = 0
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === LOCAL_SAVE_PATH) {
      events.push('save')
      saved.push(applied)
      events.push('save-done')
      return json({ ok: true, seq: 1, written: ['erdd/notes.yaml'], deleted: [] })
    }
    if (u.includes('model.mutate')) {
      await new Promise((r) => setTimeout(r, 5))
      const body = JSON.parse(String(init?.body)) as Record<string, { summary?: string }>
      events.push(body['0']!.summary ?? '')
      applied += 1
      return json([{ result: { data: { seq: 1 + applied } } }])
    }
    throw new Error(`unexpected fetch ${u}`)
  }))
  return { events, saved }
}

function setup() {
  useEditorStore.getState().setLoaded(createEmptyModel(), 1, PID)
  grantEditPermission()
  return renderHook(
    () => ({ mutate: useModelMutation(PID), local: useLocalSave() }),
    { wrapper: wrapper() },
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

/**
 * 조각 사이의 중간 상태는 참조 무결성은 지키지만 **이름 유일성은 보장하지 않는다**(같은 이름 도메인을
 * 새 id 로 바꾸는 편집이면 create 조각과 delete 조각 사이에 같은 이름이 둘이다). 로컬 모드의 저장은
 * 그 모델을 `modelToFiles` 로 파일에 쓰므로, 저장이 조각 사이에 끼면 다시 읽을 수 없는 파일이 나간다
 * (guides/editor-state.md 「저장은 편집 중인 입력을 먼저 반영한다(로컬 모드)」).
 */
describe('로컬 저장은 조각 적용과 교차하지 않는다', () => {
  it('조각 적용 도중 누른 저장은 flushPendingEdits 가 모델 변경 체인을 기다려 모든 조각 뒤에 나간다', async () => {
    const { events, saved } = mockLocalServer()
    const { result } = setup()
    await act(async () => {
      const applying = result.current.mutate((m) => withNotes(m, MAX_OPS_PER_MUTATION + 1), { summary: '메모 추가' })
      await result.current.local.save()
      await applying
    })
    expect(events).toEqual(['메모 추가 (1/2)', '메모 추가 (2/2)', 'save', 'save-done'])
    expect(saved).toEqual([2])
  })
})
