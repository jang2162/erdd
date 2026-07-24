import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { RelationshipEdgeData } from './edges.js'

/** 캔버스에 한 번 렌더하는 까마귀발 SVG 마커 정의. Canvas에서 마운트한다. */
export function RelationshipMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {/* one: 짧은 수직 막대 */}
        <marker id="erd-one" viewBox="0 0 20 20" markerWidth="20" markerHeight="20"
          refX="16" refY="10" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M16,2 L16,18" stroke="var(--color-muted-foreground)" strokeWidth="1.5" fill="none" />
        </marker>
        {/* many: 까마귀발 */}
        <marker id="erd-many" viewBox="0 0 20 20" markerWidth="20" markerHeight="20"
          refX="2" refY="10" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M18,2 L2,10 L18,18 M2,10 L18,10" stroke="var(--color-muted-foreground)"
            strokeWidth="1.5" fill="none" />
        </marker>
      </defs>
    </svg>
  )
}

export function RelationshipEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props
  const data = props.data as RelationshipEdgeData | undefined
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const identifying = data?.identifying ?? false
  const many = (data?.cardinality ?? '1:N') === '1:N'
  return (
    <BaseEdge
      id={props.id}
      path={path}
      // source=자식 끝, target=부모 끝. 부모는 항상 one, 자식은 1:N이면 many.
      markerStart={many ? 'url(#erd-many)' : 'url(#erd-one)'}
      markerEnd="url(#erd-one)"
      style={{
        stroke: selected ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
        strokeWidth: selected ? 2 : 1.5,
        strokeDasharray: identifying ? undefined : '6 4',
      }}
    />
  )
}
