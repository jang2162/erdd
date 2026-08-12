import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import type { Mutate } from './use-model.js'
import { createGroupWith } from './group-edits.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000dd'

/**
 * producer와 summary만 붙잡아 두는 가짜 mutate. 서버 제출·낙관 반영 없이 **producer가 만드는
 * 모델**을 직접 본다 — 이 함수의 계약이 거기에 전부 들어 있다.
 */
function fakeMutate() {
  const calls: { producer: (m: ProjectModel) => ProjectModel; summary?: string }[] = []
  const mutate = ((producer: (m: ProjectModel) => ProjectModel, opts?: { summary?: string }) => {
    calls.push({ producer, summary: opts?.summary })
    return Promise.resolve('applied' as const)
  }) as Mutate
  return { mutate, calls }
}

afterEach(() => { useEditorStore.getState().reset() })

describe('createGroupWith', () => {
  it('새 그룹을 만들고 주어진 테이블 전원을 그 그룹에 넣는다 — producer 하나로(undo 1회)', () => {
    // 픽스처: t1·t2는 g1(회원관리) 소속이다.
    grantEditPermission()
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, ['t1', 't2'])

    expect(id).not.toBeNull()
    expect(calls).toHaveLength(1)   // 생성 + 배정이 한 Revision
    const next = calls[0]!.producer(buildSampleModel())
    expect(next.tableGroups[id!]).toBeDefined()
    expect(next.tables['t1']?.groupId).toBe(id)
    expect(next.tables['t2']?.groupId).toBe(id)
    expect(calls[0]!.summary).toBe('그룹 추가 (테이블 2개)')
  })

  it('이름은 미사용 최소 번호다 — 그룹1·그룹3이 있으면 그룹2', () => {
    grantEditPermission()
    const m = buildSampleModel()
    m.tableGroups = {
      a: { id: 'a', name: '그룹1', color: '#111111', comment: null },
      b: { id: 'b', name: '그룹3', color: '#222222', comment: null },
    }
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, [])

    const next = calls[0]!.producer(m)
    expect(next.tableGroups[id!]?.name).toBe('그룹2')
  })

  it('이름·색을 producer가 받은 모델에서 계산한다 — store 스냅샷이 아니다', () => {
    // 낙관적 체인에서 앞선 뮤테이션이 이미 「그룹1」을 만들었을 수 있다. store에는 아직 없고
    // producer가 받는 모델에는 있는 상태가 정확히 그것이다 — 그때 이름이 겹치면 안 된다.
    // setLoaded → grantEditPermission 순서다(다른 스위트와 같다). setLoaded가 권한을 다시
    // 세우지는 않지만, 순서를 뒤집어 두면 그런 변경이 생겼을 때 이 파일만 조용히 갈린다.
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    const ahead = buildSampleModel()
    ahead.tableGroups = { ...ahead.tableGroups, z: { id: 'z', name: '그룹1', color: '#333333', comment: null } }
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, [])

    const next = calls[0]!.producer(ahead)
    expect(next.tableGroups[id!]?.name).toBe('그룹2')
  })

  it('이동 대상 전원의 그룹 뷰 좌표를 비운다 — 남기면 새 그룹 뷰에서 멤버가 갈라진다', () => {
    grantEditPermission()
    const m = buildSampleModel()
    // 픽스처 사실: t1.groupPosition = {x:10,y:10}, t2.groupPosition = {x:310,y:10}
    expect(m.tables['t1']?.groupPosition).not.toBeNull()
    const { mutate, calls } = fakeMutate()

    createGroupWith(mutate, ['t1', 't2'])

    const next = calls[0]!.producer(m)
    expect(next.tables['t1']?.groupPosition).toBeNull()
    expect(next.tables['t2']?.groupPosition).toBeNull()
  })

  it('좌표는 건드리지 않는다 — 테이블은 제자리에 두고 색상 영역만 씌운다', () => {
    grantEditPermission()
    const m = buildSampleModel()
    const before = { t1: m.tables['t1']!.position, t2: m.tables['t2']!.position }
    const { mutate, calls } = fakeMutate()

    createGroupWith(mutate, ['t1', 't2'])

    const next = calls[0]!.producer(m)
    expect(next.tables['t1']?.position).toEqual(before.t1)
    expect(next.tables['t2']?.position).toEqual(before.t2)
  })

  it('tableIds가 비면 멤버 없는 그룹을 만든다 — 좌측 「그룹 추가」의 경로다', () => {
    grantEditPermission()
    const { mutate, calls } = fakeMutate()

    const id = createGroupWith(mutate, [])

    const next = calls[0]!.producer(buildSampleModel())
    expect(next.tableGroups[id!]).toBeDefined()
    expect(Object.values(next.tables).filter((t) => t.groupId === id)).toHaveLength(0)
    expect(calls[0]!.summary).toBe('그룹 추가')
  })

  it('편집 권한이 없으면 null을 돌려주고 아무것도 제출하지 않는다', () => {
    // grantEditPermission을 부르지 않는다 — store 기본값은 fail-closed(canEdit=false)다.
    const { mutate, calls } = fakeMutate()

    expect(createGroupWith(mutate, ['t1'])).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
