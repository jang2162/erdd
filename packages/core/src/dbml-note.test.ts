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

  it('설명 안에 중괄호가 있어도 마지막 것만 꼬리로 본다', () => {
    expect(splitDbmlNote('회원 - {코드} 설명 {"보안등급":"2"}')).toEqual({
      logicalName: '회원', comment: '{코드} 설명', custom: { 보안등급: '2' },
    })
  })

  it('논리명 없이 꼬리만 있으면 논리명이 빈 문자열이다', () => {
    expect(splitDbmlNote('{"보안등급":"2"}')).toEqual({
      logicalName: '', comment: null, custom: { 보안등급: '2' },
    })
  })
})
