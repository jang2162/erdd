import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 초대·재설정 링크는 토큰을 **페이지 경로에** 담는다(`/invite/:token`). 기본 정책
 * `strict-origin-when-cross-origin` 아래에서 이 문서가 보내는 동일 출처 요청에는 전체 URL이
 * `Referer`로 붙으므로, nginx 표준 combined 로그의 `$http_referer`에 `/trpc` 요청 한 줄마다
 * 평문 토큰이 함께 남는다 — `peek`을 mutation으로 둔 조치(설계 §3.5)가 절반 무력화된다.
 *
 * jsdom은 fetch에 `Referer`를 세팅하지 않아 **헤더 자체는 테스트로 재현할 수 없다.**
 * 태그가 사라지는 것만 여기서 잡고, 실제 헤더는 브라우저 스모크에서 확인한다.
 */
describe('index.html', () => {
  it('turns the referrer off for the whole document', () => {
    const html = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8')
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/)
  })
})
