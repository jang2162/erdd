import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DIALECTS, MAX_OPS_PER_MUTATION, detectDialect, dialectFromDatabaseType, parseDbml, parseDdl,
  planDdlImport, type Dialect, type ParsedDbml,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { applyDdlImport } from './ddl-import-edits.js'
import { newId } from './uid.js'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/**
 * 헤더 「파일 ▾」의 "DDL·DBML 가져오기": DDL 또는 DBML 텍스트를 붙여넣으면 즉시 파싱해
 * 미리보기(테이블·컬럼·관계·인덱스·그룹 개수와 경고)를 보여주고, 적용하면 단일
 * mutation(Revision 1건)으로 반영한다.
 *
 * 제목은 메뉴 항목과 같은 "DDL·DBML 가져오기"다 — 사전 다이얼로그의 Excel 업로드 탭도
 * 「가져오기」라, 제목이 그냥 「가져오기」면 서로 다른 두 기능이 같은 이름으로 보인다.
 *
 * 파싱은 순수 함수(parseDdl·parseDbml·planDdlImport)라 서버 왕복이 없다 — 입력이 바뀔 때마다
 * useMemo로 즉시 다시 계산한다. **형식에 따라 파서만 갈리고** 방언 선택·미리보기·op 상한·적용은
 * 완전히 공유한다. 방언은 자동 감지(DDL은 detectDialect, DBML은 `Project { database_type }`)하되
 * 언제나 수동으로 덮을 수 있다.
 */
type Format = 'ddl' | 'dbml'

export function DdlImportDialog({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const tableOptions = useEditorStore((s) => s.tableOptions)
  const canManage = useEditorStore((s) => s.canManage)
  const mutate = useModelMutation(projectId)
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const updateProject = useMutation(
    trpc.project.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.project.get.queryKey({ projectId }) })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  const [text, setText] = useState('')
  const [format, setFormat] = useState<Format>('ddl')
  const [manualDialect, setManualDialect] = useState<Dialect | null>(null)

  const parsed = useMemo(
    () => (text.trim() === '' ? null : format === 'ddl' ? parseDdl(text) : parseDbml(text)),
    [text, format],
  )
  const detected = useMemo(() => {
    if (text.trim() === '') return null
    if (format === 'ddl') return detectDialect(text)
    const dt = (parsed as ParsedDbml | null)?.databaseType ?? null
    return dt === null ? null : dialectFromDatabaseType(dt)
  }, [text, format, parsed])
  const dialect = manualDialect ?? detected ?? 'postgresql'
  const plan = useMemo(
    () => (parsed === null ? null : planDdlImport(model, parsed, dialect, namingRules)),
    [parsed, dialect, model, namingRules],
  )
  const overLimit = plan !== null && plan.opCountEstimate > MAX_OPS_PER_MUTATION

  // 테이블 옵션 반영(설계 §5.5-3). **공통 규칙을 CLI 와 같이 쓴다**(3.19 의 정신):
  //   비어 있다 → 켬 / 같다 → 보일 것이 없다 / 값이 있고 다르다 → 끔.
  // ⚠️ 「항상 끔」이면 처음 가져오는 사용자가 체크박스를 못 보고 지나쳐 왕복이 안 닫히고,
  // 「항상 켬」이면 설정해 둔 값을 조용히 덮어쓴다 — 이 저장소에서 가장 비싼 사고 유형이다.
  const planOption = plan?.tableOptions ?? null
  const currentOption = tableOptions[dialect]
  const optionDiffers = planOption !== null && planOption !== currentOption
  const canApplyOption = canManage && optionDiffers
  const [applyOption, setApplyOption] = useState(false)
  // 채택값·방언·현재 값이 바뀌면 기본값을 다시 계산한다. 사용자가 뒤집은 뒤에도 입력이 바뀌면
  // 다시 기본값으로 돌아간다 — 다른 DDL 은 다른 결정이다.
  useEffect(() => {
    setApplyOption(planOption !== null && currentOption.trim() === '')
  }, [planOption, currentOption])

  const onApply = async () => {
    if (plan === null || overLimit) return
    const captured = plan                       // producer 진입 전에 캡처한다(마이크로태스크 지연 대비)
    const summary = format === 'ddl' ? 'DDL 가져오기' : 'DBML 가져오기'
    const r = await mutate((m) => applyDdlImport(m, captured, newId), { summary })
    if (r !== 'applied') return
    // ⚠️ **모델 변경 뒤의 두 번째 동작이다** — 프로젝트 설정은 op 로그 밖이라 `applyDdlImport`
    // 에 섞으면 「Revision 1건 = undo 1회」 규약이 깨진다.
    if (canApplyOption && applyOption && captured.tableOptions !== null) {
      await updateProject.mutateAsync({
        projectId, tableOptions: { ...tableOptions, [dialect]: captured.tableOptions },
      })
    }
    onOpenChange(false); setText('')
  }

  const columnCount = plan === null ? 0 : plan.tables.reduce((n, t) => n + t.columns.length, 0)
  const indexCount = plan === null ? 0 : plan.tables.reduce((n, t) => n + t.indexes.length, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>DDL·DBML 가져오기</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button" size="sm" variant={format === 'ddl' ? 'default' : 'outline'}
            onClick={() => { setFormat('ddl'); setManualDialect(null) }}
          >
            DDL
          </Button>
          <Button
            type="button" size="sm" variant={format === 'dbml' ? 'default' : 'outline'}
            onClick={() => { setFormat('dbml'); setManualDialect(null) }}
          >
            DBML
          </Button>
        </div>
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
          aria-label={format === 'ddl' ? 'DDL' : 'DBML'}
          className="min-h-40 rounded-md border bg-muted p-3 font-mono text-xs"
          placeholder={format === 'ddl'
            ? 'CREATE TABLE ... 형태의 DDL을 붙여넣으세요'
            : 'Table "..." { ... } 형태의 DBML을 붙여넣으세요'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {plan !== null && (
          <>
            <p className="text-sm">
              테이블 {plan.tables.length}개 · 컬럼 {columnCount}개 · 관계 {plan.relationships.length}개
              {' '}· 인덱스 {indexCount}개
              {plan.groups.length > 0 && ` · 그룹 ${plan.groups.length}개`}
              {/* ⚠️ 여기 나열되는 것은 **DDL 원문 이름**이다. 머릿말이 이름을 되돌리면 실제로
                  부딪힌 이름은 그것과 다르므로(TB_MBR_ORD → ORD) 「이미 있는 이름」이라고 적으면
                  거짓이 된다 — 사용자가 사이드바에서 그 이름을 못 찾는다. 겹쳤다는 사실만 적고
                  무엇과 겹쳤는지는 아래 경고 목록이 테이블마다 정확히 말한다. */}
              {plan.skippedTables.length > 0
                && ` · 건너뜀 ${plan.skippedTables.length}개 (이름이 겹침: ${plan.skippedTables.join(', ')})`}
            </p>
            {plan.warnings.length > 0 && (
              <ul aria-label="가져오기 경고" className="grid max-h-48 gap-0.5 overflow-y-auto text-xs text-key">
                {plan.warnings.map((w, i) => (
                  <li key={i}>
                    ⚠ <span className="font-mono text-muted-foreground">{w.target}</span> {w.message}
                  </li>
                ))}
              </ul>
            )}
            {canApplyOption && (
              <div className="grid gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" checked={applyOption}
                    onChange={(e) => setApplyOption(e.target.checked)}
                  />
                  프로젝트의 테이블 옵션도 갱신
                </label>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{dialect}</span> 칸을
                  {currentOption.trim() === ''
                    ? ' '
                    : <> <span className="font-mono">{currentOption}</span> 에서 </>}
                  <span className="font-mono">{planOption}</span> 로 바꿉니다.
                  ⚠️ 테이블 생성은 되돌리기로 취소되지만 이 설정은 되돌아가지 않습니다.
                </p>
              </div>
            )}
            {overLimit && (
              <p role="alert" className="text-sm text-destructive">
                한 번에 가져올 수 있는 양을 넘었습니다. 입력을 나눠 올려주세요.
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
