import { act } from '@testing-library/react'

/**
 * 테스트용: mutate가 서버까지 나갈 것을 **다 내보낸다.**
 *
 * "op가 하나도 안 나갔다" / "정확히 n건 나갔다"를 단언하기 전에 반드시 거쳐야 한다.
 * mutate는 직렬화 체인 → 낙관적 적용 → 배치 링크의 자체 스케줄러 → fetch 순으로 흐르므로,
 * 태스크 한 틱만 밀면 fetch가 아직 안 나가서 **op가 실제로 나갔는데도 통과한다**
 * (실측: 한 틱 버전으로 같은 describe를 3회 돌려 1회 누수). 여러 틱 밀어 확정시킨다.
 *
 * `waitFor(() => expect(calls).toHaveLength(n))`은 **"최소 n건"** 밖에 못 본다 — 0→1→2로 가는 도중
 * n인 순간을 잡고 통과한다. "op 1건 = undo 1회" 계약은 그 느슨함 때문에 두 번 미봉인이었다.
 * 여기 두는 이유: 드래그 경로와 일괄 패널 경로가 **같은 계약**을 잠그므로 헬퍼가 갈리면 안 된다.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => { setTimeout(r, 0) }) })
  }
}
