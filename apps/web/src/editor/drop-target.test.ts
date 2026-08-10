import { afterEach, describe, expect, it } from 'vitest'
import { dropAttrValue, dropTargetOf } from './drop-target.js'

afterEach(() => { document.body.innerHTML = '' })

describe('dropTargetOf', () => {
  it('그룹 블록 안의 자손에서 그룹 id를 찾는다', () => {
    document.body.innerHTML = '<div data-drop-group="g1"><ul><li id="x">MBR</li></ul></div>'
    expect(dropTargetOf(document.getElementById('x'))).toEqual({ groupId: 'g1' })
  })

  it('unassigned는 groupId null로 푼다', () => {
    document.body.innerHTML = '<div data-drop-group="unassigned"><span id="y">t</span></div>'
    expect(dropTargetOf(document.getElementById('y'))).toEqual({ groupId: null })
  })

  it('타깃 밖이면 null이다', () => {
    document.body.innerHTML = '<div><span id="z">t</span></div>'
    expect(dropTargetOf(document.getElementById('z'))).toBeNull()
  })

  it('null 엘리먼트면 null이다', () => {
    expect(dropTargetOf(null)).toBeNull()
  })

  it('중첩되면 가장 가까운 타깃을 고른다', () => {
    document.body.innerHTML = '<div data-drop-group="g1"><div data-drop-group="g2"><i id="w"></i></div></div>'
    expect(dropTargetOf(document.getElementById('w'))).toEqual({ groupId: 'g2' })
  })

  it('속성값이 비어 있으면 타깃이 아니다 — 빈 문자열을 그룹 id로 넘기면 안 된다', () => {
    // 속성 선택자는 값이 아니라 **존재**로 매칭하므로 빈 값도 걸린다. 걸러 내지 않으면
    // groupId: '' 가 그대로 그룹 이동에 실려 나간다.
    document.body.innerHTML = '<div data-drop-group=""><span id="e">t</span></div>'
    expect(dropTargetOf(document.getElementById('e'))).toBeNull()
  })

  it('타깃 엘리먼트 자신도 타깃이다', () => {
    // 캔버스 드롭은 그룹 블록의 여백에 놓일 수 있다 — 그때 elementFromPoint가 주는 것은
    // 자손이 아니라 블록 자신이다.
    document.body.innerHTML = '<div id="self" data-drop-group="g1"></div>'
    expect(dropTargetOf(document.getElementById('self'))).toEqual({ groupId: 'g1' })
  })
})

describe('dropAttrValue', () => {
  it('미분류는 특수값으로, 그룹은 id 그대로 나간다 — dropTargetOf의 역이다', () => {
    expect(dropTargetOf(hostWith(dropAttrValue(null)))).toEqual({ groupId: null })
    expect(dropTargetOf(hostWith(dropAttrValue('g1')))).toEqual({ groupId: 'g1' })
  })
})

/** 마크업이 다는 속성값을 그대로 단 엘리먼트. 쓰는 쪽과 읽는 쪽의 왕복을 잠근다. */
function hostWith(attr: string): Element {
  document.body.innerHTML = `<div data-drop-group="${attr}"></div>`
  return document.body.firstElementChild!
}
