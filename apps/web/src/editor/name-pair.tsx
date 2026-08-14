import { useEffect, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { generatePhysicalName, restoreLogicalName, type ProjectModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/field-label'

export type NamePatch = { logicalName?: string; physicalName?: string }

/**
 * 논리명·물리명을 **쌍으로** 쥐는 컨테이너.
 *
 * ⚠️ 두 draft 를 한 곳에 두는 것이 이 컴포넌트의 존재 이유다 — ↻ 버튼은 *반대편 필드의 아직
 * 커밋되지 않은 값*을 기준으로 삼아야 맞는데, draft 가 각 필드 안에만 있으면 그 값에 닿을 수 없다.
 * **이월 결함(「버튼이 blur 커밋 전 값을 읽는다」)을 실제로 닫는 것이 이 draft 다.** 옛 코드는
 * 비제어 인풋이라 친 값이 React 상태 어디에도 없어 버튼이 모델의 커밋된 값밖에 못 봤다.
 * 실증: regenerate 가 draft 대신 props 의 커밋된 값을 읽게 바꾸면 「방금 친 값」이 빨개진다.
 *
 * ⚠️ 버튼에는 onMouseDown 에서 preventDefault 를 건다. 없으면
 * `mousedown → blur(커밋 1건) → click(커밋 1건 더)` 로 **뮤테이션이 2건**이 되어 Revision 2건 ·
 * undo 2회가 된다(값 자체는 draft 덕에 맞게 나온다). 실증: 그 줄을 지우면 「재생성 한 번이
 * 뮤테이션 한 건이다」가 2건으로 빨개진다.
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
  extra?: ReactNode
}) {
  const { logicalName, physicalName, canEdit, applyNames } = props
  const namingRules = useEditorStore((s) => s.namingRules)
  const words = useEditorStore((s) => s.model.words)
  const terms = useEditorStore((s) => s.model.terms)
  const mutate = useModelMutation(props.projectId)
  const [draft, setDraft] = useState({ logicalName, physicalName })

  // 모델 값이 바뀌면 draft 를 맞춘다 — 낙관적 반영·undo·남의 편집이 전부 이 경로로 온다.
  // 값이 같으면 setState 가 no-op 이라 내가 방금 커밋한 값으로는 아무 일도 일어나지 않는다.
  useEffect(() => { setDraft({ logicalName, physicalName }) }, [logicalName, physicalName])

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

  return (
    <div className="grid gap-3">
      <NameField
        side="physical" label={props.physicalLabel} id={`${props.idPrefix}-physical`}
        value={draft.physicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, physicalName: v }))}
        onCommit={(v) => commitSide('physical', v)}
        onRegenerate={() => regenerate('physical')}
      />
      <NameField
        side="logical" label="논리명" id={`${props.idPrefix}-logical`}
        value={draft.logicalName} canEdit={canEdit}
        onChange={(v) => setDraft((d) => ({ ...d, logicalName: v }))}
        onCommit={(v) => commitSide('logical', v)}
        onRegenerate={() => regenerate('logical')}
      />
      {props.extra}
    </div>
  )
}

function NameField(props: {
  side: 'logical' | 'physical'
  label: string
  id: string
  value: string
  canEdit: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onRegenerate: () => void
}) {
  const regenerateLabel = props.side === 'physical' ? '물리명 재생성' : '논리명 재생성'
  return (
    <div className="grid gap-1.5">
      <FieldLabel htmlFor={props.id} required>{props.label}</FieldLabel>
      <div className="relative">
        <Input
          id={props.id}
          aria-label={props.label}
          value={props.value}
          readOnly={!props.canEdit}
          className={props.side === 'physical' ? 'pr-9 font-mono' : 'pr-9'}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={(e) => props.onCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); props.onCommit(props.value) }
          }}
        />
        {props.canEdit && (
          <Button
            type="button" size="icon" variant="ghost"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label={regenerateLabel}
            // ⚠️ 포커스를 뺏지 않는다 — blur 가 먼저 커밋을 내면 ↻ 의 커밋과 합쳐 뮤테이션이 2건이 된다
            // (Revision 2건 · undo 2회). 「재생성 한 번이 뮤테이션 한 건이다」가 이 줄을 잠근다.
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onRegenerate}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
