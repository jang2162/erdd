import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { ProjectModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { modelOverOpCap } from '@/testing/fixtures'
import { settle } from '@/testing/settle'
import { useEditorStore } from './store.js'
import { BulkPanel, countCascade } from './bulk-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000dd'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<BulkPanel projectId={PROJECT_ID} />, { wrapper: w })
}

/** 픽스처(t1·t2가 g1 소속)에 빈 그룹 g2를 더한다. */
function modelWithEmptyG2(): ProjectModel {
  const m = buildSampleModel()
  m.tableGroups['g2'] = { id: 'g2', name: '주문영역', color: '#000000', comment: null, alias: '' }
  return m
}

/**
 * g2에 **기존 멤버 t3**(컬럼 0개, 위치 (1000,500))를 둔다. planGroupMove가 기준으로 삼을
 * bbox가 생기므로 좌표 재배치가 실제로 일어난다 — 빈 그룹으로 옮기면 좌표를 건드리지 않는다.
 */
function modelWithAnchoredG2(): ProjectModel {
  const m = modelWithEmptyG2()
  m.tables['t3'] = {
    id: 't3', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: 'g2', position: { x: 1000, y: 500 }, groupPosition: null, custom: {},
  }
  return m
}

/** t1은 g1에 둔 채 t2만 g2로 옮긴다 — 선택이 두 그룹에 걸친 상태. */
function modelWithMixedGroups(): ProjectModel {
  const m = modelWithAnchoredG2()
  m.tables['t2'] = { ...m.tables['t2']!, groupId: 'g2' }
  return m
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('countCascade', () => {
  it('테이블과 함께 사라지는 컬럼·인덱스·관계를 센다', () => {
    // buildSampleModel: t2(MBR)는 컬럼 3개(c2·c3·c4) · 인덱스 1개(i1) · 관계 1개(r1, t1↔t2)
    const m = buildSampleModel()
    expect(countCascade(m, ['t2'])).toEqual({ tables: 1, columns: 3, indexes: 1, relationships: 1 })
  })

  it('두 테이블이 같은 관계의 양끝이어도 관계는 한 번만 센다', () => {
    const m = buildSampleModel()
    expect(countCascade(m, ['t1', 't2']).relationships).toBe(1)
  })

  it('모델에 없는 id는 세지 않는다', () => {
    // 선택은 실시간 삭제 수신과 경합할 수 있다. 사라진 id가 섞여도 안내 문구가 부풀지 않아야 한다.
    const m = buildSampleModel()
    expect(countCascade(m, ['t2', '없는id']).tables).toBe(1)
  })
})

describe('BulkPanel', () => {
  it('선택 개수와 목록을 보여준다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()
    expect(screen.getByText('2개 테이블 선택됨')).toBeInTheDocument()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_GRD')).toBeInTheDocument()
  })

  it('선택 개수 헤더가 라이브 리전이다 — 개수가 바뀌면 낭독된다', () => {
    // 사이드바 항목의 aria-pressed는 "이것이 선택됐다"만 말한다. **몇 개인지**를 읽어 주는 자리는
    // 여기뿐이라, 라이브 리전이 아니면 선택이 3개로 늘어도 스크린리더에는 아무 일도 없다.
    // (h2의 heading 역할은 그대로 둔다 — role="status"로 덮으면 제목 탐색에서 사라진다.)
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()
    expect(screen.getByText('2개 테이블 선택됨')).toHaveAttribute('aria-live', 'polite')
  })

  it('그룹 드롭다운으로 옮기면 op 배치 한 건으로 나간다(undo 1회)', async () => {
    // 픽스처는 **앵커가 있는** g2여야 한다. 빈 g2면 planGroupMove가 []를 반환해 좌표 이동 op가
    // 0건이고, 그러면 producer를 둘로 쪼개도 두 번째 뮤테이션이 'noop'으로 빠져 calls·undoStack이
    // 1로 남는다 — 계약이 깨졌는데 지표가 안 움직인다. 좌표가 실제로 움직여야 잠긴다.
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(modelWithAnchoredG2(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.selectOptions(screen.getByLabelText('선택 테이블의 그룹'), 'g2')
    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.groupId).toBe('g2')
      expect(tables['t2']?.groupId).toBe('g2')
    })
    // ⚠️ waitFor로는 **"최소 1건"** 밖에 못 본다 — 0→1→2로 가는 도중 1인 순간을 잡고 통과한다.
    // 나갈 것을 다 내보낸 뒤 **정확히 1건**으로 못 박아야 producer를 쪼갠 변경이 잡힌다.
    await settle()
    expect(calls).toHaveLength(1)   // 단일 뮤테이션 = Revision 1건
    // 그룹 배정과 좌표 재배치가 한 producer 라 cmd+Z 한 번으로 전부 원복된다.
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('그룹을 옮기면 대상 그룹 오른쪽으로 상대 배치를 유지한 채 좌표를 옮긴다', async () => {
    // 기준은 **그룹 변경 전** 모델이다. 변경 후 모델을 넘기면 이동 대상 t1·t2가 이미 g2 멤버라
    // 자기 자신이 기준 bbox에 섞여 dy가 0이 된다(앵커 t3의 y=500이 반영되지 않는다).
    //   앵커 t3(1000,500, 컬럼 0개) bbox: maxX = 1000+260 = 1260 · minY = 500
    //   이동 집합 t1(0,0)·t2(300,0) bbox: minX = 0 · minY = 0
    //   dx = 1260 + GAP(60) - 0 = 1320 · dy = 500 - 0 = 500
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(modelWithAnchoredG2(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.selectOptions(screen.getByLabelText('선택 테이블의 그룹'), 'g2')
    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.position).toEqual({ x: 1320, y: 500 })
      expect(tables['t2']?.position).toEqual({ x: 1620, y: 500 })
    })
    // 앵커는 그대로다 — 옮긴 것만 움직인다.
    expect(useEditorStore.getState().model.tables['t3']?.position).toEqual({ x: 1000, y: 500 })
  })

  it('그룹을 옮기면 그룹 뷰 좌표를 비운다 — 이전 그룹의 좌표는 새 그룹에서 의미가 없다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const model = modelWithEmptyG2()
    // 픽스처 사실: t1.groupPosition = {x:10,y:10}, t2.groupPosition = {x:310,y:10}
    expect(model.tables['t1']?.groupPosition).not.toBeNull()
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.selectOptions(screen.getByLabelText('선택 테이블의 그룹'), 'g2')
    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.groupPosition).toBeNull()
      expect(tables['t2']?.groupPosition).toBeNull()
    })
  })

  it('이미 대상 그룹에 있던 테이블의 그룹 뷰 좌표도 비운다', async () => {
    // 섞인 선택(t1∈g1, t2∈g2)을 g2로 옮기면 t2는 groupId가 바뀌지 않는다. 그래도 groupPosition을
    // 비워야 한다 — 남기면 g2 그룹 뷰에서 t1만 폴백 좌표로 가고 t2는 옛 좌표에 남아 **함께 옮긴
    // 둘이 갈라진다**. 전원 비우면 둘 다 폴백해 나란히 선다(설계 6.1).
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const model = modelWithMixedGroups()
    expect(model.tables['t2']?.groupPosition).not.toBeNull()   // 픽스처 사실: {x:310,y:10}
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    // 섞인 선택이라 드롭다운은 "여러 그룹에 걸쳐 있음"에서 시작한다.
    expect(screen.getByLabelText('선택 테이블의 그룹')).toHaveValue('')
    await userEvent.selectOptions(screen.getByLabelText('선택 테이블의 그룹'), 'g2')
    await waitFor(() => {
      expect(useEditorStore.getState().model.tables['t1']?.groupPosition).toBeNull()
    })
    const t2 = useEditorStore.getState().model.tables['t2']
    expect(t2?.groupId).toBe('g2')          // 원래부터 g2였다
    expect(t2?.groupPosition).toBeNull()    // 그래도 비운다
  })

  it('「선택 테이블로 새 그룹」이 선택 전원을 담는 그룹을 만들고 그 그룹을 연다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블로 새 그룹' }))

    await waitFor(() => {
      expect(Object.values(useEditorStore.getState().model.tableGroups)).toHaveLength(2)
    })
    const created = Object.values(useEditorStore.getState().model.tableGroups).find((g) => g.id !== 'g1')!
    const tables = useEditorStore.getState().model.tables
    expect(tables['t1']?.groupId).toBe(created.id)
    expect(tables['t2']?.groupId).toBe(created.id)
    // 기존 그룹은 "회원관리"뿐이므로 미사용 최소 번호는 "그룹1".
    expect(created.name).toBe('그룹1')
    // 만든 직후 그 그룹이 열린다 — 이름·색을 그 자리에서 고치는 것이 다음 행동이다.
    expect(useEditorStore.getState().selectedGroupId).toBe(created.id)
    // ⚠️ waitFor로는 "최소 1건"밖에 못 본다. 나갈 것을 다 내보낸 뒤 정확히 1건으로 못 박아야
    // producer를 쪼갠 변경이 잡힌다(위 드롭다운 케이스와 같은 이유).
    await settle()
    expect(calls).toHaveLength(1)
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
  })

  it('새 그룹을 만들면 선택 전원의 그룹 뷰 좌표가 비워진다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    const model = buildSampleModel()
    // 픽스처 사실: t1.groupPosition = {x:10,y:10}, t2.groupPosition = {x:310,y:10}
    expect(model.tables['t1']?.groupPosition).not.toBeNull()
    useEditorStore.getState().setLoaded(model, 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블로 새 그룹' }))

    await waitFor(() => {
      const tables = useEditorStore.getState().model.tables
      expect(tables['t1']?.groupPosition).toBeNull()
      expect(tables['t2']?.groupPosition).toBeNull()
    })
    // 전체 뷰 좌표는 그대로다 — 새 그룹은 테이블을 옮기지 않는다(설계 D2).
    expect(useEditorStore.getState().model.tables['t1']?.position)
      .toEqual(buildSampleModel().tables['t1']?.position)
  })

  it('일괄 삭제는 확인 다이얼로그를 거친다 — 취소하면 아무 op도 나가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블 삭제' }))
    expect(screen.getByText(/테이블 2개와 관계 1개가 삭제됩니다/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(calls).toHaveLength(0)
    expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(2)
  })

  it('확인하면 선택한 테이블이 한 번에 지워지고 선택에서도 빠진다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => {
      expect(Object.keys(useEditorStore.getState().model.tables)).toHaveLength(0)
    })
    expect(calls).toHaveLength(1)   // 선택 수만큼 나눠 보내지 않는다
    // 선택 정리는 이 컴포넌트가 아니라 useSubmit의 pruneSelection이 한다(경로가 한 벌이다).
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('읽기 전용이면 이동·삭제 컨트롤이 비활성이다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    // grantEditPermission을 부르지 않는다 — Viewer.
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()
    expect(screen.getByLabelText('선택 테이블의 그룹')).toBeDisabled()
    expect(screen.getByRole('button', { name: '선택 테이블로 새 그룹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '선택 테이블 삭제' })).toBeDisabled()
  })

  it('삭제 op가 상한을 넘으면 확인 다이얼로그가 삭제를 막고 이유를 알린다', async () => {
    // 낙관 반영 후 서버가 거절해 되돌려지는 것을 사용자가 겪지 않도록 제출 전에 막는다.
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    useEditorStore.getState().setLoaded(modelOverOpCap(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectTables(['t1', 't2'])
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '선택 테이블 삭제' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/한 번에 지우기에 너무 많습니다/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '삭제' })).toBeDisabled()
    expect(calls).toHaveLength(0)
  })
})
