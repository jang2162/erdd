import { useMemo, useState } from 'react'
import { Copy, Download, FileOutput } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import { DIALECTS, generateDdl, type Dialect, type DdlScope } from '@erdd/core'
import { useEditorStore } from './store.js'
import { downloadCanvasImage, type ImageFormat } from './image-export.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

const DIALECT_LABEL: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL·MariaDB', oracle: 'Oracle', mssql: 'MSSQL',
}

type Section = 'ddl' | 'image'

/** 헤더의 "내보내기": DDL(방언·범위별 미리보기/복사/다운로드)과 이미지(PNG/SVG 다운로드) 두 섹션을 토글로 오간다. 모델을 변경하지 않는 읽기 전용 다이얼로그. */
export function ExportDialog() {
  const model = useEditorStore((s) => s.model)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const rf = useReactFlow()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('ddl')
  const [dialect, setDialect] = useState<Dialect>('postgresql')
  const [scope, setScope] = useState<DdlScope>({ kind: 'all' })
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png')

  const ddl = useMemo(() => generateDdl(model, dialect, scope), [model, dialect, scope])

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

  const onDownloadImage = async () => {
    try {
      await downloadCanvasImage(rf, { format: imageFormat })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지를 내보내지 못했습니다')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setScope(activeGroupView ? { kind: 'group', groupId: activeGroupView } : { kind: 'all' })
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><FileOutput /> 내보내기</Button>
      </DialogTrigger>
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
            type="button" size="sm" variant={section === 'image' ? 'default' : 'outline'}
            onClick={() => setSection('image')}
          >
            이미지
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
            <div className="grid gap-2">
              <span className="text-sm font-medium">범위</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button" size="sm"
                  variant={scope.kind === 'all' ? 'default' : 'outline'}
                  onClick={() => setScope({ kind: 'all' })}
                >
                  전체 뷰
                </Button>
                {activeGroupView && (
                  <Button
                    type="button" size="sm"
                    variant={scope.kind === 'group' ? 'default' : 'outline'}
                    onClick={() => setScope({ kind: 'group', groupId: activeGroupView })}
                  >
                    현재 그룹
                  </Button>
                )}
              </div>
            </div>
            <pre
              aria-label="DDL 미리보기"
              className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre"
            >
              {ddl}
            </pre>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCopy}><Copy /> 복사</Button>
              <Button type="button" onClick={onDownload}><Download /> 다운로드</Button>
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
      </DialogContent>
    </Dialog>
  )
}
