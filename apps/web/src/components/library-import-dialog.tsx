import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  RESOURCE_KIND_LABEL, dictIssueText, formatLibraryFileIssues, libraryDocFromDictSheets, parseLibraryFile,
  stringifyLibraryFile,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { useLibraryDomains } from '@/lib/library-domains'
import { readDictSheets } from '@/editor/excel-file'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type LibraryImportTarget =
  | { kind: 'existing'; libraryId: string; name: string }
  | { kind: 'create'; scope: 'global' | 'org'; orgId?: string }

const SHOWN = 50
const text = (v: unknown): string => (v === null || v === undefined ? '(없음)' : typeof v === 'string' ? v : JSON.stringify(v))

/**
 * 라이브러리 파일·Excel 가져오기. 파싱은 브라우저에서 먼저 해 형식 오류를 서버에 가기 전에 보이고,
 * 계획은 서버의 dryRun 이 계산한다(guides/shared-resources.md 「파일 내보내기·가져오기」).
 * 체크박스는 적용 요청에만 실린다 — dryRun 은 두 플래그와 무관하게 전체 분류를 돌려준다.
 */
export function LibraryImportDialog({ target, onClose, onDone }: {
  target: LibraryImportTarget; onClose: () => void; onDone: () => void
}) {
  const trpc = useTRPC()
  // 대상 라이브러리의 도메인 이름 — Excel 을 라이브러리 문서로 바꿀 때 용어의 도메인을 이름으로 푸는 데만 쓴다.
  // 항목 전체(items.list)를 받지 않는다(설계 3절 — 이 쓰임은 dryRun 응답·countsByKind 로 대신할 수 없다).
  const existingDomains = useLibraryDomains(
    target.kind === 'existing' ? target.libraryId : null, target.kind === 'existing',
  )
  const importLibrary = useMutation(trpc.resource.library.import.mutationOptions())
  type ImportSummary = Awaited<ReturnType<typeof importLibrary.mutateAsync>>['summary']
  type Preview = { stateHash: string; summary: ImportSummary }
  const [fileText, setFileText] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [conflict, setConflict] = useState(false)
  const [prune, setPrune] = useState(false)
  const [includeStale, setIncludeStale] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  // 파일을 빠르게 다시 고르거나 「다시 미리보기」를 연타할 때, 먼저 시작했지만 늦게 응답하는 요청이
  // 나중 요청의 상태를 덮지 않도록 호출마다 세대를 매겨 최신이 아닌 응답을 버린다.
  const genRef = useRef(0)
  const [previewing, setPreviewing] = useState(false)

  const targetInput = (): Parameters<typeof importLibrary.mutateAsync>[0]['target'] =>
    target.kind === 'existing'
      ? { libraryId: target.libraryId }
      : { create: { scope: target.scope, ...(target.orgId ? { orgId: target.orgId } : {}), name: name.trim() || '가져온 라이브러리', description } }

  const runPreview = async (t: string, gen: number) => {
    setConflict(false)
    setPreviewing(true)
    try {
      const res = await importLibrary.mutateAsync({ target: targetInput(), text: t, dryRun: true })
      if (genRef.current !== gen) return
      setPreview({ stateHash: res.stateHash, summary: res.summary })
    } catch (err) {
      if (genRef.current !== gen) return
      toast.error(err instanceof Error ? err.message : '미리보기를 만들지 못했습니다')
    } finally {
      if (genRef.current === gen) setPreviewing(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const gen = ++genRef.current
    setPreview(null); setIssues([]); setFileText(null)
    try {
      let t: string
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const domainNames = (existingDomains.data ?? []).map((d) => d.name)
        const r = libraryDocFromDictSheets(await readDictSheets(file), { name: file.name.replace(/\.xlsx$/i, ''), targetDomainNames: domainNames })
        if (genRef.current !== gen) return
        if (!r.ok) { setIssues(r.issues.slice(0, 20).map(dictIssueText)); return }
        t = stringifyLibraryFile(r.doc)
      } else {
        t = await file.text()
        if (genRef.current !== gen) return
        const parsed = parseLibraryFile(t, 'source')
        if (!parsed.ok) { setIssues(formatLibraryFileIssues(parsed.issues)); return }
        if (target.kind === 'create') { setName(parsed.doc.library.name); setDescription(parsed.doc.library.description) }
      }
      setFileText(t)
      await runPreview(t, gen)
    } catch (err) {
      if (genRef.current !== gen) return
      toast.error(err instanceof Error ? err.message : '파일을 읽지 못했습니다')
    }
  }

  const s = preview?.summary
  const removable = s ? s.counts.remove - s.counts.removeBlocked : 0
  const changes = s ? s.counts.add + s.counts.update + (includeStale ? s.counts.stale : 0) + (prune ? removable : 0) : 0

  const onApply = async () => {
    if (fileText === null || preview === null || busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const res = await importLibrary.mutateAsync({
        target: targetInput(), text: fileText, prune, includeStale, dryRun: false, expectedStateHash: preview.stateHash,
      })
      const c = res.summary.counts
      toast.success(`추가 ${formatCount(c.add)} · 갱신 ${formatCount(c.update + (includeStale ? c.stale : 0))} · 삭제 ${formatCount(prune ? c.remove - c.removeBlocked : 0)}`)
      onDone()
    } catch (err) {
      const code = (err as { data?: { code?: string } }).data?.code
      if (code === 'CONFLICT') setConflict(true)
      else toast.error(err instanceof Error ? err.message : '가져오지 못했습니다')
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  const section = (title: string, status: ImportSummary['entries'][number]['status']) => {
    const rows = (s?.entries ?? []).filter((e) => e.status === status)
    if (rows.length === 0) return null
    return (
      <div className="grid gap-1">
        <p className="text-sm font-medium">{title} {rows.length}건</p>
        <ul className="grid gap-0.5 text-xs">
          {rows.slice(0, SHOWN).map((e, i) => (
            <li key={`${e.kind}:${e.name}:${i}`}>
              {RESOURCE_KIND_LABEL[e.kind]} {e.name}
              {e.status === 'stale' && ` (서버 v${e.currentVersion}, 파일 v${e.fileVersion})`}
              {e.status === 'remove' && e.referencedBy > 0 && ` — 용어 ${e.referencedBy}건이 가리켜 지우지 않음`}
              {e.changes.map((c) => <span key={c.field} className="ml-2 text-muted-foreground">{c.field}: {text(c.from)} → {text(c.to)}</span>)}
            </li>
          ))}
          {rows.length > SHOWN && <li className="text-muted-foreground">외 {rows.length - SHOWN}건</li>}
        </ul>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target.kind === 'existing' ? `라이브러리 가져오기 — ${target.name}` : '파일에서 만들기'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          {target.kind === 'create' && (
            <div className="grid gap-2">
              <Label htmlFor="lib-import-name">이름</Label>
              <Input id="lib-import-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
              <Label htmlFor="lib-import-desc">설명 (선택)</Label>
              <Input id="lib-import-desc" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor="lib-import-file" className="text-sm font-medium">파일 선택</label>
            <input id="lib-import-file" type="file" accept=".yaml,.yml,.xlsx" disabled={busy}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm disabled:opacity-50"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f) }} />
          </div>
          {issues.length > 0 && (
            <ul role="alert" className="grid gap-0.5 text-xs text-destructive">
              {issues.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {s && (
            <>
              {s.warnings.map((w) => <p key={w} className="text-xs text-amber-600">{w}</p>)}
              {section('추가', 'add')}
              {section('갱신', 'update')}
              <p className="text-sm">그대로 {s.counts.unchanged}건</p>
              {section('오래된 파일', 'stale')}
              {section('파일에 없음', 'remove')}
              {removable > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={prune} disabled={busy} onChange={(e) => setPrune(e.target.checked)} />
                  <span>파일에 없는 항목 {removable}건 삭제
                    {prune && <span className="block text-xs text-muted-foreground">이미 가져간 프로젝트의 사본은 그대로 남습니다</span>}</span>
                </label>
              )}
              {s.counts.stale > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={includeStale} disabled={busy} onChange={(e) => setIncludeStale(e.target.checked)} />
                  <span>오래된 파일 항목 {s.counts.stale}건 덮어쓰기
                    {includeStale && <span className="block text-xs text-muted-foreground">서버의 더 새 값을 파일의 옛 값으로 되돌립니다</span>}</span>
                </label>
              )}
              {changes === 0 && <p className="text-sm text-muted-foreground">파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다</p>}
            </>
          )}
          {conflict && (
            <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
              미리보기 이후 라이브러리가 바뀌었습니다
              <Button size="sm" variant="outline" disabled={busy || previewing}
                onClick={() => { if (fileText !== null) { const gen = ++genRef.current; void runPreview(fileText, gen) } }}>다시 미리보기</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" disabled={busy || previewing || preview === null || changes === 0 || conflict} onClick={() => void onApply()}>
            가져오기 실행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
