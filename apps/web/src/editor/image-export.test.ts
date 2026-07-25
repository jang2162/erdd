import { describe, expect, it } from 'vitest'
import type { ReactFlowInstance } from '@xyflow/react'
import { downloadCanvasImage, imageFileName } from './image-export.js'

describe('imageFileName', () => {
  it('확장자를 붙인다', () => {
    expect(imageFileName('erdd', 'png')).toBe('erdd.png')
    expect(imageFileName('erdd', 'svg')).toBe('erdd.svg')
  })
  it('빈 base는 erdd로 대체', () => {
    expect(imageFileName('', 'png')).toBe('erdd.png')
  })
  it('안전하지 않은 문자를 _로 치환하고 한글·영숫자는 유지', () => {
    expect(imageFileName('회원 스키마/v1', 'png')).toBe('회원_스키마_v1.png')
  })
})

describe('downloadCanvasImage 가드', () => {
  const rf = (nodes: unknown[]) => ({ getNodes: () => nodes }) as unknown as ReactFlowInstance

  it('노드가 없으면 오류를 던진다(다운로드 안 함)', async () => {
    await expect(downloadCanvasImage(rf([]), { format: 'png' })).rejects.toThrow('내보낼 노드가 없습니다')
  })

  it('캔버스(.react-flow__viewport)가 없으면 오류를 던진다', async () => {
    // jsdom엔 뷰포트 요소가 없으므로 노드가 있어도 뷰포트 부재로 throw(html-to-image 호출 전).
    await expect(downloadCanvasImage(rf([{ id: 'n1' }]), { format: 'png' })).rejects.toThrow('캔버스를 찾을 수 없습니다')
  })
})
