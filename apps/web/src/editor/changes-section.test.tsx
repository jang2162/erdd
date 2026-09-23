import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_PATH,
  type LocalChangesCreateResult, type LocalChangesStatus,
} from '@erdd/core'
import { ChangesSection } from './changes-section.js'

const EMPTY: LocalChangesStatus = { records: [], pending: { text: '', count: 0 }, warnings: [], error: null, unsaved: false }
const PENDING: LocalChangesStatus = { ...EMPTY, pending: { text: 'create table MBR {  @t1\n}', count: 1 } }

function stubLocal(statuses: LocalChangesStatus[], create?: (body: unknown) => LocalChangesCreateResult) {
  let i = 0
  const calls: { path: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url), 'http://localhost').pathname
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
    calls.push({ path, body })
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === LOCAL_CHANGES_PATH) return json(statuses[Math.min(i++, statuses.length - 1)])
    if (path === LOCAL_CHANGES_CREATE_PATH && create) return json(create(body))
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  render(<ChangesSection />, { wrapper })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ChangesSection', () => {
  it('미기록 변경을 미리 보여 주고, 이름을 넣어 만들면 생성 요청 뒤 다시 읽는다', async () => {
    const calls = stubLocal([PENDING, EMPTY], () => ({ ok: true, file: 'erdd/changes/20260923041200_x.erddc', statementCount: 1 }))
    renderSection()
    expect(await screen.findByLabelText('미기록 변경 미리보기')).toHaveTextContent('create table MBR')
    const button = screen.getByRole('button', { name: '변경 기록 만들기' })
    expect(button).toBeDisabled()                       // 이름이 비었다
    await userEvent.type(screen.getByLabelText('이름'), '회원 등급 추가')
    await userEvent.click(button)
    await waitFor(() => { expect(calls.some((c) => c.path === LOCAL_CHANGES_CREATE_PATH)).toBe(true) })
    expect(calls.find((c) => c.path === LOCAL_CHANGES_CREATE_PATH)!.body).toEqual({ name: '회원 등급 추가' })
    expect(await screen.findByText('기록할 변경이 없습니다')).toBeInTheDocument()
  })

  it('미저장 편집이 있으면 안내하고 버튼을 잠근다', async () => {
    stubLocal([{ ...PENDING, unsaved: true }])
    renderSection()
    expect(await screen.findByText('저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 변경 기록을 만드세요')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('이름'), 'x')
    expect(screen.getByRole('button', { name: '변경 기록 만들기' })).toBeDisabled()
  })

  it('재생 오류와 경합 경고를 위치와 함께 보여 주고, 오류면 잠근다', async () => {
    stubLocal([{
      ...EMPTY, pending: null,
      error: { file: 'erdd/changes/b.erddc', line: 5, message: '없습니다' },
      warnings: [{ file: 'erdd/changes/a.erddc', line: 3, message: '이전 값이' }],
    }])
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent('오류: erdd/changes/b.erddc 5행: 없습니다')
    expect(screen.getByText('⚠️ 기록 간 경합 — erdd/changes/a.erddc 3행: 이전 값이')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('이름'), 'x')
    expect(screen.getByRole('button', { name: '변경 기록 만들기' })).toBeDisabled()
  })

  it('기록 목록은 최신순이고, 누르면 본문을 펼친다', async () => {
    stubLocal([{
      ...EMPTY,
      records: [
        { file: 'erdd/changes/1_a.erddc', name: '초기', created: '2026-09-01T00:00:00Z', baseline: true, statementCount: 4, text: '본문-초기' },
        { file: 'erdd/changes/2_b.erddc', name: '등급 추가', created: '2026-09-02T00:00:00Z', baseline: false, statementCount: 1, text: '본문-등급' },
      ],
    }])
    renderSection()
    const rows = await screen.findAllByRole('button', { expanded: false })
    expect(rows[0]).toHaveTextContent('등급 추가')
    expect(rows[1]).toHaveTextContent('초기')
    expect(rows[1]).toHaveTextContent('기준선')
    await userEvent.click(rows[0]!)
    expect(screen.getByText('본문-등급')).toBeInTheDocument()
  })
})
