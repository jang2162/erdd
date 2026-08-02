import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  DICT_SHEET_KEYS, EXCEL_SHEET_NAME, MAX_OPS_PER_MUTATION, buildDictTemplateSheets, planDictImport,
  type DictImportPlan,
} from '@erdd/core'
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
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [plan, setPlan] = useState<DictImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<DictImportMode>('skip')
  // 제출 중 잠금. mutation 왕복 동안 버튼이 열려 있으면 두 번째 클릭이 같은 계획을 한 번 더
  // 보내고, 신규 항목은 그때마다 새 id로 다시 만들어져 사전이 통째로 중복 등록된다(무결성
  // 규칙에도 이름 유일성이 없어 아무도 막지 않는다). 파일 입력도 같이 잠근다 — 왕복 중에
  // 새 파일을 고르면 앞선 mutation이 끝나면서 그 미리보기를 지워 버린다.
  // ref는 리렌더 전 재진입까지 막고, state는 화면을 잠근다.
  const importingRef = useRef(false)
  const [importing, setImporting] = useState(false)

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

  /**
   * 사전 전체를 mutation 1건으로 보낸다(undo 한 번으로 원복). 서버가 거절할 수도 있으므로
   * 결과를 기다렸다가 성공했을 때만 완료를 알리고 미리보기를 치운다 — 실패하면 미리보기를
   * 남겨 사용자가 그대로 다시 시도할 수 있게 한다.
   *
   * 덮어쓰기인데 파일 내용이 사전과 같으면 보낼 op이 없어 mutation이 noop으로 끝난다. 이때는
   * 아무도 알려 주지 않으므로 여기서 안내한다("눌렀는데 아무 일도 없는" 상태 방지).
   */
  const onImport = async () => {
    if (!plan || importingRef.current) return
    const current = plan
    const currentMode = mode
    const counts = countApplied(current, currentMode)
    const summary = `Excel 사전 가져오기 (단어 ${counts.words} · 용어 ${counts.terms} · 도메인 ${counts.domains})`
    importingRef.current = true
    setImporting(true)
    try {
      const result = await mutate((m) => applyDictImport(m, current, currentMode, newId), { summary })
      if (result === 'error') return
      setPlan(null)
      setFileName('')
      if (result === 'noop') toast.info('파일 내용이 현재 사전과 같아 바뀐 항목이 없습니다')
      else toast.success(summary)
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  const applied = plan ? countApplied(plan, mode) : null
  const appliedTotal = applied === null ? 0 : applied.words + applied.terms + applied.domains
  const nothingToApply = applied !== null && appliedTotal === 0
  // 서버는 mutation 1건당 op 수를 MAX_OPS_PER_MUTATION으로 제한한다. 항목 1건이 op 1건이므로
  // 여기서 미리 막지 않으면 낙관적 반영 → 서버 거절 → 되돌림을 사용자가 겪게 된다.
  const tooManyOps = appliedTotal > MAX_OPS_PER_MUTATION
  const recognizedSheets = plan === null
    ? []
    : DICT_SHEET_KEYS
      .map((key) => [key, plan.recognizedColumns[key]] as const)
      .filter(([, cols]) => cols.length > 0)

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          정해진 양식의 Excel로 단어·용어·도메인을 한 번에 등록합니다
        </p>
        <Button size="sm" variant="outline" onClick={onTemplate}><Download /> 양식 다운로드</Button>
      </div>

      {canEdit && (
        <>
          <div className="grid gap-1.5">
            <label htmlFor="dict-import-file" className="text-sm font-medium">Excel 파일 선택</label>
            <input
              id="dict-import-file" type="file" accept=".xlsx" disabled={importing}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm disabled:opacity-50"
              onChange={(e) => {
                const f = e.target.files?.[0]
                // 같은 파일을 고치고 다시 고르면 change가 안 뜬다. 값을 비워 재선택을 살린다.
                e.target.value = ''
                void onFile(f)
              }}
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

              {recognizedSheets.length > 0 && (
                <div className="grid gap-0.5 text-xs text-muted-foreground">
                  <p>덮어쓰기는 파일에 있는 아래 컬럼만 갱신하고 나머지 값은 그대로 둡니다</p>
                  <ul aria-label="인식한 컬럼">
                    {recognizedSheets.map(([key, cols]) => (
                      <li key={key}>{EXCEL_SHEET_NAME[key]}: {cols.join(', ')}</li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.issues.length > 0 && (
                <ul aria-label="가져오기 이슈" className="grid max-h-48 gap-0.5 overflow-y-auto text-xs">
                  {plan.issues.slice(0, MAX_ISSUES_SHOWN).map((i, idx) => (
                    <li key={idx} className={i.level === 'error' ? 'text-destructive' : 'text-key'}>
                      {EXCEL_SHEET_NAME[i.sheet]} · {i.row === null ? '' : `${i.row}행 · `}{i.message}
                    </li>
                  ))}
                  {plan.issues.length > MAX_ISSUES_SHOWN && (
                    <li className="text-muted-foreground">외 {plan.issues.length - MAX_ISSUES_SHOWN}건</li>
                  )}
                </ul>
              )}

              {tooManyOps && (
                <p role="alert" className="text-sm text-destructive">
                  한 번에 보낼 수 있는 최대 {MAX_OPS_PER_MUTATION}건을 넘습니다. 파일을 나눠서 올려 주세요
                </p>
              )}

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">적용 대상 {appliedTotal}건</p>
                <Button
                  type="button" disabled={nothingToApply || tooManyOps || importing}
                  onClick={() => { void onImport() }}
                >
                  <Upload /> 가져오기 실행
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
