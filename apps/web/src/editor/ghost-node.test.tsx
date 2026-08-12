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
