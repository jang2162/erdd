import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { DdlImportDialog } from './ddl-import-dialog.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000dd'

const DDL = `
CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
COMMENT ON TABLE MBR IS '회원';`

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<DdlImportDialog projectId={PROJECT_ID} open onOpenChange={() => {}} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('DdlImportDialog', () => {
  it('DDL을 붙여넣으면 미리보기에 개수가 뜬다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste(DDL)
    expect(await screen.findByText(/테이블 1개/)).toBeInTheDocument()
    expect(screen.getByText(/컬럼 2개/)).toBeInTheDocument()
  })

  it('건너뛴 구문을 경고로 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste('GRANT SELECT ON A TO B;')
    expect(await screen.findByText(/건너뛰었습니다/)).toBeInTheDocument()
  })

  it('적용하면 단일 mutation이 나간다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste(DDL)
    await userEvent.click(await screen.findByRole('button', { name: /만들기$/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
  })

  it('방언을 수동으로 바꾸면 파싱 결과가 갱신된다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    // 브리프 원문은 'CREATE TABLE A (C1 CLOB);'을 썼는데, CLOB 하나만으로 detectDialect가
    // 이미 'oracle'을 자동 감지한다(ddl-parse.ts의 SIGNATURES, 경쟁 시그니처 없음). 그 상태에서
    // selectOptions로 'oracle'을 고르면 이미 활성인 값을 다시 고르는 것이라 manualDialect
    // 오버라이드 기구를 통째로 지워도(dialect = detected ?? 'postgresql') 테스트가 통과해
    // 회귀 방어력이 0이었다(task-8-report.md "브리프 코드에서 발견한 결함" 두 번째 항목 참고).
    // 백틱·ENGINE= 때문에 mysql로 자동 감지되게(detectDialect로 직접 확인: 'mysql') 픽스처를
    // 바꿔, 자동 감지값(mysql)과 수동 선택값(oracle)이 실제로 달라지게 했다. mysql에는 CLOB
    // 규칙이 없어 '알지 못해' 경고가 나고, oracle로 바꿔야 비로소 CLOB → TEXT 모호성 경고로
    // 바뀐다 — 이제 오버라이드가 실제로 동작해야만 통과하는 테스트다.
    await userEvent.paste('CREATE TABLE `A` (C1 CLOB) ENGINE=InnoDB;')
    expect(await screen.findByText(/알지 못해/)).toBeInTheDocument()
    expect(screen.queryByText(/TEXT로 읽었습니다/)).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '방언' }), 'oracle')
    expect(await screen.findByText(/TEXT로 읽었습니다/)).toBeInTheDocument()
    expect(screen.queryByText(/알지 못해/)).toBeNull()
  })

  it('op 한도를 넘으면 적용을 막고 안내한다', async () => {
    const many = Array.from({ length: 2600 }, (_, i) => `CREATE TABLE T${i} (C1 INT, C2 INT);`).join('\n')
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste(many)
    expect(await screen.findByText(/나눠/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /만들기$/ })).toBeDisabled()
  })

  // I-1: 경고의 target(어느 테이블·컬럼인지)이 렌더돼야 한다 — 그렇지 않으면 컬럼 여러
  // 개를 가져올 때 같은 문구가 반복되고 어느 컬럼인지 알 수 없다.
  it('경고에 대상 위치를 함께 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste('CREATE TABLE MBR (MBR_NO bigint);')
    expect(await screen.findByText('MBR.MBR_NO')).toBeInTheDocument()
  })

  // I-1: 미리보기의 "건너뜀 N개"에 건너뛴 테이블 이름도 함께 보여야 어느 테이블이 겹쳤는지
  // 알 수 있다(설계 §7 목업: "건너뜀 2개 (이미 있는 이름: MBR, ORD)").
  //
  // 브리프 원문은 `screen.findByText(/MBR/)`이었으나, 붙여넣은 DDL 텍스트 자체가
  // <textarea>에 그대로 echo되어 그 안에 이미 'MBR'이 들어 있다 — 그래서 이 배너를
  // 구현하지 않아도(수정 전 코드 그대로도) 항상 통과하는 가짜 양성 테스트였다(직접 확인:
  // 수정 전 상태에서 이 assertion만 통과함). "건너뜀 N개"는 요약 문단에서만 나오는
  // 문구이므로 그 문단 텍스트 안에 테이블 이름이 함께 있는지로 범위를 좁혔다.
  it('건너뛴 테이블 이름을 미리보기에 보여준다', async () => {
    const model = createEmptyModel()
    model.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('textbox', { name: 'DDL' }))
    await userEvent.paste('CREATE TABLE MBR (MBR_NO bigint);')
    // ⚠️ 문구까지 못 박는다 — 「이미 있는 이름」은 머릿말이 이름을 되돌리면 거짓이 된다
    // (나열되는 것은 DDL 원문 이름이고 부딪힌 것은 되돌린 이름이다).
    expect(await screen.findByText(/건너뜀 1개 \(이름이 겹침: MBR\)/)).toBeInTheDocument()
  })

  // 「편집 권한이 없으면 진입점이 없다」는 header-tools.test.tsx 로 옮겼다 — canEdit 가드가
  // 컴포넌트에서 「파일 ▾」 메뉴 항목으로 이동했기 때문이다(설계 3.3).
})

describe('DdlImportDialog — DBML 형식', () => {
  /** DBML 본문을 textarea에 넣는다. userEvent.type은 `{`·`[`를 특수 키로 해석하므로 쓰지 않는다. */
  const typeSchema = (el: HTMLElement, value: string): void => {
    fireEvent.change(el, { target: { value } })
  }

  const openDbml = async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'DBML' }))
  }

  it('DBML 을 고르면 DBML 파서로 미리보기를 만든다', async () => {
    await openDbml()
    typeSchema(screen.getByRole('textbox', { name: 'DBML' }), 'Table "MBR" {\n  "MBR_NO" bigint [pk]\n}')
    expect(await screen.findByText(/테이블 1개/)).toBeInTheDocument()
  })

  it('DBML 의 database_type 으로 방언을 자동 감지한다', async () => {
    await openDbml()
    typeSchema(screen.getByRole('textbox', { name: 'DBML' }), "Project \"P\" {\n  database_type: 'Oracle'\n}")
    await waitFor(() => {
      expect((screen.getByLabelText('방언') as HTMLSelectElement).value).toBe('oracle')
    })
  })

  it('DBML 은 그룹 수를 미리보기에 보인다', async () => {
    await openDbml()
    typeSchema(
      screen.getByRole('textbox', { name: 'DBML' }),
      'Table "MBR" {\n  "A" int\n}\nTableGroup "회원" {\n  "MBR"\n}',
    )
    expect(await screen.findByText(/그룹 1개/)).toBeInTheDocument()
  })
})
