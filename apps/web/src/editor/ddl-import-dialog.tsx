import { useMemo, useState } from 'react'
import { Import } from 'lucide-react'
import {
  DIALECTS, MAX_OPS_PER_MUTATION, detectDialect, parseDdl, planDdlImport, type Dialect,
} from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { applyDdlImport } from './ddl-import-edits.js'
import { newId } from './uid.js'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

/**
 * 헤더의 "가져오기": DDL 텍스트를 붙여넣으면 즉시 파싱해 미리보기(테이블·컬럼·관계·인덱스 개수와
 * 경고)를 보여주고, 적용하면 단일 mutation(Revision 1건)으로 반영한다.
 *
 * 파싱은 순수 함수(parseDdl·planDdlImport)라 서버 왕복이 없다 — 입력이 바뀔 때마다 useMemo로
 * 즉시 다시 계산한다. 방언은 자동 감지(detectDialect)하되 언제나 수동으로 덮을 수 있다.
 */
export function DdlImportDialog({ projectId }: { projectId: string }) {
  const canEdit = useEditorStore((s) => s.canEdit)
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const mutate = useModelMutation(projectId)

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [manualDialect, setManualDialect] = useState<Dialect | null>(null)

  const detected = useMemo(() => detectDialect(text), [text])
  const dialect = manualDialect ?? detected ?? 'postgresql'
  const plan = useMemo(
    () => (text.trim() === '' ? null : planDdlImport(model, parseDdl(text), dialect, namingRules)),
    [text, dialect, model, namingRules],
  )
  const overLimit = plan !== null && plan.opCountEstimate > MAX_OPS_PER_MUTATION

  const onApply = async () => {
    if (plan === null || overLimit) return
    const captured = plan                       // producer 진입 전에 캡처한다(마이크로태스크 지연 대비)
    const r = await mutate((m) => applyDdlImport(m, captured, newId), { summary: 'DDL 가져오기' })
    if (r === 'applied') { setOpen(false); setText('') }
  }

  if (!canEdit) return null

  const columnCount = plan === null ? 0 : plan.tables.reduce((n, t) => n + t.columns.length, 0)
  const indexCount = plan === null ? 0 : plan.tables.reduce((n, t) => n + t.indexes.length, 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Import /> 가져오기</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>DDL 가져오기</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <span className="text-sm font-medium">방언</span>
          <select
            aria-label="방언"
            className="h-8 w-fit rounded-md border bg-transparent px-2 text-sm"
            value={dialect}
            onChange={(e) => setManualDialect(e.target.value as Dialect)}
          >
            {DIALECTS.map((d) => (
              <option key={d} value={d}>
                {DIALECT_LABEL[d]}{d === detected ? ' (자동 감지)' : ''}
              </option>
            ))}
          </select>
        </div>
        <textarea
          aria-label="DDL"
          className="min-h-40 rounded-md border bg-muted p-3 font-mono text-xs"
          placeholder="CREATE TABLE ... 형태의 DDL을 붙여넣으세요"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {plan !== null && (
          <>
            <p className="text-sm">
              테이블 {plan.tables.length}개 · 컬럼 {columnCount}개 · 관계 {plan.relationships.length}개
              {' '}· 인덱스 {indexCount}개
              {plan.skippedTables.length > 0
                && ` · 건너뜀 ${plan.skippedTables.length}개 (이미 있는 이름: ${plan.skippedTables.join(', ')})`}
            </p>
            {plan.warnings.length > 0 && (
              <ul aria-label="DDL 경고" className="grid max-h-48 gap-0.5 overflow-y-auto text-xs text-key">
                {plan.warnings.map((w, i) => (
                  <li key={i}>
                    ⚠ <span className="font-mono text-muted-foreground">{w.target}</span> {w.message}
                  </li>
                ))}
              </ul>
            )}
            {overLimit && (
              <p role="alert" className="text-sm text-destructive">
                한 번에 가져올 수 있는 양을 넘었습니다. DDL을 나눠 올려주세요.
              </p>
            )}
            <DialogFooter>
              <Button type="button" disabled={overLimit} onClick={() => { void onApply() }}>
                {plan.tables.length}개 테이블 만들기
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
