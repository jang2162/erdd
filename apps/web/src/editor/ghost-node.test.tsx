import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { GhostNode } from './ghost-node.js'
import type { GhostNodeData } from './ghost-nodes.js'

afterEach(() => { cleanup() })

const TABLE = {
  id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
  groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
}

function renderGhost(data: GhostNodeData) {
  // GhostNode 는 NodeProps 를 받지만 실제로 읽는 것은 data 뿐이다.
  return render(
    <ReactFlowProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <GhostNode {...({ data } as any)} />
    </ReactFlowProvider>,
  )
}

describe('GhostNode', () => {
  it('앵커 핸들을 전부 렌더한다', () => {
    // 컬럼 행이 없어도 핸들은 있어야 한다 — 없으면 그룹↔외부 관계선이 사라진다(설계 3.4).
    const { container } = renderGhost({
      table: TABLE, targetGroupId: null,
      anchors: [{ key: 'c:c1', columnIds: ['c1'] }, { key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    const ids = [...container.querySelectorAll('[data-handleid]')]
      .map((el) => el.getAttribute('data-handleid'))
    expect(ids).toEqual(expect.arrayContaining([
      'l', 'r', 'l:c:c1', 'r:c:c1', 'l:s:c1+c2', 'r:s:c1+c2',
    ]))
  })
})

describe('GhostNode — anchors 런타임 방어', () => {
  it('anchors 없이 렌더해도 던지지 않고 중앙 핸들은 남는다', () => {
    // `data` 를 `as unknown as GhostNodeData` 로 받는 자리라 타입 검사가 막아 주지 않는다.
    // undefined 가 들어오면 anchors.map 이 던지는데, 그러면 고스트 하나가 아니라
    // **캔버스 전체가 죽는다**(React 는 렌더 예외를 위로 던진다). TableNode 와 같은 방어다.
    const { container } = render(
      <ReactFlowProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <GhostNode {...({ data: { table: TABLE, targetGroupId: null } } as any)} />
      </ReactFlowProvider>,
    )
    const ids = [...container.querySelectorAll('[data-handleid]')]
      .map((el) => el.getAttribute('data-handleid'))
    expect(ids).toEqual(['l', 'r'])
  })
})
