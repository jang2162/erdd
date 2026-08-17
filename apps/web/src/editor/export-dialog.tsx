import { useEffect, useMemo, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import {
  DIALECTS, EXCEL_SHEET_KEYS, EXCEL_SHEET_NAME, buildExcelSheets, generateDdl, generateDbml,
  ddlWarnings, type Dialect, type ExcelSheetKey, type ExportScope,
} from '@erdd/core'
import { useEditorStore } from './store.js'
import { downloadCanvasImage, type ImageFormat } from './image-export.js'
import { downloadExcelWorkbook } from './excel-file.js'
import { ExportScopeSelect } from './export-scope-select.js'
import { DIALECT_LABEL } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Section = 'ddl' | 'dbml' | 'image' | 'excel'

/** 파일명에 못 쓰는 문자를 밑줄로 바꾼다. */
function safeFileNamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_')
}

/**
 * 헤더의 "내보내기": DDL·DBML·이미지·Excel 네 섹션을 토글로 오간다. 모델을 변경하지 않는
 * 읽기 전용 다이얼로그.
 *
 * DDL 과 DBML 은 방언·범위 state 를 **공유한다** — 형식을 바꿔도 고른 방언·범위가 유지되는
 * 것이 자연스럽고, 경고(`ddlWarnings`)도 두 형식이 같은 것을 쓴다(테이블 선정 판정이 같다).
 */
export function ExportDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const projectName = useEditorStore((s) => s.projectName)
  const namingRules = useEditorStore((s) => s.namingRules)
  const rf = useReactFlow()
  const [section, setSection] = useState<Section>('ddl')
  const [dialect, setDialect] = useState<Dialect>('postgresql')
  const [scope, setScope] = useState<ExportScope>({ kind: 'all' })
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png')
  const [sheets, setSheets] = useState<ExcelSheetKey[]>([...EXCEL_SHEET_KEYS])

  // 열릴 때 범위를 현재 그룹 뷰에 맞춘다. 제어형이 되어 onOpenChange 가 부모 것이므로 "열림"을
  // 여기서 감지한다. activeGroupView 를 구독해 의존성에 넣으면 **열려 있는 동안** 그룹 뷰가
  // 바뀔 때도 범위가 재설정되어 기존 동작과 달라지므로, 그 순간의 값을 store 에서 직접 읽는다.
  useEffect(() => {
    if (!open) return
    const groupId = useEditorStore.getState().activeGroupView
    setScope(groupId ? { kind: 'group', groupId } : { kind: 'all' })
  }, [open])

  const ddl = useMemo(
    () => generateDdl(model, dialect, scope, namingRules), [model, dialect, scope, namingRules])
  const dbml = useMemo(
    () => generateDbml(model, dialect, scope, { projectName: projectName ?? undefined }, namingRules),
    [model, dialect, scope, projectName, namingRules],
  )
  const warnings = useMemo(
    () => ddlWarnings(model, dialect, scope, namingRules), [model, dialect, scope, namingRules])

  const onCopy = () => { void navigator.clipboard?.writeText(ddl) }
  const onDownload = () => {
    const blob = new Blob([ddl], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `erdd_${dialect}.sql`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onCopyDbml = () => { void navigator.clipboard?.writeText(dbml) }
  const onDownloadDbml = () => {
    const blob = new Blob([dbml], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `erdd_${dialect}.dbml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onDownloadImage = async () => {
    try {
      await downloadCanvasImage(rf, { format: imageFormat })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지를 내보내지 못했습니다')
    }
  }

  const toggleSheet = (key: ExcelSheetKey) => {
    setSheets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const onDownloadExcel = async () => {
    try {
      const data = buildExcelSheets(model, { scope, sheets, rules: namingRules })
      const groupName = scope.kind === 'group' ? model.tableGroups[scope.groupId]?.name : undefined
      const suffix = groupName ? `_${safeFileNamePart(groupName)}` : ''
      await downloadExcelWorkbook(data, `erdd_정의서${suffix}.xlsx`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Excel을 내보내지 못했습니다')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>내보내기</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button" size="sm" variant={section === 'ddl' ? 'default' : 'outline'}
            onClick={() => setSection('ddl')}
          >
            DDL
          </Button>
          <Button
            type="button" size="sm" variant={section === 'dbml' ? 'default' : 'outline'}
            onClick={() => setSection('dbml')}
          >
            DBML
          </Button>
          <Button
            type="button" size="sm" variant={section === 'image' ? 'default' : 'outline'}
            onClick={() => setSection('image')}
          >
            이미지
          </Button>
          <Button
            type="button" size="sm" variant={section === 'excel' ? 'default' : 'outline'}
            onClick={() => setSection('excel')}
          >
            Excel
          </Button>
        </div>
        {section === 'ddl' && (
          <>
            <div className="grid gap-2">
              <span className="text-sm font-medium">방언</span>
              <div className="flex flex-wrap gap-2">
                {DIALECTS.map((d) => (
                  <Button
                    key={d} type="button" size="sm"
                    variant={dialect === d ? 'default' : 'outline'}
                    onClick={() => setDialect(d)}
                  >
                    {DIALECT_LABEL[d]}
                  </Button>
                ))}
              </div>
            </div>
            <ExportScopeSelect value={scope} onChange={setScope} />
            <pre
              aria-label="DDL 미리보기"
              className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre"
            >
              {ddl}
            </pre>
            {warnings.length > 0 && (
              <ul aria-label="DDL 경고" className="grid gap-0.5 text-xs text-key">
                {warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCopy}><Copy /> 복사</Button>
              <Button type="button" onClick={onDownload}><Download /> 다운로드</Button>
            </DialogFooter>
          </>
        )}
        {section === 'dbml' && (
          <>
            <div className="grid gap-2">
              <span className="text-sm font-medium">방언</span>
              <div className="flex flex-wrap gap-2">
                {DIALECTS.map((d) => (
                  <Button
                    key={d} type="button" size="sm"
                    variant={dialect === d ? 'default' : 'outline'}
                    onClick={() => setDialect(d)}
                  >
                    {DIALECT_LABEL[d]}
                  </Button>
                ))}
              </div>
            </div>
            <ExportScopeSelect value={scope} onChange={setScope} />
            <pre
              aria-label="DBML 미리보기"
              className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre"
            >
              {dbml}
            </pre>
            {warnings.length > 0 && (
              <ul aria-label="DBML 경고" className="grid gap-0.5 text-xs text-key">
                {warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCopyDbml}><Copy /> 복사</Button>
              <Button type="button" onClick={onDownloadDbml}><Download /> 다운로드</Button>
            </DialogFooter>
          </>
        )}
        {section === 'image' && (
          <>
            <div className="grid gap-2">
              <span className="text-sm font-medium">포맷</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button" size="sm"
                  variant={imageFormat === 'png' ? 'default' : 'outline'}
                  onClick={() => setImageFormat('png')}
                >
                  PNG
                </Button>
                <Button
                  type="button" size="sm"
                  variant={imageFormat === 'svg' ? 'default' : 'outline'}
                  onClick={() => setImageFormat('svg')}
                >
                  SVG
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">현재 화면(뷰·보기 모드)이 그대로 저장됩니다</p>
            <DialogFooter>
              <Button type="button" onClick={() => void onDownloadImage()}><Download /> 다운로드</Button>
            </DialogFooter>
          </>
        )}
        {section === 'excel' && (
          <>
            <ExportScopeSelect value={scope} onChange={setScope} />
            <div className="grid gap-2">
              <span className="text-sm font-medium">시트</span>
              <div className="grid gap-1.5">
                {EXCEL_SHEET_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" className="size-4"
                      checked={sheets.includes(k)}
                      onChange={() => toggleSheet(k)}
                    />
                    {EXCEL_SHEET_NAME[k]}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              범위는 테이블 목록·테이블정의서에만 적용됩니다. 사전 3종은 항상 전체를 내보냅니다
            </p>
            <DialogFooter>
              <Button type="button" disabled={sheets.length === 0} onClick={() => void onDownloadExcel()}>
                <Download /> 다운로드
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
