import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { DEFAULT_NAMING_RULES, computeWarnings, type NamingRules } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createDomain } from './domain-edits.js'
import { createCustomField } from './custom-field-edits.js'
import { createTerm } from './dict-edits.js'
import { addTable } from './model-edits.js'
import { EditPanel } from './edit-panel.js'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<EditPanel projectId="018f6b0e-0000-7000-8000-0000000000aa" />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('EditPanel', () => {
  it('prompts to select a table when nothing is selected', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    renderPanel()
    expect(screen.getByText(/테이블을 선택/)).toBeInTheDocument()
  })

  it('edits the table physical name and sends a mutation', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER')
    await userEvent.tab() // blur → commit
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  it('adds a column via the add button', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    const before = Object.values(useEditorStore.getState().model.columns)
      .filter((c) => c.tableId === 't1').length
    await userEvent.click(screen.getByRole('button', { name: '컬럼 추가' }))
    await waitFor(() => {
      const after = Object.values(useEditorStore.getState().model.columns)
        .filter((c) => c.tableId === 't1').length
      expect(after).toBe(before + 1)
    })
  })

  it('assigning a domain to a column locks the type input and shows the domain type', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createDomain(m, {
      id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    expect((screen.getByLabelText('타입') as HTMLInputElement)).toBeEnabled()

    await userEvent.selectOptions(screen.getByLabelText('도메인'), 'd1')

    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.domainId).toBe('d1'))
    const typeInput = screen.getByLabelText('타입') as HTMLInputElement
    expect(typeInput).toBeDisabled()
    expect(typeInput.value).toContain('DECIMAL(15)')
  })

  it('빈 물리명 컬럼은 논리명 입력 시 물리명이 자동 생성된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '', physicalName: '' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    // selector: 'input' — 「논리명 채우기」 버튼의 aria-label도 /논리명/에 매치해 인덱스가 밀리므로 input만 취한다.
    const logicalInputs = screen.getAllByLabelText(/논리명/, { selector: 'input' }) // [0] 테이블, [1] 컬럼
    await userEvent.type(logicalInputs[1]!, '회원')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.physicalName).toBe('MBR')
    })
  })

  it('물리명이 이미 있으면 논리명 입력이 물리명을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '', physicalName: 'KEEP_ME' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    // selector: 'input' — 「논리명 채우기」 버튼의 aria-label도 /논리명/에 매치해 인덱스가 밀리므로 input만 취한다.
    const logicalInputs = screen.getAllByLabelText(/논리명/, { selector: 'input' })
    await userEvent.type(logicalInputs[1]!, '회원')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('회원')
    })
    expect(useEditorStore.getState().model.columns['c1']!.physicalName).toBe('KEEP_ME')
  })

  it('clearing a domain unlocks the type input and copies the resolved logical type', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createDomain(m, {
      id: 'd2', name: '상태코드', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: ['Y', 'N'], description: null, origin: null,
    })
    m = { ...m, columns: { ...m.columns, c1: { ...m.columns['c1']!, domainId: 'd2' } } }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    expect(screen.getByLabelText('타입')).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('도메인'), '')

    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.domainId).toBeNull())
    expect(useEditorStore.getState().model.columns['c1']!.type).toBe('CHAR(1)')
    const typeInput = screen.getByLabelText('타입') as HTMLInputElement
    expect(typeInput).toBeEnabled()
    expect(typeInput.value).toBe('CHAR(1)')
  })

  it('컬럼 커스텀 항목 체크박스가 모델의 custom 값을 바꾼다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = createCustomField(m, {
      id: 'cf1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: false, defaultValue: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1') // t1은 컬럼 c1 하나뿐
    renderPanel()
    await userEvent.click(screen.getByLabelText('개인정보여부'))
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.custom).toEqual({ cf1: 'true' })
    })
  })

  it('테이블 대상 커스텀 항목은 테이블 영역에 기본값과 함께 렌더된다', () => {
    let m = buildSampleModel()
    m = createCustomField(m, {
      id: 'cf2', name: '업무구분', target: 'table', type: 'text',
      options: [], required: false, defaultValue: '공통', origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    renderPanel()
    // 미입력이므로 정의 기본값이 라이브 해석돼 보인다
    expect(screen.getByLabelText('업무구분')).toHaveValue('공통')
  })

  it('테이블 폼은 물리명 입력이 논리명 입력보다 앞에 온다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    const physical = screen.getByLabelText(/테이블 물리명/)
    const logical = screen.getAllByLabelText(/논리명/, { selector: 'input' })[0]!   // [0] 테이블
    // compareDocumentPosition: 4 === FOLLOWING (physical 뒤에 logical이 온다)
    expect(physical.compareDocumentPosition(logical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('빈 논리명 테이블은 물리명 입력 시 논리명이 복원된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '', physicalName: '' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    const physical = screen.getByLabelText(/테이블 물리명/)
    await userEvent.type(physical, 'MBR')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('회원')
    })
  })

  it('논리명이 이미 있으면 물리명 입력이 논리명을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '유지', physicalName: '' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    await userEvent.type(screen.getByLabelText(/테이블 물리명/), 'MBR')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']!.physicalName).toBe('MBR')
    })
    expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('유지')
  })

  it('사전에 없는 약어면 논리명을 채우지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '', physicalName: '' } },
    }   // words가 비어 있다 — buildSampleModel의 기본값
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    await userEvent.type(screen.getByLabelText(/테이블 물리명/), 'XYZ')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']!.physicalName).toBe('XYZ')
    })
    expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('')
  })

  it('「논리명 채우기」 화살표는 값이 있어도 덮어쓴다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      tables: { ...m.tables, t1: { ...m.tables['t1']!, logicalName: '옛이름', physicalName: 'MBR' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    // 테이블·컬럼이 같은 이름의 버튼을 가지므로 [0](테이블)으로 좁힌다.
    await userEvent.click(screen.getAllByRole('button', { name: '논리명 채우기' })[0]!)
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']!.logicalName).toBe('회원')
    })
  })

  it('새 테이블은 물리명 required-empty가 뜨고, 논리명을 넣으면 사라진다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m, words: { w1: {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    } } }
    m = addTable(m, { id: 'newt', position: { x: 0, y: 0 } })
    const before = computeWarnings(m).filter(
      (w) => w.kind === 'required-empty' && w.entityId === 'newt')
    expect(before).toHaveLength(1)          // 물리명만 비어 있다

    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('newt')
    renderPanel()
    const logical = screen.getAllByLabelText(/논리명/, { selector: 'input' })[0]!
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['newt']!.physicalName).toBe('MBR')
    })
    const after = computeWarnings(useEditorStore.getState().model).filter(
      (w) => w.kind === 'required-empty' && w.entityId === 'newt')
    expect(after).toEqual([])
  })

  it('편집 권한이 없으면 입력이 잠기고 편집 버튼이 사라진다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    useEditorStore.getState().select('t1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '컬럼 삭제' })).toBeNull()
    expect(screen.queryByRole('button', { name: '물리명 채우기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '용어 등록' })).toBeNull()
    expect(screen.queryByRole('button', { name: '논리명 채우기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '컬럼 추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: '위로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '아래로' })).toBeNull()

    // 값은 그대로 보인다 (t1: 논리명 회원등급, 컬럼 c1 논리명 등급코드).
    const tableLogical = screen.getByDisplayValue('회원등급')
    expect(tableLogical).toHaveAttribute('readonly')
    const columnLogical = screen.getByDisplayValue('등급코드')
    expect(columnLogical).toHaveAttribute('readonly')

    expect(screen.getByLabelText('소속 그룹')).toBeDisabled()
    expect(screen.getByLabelText('도메인')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'PK' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'NN' })).toBeDisabled()
  })

  it('컬럼 행은 물리명 입력이 논리명 입력보다 앞에 온다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')   // t1은 컬럼 c1 하나뿐
    renderPanel()
    // selector: 'input' — 「논리명 채우기」 버튼의 aria-label도 정규식에 매치해
    // 인덱스가 밀리므로 input만 취한다(기존 두 테스트와 같은 이유).
    const physicals = screen.getAllByLabelText(/물리명/, { selector: 'input' })
    const logicals = screen.getAllByLabelText(/논리명/, { selector: 'input' })
    // [0]은 테이블 폼, [1]이 컬럼 행
    const colPhysical = physicals[1]!
    const colLogical = logicals[1]!
    expect(colPhysical.compareDocumentPosition(colLogical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('빈 논리명 컬럼은 물리명 입력 시 논리명이 복원된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '', physicalName: '' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    const colPhysical = screen.getAllByLabelText(/물리명/, { selector: 'input' })[1]!
    await userEvent.type(colPhysical, 'MBR')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('회원')
    })
  })

  it('컬럼의 논리명이 이미 있으면 물리명 입력이 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '유지', physicalName: '' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    await userEvent.type(screen.getAllByLabelText(/물리명/, { selector: 'input' })[1]!, 'MBR')
    await userEvent.tab()
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.physicalName).toBe('MBR')
    })
    expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('유지')
  })

  it('컬럼의 「논리명 채우기」 화살표는 값이 있어도 덮어쓴다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    let m = buildSampleModel()
    m = { ...m,
      words: { w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: null, description: null, origin: null,
      } },
      columns: { ...m.columns, c1: { ...m.columns['c1']!, logicalName: '옛이름', physicalName: 'MBR' } },
    }
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t1')
    renderPanel()
    const card = screen.getByLabelText('논리명', { selector: '#col-c1-logical' }).closest('li')!
    await userEvent.click(within(card).getByRole('button', { name: '논리명 채우기' }))
    await waitFor(() => {
      expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('회원')
    })
  })

  it('선택된 컬럼 행에 aria-selected가 붙는다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
    renderPanel()
    const rows = screen.getAllByRole('listitem')
    const selected = rows.filter((r) => r.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
  })

  it('2개 이상 선택하면 일괄 작업 패널로 전환된다', () => {
    // 상세 편집은 다중 선택에서 의미가 모호하다. 주 선택 하나를 계속 편집하게 두면
    // 화면에 2개가 하이라이트된 채 한 개만 바뀌어 무엇이 편집되는지 알 수 없다.
    // BulkPanel이 main의 「N개 선택됨」 안내를 대신한다(개수 + 목록 + 그룹 이동 + 삭제).
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    expect(screen.getByText('2개 테이블 선택됨')).toBeInTheDocument()
    expect(screen.queryByLabelText(/테이블 물리명/)).toBeNull()
  })

  it('1개만 선택하면 기존 상세 편집 패널 그대로다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().selectTables(['t2'])
    renderPanel()

    expect(screen.getByLabelText(/테이블 물리명/)).toBeInTheDocument()
    expect(screen.queryByText(/테이블 선택됨/)).toBeNull()
  })

  it('선택된 컬럼 행으로 스크롤한다', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
      grantEditPermission()
      useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
      renderPanel()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  it('이미 있는 용어와 논리명이 같으면 용어 등록이 비활성이다', async () => {
    let m = buildSampleModel()
    m = createTerm(m, {
      id: 'tm1', logicalName: '회원명', physicalName: 'MBR_NM',
      domainId: null, description: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const card = screen.getByLabelText('논리명', { selector: '#col-c3-logical' }).closest('li')!
    expect(within(card).getByRole('button', { name: '용어 등록' })).toBeDisabled()
  })

  it('용어를 등록하면 토스트로 알린다', async () => {
    const { toast } = await import('sonner')
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => '' as never)
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, '018f6b0e-0000-7000-8000-0000000000aa')
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const card = screen.getByLabelText('논리명', { selector: '#col-c3-logical' }).closest('li')!
    await userEvent.click(within(card).getByRole('button', { name: '용어 등록' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })
})

const PROJECT = '018f6b0e-0000-7000-8000-0000000000aa'

/** 도메인 d1 을 단 용어 하나를 실은 모델. c1(t1 의 유일 컬럼)은 이름을 비워 둔다. */
function loadForDomainRule(over: { logicalName?: string; physicalName?: string; domainId?: string | null }) {
  let m = buildSampleModel()
  m = createDomain(m, {
    id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  })
  m = createDomain(m, {
    id: 'd2', name: '수량', category: null, logicalType: 'INT',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  })
  m = createTerm(m, {
    id: 'tm1', logicalName: '결제금액', physicalName: 'PAY_AMT',
    domainId: 'd1', description: null, origin: null,
  })
  m = { ...m, columns: { ...m.columns, c1: {
    ...m.columns['c1']!, logicalName: '', physicalName: '', domainId: null, ...over,
  } } }
  useEditorStore.getState().setLoaded(m, 1, PROJECT)
  grantEditPermission()
  useEditorStore.getState().select('t1')
}

describe('EditPanel 용어 등록', () => {
  /** t2 의 컬럼 c3(회원명/MBR_NM) 카드를 집는다. */
  function c3Card() {
    return screen.getByLabelText('논리명', { selector: '#col-c3-logical' }).closest('li')!
  }

  // ⚠️ M1. 이 사이클이 "닫았다"고 선언한 이월 결함이 같은 카드의 세 번째 버튼에 그대로 있었다.
  it('치고 blur 없이 용어 등록을 누르면 방금 친 이름으로 등록된다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT)
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText('논리명', { selector: '#col-c3-logical' })
    const card = input.closest('li')!
    await userEvent.clear(input)
    await userEvent.type(input, '주문번호')          // blur 하지 않는다
    await userEvent.click(within(card).getByRole('button', { name: '용어 등록' }))
    await waitFor(() => {
      const t = Object.values(useEditorStore.getState().model.terms)[0]
      expect(t?.logicalName).toBe('주문번호')        // 옛 값이면 '회원명' 이 된다
    })
  })

  it('용어 등록 한 번이 뮤테이션 한 건이다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT)
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText('논리명', { selector: '#col-c3-logical' })
    const card = input.closest('li')!
    await userEvent.clear(input)
    await userEvent.type(input, '주문번호')
    await userEvent.click(within(card).getByRole('button', { name: '용어 등록' }))
    await waitFor(() => expect(Object.values(useEditorStore.getState().model.terms)).toHaveLength(1))
    // 컬럼 이름 확정과 용어 등록이 한 producer 다 — 어긋난 상태로 Revision 2건이 되면 안 된다.
    expect(calls).toHaveLength(1)
    expect(useEditorStore.getState().model.columns['c3']!.logicalName).toBe('주문번호')
  })

  it('방금 친 논리명이 기존 용어와 겹치면 용어 등록이 잠긴다', async () => {
    let m = buildSampleModel()
    m = createTerm(m, {
      id: 'tm1', logicalName: '주문번호', physicalName: 'ORD_NO',
      domainId: null, description: null, origin: null,
    })
    useEditorStore.getState().setLoaded(m, 1, PROJECT)
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText('논리명', { selector: '#col-c3-logical' })
    expect(within(c3Card()).getByRole('button', { name: '용어 등록' })).toBeEnabled()
    await userEvent.clear(input)
    await userEvent.type(input, '주문번호')          // blur 없이 — 판정도 draft 기준이어야 한다
    expect(within(c3Card()).getByRole('button', { name: '용어 등록' })).toBeDisabled()
  })

  // ⚠️ F2. 다른 버튼 4개와 같은 형태의 포커스 케이스. 이 줄만 잠금이 없어 지워도 전건이 통과했다.
  it('용어 등록을 눌러도 포커스가 이름 입력란에 남는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT)
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    const input = screen.getByLabelText('논리명', { selector: '#col-c3-logical' })
    await userEvent.click(input)
    await userEvent.click(within(c3Card()).getByRole('button', { name: '용어 등록' }))
    expect(input).toHaveFocus()
  })

  // ⚠️ m7. useModelMutation 의 계약이 "완료 토스트는 applied 일 때만"이라고 못 박고 있다.
  it('용어 등록이 거절되면 성공 토스트가 뜨지 않는다', async () => {
    const { toast } = await import('sonner')
    const success = vi.spyOn(toast, 'success').mockImplementation(() => '' as never)
    const failure = vi.spyOn(toast, 'error').mockImplementation(() => '' as never)
    mockTrpcFetch({ 'model.mutate': () => ({ error: { code: -32003, message: '편집 권한이 없습니다' } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT)
    grantEditPermission()
    useEditorStore.getState().select('t2')
    renderPanel()
    // vi.spyOn 은 이미 spy 된 함수를 다시 감싸면 같은 spy 를 돌려주므로 앞선 케이스의 호출이 남는다.
    success.mockClear(); failure.mockClear()
    await userEvent.click(within(c3Card()).getByRole('button', { name: '용어 등록' }))
    await waitFor(() => expect(failure).toHaveBeenCalled())
    expect(success).not.toHaveBeenCalled()
  })
})

describe('EditPanel 컬럼 도메인 자동 지정', () => {
  const logicalInput = () => screen.getByLabelText('논리명', { selector: '#col-c1-logical' })

  it('논리명이 용어와 일치하고 물리명이 비어 있으면 그 용어의 도메인이 채워진다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadForDomainRule({})
    renderPanel()
    await userEvent.type(logicalInput(), '결제금액')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.domainId).toBe('d1'))
  })

  it('컬럼에 도메인이 이미 있으면 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadForDomainRule({ domainId: 'd2' })
    renderPanel()
    await userEvent.type(logicalInput(), '결제금액')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('결제금액'))
    expect(useEditorStore.getState().model.columns['c1']!.domainId).toBe('d2')
  })

  it('용어와 일치하지 않으면 도메인이 그대로 null 이다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadForDomainRule({})
    renderPanel()
    await userEvent.type(logicalInput(), '아무이름')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('아무이름'))
    expect(useEditorStore.getState().model.columns['c1']!.domainId).toBeNull()
  })

  // ⚠️ M3(b). 이 규칙은 **물리명 빈칸 가드 안**에 있는 것이 옛 동작이다. 가드를 없애 「항상」으로
  // 넓히는 것은 제품 동작 변경이라 이 사이클 범위 밖이다(HANDOFF 6절 이월).
  it('물리명이 이미 있으면 도메인을 채우지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadForDomainRule({ physicalName: 'KEEP_ME' })
    renderPanel()
    await userEvent.type(logicalInput(), '결제금액')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.columns['c1']!.logicalName).toBe('결제금액'))
    expect(useEditorStore.getState().model.columns['c1']!.domainId).toBeNull()
  })
})

describe('EditPanel — 테이블 물리명 미리보기', () => {
  const PID = '018f6b0e-0000-7000-8000-0000000000aa'
  /** 모델과 명명 규칙을 store 에 얹는다. namingRules 는 setLoaded 가 건드리지 않는다. */
  function load(m: ReturnType<typeof buildSampleModel>, rules: NamingRules) {
    useEditorStore.getState().setLoaded(m, 1, PID)
    useEditorStore.setState({ namingRules: rules })
    grantEditPermission()
  }
  function withAlias() {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    return m
  }

  it('템플릿이 있으면 조합 결과를 보여 준다', async () => {
    load(withAlias(), { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    useEditorStore.getState().selectTables(['t2'])   // t2 = MBR
    renderPanel()
    expect(await screen.findByText('물리 → TB_MBR_MBR')).toBeInTheDocument()
  })

  it('템플릿이 없으면 미리보기를 렌더하지 않는다', async () => {
    load(buildSampleModel(), DEFAULT_NAMING_RULES)
    useEditorStore.getState().selectTables(['t2'])
    renderPanel()
    await screen.findByLabelText(/테이블 물리명/)
    expect(screen.queryByText(/^(물리|논리) → /)).not.toBeInTheDocument()
  })

  // ⚠️ 컬럼에는 템플릿이 없다(범위 밖). NamePair 안에 넣으면 여기가 빨개진다.
  it('컬럼 물리명에는 미리보기가 없다', async () => {
    load(withAlias(), { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    useEditorStore.getState().selectColumn('t2', 'c3', 'replace')
    renderPanel()
    // 컬럼마다 NamePair 가 있어 '물리명' 라벨은 여럿이다 — 존재만 확인한다.
    expect(await screen.findAllByLabelText(/^물리명$/)).not.toHaveLength(0)
    expect(screen.getAllByText(/^(물리|논리) → /)).toHaveLength(1)     // 테이블 것 하나뿐
  })

  it('논리 템플릿이 있으면 조합된 논리명을 보여 준다', async () => {
    const m = withAlias()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: 'SALES' }
    load(m, { ...DEFAULT_NAMING_RULES, tableLogicalTemplate: '{그룹명}_{논리명}' })
    useEditorStore.getState().selectTables(['t2'])
    renderPanel()
    expect(await screen.findByText('논리 → SALES_회원')).toBeInTheDocument()
  })

  it('두 템플릿이 다 있으면 두 줄이 다 뜬다', async () => {
    const m = withAlias()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: 'SALES' }
    load(m, {
      ...DEFAULT_NAMING_RULES,
      tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}',
      tableLogicalTemplate: '{그룹명}_{논리명}',
    })
    useEditorStore.getState().selectTables(['t2'])
    renderPanel()
    expect(await screen.findByText('물리 → TB_MBR_MBR')).toBeInTheDocument()
    expect(screen.getByText('논리 → SALES_회원')).toBeInTheDocument()
  })

  it('물리 템플릿만 있으면 논리 줄은 없다', async () => {
    load(withAlias(), { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    useEditorStore.getState().selectTables(['t2'])
    renderPanel()
    await screen.findByText('물리 → TB_MBR_MBR')
    expect(screen.queryByText(/^논리 → /)).not.toBeInTheDocument()
  })
})
