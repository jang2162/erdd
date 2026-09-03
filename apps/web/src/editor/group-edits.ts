import { createGroup, nextGroupColor, setTableGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { clearTableGroupPosition } from './model-edits.js'
import { newId } from './uid.js'
import type { Mutate } from './use-model.js'

/**
 * 새 그룹을 만들고 주어진 테이블을 그 그룹에 넣는다. `tableIds`가 비면 빈 그룹이다
 * (좌측 사이드바 「그룹 추가」가 그 경로다).
 *
 * **"새 그룹 하나 만들기"의 규칙이 전부 여기 있다** — 권한·미사용 최소 번호·다음 색·그룹 뷰 좌표
 * 비움. 진입점이 둘이므로(우측 일괄 패널·좌측 사이드바) 호출자에 두면 같은 사용자 의도가 진입점에
 * 따라 다르게 끝난다. `applyGroupMove`(bulk-panel.tsx)와 같은 형태다.
 *
 * ⚠️ **좌표는 건드리지 않는다.** `planGroupMove`는 *대상 그룹의 기존 멤버* bbox를 기준으로 삼는데
 * 새 그룹에는 기존 멤버가 없어 정의상 빈 배열을 낸다. 부르지 않는 편이 "제자리가 의도"임이
 * 드러나고 컬럼 전수 스캔도 돌지 않는다.
 *
 * 반환값은 새 그룹 id — 권한이 없으면 null. **선택은 건드리지 않는다**(호출자가 `selectGroup`을
 * 부른다). `applyGroupMove`와 마찬가지로 이 함수는 모델만 바꾼다.
 */
export function createGroupWith(mutate: Mutate, tableIds: readonly string[]): string | null {
  // 권한 판정은 여기 한 곳이다. useSubmit도 canEdit을 막지만 그쪽은 **토스트를 띄운다** —
  // 사용자가 하지도 않은 편집으로 에러를 보게 된다.
  if (!useEditorStore.getState().canEdit) return null
  // id는 producer 밖에서 발급한다 — 반환해야 하는 값이기 때문이다.
  const id = newId()
  void mutate((m) => {
    // 이름·색은 **producer가 받은 모델**에서 계산한다. store 스냅샷을 쓰면 낙관적 체인에서 앞선
    // 뮤테이션이 만든 그룹을 못 보고 이름·색이 겹친다.
    const groups = Object.values(m.tableGroups)
    const usedNames = new Set(groups.map((g) => g.name))
    // 개수 기반이 아니라 미사용 최소 번호를 찾는다(삭제 후 재추가 시 이름 충돌 방지).
    let n = 1
    while (usedNames.has(`그룹${n}`)) n++
    let next = createGroup(m, {
      id, name: `그룹${n}`, color: nextGroupColor(groups.map((g) => g.color)),
    })
    for (const tid of tableIds) {
      next = setTableGroup(next, tid, id)
      // 옛 그룹 뷰 좌표를 남기면 새 그룹의 그룹 뷰에서 멤버가 갈라진다 — 옛 그룹에 있던 것은 옛
      // 좌표, 미분류였던 것은 폴백 좌표에 선다. 전원 비워야 모두 전체 뷰 좌표로 폴백해 나란히 선다.
      next = clearTableGroupPosition(next, tid)
    }
    return next
  }, { summary: tableIds.length === 0 ? '그룹 추가' : `그룹 추가 (테이블 ${tableIds.length}개)` })
  return id
}
