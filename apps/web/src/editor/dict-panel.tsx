import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { NamingRules, ProjectModel, Term, Word } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import {
  buildUsageIndex, canRegisterWord,
  createTerm, createWord, removeTerm, removeWord, unregisteredAbbreviations, unregisteredWords,
  updateTerm, updateWord,
  planTermPropagation, applyTermPropagation, type TermPropagationPlan,
} from './dict-edits.js'
import { DictImportSection } from './dict-import-section.js'
import { formatCount } from '@/lib/format'
import { useListPage } from '@/lib/use-list-page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FieldLabel } from '@/components/field-label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Section = 'words' | 'terms' | 'unregistered' | 'import'

/** 검색 칸 — 서버 `items.page` 와 같은 필드다(guides/shared-resources.md 「관리 화면의 항목 조회」). */
const WORD_FIELDS = (w: Word) => [w.logicalName, w.abbreviation, w.englishName]
const TERM_FIELDS = (t: Term) => [t.logicalName, t.physicalName]

/** 헤더의 "사전": 물리명 자동 생성에 쓰이는 단어·용어 사전의 목록·추가·편집·삭제, 사용처, 미등록 단어 모아보기. */
export function DictPanel({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const namingRules = useEditorStore((s) => s.namingRules)
  const mutate = useModelMutation(projectId)
  const [section, setSection] = useState<Section>('words')
  const [direction, setDirection] = useState<'toAbbr' | 'toLogical'>('toAbbr')
  const [editingWord, setEditingWord] = useState<Word | null>(null)
  const [wordEditorOpen, setWordEditorOpen] = useState(false)
  const [editingTerm, setEditingTerm] = useState<Term | null>(null)
  const [termEditorOpen, setTermEditorOpen] = useState(false)

  const words = useMemo(
    () => Object.values(model.words).sort((a, b) => a.logicalName.localeCompare(b.logicalName)), [model.words])
  const terms = useMemo(
    () => Object.values(model.terms).sort((a, b) => a.logicalName.localeCompare(b.logicalName)), [model.terms])
  const wordList = useListPage(words, WORD_FIELDS)
  const termList = useListPage(terms, TERM_FIELDS)
  const wordListRef = useRef<HTMLUListElement>(null)
  const termListRef = useRef<HTMLUListElement>(null)
  // 무거운 계산(사용처 색인·미등록)은 열려 있던 마지막 때의 입력으로 한다. 이 패널은 늘 마운트돼 있어 닫힌
  // 동안 편집마다 다시 계산하게 되므로 닫혀 있으면 입력을 바꾸지 않는다 — 한 번도 열리지 않았으면 계산하지 않는다.
  // 닫힌 동안 값을 비우지 않는 것은 닫힘 애니메이션(Radix Presence 가 내용을 잠시 더 그린다) 동안 건수·사용처가
  // 먼저 사라져 깜박이지 않게 하려는 것이다. 다시 열면 최신 모델로 바뀌어 다시 계산된다.
  // 렌더 중 상태 맞추기라 바뀐 입력으로 한 번 더 그리고, 옛 입력의 화면은 커밋되지 않는다.
  const [calcInput, setCalcInput] = useState<{ model: ProjectModel; namingRules: NamingRules } | null>(null)
  if (open && (calcInput === null || calcInput.model !== model || calcInput.namingRules !== namingRules)) {
    setCalcInput({ model, namingRules })
  }
  // 사용 수는 모델을 한 번 훑은 색인에서 읽는다(행마다 wordUsage/termUsage 를 부르지 않는다). 사용 수를 보이지
  // 않는 탭이면 만들지 않는다. 의존성은 `section` 이 아니라 이 불리언이다 — 단어↔용어 탭을 오갈 때마다 같은
  // 색인을 다시 만들지 않게 한다.
  const showsUsage = section === 'words' || section === 'terms'
  const usage = useMemo(
    () => (showsUsage && calcInput !== null ? buildUsageIndex(calcInput.model, calcInput.namingRules) : null),
    [showsUsage, calcInput])
  // 미등록 계산은 이름마다 용어 전부를 비교해 대용량 사전에서 무겁다.
  const candidates = useMemo(
    () => (calcInput !== null ? unregisteredWords(calcInput.model, calcInput.namingRules) : []), [calcInput])
  // 물리명 분해에서 나온 미등록 약어(위 candidates의 대칭 — 논리명 분해 vs 물리명 분해).
  const abbrCandidates = useMemo(
    () => (calcInput !== null ? unregisteredAbbreviations(calcInput.model, calcInput.namingRules) : []), [calcInput])
  const unregisteredCount = candidates.length + abbrCandidates.length

  const onAddWord = () => { setEditingWord(null); setWordEditorOpen(true) }
  const onEditWord = (w: Word) => { setEditingWord(w); setWordEditorOpen(true) }
  const onRemoveWord = (id: string) => { void mutate((m) => removeWord(m, id), { summary: '단어 삭제' }) }

  const onAddTerm = () => { setEditingTerm(null); setTermEditorOpen(true) }
  const onEditTerm = (t: Term) => { setEditingTerm(t); setTermEditorOpen(true) }
  const onRemoveTerm = (id: string) => { void mutate((m) => removeTerm(m, id), { summary: '용어 삭제' }) }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>단어·용어 사전</DialogTitle></DialogHeader>
          <Tabs value={section} onValueChange={(value) => setSection(value as Section)}>
            <TabsList aria-label="사전 구역">
              <TabsTrigger value="words">단어 ({formatCount(words.length)})</TabsTrigger>
              <TabsTrigger value="terms">용어 ({formatCount(terms.length)})</TabsTrigger>
              <TabsTrigger value="unregistered">
                미등록 항목{unregisteredCount > 0 ? ` (${formatCount(unregisteredCount)})` : ''}
              </TabsTrigger>
              <TabsTrigger value="import">가져오기</TabsTrigger>
            </TabsList>

            <TabsContent value="words" className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  단어의 표준 약어를 등록해 물리명 자동 생성에 사용합니다
                </p>
                {canEdit && <Button size="sm" onClick={onAddWord}><Plus /> 단어 추가</Button>}
              </div>
              {words.length > 0 && (
                <Input aria-label="단어 검색" placeholder="논리명·약어·영문명 검색" value={wordList.query}
                  onChange={(e) => wordList.setQuery(e.target.value)} />
              )}
              <ul ref={wordListRef} className="grid max-h-96 gap-2 overflow-y-auto">
                {words.length === 0 && <p className="text-sm text-muted-foreground">아직 단어가 없습니다</p>}
                {words.length > 0 && wordList.view.total === 0 && (
                  <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
                )}
                {wordList.view.rows.map((w) => (
                  <DictRow key={w.id} logical={w.logicalName} physical={w.abbreviation}
                    usage={usage?.words.get(w.id)?.length ?? 0} canEdit={canEdit}
                    onEdit={() => onEditWord(w)} onRemove={() => onRemoveWord(w.id)} />
                ))}
              </ul>
              <Pagination label="단어" page={wordList.view.page} pageCount={wordList.view.pageCount}
                total={wordList.view.total} onPageChange={wordList.setPage} listRef={wordListRef} />
            </TabsContent>

            <TabsContent value="terms" className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  논리명 전체가 완전일치할 때 우선 적용되는 표준 물리명을 관리합니다
                </p>
                {canEdit && <Button size="sm" onClick={onAddTerm}><Plus /> 용어 추가</Button>}
              </div>
              {terms.length > 0 && (
                <Input aria-label="용어 검색" placeholder="논리명·물리명 검색" value={termList.query}
                  onChange={(e) => termList.setQuery(e.target.value)} />
              )}
              <ul ref={termListRef} className="grid max-h-96 gap-2 overflow-y-auto">
                {terms.length === 0 && <p className="text-sm text-muted-foreground">아직 용어가 없습니다</p>}
                {terms.length > 0 && termList.view.total === 0 && (
                  <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
                )}
                {termList.view.rows.map((t) => (
                  <DictRow key={t.id} logical={t.logicalName} physical={t.physicalName}
                    usage={usage?.terms.get(t.id)?.length ?? 0} canEdit={canEdit}
                    onEdit={() => onEditTerm(t)} onRemove={() => onRemoveTerm(t.id)} />
                ))}
              </ul>
              <Pagination label="용어" page={termList.view.page} pageCount={termList.view.pageCount}
                total={termList.view.total} onPageChange={termList.setPage} listRef={termListRef} />
            </TabsContent>

            <TabsContent value="unregistered" className="grid gap-3">
              <div className="flex gap-2">
                <Button
                  type="button" size="sm" variant={direction === 'toAbbr' ? 'default' : 'outline'}
                  onClick={() => setDirection('toAbbr')}
                >
                  논리명 → 약어{candidates.length > 0 ? ` (${formatCount(candidates.length)})` : ''}
                </Button>
                <Button
                  type="button" size="sm" variant={direction === 'toLogical' ? 'default' : 'outline'}
                  onClick={() => setDirection('toLogical')}
                >
                  물리명 → 논리명{abbrCandidates.length > 0 ? ` (${formatCount(abbrCandidates.length)})` : ''}
                </Button>
              </div>
              <UnregisteredSection
                projectId={projectId} canEdit={canEdit} direction={direction}
                candidates={direction === 'toAbbr' ? candidates : abbrCandidates}
              />
            </TabsContent>

            <TabsContent value="import">
              <DictImportSection projectId={projectId} />
            </TabsContent>
          </Tabs>
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
 * 미등록 항목 일괄 등록. 방향만 다르고 등록은 같은 createWord 다 —
 * toAbbr 는 논리명이 후보이고 약어를 받고, toLogical 은 그 반대다.
 * ⚠️ 두 방향을 각각의 컴포넌트로 두면 등록 규칙이 갈린다(그래서 합쳤다).
 */
function UnregisteredSection(
  { projectId, candidates, canEdit, direction }: {
    projectId: string; candidates: string[]; canEdit: boolean
    direction: 'toAbbr' | 'toLogical'
  },
) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const [valueByCandidate, setValueByCandidate] = useState<Record<string, string>>({})
  const toAbbr = direction === 'toAbbr'

  // 방향이 바뀌면 입력 중이던 값을 비운다 — 후보 집합이 통째로 다르다.
  useEffect(() => { setValueByCandidate({}) }, [direction])

  /**
   * 행별 등록 계획. ⚠️ **역방향은 사용자가 논리명을 직접 치므로 중복이 실제로 생긴다** —
   * 「미등록 목록에서 오므로 정의상 중복이 아니다」는 정방향에만 성립한다. 같은 논리명 단어가 둘이면
   * decomposeByWords 가 하나만 쓰고 나머지는 유령이 되므로, 사전 중복과 **배치 안 자기 충돌**을
   * 모두 걸러 낸다(앞선 행이 만든 이름을 누적하며 판정한다).
   */
  const seenLogical = new Set<string>()
  const rows = candidates.map((candidate) => {
    const typed = (valueByCandidate[candidate] ?? '').trim()
    const logicalName = toAbbr ? candidate : typed
    const abbreviation = toAbbr ? typed : candidate
    let reason: 'duplicate' | 'batch' | null = null
    if (typed !== '') {
      if (!canRegisterWord(model, { logicalName, abbreviation }).ok) reason = 'duplicate'
      else if (seenLogical.has(logicalName)) reason = 'batch'
      else seenLogical.add(logicalName)
    }
    return { candidate, typed, logicalName, abbreviation, reason }
  })

  const onBulkRegister = () => {
    // producer 진입 전에 등록 대상(후보 + 입력값 + 신규 id)을 모두 확정한 상수 배열로 캡처한다.
    const registrations = rows
      .filter((r) => r.typed !== '' && r.reason === null)
      .map((r) => ({ id: newId(), logicalName: r.logicalName, abbreviation: r.abbreviation }))
    if (registrations.length === 0) return
    void mutate(
      // 누적 모델로 한 번 더 판정한다 — 낙관적 체인에서 producer 가 받는 모델은 화면이 판정한
      // 모델과 다를 수 있다(그 사이 남이 같은 단어를 만들었을 수 있다).
      (m: ProjectModel) => registrations.reduce(
        (acc, r) => (canRegisterWord(acc, { logicalName: r.logicalName, abbreviation: r.abbreviation }).ok
          ? createWord(acc, {
              id: r.id, logicalName: r.logicalName, abbreviation: r.abbreviation,
              englishName: null, description: null, origin: null,
            })
          : acc),
        m,
      ),
      { summary: toAbbr ? '미등록 단어 일괄 등록' : '미등록 약어 일괄 등록' },
    )
    setValueByCandidate({})
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {toAbbr
          ? '테이블·컬럼 논리명 분해 중 사전에 없는 단어입니다. 약어를 입력한 항목만 일괄 등록됩니다'
          : '테이블·컬럼 물리명 분해 중 사전에 없는 약어입니다. 논리명을 입력한 항목만 일괄 등록됩니다'}
      </p>
      {candidates.length === 0
        ? (
            <p className="text-sm text-muted-foreground">
              {toAbbr ? '미등록 단어가 없습니다' : '미등록 약어가 없습니다'}
            </p>
          )
        : (
            <>
              <ul className="grid max-h-72 gap-2 overflow-y-auto">
                {rows.map(({ candidate, reason }) => (
                  <li key={candidate} className="flex items-center gap-2 rounded-md border p-2">
                    <span className={`flex-1 font-medium ${toAbbr ? '' : 'font-mono'}`}>{candidate}</span>
                    {reason && (
                      <span className="shrink-0 text-[11px] text-destructive">
                        {reason === 'duplicate' ? '사전에 이미 있습니다' : '위 항목과 겹칩니다'}
                      </span>
                    )}
                    {canEdit && (
                      <Input
                        aria-label={`${candidate} ${toAbbr ? '약어' : '논리명'}`}
                        placeholder={toAbbr ? '약어' : '논리명'}
                        className={`w-32 ${toAbbr ? 'font-mono' : ''}`}
                        value={valueByCandidate[candidate] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setValueByCandidate((prev) => ({ ...prev, [candidate]: value }))
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={onBulkRegister}><Plus /> 일괄 등록</Button>
                </div>
              )}
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
            <FieldLabel htmlFor="word-abbr" required>약어</FieldLabel>
            <Input
              id="word-abbr" className="font-mono" value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="word-logical" required>논리명</FieldLabel>
            <Input id="word-logical" value={logicalName} onChange={(e) => setLogicalName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="word-english">영문명</FieldLabel>
            <Input
              id="word-english" className="font-mono" value={englishName}
              onChange={(e) => setEnglishName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="word-desc">설명</FieldLabel>
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
            <FieldLabel htmlFor="term-physical" required>물리명</FieldLabel>
            <Input
              id="term-physical" className="font-mono" value={physicalName}
              onChange={(e) => setPhysicalName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="term-logical" required>논리명</FieldLabel>
            <Input id="term-logical" value={logicalName} onChange={(e) => setLogicalName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="term-domain">도메인</FieldLabel>
            <select
              id="term-domain" className="h-9 rounded-md border bg-background px-2 text-sm"
              value={domainId} onChange={(e) => setDomainId(e.target.value)}
            >
              <option value="">없음</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="term-desc">설명</FieldLabel>
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
            &quot;{term?.logicalName}&quot; 용어를 쓰는 {formatCount(pending?.plan.entries.length ?? 0)}곳을 함께 갱신할까요?
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
            {formatCount(pending?.plan.entries.length ?? 0)}곳에 반영
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

/** 사전 한 행 — 논리명 | 물리명 | 사용 수를 한 줄에 나란히 보인다. */
function DictRow({ logical, physical, usage, canEdit, onEdit, onRemove }: {
  logical: string
  physical: string
  usage: number
  canEdit: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2">
      <span className="truncate font-medium">{logical}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">{physical}</span>
      <div className="flex shrink-0 items-center gap-2">
        {usage > 0 && <span className="text-xs text-muted-foreground">사용처 {formatCount(usage)}개</span>}
        {canEdit && (
          <>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`${logical} 편집`} onClick={onEdit}>
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7 text-destructive"
              aria-label={`${logical} 삭제`} onClick={onRemove}>
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
