import { RESOURCE_KIND_LABEL, type PromoteEntry, type PromoteStatus } from '@erdd/core'
import { danglingDomain } from '@/lib/promote-selection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const SECTIONS: { status: PromoteStatus; title: string }[] = [
  { status: 'new', title: '신규 추가' },
  { status: 'update', title: '원본 갱신' },
  { status: 'name-match', title: '동명 발견' },
]

function EntryLabel({ entry }: { entry: PromoteEntry }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
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
 * 계획은 거기서 서버가 계산해 내려준다.
 */
export function PromoteEntryList({
  entries, selected, onToggle, onSetAll, syncedCount,
}: {
  entries: readonly PromoteEntry[]
  selected: ReadonlySet<string>
  onToggle: (entityId: string, on: boolean) => void
  onSetAll: (status: PromoteStatus, on: boolean) => void
  /** 승격 탭에서만 넘긴다(승인 화면에는 의미가 없다). */
  syncedCount?: number
}) {
  return (
    <>
      {SECTIONS.map(({ status, title }) => {
        const rows = entries.filter((entry) => entry.status === status)
        return (
          <section key={status} className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{title} ({rows.length})</h4>
              {rows.length > 0 && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onSetAll(status, true)}>
                    모두 선택
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onSetAll(status, false)}>
                    모두 해제
                  </Button>
                </span>
              )}
            </div>
            {status === 'name-match' && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의
                값으로 갱신하고 연결합니다.
              </p>
            )}
            <ul className="grid gap-1">
              {rows.map((entry) => (
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
                      원본이 더 새롭습니다 — 먼저 가져오기(재동기화)로 받으세요
                    </Badge>
                  )}
                  {selected.has(entry.entityId) && danglingDomain(entry, selected) && (
                    <Badge variant="outline" className="shrink-0">도메인 연결 비움</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {syncedCount !== undefined && (
        <section className="grid gap-1 text-xs text-muted-foreground">
          <h4 className="text-sm font-semibold text-foreground">유지</h4>
          <span>이미 이 라이브러리와 같은 항목 {syncedCount}건</span>
        </section>
      )}
    </>
  )
}
