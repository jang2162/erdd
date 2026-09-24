import { describe, expect, it, vi } from 'vitest'
import { MAX_OPS_PER_MUTATION } from '@erdd/core'
import { promoteFailureMessage, promoteInChunks, type PromoteRequestEntry } from './promote-chunks'

const req = (i: number): PromoteRequestEntry => ({
  entityId: `e${i}`, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null,
})
const reqs = (n: number) => Array.from({ length: n }, (_, i) => req(i))

describe('promoteInChunks', () => {
  it('받은 순서 그대로 5,000씩 차례로 보내고 결과를 합친다', async () => {
    const send = vi.fn(async (chunk: PromoteRequestEntry[]) => ({
      inserted: chunk.length, updated: 0, skipped: chunk.length === 1 ? [{ entityId: 'x', reason: 'missing' }] : [],
    }))
    const progress = vi.fn()
    const run = await promoteInChunks(reqs(MAX_OPS_PER_MUTATION + 1), send, progress)
    expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([MAX_OPS_PER_MUTATION, 1])
    expect(send.mock.calls[0]![0][0]!.entityId).toBe('e0')
    expect(send.mock.calls[1]![0][0]!.entityId).toBe(`e${MAX_OPS_PER_MUTATION}`)
    expect(run).toMatchObject({ done: 2, total: 2, error: null })
    expect(run.outcome).toEqual({ inserted: MAX_OPS_PER_MUTATION + 1, updated: 0, skipped: [{ entityId: 'x', reason: 'missing' }] })
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('한 조각이면 진행을 알리지 않는다', async () => {
    const progress = vi.fn()
    await promoteInChunks(reqs(3), async () => ({ inserted: 3, updated: 0, skipped: [] }), progress)
    expect(progress).not.toHaveBeenCalled()
  })

  it('실패한 조각에서 멈추고 그때까지의 합을 돌려준다 — 던지지 않는다', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ inserted: 4000, updated: 1000, skipped: [] })
      .mockRejectedValueOnce(new Error('거절'))
    const run = await promoteInChunks(reqs(2 * MAX_OPS_PER_MUTATION + 1), send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(run).toMatchObject({ done: 1, total: 3, outcome: { inserted: 4000, updated: 1000 } })
    expect(run.error).toBeInstanceOf(Error)
    expect(promoteFailureMessage(2 * MAX_OPS_PER_MUTATION + 1, run)).toBe('10,001건 중 5,000건 승격했습니다 — 거절')
  })

  it('첫 조각 실패는 오류 문구 그대로다', async () => {
    const run = await promoteInChunks(reqs(2), async () => { throw new Error('권한이 없습니다') })
    expect(promoteFailureMessage(2, run)).toBe('권한이 없습니다')
  })

  it('진행 콜백이 던져도 승격은 끝까지 가고 성공으로 끝난다', async () => {
    const send = vi.fn(async (chunk: PromoteRequestEntry[]) => ({ inserted: chunk.length, updated: 0, skipped: [] }))
    const progress = vi.fn(() => { throw new Error('boom') })
    const run = await promoteInChunks(reqs(MAX_OPS_PER_MUTATION + 1), send, progress)
    expect(send).toHaveBeenCalledTimes(2)
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
    expect(run).toMatchObject({ done: 2, total: 2, error: null, outcome: { inserted: MAX_OPS_PER_MUTATION + 1 } })
  })
})
