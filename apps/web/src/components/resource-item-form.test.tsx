import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResourceItemForm } from './resource-item-form.js'

afterEach(cleanup)

describe('ResourceItemForm', () => {
  it('단어를 추가한다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="word" payload={null} domainOptions={[]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/논리명/), '회원')
    await userEvent.type(screen.getByLabelText(/물리 약어/), 'MBR')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      logicalName: '회원', abbreviation: 'MBR', description: null,
    })
  })

  it('용어의 도메인 선택은 라이브러리 항목 id를 담는다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="term" payload={null}
      domainOptions={[{ id: 'lib-d1', name: '금액' }]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/논리명/), '주문금액')
    await userEvent.type(screen.getByLabelText(/물리명/), 'ORD_AMT')
    await userEvent.selectOptions(screen.getByLabelText('기본 도메인'), 'lib-d1')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: 'lib-d1', description: null,
    })
  })

  it('도메인의 방언 물리 타입은 비워 두면 null이다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="domain" payload={null} domainOptions={[]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/이름/), '금액')
    await userEvent.type(screen.getByLabelText(/논리 타입/), 'DECIMAL(15,2)')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    })
  })

  it('커스텀 항목 payload에는 order가 없다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/이름/), '비고')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '비고', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null,
    })
  })

  it('선택형인데 선택지가 없으면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/이름/), '개인정보여부')
    await userEvent.selectOptions(screen.getByLabelText(/타입/), 'select')
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
    expect(screen.getByText('선택형은 선택지를 하나 이상 입력해야 합니다')).toBeDefined()
  })

  it('이름이 비면 저장할 수 없다', () => {
    render(<ResourceItemForm kind="word" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
  })

  it('기존 payload를 폼에 채운다', () => {
    render(<ResourceItemForm kind="word"
      payload={{ logicalName: '회원', abbreviation: 'MBR', description: '가입자' }}
      domainOptions={[]} onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByLabelText(/논리명/)).toHaveProperty('value', '회원')
    expect(screen.getByLabelText(/물리 약어/)).toHaveProperty('value', 'MBR')
  })

  it('커스텀 항목 선택형의 기본값이 선택지 밖이면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/이름/), '등급')
    await userEvent.selectOptions(screen.getByLabelText(/타입/), 'select')
    await userEvent.type(screen.getByLabelText(/선택지 \(쉼표로 구분\)/), 'A, B')
    await userEvent.type(screen.getByLabelText('기본값'), 'C')
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
    expect(screen.getByText('기본값은 선택지 중 하나여야 합니다')).toBeDefined()
  })

  it('커스텀 항목 불리언의 기본값이 true/false가 아니면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/이름/), '동의여부')
    await userEvent.selectOptions(screen.getByLabelText(/타입/), 'boolean')
    await userEvent.type(screen.getByLabelText('기본값'), 'yes')
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
    expect(screen.getByText('불리언 기본값은 true 또는 false여야 합니다')).toBeDefined()
  })

  it('도메인의 논리 타입이 비면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="domain" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/이름/), '금액')
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
  })

  it('용어의 물리명이 비면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="term" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/논리명/), '주문금액')
    expect(screen.getByRole('button', { name: '저장' })).toHaveProperty('disabled', true)
  })

  it('기존 용어 payload를 폼에 채운다(도메인 선택 포함)', () => {
    render(<ResourceItemForm kind="term"
      payload={{
        logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: 'lib-d1', description: '주문 총액',
      }}
      domainOptions={[{ id: 'lib-d1', name: '금액' }]} onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByLabelText(/논리명/)).toHaveProperty('value', '주문금액')
    expect(screen.getByLabelText(/물리명/)).toHaveProperty('value', 'ORD_AMT')
    expect(screen.getByLabelText('기본 도메인')).toHaveProperty('value', 'lib-d1')
  })

  it('용어 payload의 domainId가 null이면 기본 도메인이 "선택 안 함"이다', () => {
    render(<ResourceItemForm kind="term"
      payload={{ logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: null, description: null }}
      domainOptions={[{ id: 'lib-d1', name: '금액' }]} onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByLabelText('기본 도메인')).toHaveProperty('value', '')
  })

  it('기존 도메인 payload를 폼에 채운다(방언별 물리 타입·허용값 포함)', () => {
    render(<ResourceItemForm kind="domain"
      payload={{
        name: '금액', category: '재무', logicalType: 'DECIMAL(15,2)',
        dialectTypes: { postgresql: 'numeric(15,2)', mysql: null, oracle: 'NUMBER(15,2)', mssql: null },
        defaultValue: '0', allowedValues: ['A', 'B'], description: '금액 도메인',
      }}
      domainOptions={[]} onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByLabelText(/이름/)).toHaveProperty('value', '금액')
    expect(screen.getByLabelText('분류')).toHaveProperty('value', '재무')
    expect(screen.getByLabelText(/논리 타입/)).toHaveProperty('value', 'DECIMAL(15,2)')
    expect(screen.getByLabelText('PostgreSQL 물리 타입')).toHaveProperty('value', 'numeric(15,2)')
    expect(screen.getByLabelText('MySQL·MariaDB 물리 타입')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Oracle 물리 타입')).toHaveProperty('value', 'NUMBER(15,2)')
    expect(screen.getByLabelText('MSSQL 물리 타입')).toHaveProperty('value', '')
    expect(screen.getByLabelText('허용값 (쉼표로 구분)')).toHaveProperty('value', 'A, B')
    expect(screen.getByLabelText('기본값')).toHaveProperty('value', '0')
  })

  it('기존 도메인 payload를 수정 없이 저장하면 payload 키 집합이 스키마와 일치한다', async () => {
    const onSubmit = vi.fn()
    render(<ResourceItemForm kind="domain"
      payload={{
        name: '금액', category: '재무', logicalType: 'DECIMAL(15,2)',
        dialectTypes: { postgresql: 'numeric(15,2)', mysql: null, oracle: null, mssql: null },
        defaultValue: '0', allowedValues: ['A', 'B'], description: '금액 도메인',
      }}
      domainOptions={[]} onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '금액', category: '재무', logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: 'numeric(15,2)', mysql: null, oracle: null, mssql: null },
      defaultValue: '0', allowedValues: ['A', 'B'], description: '금액 도메인',
    })
  })

  it('기존 커스텀 항목 payload를 폼에 채운다(대상·타입·선택지·필수 포함)', () => {
    render(<ResourceItemForm kind="customField"
      payload={{
        name: '등급', target: 'table', type: 'select', options: ['A', 'B'],
        required: true, defaultValue: 'A',
      }}
      domainOptions={[]} onSubmit={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByLabelText(/이름/)).toHaveProperty('value', '등급')
    expect(screen.getByLabelText(/적용 대상/)).toHaveProperty('value', 'table')
    expect(screen.getByLabelText(/타입/)).toHaveProperty('value', 'select')
    expect(screen.getByLabelText(/선택지 \(쉼표로 구분\)/)).toHaveProperty('value', 'A, B')
    expect(screen.getByLabelText('필수')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('기본값')).toHaveProperty('value', 'A')
  })

  it('word/term 폼은 물리 입력이 논리 입력보다 앞에 온다', () => {
    render(<ResourceItemForm kind="term" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    const physical = screen.getByLabelText(/물리명/)
    const logical = screen.getByLabelText(/논리명/)
    expect(physical.compareDocumentPosition(logical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('word 폼에서 필수 라벨(논리명·물리 약어)에는 별표가 붙고 선택 라벨(설명)에는 붙지 않는다', () => {
    render(<ResourceItemForm kind="word" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    const labelText = (text: string) => screen.getByText(text).closest('label')?.textContent
    expect(labelText('논리명')).toBe('논리명*(필수)')
    expect(labelText('물리 약어')).toBe('물리 약어*(필수)')
    expect(labelText('설명')).toBe('설명')
  })

  it('term 폼에서 필수 라벨(논리명·물리명)에는 별표가 붙고 선택 라벨(기본 도메인·설명)에는 붙지 않는다', () => {
    render(<ResourceItemForm kind="term" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    const labelText = (text: string) => screen.getByText(text).closest('label')?.textContent
    expect(labelText('논리명')).toBe('논리명*(필수)')
    expect(labelText('물리명')).toBe('물리명*(필수)')
    expect(labelText('기본 도메인')).toBe('기본 도메인')
    expect(labelText('설명')).toBe('설명')
  })

  it('domain 폼에서 필수 라벨(이름·논리 타입)에는 별표가 붙고 선택 라벨(분류·방언별 물리 타입·허용값·기본값·설명)에는 붙지 않는다', () => {
    render(<ResourceItemForm kind="domain" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    const labelText = (text: string) => screen.getByText(text).closest('label')?.textContent
    expect(labelText('이름')).toBe('이름*(필수)')
    expect(labelText('논리 타입')).toBe('논리 타입*(필수)')
    expect(labelText('분류')).toBe('분류')
    expect(labelText('PostgreSQL 물리 타입')).toBe('PostgreSQL 물리 타입')
    expect(labelText('허용값 (쉼표로 구분)')).toBe('허용값 (쉼표로 구분)')
    expect(labelText('기본값')).toBe('기본값')
    expect(labelText('설명')).toBe('설명')
  })

  it('customField 폼에서 필수 라벨(이름·적용 대상·타입·선택지)에는 별표가 붙고 선택 라벨(기본값)에는 붙지 않는다', async () => {
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText(/타입/), 'select')
    const labelText = (text: string) => screen.getByText(text).closest('label')?.textContent
    expect(labelText('이름')).toBe('이름*(필수)')
    expect(labelText('적용 대상')).toBe('적용 대상*(필수)')
    expect(labelText('타입')).toBe('타입*(필수)')
    expect(labelText('선택지 (쉼표로 구분)')).toBe('선택지 (쉼표로 구분)*(필수)')
    expect(labelText('기본값')).toBe('기본값')
  })
})
