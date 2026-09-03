import { describe, expect, it } from 'vitest'
import {
  LOCAL_DISCARD_PATH, LOCAL_EVENTS_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, parseLocalEvent,
} from './local-protocol.js'

describe('parseLocalEvent', () => {
  it('reload·blocked·status 를 그대로 되살린다', () => {
    expect(parseLocalEvent(JSON.stringify({ type: 'reload' }))).toEqual({ type: 'reload' })
    expect(parseLocalEvent(JSON.stringify({
      type: 'blocked', failures: [{ path: 'erdd/', message: '깨졌다' }],
    }))).toEqual({ type: 'blocked', failures: [{ path: 'erdd/', message: '깨졌다' }] })
    expect(parseLocalEvent(JSON.stringify({ type: 'status', dirty: true, external: false })))
      .toEqual({ type: 'status', dirty: true, external: false })
  })

  /**
   * ⚠️ 모르는 type 에 null 을 돌려주는 것이 **옛 웹이 새 이벤트를 만나도 죽지 않게** 하는 자리다.
   * 설치본의 웹 번들은 CLI 버전과 따로 움직인다(패키지에 동봉된 것과 저장소 빌드가 다를 수 있다).
   */
  it('모르는 type·깨진 JSON·형식 위반은 null 이다', () => {
    expect(parseLocalEvent(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseLocalEvent('{')).toBeNull()
    expect(parseLocalEvent(JSON.stringify({ type: 'status', dirty: 'yes', external: false }))).toBeNull()
    expect(parseLocalEvent(JSON.stringify({ type: 'blocked' }))).toBeNull()
    expect(parseLocalEvent(JSON.stringify({ type: 'blocked', failures: [{ path: 1, message: 'x' }] }))).toBeNull()
    expect(parseLocalEvent(JSON.stringify(['reload']))).toBeNull()
  })

  it('경로 상수는 /local/ 아래에 있다', () => {
    expect(LOCAL_EVENTS_PATH).toBe('/local/events')
    expect(LOCAL_SAVE_PATH).toBe('/local/save')
    expect(LOCAL_DISCARD_PATH).toBe('/local/discard')
    expect(LOCAL_KEEP_PATH).toBe('/local/keep')
  })
})
