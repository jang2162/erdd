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
    await userEvent.type(screen.getByLabelText('논리명'), '회원')
    await userEvent.type(screen.getByLabelText('물리 약어'), 'MBR')
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
    await userEvent.type(screen.getByLabelText('논리명'), '주문금액')
    await userEvent.type(screen.getByLabelText('물리명'), 'ORD_AMT')
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
    await userEvent.type(screen.getByLabelText('이름'), '금액')
    await userEvent.type(screen.getByLabelText('논리 타입'), 'DECIMAL(15,2)')
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
    await userEvent.type(screen.getByLabelText('이름'), '비고')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: '비고', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null,
    })
  })

  it('선택형인데 선택지가 없으면 저장할 수 없다', async () => {
    render(<ResourceItemForm kind="customField" payload={null} domainOptions={[]}
      onSubmit={vi.fn()} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('이름'), '개인정보여부')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'select')
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
    expect(screen.getByLabelText('논리명')).toHaveProperty('value', '회원')
    expect(screen.getByLabelText('물리 약어')).toHaveProperty('value', 'MBR')
  })
})
