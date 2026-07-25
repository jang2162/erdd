import { toPng, toSvg } from 'html-to-image'
import type { ReactFlowInstance } from '@xyflow/react'

export type ImageFormat = 'png' | 'svg'

const MARGIN = 48
const PAPER = '#F7F8FA'

export function imageFileName(base: string, format: ImageFormat): string {
  const trimmed = base.trim()
  const safe = (trimmed === '' ? 'erdd' : trimmed).replace(/[^\w가-힣.-]+/g, '_')
  return `${safe}.${format}`
}

/** 현재 캔버스(활성 뷰·보기 모드 반영)를 PNG/SVG로 내려받는다. 현재 팬/줌과 무관하게 전체를 담는다. */
export async function downloadCanvasImage(
  rf: ReactFlowInstance,
  opts: { format: ImageFormat; fileName?: string },
): Promise<void> {
  const nodes = rf.getNodes()
  if (nodes.length === 0) throw new Error('내보낼 노드가 없습니다')
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport) throw new Error('캔버스를 찾을 수 없습니다')

  const b = rf.getNodesBounds(nodes)
  const width = Math.ceil(b.width) + MARGIN * 2
  const height = Math.ceil(b.height) + MARGIN * 2
  const style = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(${MARGIN - b.x}px, ${MARGIN - b.y}px) scale(1)`,
  }
  const params = { width, height, style, backgroundColor: PAPER, pixelRatio: 2 }
  const dataUrl = opts.format === 'png' ? await toPng(viewport, params) : await toSvg(viewport, params)

  const a = document.createElement('a')
  a.href = dataUrl
  a.download = imageFileName(opts.fileName ?? 'erdd', opts.format)
  a.click()
}
