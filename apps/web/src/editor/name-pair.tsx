import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  generatePhysicalName, restoreLogicalName, suggestCompletions,
  type Completion, type ProjectModel,
} from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { canRegisterWord, createWord } from './dict-edits.js'
import { newId } from './uid.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/field-label'

export type NamePatch = { logicalName?: string; physicalName?: string }
/** 아직 커밋되지 않은 두 이름. `extra` 슬롯이 이 값으로 판정하고 이 값을 넘겨야 한다. */
export type NameDraft = { logicalName: string; physicalName: string }

/**
 * 논리명·물리명을 **쌍으로** 쥐는 컨테이너.
 *
 * ⚠️ 두 draft 를 한 곳에 두는 것이 이 컴포넌트의 존재 이유다 — ↻ 버튼은 *반대편 필드의 아직
 * 커밋되지 않은 값*을 기준으로 삼아야 맞는데, draft 가 각 필드 안에만 있으면 그 값에 닿을 수 없다.
 * **이월 결함(「버튼이 blur 커밋 전 값을 읽는다」)을 실제로 닫는 것이 이 draft 다.** 옛 코드는
 * 비제어 인풋이라 친 값이 React 상태 어디에도 없어 버튼이 모델의 커밋된 값밖에 못 봤다.
 * 실증: regenerate 가 draft 대신 props 의 커밋된 값을 읽게 바꾸면 「방금 친 값」이 빨개진다.
 *
 * ⚠️ 버튼의 onMouseDown preventDefault 가 막는 것은 **포커스 이탈뿐이다. 뮤테이션 수와 무관하다.**
 * blur 는 실제로 발화하고 `commitSide` 까지 도달한다 — **값-동일 조기 반환은 걸리지 않는다.**
 * `onBlur` 콜백은 자기가 만들어진 렌더의 props 를 쥐고 있어 `current` 가 옛 값이기 때문이다
 * (계측: `commitSide side=logical value="회원주문번호" current="회원" skip=false`).
 * 실제로 막는 것은 **`use-model` 의 `ops.length === 0 → noop` 하나뿐이다** — `regenerate` 가 반대편
 * draft 를 같은 patch 에 접어 넣어 모델이 이미 그 값이 된 뒤에 blur 커밋이 도착하므로 diff 가 비어
 * 있다. 실증: 이 줄들을 지워도 web 전건이 통과하고, 빨개지는 것은 「포커스 유지」 케이스뿐이다.
 *
 * mutate 를 이 컴포넌트가 소유하는 이유: 단어 인라인 등록과 이름 갱신을 **한 producer** 로
 * 합성해야 하기 때문이다. 대상이 테이블인지 컬럼인지는 applyNames 가 안다.
 */
export function NamePair(props: {
  projectId: string
  logicalName: string
  physicalName: string
  idPrefix: string
  physicalLabel: string
  canEdit: boolean
  applyNames: (m: ProjectModel, patch: NamePatch) => ProjectModel
  /**
   * 두 입력란 아래에 붙는 슬롯(컬럼의 「용어 등록」). **렌더 prop 이다** — 그 버튼도 "치고 바로
   * 옆 버튼"이 주 동선이라 ↻ 와 같은 대우가 필요한데, 고정 ReactNode 로 받으면 컨테이너의 draft 에
   * 닿을 수 없어 커밋된 옛 값을 읽게 된다(설계 §3.2 가 지목한 "등록 버튼"이 이것이다).
   */
  extra?: (draft: NameDraft) => ReactNode
}) {
  const { logicalName, physicalName, canEdit, applyNames } = props
  const namingRules = useEditorStore((s) => s.namingRules)
  const words = useEditorStore((s) => s.model.words)
  const terms = useEditorStore((s) => s.model.terms)
  const mutate = useModelMutation(props.projectId)
  const [draft, setDraft] = useState({ logicalName, physicalName })

  /**
   * 모델 값이 바뀌면 draft 를 맞춘다 — 낙관적 반영·undo·남의 편집이 전부 이 경로로 온다.
   *
   * ⚠️ **실제로 바뀐 쪽만 덮는다.** 두 값을 통째로 `setDraft` 하면 한쪽만 원격으로 바뀌어도
   * 반대쪽의 **커밋되지 않은 타이핑이 모델 값으로 되돌아간다**(실시간 협업·undo·인라인 단어 등록의
   * 반대편 채움이 전부 그 경로다). "값이 같으면 no-op" 은 두 필드가 **함께** 바뀔 때만 성립한다.
   */
  const prevNames = useRef({ logicalName, physicalName })
  useEffect(() => {
    setDraft((d) => ({
      logicalName: logicalName !== prevNames.current.logicalName ? logicalName : d.logicalName,
      physicalName: physicalName !== prevNames.current.physicalName ? physicalName : d.physicalName,
    }))
    prevNames.current = { logicalName, physicalName }
  }, [logicalName, physicalName])

  const commit = (patch: NamePatch, summary: string) => {
    if (Object.keys(patch).length === 0) return
    void mutate((m) => applyNames(m, patch), { summary })
  }

  /** 한쪽을 커밋한다. 반대쪽이 비어 있으면 기존 정책대로 함께 채운다(버튼만 덮어쓴다). */
  const commitSide = (side: 'logical' | 'physical', value: string) => {
    const current = side === 'logical' ? logicalName : physicalName
    if (value === current) return
    const patch: NamePatch = side === 'logical' ? { logicalName: value } : { physicalName: value }
    if (side === 'physical' && draft.logicalName.trim() === '' && value.trim() !== '') {
      const r = restoreLogicalName(value, words, terms, namingRules)
      if (r.ok) patch.logicalName = r.logicalName
    }
    if (side === 'logical' && draft.physicalName.trim() === '' && value.trim() !== '') {
      const gen = generatePhysicalName(value, words, terms, namingRules)
      if (gen.physicalName) patch.physicalName = gen.physicalName
    }
    setDraft((d) => ({ ...d, ...patch }))
    commit(patch, side === 'logical' ? '논리명 변경' : '물리명 변경')
  }

  /** ↻ — 자기 필드를 반대편 draft 기준으로 다시 만든다. 덮어쓴다. */
  const regenerate = (side: 'logical' | 'physical') => {
    const patch: NamePatch = {}
    if (side === 'physical') {
      const gen = generatePhysicalName(draft.logicalName, words, terms, namingRules)
      if (!gen.physicalName) {
        toast.error(gen.unknownWords.length > 0
          ? `사전에 없는 단어: ${gen.unknownWords.join(', ')}`
          : '논리명이 비어 있어 물리명을 만들 수 없습니다')
        return
      }
      if (gen.physicalName !== physicalName) patch.physicalName = gen.physicalName
    } else {
      const r = restoreLogicalName(draft.physicalName, words, terms, namingRules)
      if (!r.ok) {
        toast.error(r.unknownTokens.length > 0
          ? `등록되지 않은 약어: ${r.unknownTokens.join(', ')}`
          : '물리명이 비어 있어 논리명을 만들 수 없습니다')
        return
      }
      if (r.logicalName !== logicalName) patch.logicalName = r.logicalName
    }
    // 아직 커밋되지 않은 반대편 draft 도 함께 확정한다 — 안 그러면 다음 blur 가 뮤테이션을 하나 더 낸다.
    // 유니온 키로 patch[other] 에 쓰면 TS 가 거부하므로 분기로 적는다.
    if (side === 'physical') {
      if (draft.logicalName !== logicalName) patch.logicalName = draft.logicalName
    } else if (draft.physicalName !== physicalName) {
      patch.physicalName = draft.physicalName
    }
    setDraft((d) => ({ ...d, ...patch }))
    commit(patch, side === 'physical' ? '물리명 재생성' : '논리명 재생성')
  }

  /**
   * 미등록 구간을 단어로 등록한다. 등록과 "반대편이 비어 있으면 채우기"를 **한 producer** 로 묶어
   * Revision 1건 · undo 1회로 만든다.
   * ⚠️ 자동 생성은 next.words(방금 등록한 단어가 든 모델)로 계산해야 한다.
   */
  const registerWord = (logical: string, abbreviation: string) => {
    const id = newId()
    const draftLogical = draft.logicalName
    const draftPhysical = draft.physicalName
    void mutate((m) => {
      const next = createWord(m, {
        id, logicalName: logical.trim(), abbreviation: abbreviation.trim(),
        englishName: null, description: null, origin: null,
      })
      const patch: NamePatch = {}
      if (draftPhysical.trim() === '' && draftLogical.trim() !== '') {
        const gen = generatePhysicalName(draftLogical, next.words, next.terms, namingRules)
        if (gen.physicalName) patch.physicalName = gen.physicalName
      } else if (draftLogical.trim() === '' && draftPhysical.trim() !== '') {
        const r = restoreLogicalName(draftPhysical, next.words, next.terms, namingRules)
        if (r.ok) patch.logicalName = r.logicalName
      }
      return Object.keys(patch).length > 0 ? applyNames(next, patch) : next
    }, { summary: '단어 등록' })
  }

  return (
    <div className="grid gap-3">
      <NameField
        side="physical" label={props.physicalLabel} id={`${props.idPrefix}-physical`}
        value={draft.physicalName} committed={physicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, physicalName: v }))}
        onCommit={(v) => commitSide('physical', v)}
        onRegenerate={() => regenerate('physical')}
        onRegisterWord={registerWord}
      />
      <NameField
        side="logical" label="논리명" id={`${props.idPrefix}-logical`}
        value={draft.logicalName} committed={logicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, logicalName: v }))}
        onCommit={(v) => commitSide('logical', v)}
        onRegenerate={() => regenerate('logical')}
        onRegisterWord={registerWord}
      />
      {props.extra?.(draft)}
    </div>
  )
}

function NameField(props: {
  side: 'logical' | 'physical'
  label: string
  id: string
  value: string
  /** 모델에 커밋된 값. 미등록 칩은 이것으로만 계산한다(draft 면 타이핑 중 깜박인다). */
  committed: string
  canEdit: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onRegenerate: () => void
  onRegisterWord: (logical: string, abbreviation: string) => void
}) {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const words = useEditorStore((s) => s.model.words)
  const terms = useEditorStore((s) => s.model.terms)
  const [focused, setFocused] = useState(false)
  const [openChip, setOpenChip] = useState<string | null>(null)
  const [chipValue, setChipValue] = useState('')
  // 확정·Esc 로 닫은 상태. 다음 타이핑에서 풀린다.
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current) }, [])

  const completions = useMemo(
    () => (props.canEdit
      ? suggestCompletions(props.value, props.side, words, terms, namingRules)
      : { query: '', items: [] as Completion[] }),
    [props.value, props.side, props.canEdit, words, terms, namingRules],
  )
  const open = focused && !dismissed && completions.items.length > 0
  // ⚠️ query 만 보면 안 된다 — 용어만 나오는 구간은 query 가 '' 로 고정이라, 사전이 바뀌어 항목이
  // 줄어들어도 활성 인덱스가 그대로 남아 범위를 벗어나고 Enter 가 아무 일도 하지 않는다.
  const itemsKey = completions.items.map((i) => `${i.kind}:${i.insert}`).join('|')
  useEffect(() => { setActive(0) }, [completions.query, itemsKey])

  const apply = (item: Completion) => {
    props.onChange(props.value.slice(0, item.start) + item.insert)
    setDismissed(true)      // 확정하면 닫는다. 다음 글자를 치면 다시 열린다.
  }

  // ⚠️ draft 가 아니라 committed 로 계산한다 — draft 로 하면 타이핑 중 꼬리가 늘 미등록이라 깜박인다.
  const chips = useMemo(() => {
    if (!props.canEdit || props.committed.trim() === '') return []
    if (props.side === 'logical') {
      return generatePhysicalName(props.committed, words, terms, namingRules).unknownWords
    }
    const r = restoreLogicalName(props.committed, words, terms, namingRules)
    return r.ok ? [] : r.unknownTokens
  }, [props.canEdit, props.committed, props.side, words, terms, namingRules])

  // 사전이 바뀌어 칩이 사라지면 펼친 폼도 닫는다.
  useEffect(() => {
    if (openChip !== null && !chips.includes(openChip)) { setOpenChip(null); setChipValue('') }
  }, [chips, openChip])

  const check = openChip === null
    ? null
    : canRegisterWord(model, props.side === 'logical'
      ? { logicalName: openChip, abbreviation: chipValue }
      : { logicalName: chipValue, abbreviation: openChip })

  const regenerateLabel = props.side === 'physical' ? '물리명 재생성' : '논리명 재생성'
  const listId = `${props.id}-completions`

  return (
    <div className="grid gap-1.5">
      <FieldLabel htmlFor={props.id} required>{props.label}</FieldLabel>
      <div className="relative">
        <Input
          id={props.id}
          aria-label={props.label}
          // ⚠️ 읽기 전용에서는 combobox 로 노출하지 않는다 — 목록이 canEdit 로 막혀 있어
          // 스크린리더가 "펼칠 수 있다"고 읽어도 절대 열리지 않는다.
          role={props.canEdit ? 'combobox' : undefined}
          aria-expanded={props.canEdit ? open : undefined}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={props.value}
          readOnly={!props.canEdit}
          className={props.side === 'physical' ? 'pr-9 font-mono' : 'pr-9'}
          onFocus={() => setFocused(true)}
          onChange={(e) => { setDismissed(false); props.onChange(e.target.value) }}
          onBlur={(e) => {
            const value = e.target.value
            // 목록 항목을 누른 경우 mousedown 의 preventDefault 로 blur 가 오지 않는다.
            // 그래도 방어로 한 틱 미뤄 확정이 먼저 반영되게 한다.
            if (blurTimer.current) clearTimeout(blurTimer.current)
            blurTimer.current = setTimeout(() => { setFocused(false); props.onCommit(value) }, 0)
          }}
          onKeyDown={(e) => {
            if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              const delta = e.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i + delta + completions.items.length) % completions.items.length)
              return
            }
            if (open && e.key === 'Enter') {
              // 목록이 열려 있는 동안 Enter 는 확정 전용이다 — 커밋으로 내려가지 않는다.
              e.preventDefault()
              const item = completions.items[active]
              if (item) apply(item)
              return
            }
            if (open && e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()     // 상위(다이얼로그·캔버스)로 새면 안 된다
              setDismissed(true)
              return
            }
            if (e.key === 'Enter') { e.preventDefault(); props.onCommit(props.value) }
          }}
        />
        {props.canEdit && (
          <Button
            type="button" size="icon" variant="ghost"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label={regenerateLabel}
            // ⚠️ 포커스를 뺏지 않는다 — 커서가 입력란에 남아 이어서 칠 수 있다.
            // 「↻ 를 눌러도 포커스가 입력란에 남는다」가 이 줄을 잠근다(뮤테이션 수와는 무관하다).
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onRegenerate}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
        {open && (
          <ul
            id={listId} role="listbox"
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {completions.items.map((item, i) => (
              <li
                key={`${item.kind}-${item.insert}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-sm ${
                  i === active ? 'bg-accent' : ''
                }`}
                onMouseDown={(e) => e.preventDefault()}   // blur 로 목록이 닫히기 전에 클릭이 온다
                onClick={() => apply(item)}
              >
                <span className={props.side === 'physical' ? 'font-mono' : undefined}>{item.insert}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.kind === 'term' ? `용어 · ${item.hint}` : item.hint}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">미등록</span>
          {chips.map((chip) => (
            <Button
              key={chip} type="button" size="sm" variant="outline"
              className="h-6 gap-0.5 px-1.5 text-[11px]"
              aria-label={`${chip} 등록`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpenChip((cur) => (cur === chip ? null : chip))
                setChipValue('')
              }}
            >
              <Plus className="size-3" />
              <span className={props.side === 'physical' ? 'font-mono' : undefined}>{chip}</span>
            </Button>
          ))}
        </div>
      )}
      {openChip !== null && (
        <div className="grid gap-1 rounded-md border p-2">
          <span className="text-xs font-medium">{openChip}</span>
          <div className="flex items-center gap-1">
            <Input
              aria-label={`${openChip} ${props.side === 'logical' ? '약어' : '논리명'}`}
              placeholder={props.side === 'logical' ? '약어' : '논리명'}
              className={props.side === 'logical' ? 'h-8 font-mono' : 'h-8'}
              value={chipValue}
              onChange={(e) => setChipValue(e.target.value)}
            />
            <Button
              type="button" size="sm" className="h-8 shrink-0"
              disabled={!check?.ok}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const target = openChip
                const value = chipValue
                setOpenChip(null)
                setChipValue('')
                if (props.side === 'logical') props.onRegisterWord(target, value)
                else props.onRegisterWord(value, target)
              }}
            >
              단어 등록
            </Button>
          </div>
          {check?.abbrClash && (
            <span className="text-[11px] text-muted-foreground">이미 쓰는 약어입니다</span>
          )}
          {check?.reason === 'duplicate' && (
            <span className="text-[11px] text-destructive">사전에 이미 있는 이름입니다</span>
          )}
        </div>
      )}
    </div>
  )
}
