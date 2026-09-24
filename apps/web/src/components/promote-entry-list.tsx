import { useMemo } from 'react'
import {
  RESOURCE_KIND_LABEL, danglingDomain, resourceSecondaryName, type PromoteEntry, type PromoteStatus,
} from '@erdd/core'
import { formatCount } from '@/lib/format'
import { PagedSection } from '@/components/paged-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const SECTIONS: { status: PromoteStatus; title: string }[] = [
  { status: 'new', title: '신규 추가' },
  { status: 'update', title: '원본 갱신' },
  { status: 'name-match', title: '동명 발견' },
]

/**
 * 원본이 앞선 항목(`sourceBehind`)의 배지 문구 — 화면마다 할 수 있는 행동이 달라 여기서 한 번에 고른다.
 * 요청자·직접 승격자는 재동기화로 받을 수 있지만, 승인자는 요청 프로젝트를 재동기화할 수 없다.
 * 승인자 문구는 「언제」 앞섰는지 말하지 않는다 — `sourceBehind` 는 승인 시점의 프로젝트 origin 과
 * 원본 버전의 비교라, 요청자가 배지를 무시하고 직접 켠(요청 당시 이미 뒤처진) 항목에도 붙는다.
 */
const SOURCE_BEHIND_NOTICE = {
  promote: '원본이 더 새롭습니다 — 먼저 가져오기(재동기화)로 받으세요',
  approve: '원본이 요청자가 받은 버전보다 새롭습니다 — 승인하면 최신 원본을 요청자의 값으로 되돌립니다',
} as const

/**
 * 구역 검색 칸 — 논리명 칸과 물리명 칸. 물리명은 계획에 이미 실린 payload(프로젝트 엔티티를 라이브러리 공간으로
 * 투영한 값 — 단어 약어·용어 물리명은 투영에서 바뀌지 않는다)에서 읽는다. 조직 승인 화면에는 모델 store 가 없다.
 */
const ENTRY_FIELDS = (entry: PromoteEntry) => [entry.name, resourceSecondaryName(entry.kind, entry.payload)]

function EntryLabel({ entry }: { entry: PromoteEntry }) {
  const physical = resourceSecondaryName(entry.kind, entry.payload)
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
        {physical !== null && <span className="font-mono text-xs text-muted-foreground">{physical}</span>}
      </span>
      {entry.targetVersion !== null && (
        <span className="text-xs text-muted-foreground">
          v{entry.targetVersion} → v{entry.targetVersion + 1}
          {entry.changedFields.length > 0 && ` · ${entry.changedFields.join(', ')}`}
        </span>
      )}
    </span>
  )
}

/**
 * 승격 계획의 3구역 목록. 승격 탭(프로젝트)과 승인 다이얼로그(조직)가 함께 쓴다.
 *
 * **에디터 store를 참조하지 않는다** — 조직 화면에는 프로젝트 모델 store가 없고,
 * 계획은 거기서 서버가 계산해 내려준다. 구역마다 검색·50건 페이지가 있고 선택(`selected`)은 부모가 구역 전체에
 * 대해 들고 있다 — 쪽을 넘겨도 체크가 남고 「모두 선택/해제」는 구역 전체에 적용된다.
 */
export function PromoteEntryList({
  audience, entries, selected, onToggle, onSetAll, syncedCount,
}: {
  /** 승격 탭(`promote`)인지 조직 승인 다이얼로그(`approve`)인지 — 배지 문구를 고른다. */
  audience: keyof typeof SOURCE_BEHIND_NOTICE
  entries: readonly PromoteEntry[]
  selected: ReadonlySet<string>
  onToggle: (entityId: string, on: boolean) => void
  onSetAll: (status: PromoteStatus, on: boolean) => void
  /** 승격 탭에서만 넘긴다(승인 화면에는 의미가 없다). */
  syncedCount?: number
}) {
  const byStatus = useMemo(
    () => new Map(SECTIONS.map(({ status }) => [status, entries.filter((entry) => entry.status === status)])),
    [entries],
  )
  const row = (entry: PromoteEntry) => (
    <li key={entry.entityId}
      className="flex items-center justify-between gap-2 rounded border px-2 py-1">
      <label className="flex flex-1 items-center gap-2">
        <input type="checkbox" aria-label={`${entry.name} 선택`}
          checked={selected.has(entry.entityId)}
          onChange={(e) => onToggle(entry.entityId, e.target.checked)} />
        <EntryLabel entry={entry} />
      </label>
      {/* 문장이 길어 좁은 패널에서 잘리지 않게 줄바꿈을 허용한다. */}
      {entry.sourceBehind && (
        <Badge variant="outline" className="max-w-[60%] shrink whitespace-normal">
          {SOURCE_BEHIND_NOTICE[audience]}
        </Badge>
      )}
      {selected.has(entry.entityId) && danglingDomain(entry, selected) && (
        <Badge variant="outline" className="shrink-0">도메인 연결 비움</Badge>
      )}
    </li>
  )

  return (
    <>
      {SECTIONS.map(({ status, title }) => {
        const rows = byStatus.get(status) ?? []
        return (
          <PagedSection key={status} title={title} rows={rows} fields={ENTRY_FIELDS} renderRow={row}
            actions={(
              <>
                <Button size="sm" variant="ghost" onClick={() => onSetAll(status, true)}>모두 선택</Button>
                <Button size="sm" variant="ghost" onClick={() => onSetAll(status, false)}>모두 해제</Button>
              </>
            )}>
            {status === 'name-match' && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의
                값으로 갱신하고 연결합니다.
              </p>
            )}
          </PagedSection>
        )
      })}

      {syncedCount !== undefined && (
        <section className="grid gap-1 text-xs text-muted-foreground">
          <h4 className="text-sm font-semibold text-foreground">유지</h4>
          <span>이미 이 라이브러리와 같은 항목 {formatCount(syncedCount)}건</span>
        </section>
      )}
    </>
  )
}
