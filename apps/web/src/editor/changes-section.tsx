import { useState } from 'react'
import { toast } from 'sonner'
import { LOCAL_CHANGES_UNSAVED_MESSAGE, formatChangeIssue, type ChangeRecordSummary } from '@erdd/core'
import { formatCreatedAt } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateLocalChange, useLocalChanges } from './use-local-changes.js'

function RecordRow({ record }: { record: ChangeRecordSummary }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-md border p-3">
      <button
        type="button" className="grid w-full gap-0.5 text-left" aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="font-medium">
          {record.name}
          {record.baseline && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">기준선</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatCreatedAt(record.created)} · 문장 {record.statementCount}개 · {record.file}
        </span>
      </button>
      {expanded && <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs">{record.text}</pre>}
    </div>
  )
}

/**
 * 「버전」 → 「변경 기록」 탭(로컬 모드 전용). 미기록 변경 미리보기는 **화면 모델 기준**이고
 * (미저장 편집 포함), 만들기는 저장된 상태에서만 된다. 규칙은 guide 「변경 기록 — `.erddc` 문법과
 * 재생 규칙」.
 */
export function ChangesSection() {
  const status = useLocalChanges()
  const create = useCreateLocalChange()
  const [name, setName] = useState('')
  const data = status.data
  const pendingCount = data?.pending?.count ?? 0
  const locked = data === undefined || data.error !== null || data.unsaved || pendingCount === 0

  const onCreate = async () => {
    try {
      const r = await create.mutateAsync({ name: name.trim() })
      if (r.ok) {
        toast.success(`변경 기록을 만들었습니다: ${r.file}`)
        setName('')
      } else {
        toast.error(r.message)
      }
    } catch {
      toast.error('변경 기록을 만들지 못했습니다')
    }
  }

  return (
    <div className="grid gap-4">
      {status.isError && <p role="alert" className="text-sm text-destructive">변경 기록을 읽지 못했습니다</p>}
      {data?.error && <p role="alert" className="text-sm text-destructive">오류: {formatChangeIssue(data.error)}</p>}
      {data?.warnings.map((w, i) => (
        <p key={i} className="text-sm text-amber-700 dark:text-amber-400">⚠️ 기록 간 경합 — {formatChangeIssue(w)}</p>
      ))}
      {data?.unsaved && <p className="text-sm text-muted-foreground">{LOCAL_CHANGES_UNSAVED_MESSAGE}</p>}

      <div className="grid gap-2">
        <p className="text-sm font-medium">미기록 변경</p>
        {data?.pending && pendingCount === 0 && (
          <p className="text-sm text-muted-foreground">기록할 변경이 없습니다</p>
        )}
        {data?.pending && pendingCount > 0 && (
          <pre aria-label="미기록 변경 미리보기" className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-xs">
            {data.pending.text}
          </pre>
        )}
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="change-name">이름</Label>
            <Input
              id="change-name" value={name} placeholder="예: 회원 등급 추가"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            type="button" disabled={locked || create.isPending || name.trim() === ''}
            onClick={() => { void onCreate() }}
          >
            변경 기록 만들기
          </Button>
        </div>
      </div>

      <div className="grid max-h-72 gap-2 overflow-y-auto">
        {data?.records.length === 0 && <p className="text-sm text-muted-foreground">아직 변경 기록이 없습니다</p>}
        {[...(data?.records ?? [])].reverse().map((r) => <RecordRow key={r.file} record={r} />)}
      </div>
    </div>
  )
}
