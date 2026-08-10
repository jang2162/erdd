import { describe, expect, it } from 'vitest'
import { buildDbmlNote, splitDbmlNote } from './dbml-note.js'

describe('buildDbmlNote', () => {
  it('논리명·설명·커스텀을 한 줄로 합친다', () => {
    expect(buildDbmlNote('회원', 'MBR', '회원 기본정보', { 보안등급: '2' }))
      .toBe('회원 - 회원 기본정보 {"보안등급":"2"}')
  })

  it('커스텀이 없으면 꼬리를 붙이지 않는다', () => {
    expect(buildDbmlNote('회원', 'MBR', '회원 기본정보', {})).toBe('회원 - 회원 기본정보')
  })

  it('빈 문자열 값은 미입력이므로 내보내지 않는다', () => {
    expect(buildDbmlNote('회원', 'MBR', null, { 보안등급: '' })).toBe('회원')
  })

  it('논리명==물리명이고 설명·커스텀이 없으면 null 이다', () => {
    expect(buildDbmlNote('MBR', 'MBR', null, {})).toBeNull()
  })

  it('설명이 없고 커스텀만 있으면 논리명 뒤에 꼬리만 붙는다', () => {
    expect(buildDbmlNote('회원', 'MBR', null, { 보안등급: '2' })).toBe('회원 {"보안등급":"2"}')
  })
})

describe('splitDbmlNote', () => {
  it('buildDbmlNote 의 역이다', () => {
    expect(splitDbmlNote('회원 - 회원 기본정보 {"보안등급":"2"}')).toEqual({
      logicalName: '회원', comment: '회원 기본정보', custom: { 보안등급: '2' },
    })
  })

  it('꼬리가 없으면 커스텀은 빈 객체다', () => {
    expect(splitDbmlNote('회원 - 회원 기본정보')).toEqual({
      logicalName: '회원', comment: '회원 기본정보', custom: {},
    })
  })

  it('JSON 이 깨져 있으면 통째로 설명으로 둔다', () => {
    expect(splitDbmlNote('회원 - 상태 {깨진')).toEqual({
      logicalName: '회원', comment: '상태 {깨진', custom: {},
    })
  })

  it('값이 문자열이 아니면 커스텀으로 보지 않는다', () => {
    expect(splitDbmlNote('회원 - 설명 {"n":1}')).toEqual({
      logicalName: '회원', comment: '설명 {"n":1}', custom: {},
    })
  })

  it('설명 안에 중괄호가 있어도 꼬리만 떼어낸다', () => {
    expect(splitDbmlNote('회원 - {코드} 설명 {"보안등급":"2"}')).toEqual({
      logicalName: '회원', comment: '{코드} 설명', custom: { 보안등급: '2' },
    })
  })

  // 설계 §3 의 "마지막 { 부터" 규칙은 **커스텀 값 안의 {** 를 못 지켰다 — 그 { 가 마지막이 되어
  // JSON 파싱이 실패하고 꼬리 전체가 설명·논리명으로 샜다(리뷰 M-3). "앞에서부터 훑어 끝까지가
  // JSON 으로 파싱되는 첫 { " 로 바꾸면 손글씨 중괄호를 지키는 성질은 그대로 유지된다.
  it('값에 중괄호가 있어도 커스텀으로 읽는다', () => {
    expect(splitDbmlNote('A {"비고":"a{b"}')).toEqual({
      logicalName: 'A', comment: null, custom: { 비고: 'a{b' },
    })
  })

  it('값에 따옴표·중괄호·JSON 문자열이 들어도 읽는다', () => {
    const custom = { 비고: `it's {중괄호} "큰따옴표"`, 메타: '{"a":1}' }
    const note = `회원 - 설명에 {중괄호} 가 있다 ${JSON.stringify(custom)}`
    expect(splitDbmlNote(note)).toEqual({
      logicalName: '회원', comment: '설명에 {중괄호} 가 있다', custom,
    })
  })

  it('값에 }만 있는 경우도 그대로다(대조군)', () => {
    expect(splitDbmlNote('A {"비고":"a}b"}')).toEqual({
      logicalName: 'A', comment: null, custom: { 비고: 'a}b' },
    })
  })

  it('값에 개행이 있어도 읽는다(대조군)', () => {
    // 내보내기는 JSON.stringify 로 꼬리를 만들므로 개행은 \n 으로 이스케이프돼 실린다.
    const custom = { 비고: '첫 줄\n둘째 줄' }
    expect(splitDbmlNote(`A - 설명 ${JSON.stringify(custom)}`)).toEqual({
      logicalName: 'A', comment: '설명', custom,
    })
  })

  it('꼬리 없이 손글씨 중괄호만 있으면 통째로 설명이다(대조군)', () => {
    expect(splitDbmlNote('회원 - 설명에 {중괄호} 가 있다')).toEqual({
      logicalName: '회원', comment: '설명에 {중괄호} 가 있다', custom: {},
    })
  })

  it('논리명 없이 꼬리만 있으면 논리명이 빈 문자열이다', () => {
    expect(splitDbmlNote('{"보안등급":"2"}')).toEqual({
      logicalName: '', comment: null, custom: { 보안등급: '2' },
    })
  })
})
