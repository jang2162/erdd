import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { buildDictTemplateSheets, planDictImport, type DictImportPlan } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { downloadExcelWorkbook, readDictSheets } from './excel-file.js'
import { applyDictImport, countApplied, type DictImportMode } from './dict-import-edits.js'
import { Button } from '@/components/ui/button'

const MAX_ISSUES_SHOWN = 20

/** 사전 패널의 "가져오기" 섹션: 양식 다운로드 → 파일 선택 → 미리보기 → 일괄 적용. */
export function DictImportSection({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const mutate = useModelMutation(projectId)
  const [plan, setPlan] = useState<DictImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<DictImportMode>('skip')

  const onTemplate = () => {
    void downloadExcelWorkbook(buildDictTemplateSheets(), 'erdd_사전양식.xlsx')
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : '양식을 내려받지 못했습니다')
      })
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setPlan(null)
    setFileName(file.name)
    try {
      const sheets = await readDictSheets(file)
      setPlan(planDictImport(sheets, model, namingRules))
    } catch (err) {
      setFileName('')
      toast.error(err instanceof Error ? err.message : 'Excel 파일을 읽지 못했습니다')
    }
  }

  const onImport = () => {
    if (!plan) return
    const current = plan
    const currentMode = mode
    const applied = countApplied(current, currentMode)
    const summary = `Excel 사전 가져오기 (단어 ${applied.words} · 용어 ${applied.terms} · 도메인 ${applied.domains})`
    void mutate((m) => applyDictImport(m, current, currentMode, newId), { summary })
    setPlan(null)
    setFileName('')
    toast.success(summary)
  }

  const applied = plan ? countApplied(plan, mode) : null
  const nothingToApply = applied !== null && applied.words + applied.terms + applied.domains === 0

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          정해진 양식의 Excel로 단어·용어·도메인을 한 번에 등록합니다
        </p>
        <Button size="sm" variant="outline" onClick={onTemplate}><Download /> 양식 다운로드</Button>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="dict-import-file" className="text-sm font-medium">Excel 파일 선택</label>
        <input
          id="dict-import-file" type="file" accept=".xlsx"
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          onChange={(e) => { const f = e.target.files?.[0]; void onFile(f) }}
        />
      </div>

      {plan && (
        <div className="grid gap-3 rounded-md border p-3">
          <p className="text-sm">
            <span className="font-medium">{fileName}</span>
            {' — '}
            신규 {plan.total.created}건 · 중복 {plan.total.duplicated}건 · 오류 {plan.total.errored}행
          </p>

          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">중복 항목 처리</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio" name="dict-import-mode" className="size-4"
                checked={mode === 'skip'} onChange={() => setMode('skip')}
              />
              건너뛰기
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio" name="dict-import-mode" className="size-4"
                checked={mode === 'overwrite'} onChange={() => setMode('overwrite')}
              />
              덮어쓰기
            </label>
          </fieldset>

          {plan.issues.length > 0 && (
            <ul aria-label="가져오기 이슈" className="grid max-h-48 gap-0.5 overflow-y-auto text-xs">
              {plan.issues.slice(0, MAX_ISSUES_SHOWN).map((i, idx) => (
                <li key={idx} className={i.level === 'error' ? 'text-destructive' : 'text-key'}>
                  {i.row === null ? '' : `${i.row}행 · `}{i.message}
                </li>
              ))}
              {plan.issues.length > MAX_ISSUES_SHOWN && (
                <li className="text-muted-foreground">외 {plan.issues.length - MAX_ISSUES_SHOWN}건</li>
              )}
            </ul>
          )}

          <div className="flex justify-end">
            <Button type="button" disabled={nothingToApply} onClick={onImport}>
              <Upload /> 가져오기
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
