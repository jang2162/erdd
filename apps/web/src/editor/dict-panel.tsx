import { useState } from 'react'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { DEFAULT_NAMING_RULES, type ProjectModel, type Term, type Word } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import {
  createTerm, createWord, removeTerm, removeWord, termUsage, unregisteredWords, updateTerm, updateWord,
  planTermPropagation, applyTermPropagation, type TermPropagationPlan,
  wordUsage,
} from './dict-edits.js'
import { DictImportSection } from './dict-import-section.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

type Section = 'words' | 'terms' | 'unregistered' | 'import'

/** 헤더의 "사전": 물리명 자동 생성에 쓰이는 단어·용어 사전의 목록·추가·편집·삭제, 사용처, 미등록 단어 모아보기. */
export function DictPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>('words')
  const [editingWord, setEditingWord] = useState<Word | null>(null)
  const [wordEditorOpen, setWordEditorOpen] = useState(false)
  const [editingTerm, setEditingTerm] = useState<Term | null>(null)
  const [termEditorOpen, setTermEditorOpen] = useState(false)

  const words = Object.values(model.words).sort((a, b) => a.logicalName.localeCompare(b.logicalName))
  const terms = Object.values(model.terms).sort((a, b) => a.logicalName.localeCompare(b.logicalName))
  // Task 6에서 store에 실제 프로젝트 명명 규칙이 로드되면 그 규칙으로 교체한다.
  const candidates = unregisteredWords(model, DEFAULT_NAMING_RULES)

  const onAddWord = () => { setEditingWord(null); setWordEditorOpen(true) }
  const onEditWord = (w: Word) => { setEditingWord(w); setWordEditorOpen(true) }
  const onRemoveWord = (id: string) => { void mutate((m) => removeWord(m, id), { summary: '단어 삭제' }) }

  const onAddTerm = () => { setEditingTerm(null); setTermEditorOpen(true) }
  const onEditTerm = (t: Term) => { setEditingTerm(t); setTermEditorOpen(true) }
  const onRemoveTerm = (id: string) => { void mutate((m) => removeTerm(m, id), { summary: '용어 삭제' }) }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm"><BookOpen /> 사전</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>단어·용어 사전</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Button
              type="button" size="sm" variant={section === 'words' ? 'default' : 'outline'}
              onClick={() => setSection('words')}
            >
              단어
            </Button>
            <Button
              type="button" size="sm" variant={section === 'terms' ? 'default' : 'outline'}
              onClick={() => setSection('terms')}
            >
              용어
            </Button>
            <Button
              type="button" size="sm" variant={section === 'unregistered' ? 'default' : 'outline'}
              onClick={() => setSection('unregistered')}
            >
              미등록 단어{candidates.length > 0 ? ` (${candidates.length})` : ''}
            </Button>
            <Button
              type="button" size="sm" variant={section === 'import' ? 'default' : 'outline'}
              onClick={() => setSection('import')}
            >
              가져오기
            </Button>
          </div>

          {section === 'words' && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  단어의 표준 약어를 등록해 물리명 자동 생성에 사용합니다
                </p>
                <Button size="sm" onClick={onAddWord}><Plus /> 단어 추가</Button>
              </div>
              <ul className="grid max-h-96 gap-2 overflow-y-auto">
                {words.length === 0 && <p className="text-sm text-muted-foreground">아직 단어가 없습니다</p>}
                {words.map((w) => {
                  const usage = wordUsage(model, w.id)
                  return (
                    <li key={w.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                      <div className="grid gap-0.5">
                        <span className="font-medium">{w.logicalName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{w.abbreviation}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {usage.length > 0 && (
                          <span className="text-xs text-muted-foreground">사용처 {usage.length}개</span>
                        )}
                        <Button
                          size="icon" variant="ghost" className="size-7" aria-label={`${w.logicalName} 편집`}
                          onClick={() => onEditWord(w)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="size-7 text-destructive"
                          aria-label={`${w.logicalName} 삭제`}
                          onClick={() => onRemoveWord(w.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {section === 'terms' && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  논리명 전체가 완전일치할 때 우선 적용되는 표준 물리명을 관리합니다
                </p>
                <Button size="sm" onClick={onAddTerm}><Plus /> 용어 추가</Button>
              </div>
              <ul className="grid max-h-96 gap-2 overflow-y-auto">
                {terms.length === 0 && <p className="text-sm text-muted-foreground">아직 용어가 없습니다</p>}
                {terms.map((t) => {
                  const usage = termUsage(model, t.id)
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                      <div className="grid gap-0.5">
                        <span className="font-medium">{t.logicalName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{t.physicalName}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {usage.length > 0 && (
                          <span className="text-xs text-muted-foreground">사용처 {usage.length}개</span>
                        )}
                        <Button
                          size="icon" variant="ghost" className="size-7" aria-label={`${t.logicalName} 편집`}
                          onClick={() => onEditTerm(t)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="size-7 text-destructive"
                          aria-label={`${t.logicalName} 삭제`}
                          onClick={() => onRemoveTerm(t.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {section === 'unregistered' && <UnregisteredWordsSection projectId={projectId} candidates={candidates} />}
          {section === 'import' && <DictImportSection projectId={projectId} />}
        </DialogContent>
      </Dialog>
      {wordEditorOpen && (
        <WordEditDialog
          key={editingWord?.id ?? 'new'} projectId={projectId} word={editingWord}
          open={wordEditorOpen} onOpenChange={setWordEditorOpen}
        />
      )}
      {termEditorOpen && (
        <TermEditDialog
          key={editingTerm?.id ?? 'new'} projectId={projectId} term={editingTerm}
          open={termEditorOpen} onOpenChange={setTermEditorOpen}
        />
      )}
    </>
  )
}

/**
 * 테이블·컬럼 논리명 분해 중 사전에 없는 단어(후보) 목록을 보여주고, 약어를 입력한 후보들을
 * 단일 mutation으로 일괄 createWord 등록한다. 등록되면 다음 렌더에서 후보 목록에서 자연히 빠진다.
 */
function UnregisteredWordsSection({ projectId, candidates }: { projectId: string; candidates: string[] }) {
  const mutate = useModelMutation(projectId)
  const [abbrByCandidate, setAbbrByCandidate] = useState<Record<string, string>>({})

  const onAbbreviationChange = (candidate: string, value: string) => {
    setAbbrByCandidate((prev) => ({ ...prev, [candidate]: value }))
  }

  const onBulkRegister = () => {
    // producer 진입 전에 등록 대상(후보 + 약어 + 신규 id)을 모두 확정한 상수 배열로 캡처한다.
    const registrations = candidates
      .map((candidate) => ({
        id: newId(), logicalName: candidate, abbreviation: (abbrByCandidate[candidate] ?? '').trim(),
      }))
      .filter((r) => r.abbreviation !== '')
    if (registrations.length === 0) return
    void mutate(
      (m: ProjectModel) => registrations.reduce(
        (acc, r) => createWord(acc, {
          id: r.id, logicalName: r.logicalName, abbreviation: r.abbreviation,
          englishName: null, description: null, origin: null,
        }),
        m,
      ),
      { summary: '미등록 단어 일괄 등록' },
    )
    setAbbrByCandidate({})
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        테이블·컬럼 논리명 분해 중 사전에 없는 단어입니다. 약어를 입력한 항목만 일괄 등록됩니다
      </p>
      {candidates.length === 0
        ? <p className="text-sm text-muted-foreground">미등록 단어가 없습니다</p>
        : (
            <>
              <ul className="grid max-h-72 gap-2 overflow-y-auto">
                {candidates.map((candidate) => (
                  <li key={candidate} className="flex items-center gap-2 rounded-md border p-2">
                    <span className="flex-1 font-medium">{candidate}</span>
                    <Input
                      aria-label={`${candidate} 약어`} placeholder="약어" className="w-32 font-mono"
                      value={abbrByCandidate[candidate] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value
                        onAbbreviationChange(candidate, value)
                      }}
                    />
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button size="sm" onClick={onBulkRegister}><Plus /> 일괄 등록</Button>
              </div>
            </>
          )}
    </div>
  )
}

/**
 * "단어" 추가/수정 폼. 신규는 확인 없이 단일 createWord mutation, 수정은 단일 updateWord mutation.
 * 모든 입력값은 컨트롤드 state로 즉시 캡처되고, 저장 시 그 state에서 뽑은 const만 producer에 넘긴다
 * (producer 안에서 이벤트 값을 lazy read하지 않는다).
 */
function WordEditDialog({
  projectId, word, open, onOpenChange,
}: {
  projectId: string
  word: Word | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mutate = useModelMutation(projectId)

  const [logicalName, setLogicalName] = useState(word?.logicalName ?? '')
  const [abbreviation, setAbbreviation] = useState(word?.abbreviation ?? '')
  const [englishName, setEnglishName] = useState(word?.englishName ?? '')
  const [description, setDescription] = useState(word?.description ?? '')

  const logicalNameInvalid = logicalName.trim() === ''
  const abbreviationInvalid = abbreviation.trim() === ''

  const onSave = () => {
    const trimmedLogicalName = logicalName.trim()
    if (trimmedLogicalName === '') return
    const trimmedAbbreviation = abbreviation.trim()
    if (trimmedAbbreviation === '') return
    const trimmedEnglishName = englishName.trim()
    const trimmedDescription = description.trim()

    if (word === null) {
      const id = newId()
      void mutate((m) => createWord(m, {
        id,
        logicalName: trimmedLogicalName,
        abbreviation: trimmedAbbreviation,
        englishName: trimmedEnglishName === '' ? null : trimmedEnglishName,
        description: trimmedDescription === '' ? null : trimmedDescription,
        origin: null,
      }), { summary: '단어 추가' })
      onOpenChange(false)
      return
    }

    const wordId = word.id
    void mutate((m) => updateWord(m, wordId, {
      logicalName: trimmedLogicalName,
      abbreviation: trimmedAbbreviation,
      englishName: trimmedEnglishName === '' ? null : trimmedEnglishName,
      description: trimmedDescription === '' ? null : trimmedDescription,
    }), { summary: '단어 수정' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{word === null ? '단어 추가' : '단어 수정'}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="word-logical">논리명</Label>
            <Input id="word-logical" value={logicalName} onChange={(e) => setLogicalName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-abbr">약어</Label>
            <Input
              id="word-abbr" className="font-mono" value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-english">영문명</Label>
            <Input
              id="word-english" className="font-mono" value={englishName}
              onChange={(e) => setEnglishName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-desc">설명</Label>
            <textarea
              id="word-desc" className="min-h-16 rounded-md border bg-background p-2 text-sm"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="button" disabled={logicalNameInvalid || abbreviationInvalid} onClick={onSave}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "용어" 추가/수정 폼. 신규는 확인 없이 단일 createTerm mutation, 수정은 단일 updateTerm mutation.
 * 모든 입력값은 컨트롤드 state로 즉시 캡처되고, 저장 시 그 state에서 뽑은 const만 producer에 넘긴다
 * (producer 안에서 이벤트 값을 lazy read하지 않는다).
 */
function TermEditDialog({
  projectId, term, open, onOpenChange,
}: {
  projectId: string
  term: Term | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)

  const [logicalName, setLogicalName] = useState(term?.logicalName ?? '')
  const [physicalName, setPhysicalName] = useState(term?.physicalName ?? '')
  const [domainId, setDomainId] = useState(term?.domainId ?? '')
  const [description, setDescription] = useState(term?.description ?? '')

  const logicalNameInvalid = logicalName.trim() === ''
  const physicalNameInvalid = physicalName.trim() === ''

  const domains = Object.values(model.domains).sort((a, b) => a.name.localeCompare(b.name))

  // 저장 시 전파할 게 있으면 여기에 담고 확인 단계를 띄운다. patch·plan은 클릭 시점에 확정된 값이다.
  const [pending, setPending] = useState<
    { termId: string; patch: Partial<Omit<Term, 'id'>>; plan: TermPropagationPlan } | null
  >(null)

  const onSave = () => {
    const trimmedLogicalName = logicalName.trim()
    if (trimmedLogicalName === '') return
    const trimmedPhysicalName = physicalName.trim()
    if (trimmedPhysicalName === '') return
    const nextDomainId = domainId === '' ? null : domainId
    const trimmedDescription = description.trim()

    if (term === null) {
      const id = newId()
      void mutate((m) => createTerm(m, {
        id,
        logicalName: trimmedLogicalName,
        physicalName: trimmedPhysicalName,
        domainId: nextDomainId,
        description: trimmedDescription === '' ? null : trimmedDescription,
        origin: null,
      }), { summary: '용어 추가' })
      onOpenChange(false)
      return
    }

    const termId = term.id
    const patch = {
      logicalName: trimmedLogicalName,
      physicalName: trimmedPhysicalName,
      domainId: nextDomainId,
      description: trimmedDescription === '' ? null : trimmedDescription,
    }
    // 반드시 updateTerm 적용 전의 모델로 계획을 세운다(논리명이 바뀌면 사용처 판정이 무너진다).
    const plan = planTermPropagation(model, termId, patch)
    if (plan.entries.length === 0) {
      void mutate((m) => updateTerm(m, termId, patch), { summary: '용어 수정' })
      onOpenChange(false)
      return
    }
    setPending({ termId, patch, plan })
  }

  /** 확인 단계의 선택. propagate=false면 용어만 저장한다. */
  const onResolve = (propagate: boolean) => {
    if (!pending) return
    const { termId, patch, plan } = pending      // producer 진입 전에 캡처
    setPending(null)
    void mutate(
      (m) => (propagate
        ? applyTermPropagation(updateTerm(m, termId, patch), plan)
        : updateTerm(m, termId, patch)),
      { summary: propagate ? '용어 수정·사용처 반영' : '용어 수정' },
    )
    onOpenChange(false)
  }

  return (
    <>
    <Dialog open={open && pending === null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{term === null ? '용어 추가' : '용어 수정'}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="term-logical">논리명</Label>
            <Input id="term-logical" value={logicalName} onChange={(e) => setLogicalName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="term-physical">물리명</Label>
            <Input
              id="term-physical" className="font-mono" value={physicalName}
              onChange={(e) => setPhysicalName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="term-domain">도메인 (선택)</Label>
            <select
              id="term-domain" className="h-9 rounded-md border bg-background px-2 text-sm"
              value={domainId} onChange={(e) => setDomainId(e.target.value)}
            >
              <option value="">없음</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="term-desc">설명</Label>
            <textarea
              id="term-desc" className="min-h-16 rounded-md border bg-background p-2 text-sm"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="button" disabled={logicalNameInvalid || physicalNameInvalid} onClick={onSave}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            &quot;{term?.logicalName}&quot; 용어를 쓰는 {pending?.plan.entries.length ?? 0}곳을 함께 갱신할까요?
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto text-sm">
          {pending?.plan.entries.map((entry) => (
            <div key={entry.entityId} className="border-b py-2 last:border-b-0">
              <p className="font-mono text-xs font-semibold">{entry.label}</p>
              {entry.changes.map((c) => (
                <p key={c.field} className="text-xs text-muted-foreground">
                  {PROPAGATION_FIELD_LABEL[c.field]}{' '}
                  {displayFieldValue(c.field, c.before, model)} → {displayFieldValue(c.field, c.after, model)}
                </p>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onResolve(false)}>유지</Button>
          <Button type="button" onClick={() => onResolve(true)}>
            {pending?.plan.entries.length ?? 0}곳에 반영
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

const PROPAGATION_FIELD_LABEL: Record<'logicalName' | 'physicalName' | 'domainId', string> = {
  logicalName: '논리명', physicalName: '물리명', domainId: '도메인',
}

/** 도메인은 UUID 대신 이름으로 보여준다(없으면 '없음'). */
function displayFieldValue(
  field: 'logicalName' | 'physicalName' | 'domainId', value: string | null, model: ProjectModel,
): string {
  if (field !== 'domainId') return value ?? ''
  if (value === null) return '없음'
  return model.domains[value]?.name ?? value
}
