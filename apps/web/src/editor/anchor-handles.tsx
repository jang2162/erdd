import { Handle, Position } from '@xyflow/react'
import { handleId } from './anchors.js'

/**
 * 관계선이 붙는 **표시 전용** 핸들 한 쌍. 보이지 않고 연결 대상도 아니다 —
 * 관계 생성 드래그는 테이블 좌우의 보이는 중앙 핸들(`l`/`r`)이 계속 전담한다(설계 D-3).
 *
 * ⚠️ `display:none`·`hidden` 으로 감추지 마라. `getBoundingClientRect` 가 전부 0이 되어
 * React Flow 가 재는 `handleBounds` 좌표가 무너진다. 크기를 0으로 하되 렌더는 시킨다 —
 * 위치(x·y)는 그래도 정확하고, React Flow 는 핸들 중심을 `x + width/2` 로 잡는다.
 *
 * 이 컴포넌트를 담는 요소에 `relative` 가 있어야 한다. Handle 은 `position: absolute` 라
 * **가장 가까운 positioned 조상** 기준으로 배치되므로, 빠뜨리면 노드 루트 기준이 되어
 * 모든 앵커가 같은 자리에 겹친다.
 */
export function AnchorHandles({ anchorKey }: { anchorKey: string }) {
  const cls = '!h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent'
  return (
    <>
      <Handle id={handleId('l', anchorKey)} type="source" position={Position.Left}
        isConnectable={false} className={cls} />
      <Handle id={handleId('r', anchorKey)} type="source" position={Position.Right}
        isConnectable={false} className={cls} />
    </>
  )
}
