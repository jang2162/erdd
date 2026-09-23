import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { guardFeature, listLibraries, requireDictConnection } from './dict-shared.js'

export type RequestStatus = 'pending' | 'resolved' | 'rejected' | 'cancelled'
export const REQUEST_STATUSES: readonly RequestStatus[] = ['pending', 'resolved', 'rejected', 'cancelled']
export type DictRequestsCtx = CommandCtx & { status?: RequestStatus }

type Row = {
  id: string; libraryId: string; entityIds: string[]; note: string; status: RequestStatus
  createdAt: string; resolvedAt: string | null; resolutionNote: string | null
  approvedEntityIds: string[] | null; requesterName: string
}
const STATUS_LABEL: Record<RequestStatus, string> = { pending: '대기', resolved: '승인', rejected: '반려', cancelled: '취소' }

export function dictRequests(ctx: DictRequestsCtx): Promise<number> {
  return run(ctx, async () => {
    const { projectId } = requireDictConnection(await readConfig(ctx.cwd))
    const client = await clientFor(ctx)
    const rows = await guardFeature(() => client.query<Row[]>('promotion.listForProject', { projectId, status: ctx.status }))
    const names = new Map((await listLibraries(client, projectId)).map((l) => [l.id, l.name]))
    const human = rows.length === 0 ? '승격 요청이 없습니다' : rows.map((r) => [
      `[${STATUS_LABEL[r.status]}] ${String(r.createdAt).slice(0, 10)} ${names.get(r.libraryId) ?? r.libraryId} — ${r.entityIds.length}건 · ${r.requesterName}`,
      ...(r.note !== '' ? [`  메모: ${r.note}`] : []),
      ...(r.resolutionNote ? [`  처리 메모: ${r.resolutionNote}`] : []),
    ].join('\n')).join('\n')
    emit(ctx.json, human, rows)
    return 0
  })
}
