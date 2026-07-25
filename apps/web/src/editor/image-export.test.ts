import { describe, expect, it } from 'vitest'
import { imageFileName } from './image-export.js'

describe('imageFileName', () => {
  it('확장자를 붙인다', () => {
    expect(imageFileName('erdd', 'png')).toBe('erdd.png')
    expect(imageFileName('erdd', 'svg')).toBe('erdd.svg')
  })
  it('빈 base는 erdd로 대체', () => {
    expect(imageFileName('', 'png')).toBe('erdd.png')
  })
  it('안전하지 않은 문자를 _로 치환하고 한글·영숫자는 유지', () => {
    expect(imageFileName('회원 스키마/v1', 'png')).toBe('회원_스키마_v1.png')
  })
})
