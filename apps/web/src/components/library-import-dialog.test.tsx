import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { LibraryImportDialog } from './library-import-dialog.js'

const FILE = 'format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\nwords:\n  - { logicalName: 고객, abbreviation: CSTMR }\n'
const summary = (counts: Record<string, number>, entries: unknown[] = []) => ({
  counts: { add: 0, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0, ...counts }, warnings: [], entries,
})

function renderDialog(handlers: Parameters<typeof mockTrpcFetch>[0], onDone = vi.fn()) {
  mockTrpcFetch({ 'resource.items.list': () => ({ data: [] }), ...handlers })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <LibraryImportDialog target={{ kind: 'existing', libraryId: 'l1', name: '표준' }} onClose={() => {}} onDone={onDone} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return onDone
}
const pick = async (text = FILE, name = 'std.erdd-lib.yaml') =>
  userEvent.upload(screen.getByLabelText('파일 선택'), new File([text], name))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('LibraryImportDialog', () => {
  it('형식 오류는 서버를 부르지 않고 위치와 함께 보인다', async () => {
    const importFn = vi.fn()
    renderDialog({ 'resource.library.import': importFn })
    await pick(FILE.replace('abbreviation', 'abbrevation'))
    expect(await screen.findByText(/words\[0\] \(고객\)/)).toBeDefined()
    expect(importFn).not.toHaveBeenCalled()
  })

  it('두 체크박스는 기본 해제이고, 미리보기 해시를 실어 적용한다', async () => {
    const calls: Record<string, unknown>[] = []
    const onDone = renderDialog({ 'resource.library.import': (input) => {
      calls.push(input as Record<string, unknown>)
      return { data: { libraryId: 'l1', applied: !(input as { dryRun: boolean }).dryRun, stateHash: 'h1', summary: summary(
        { update: 1, remove: 2, stale: 1 },
        [{ status: 'update', kind: 'word', name: '고객', currentVersion: 1, fileVersion: null, referencedBy: 0, changes: [{ field: 'abbreviation', from: 'CUST', to: 'CSTMR' }] }],
      ) } }
    } })
    await pick()
    const prune = await screen.findByRole('checkbox', { name: /파일에 없는 항목 2건 삭제/ })
    const stale = screen.getByRole('checkbox', { name: /오래된 파일 항목 1건 덮어쓰기/ })
    expect((prune as HTMLInputElement).checked).toBe(false)
    expect((stale as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/CUST → CSTMR/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: '가져오기 실행' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)).toMatchObject({ dryRun: false, prune: false, includeStale: false, expectedStateHash: 'h1' })
  })

  it('바뀔 것이 0건이면 실행 버튼이 잠기고 안내가 보인다', async () => {
    renderDialog({ 'resource.library.import': () => ({ data: { libraryId: 'l1', applied: false, stateHash: 'h', summary: summary({ unchanged: 3 }) } }) })
    await pick()
    expect(await screen.findByText('파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다')).toBeDefined()
    expect((screen.getByRole('button', { name: '가져오기 실행' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('409 면 다시 미리보기를 권한다', async () => {
    let n = 0
    renderDialog({ 'resource.library.import': () => (++n === 1
      ? { data: { libraryId: 'l1', applied: false, stateHash: 'h', summary: summary({ add: 1 }) } }
      : { error: { code: -32009, message: '미리보기 이후 라이브러리가 바뀌었습니다 — 다시 미리보기 하세요' } }) })
    await pick()
    await userEvent.click(await screen.findByRole('button', { name: '가져오기 실행' }))
    expect(await screen.findByRole('button', { name: '다시 미리보기' })).toBeDefined()
  })

  it('늦게 응답한 먼저 고른 파일의 미리보기가 나중에 고른 파일의 요약을 덮지 않는다', async () => {
    let resolveFirst: (v: { data: unknown }) => void = () => {}
    const pending = new Promise<{ data: unknown }>((resolve) => { resolveFirst = resolve })
    let call = 0
    const marker = (name: string) => summary({ add: 1 }, [
      { status: 'add', kind: 'word', name, currentVersion: null, fileVersion: null, referencedBy: 0, changes: [] },
    ])
    renderDialog({ 'resource.library.import': () => {
      call += 1
      return call === 1
        ? pending
        : { data: { libraryId: 'l1', applied: false, stateHash: 'h2', summary: marker('SECOND') } }
    } })
    await pick(FILE, 'first.erdd-lib.yaml')
    await pick(FILE, 'second.erdd-lib.yaml')
    expect(await screen.findByText(/SECOND/)).toBeDefined()
    // 먼저 고른 파일의 dryRun 이 이제야 응답한다 — 화면은 이미 두 번째 파일의 요약을 보이고 있다.
    resolveFirst({ data: { libraryId: 'l1', applied: false, stateHash: 'h1', summary: marker('FIRST') } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText(/SECOND/)).toBeDefined()
    expect(screen.queryByText(/FIRST/)).toBeNull()
  })
})
