import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TABLE_OPTIONS, TableOptionsSchema, TableOptionsStrictSchema,
} from './table-options.js'

describe('TableOptions — 읽기/쓰기 스키마 분리(설계 §5.3)', () => {
  it('기본값은 네 방언 모두 빈 문자열이다', () => {
    expect(DEFAULT_TABLE_OPTIONS).toEqual({ postgresql: '', mysql: '', oracle: '', mssql: '' })
  })

  it('읽기 스키마는 키가 없는 옛 행에 기본값을 주입한다', () => {
    expect(TableOptionsSchema.parse({})).toEqual(DEFAULT_TABLE_OPTIONS)
    expect(TableOptionsSchema.parse({ mysql: 'ENGINE=InnoDB' })).toEqual({
      postgresql: '', mysql: 'ENGINE=InnoDB', oracle: '', mssql: '',
    })
  })

  /**
   * ⚠️ **이 단언이 이 사이클에서 가장 비싼 사고를 막는다**(HANDOFF 3.16 과 같은 함정).
   * 읽기 스키마를 쓰기에 걸면 `{mysql: '…'}` 만 보낸 화면이 나머지 세 방언의 값을 조용히
   * 지운다 — 부분 페이로드가 전체 덮어쓰기로 둔갑한다. 키가 넷이라 함정이 더 크다.
   */
  it('쓰기 스키마는 네 키를 전부 요구한다 — 부분 페이로드를 거절한다', () => {
    expect(TableOptionsStrictSchema.safeParse({ mysql: 'ENGINE=InnoDB' }).success).toBe(false)
    expect(TableOptionsStrictSchema.safeParse({}).success).toBe(false)
    expect(TableOptionsStrictSchema.safeParse({
      postgresql: '', mysql: 'ENGINE=InnoDB', oracle: '', mssql: '',
    }).success).toBe(true)
  })

  it('값은 검증하지 않는다 — 임의 문자열을 받는다(dialectTypes 와 같은 방침)', () => {
    const v = { postgresql: 'TABLESPACE x', mysql: 'ENGINE=InnoDB', oracle: 'TABLESPACE users', mssql: 'ON [PRIMARY]' }
    expect(TableOptionsStrictSchema.parse(v)).toEqual(v)
  })
})
