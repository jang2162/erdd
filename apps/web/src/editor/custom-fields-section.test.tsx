import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CustomField } from '@erdd/core'
import { CustomFieldsSection } from './custom-fields-section.js'

function field(id: string, over: Partial<CustomField> = {}): CustomField {
  return {
    id, name: id, target: 'column', type: 'text', options: [], required: false,
    defaultValue: null, order: 0, origin: null, ...over,
  }
}

afterEach(cleanup)

describe('CustomFieldsSection', () => {
  it('정의가 없으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(
      <CustomFieldsSection fields={[]} values={{}} idPrefix="x" warnings={[]} canEdit={true} onChange={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('텍스트 항목은 blur 시 값을 커밋한다', async () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '비고' })]} values={{}} idPrefix="x"
        warnings={[]} canEdit={true} onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('비고'), '메모')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('f1', '메모')
  })

  it('불리언 항목은 체크 시 true/false 문자열을 커밋한다', async () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '개인정보여부', type: 'boolean' })]} values={{}}
        idPrefix="x" warnings={[]} canEdit={true} onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByLabelText('개인정보여부'))
    expect(onChange).toHaveBeenCalledWith('f1', 'true')
  })

  it('선택형 항목은 선택지를 보여주고 선택 시 값을 커밋한다', async () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '암호화방식', type: 'select', options: ['없음', 'AES256'] })]}
        values={{}} idPrefix="x" warnings={[]} canEdit={true} onChange={onChange}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('암호화방식'), 'AES256')
    expect(onChange).toHaveBeenCalledWith('f1', 'AES256')
  })

  it('미입력이면 정의 기본값을 표시한다', () => {
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '비고', defaultValue: '해당없음' })]} values={{}}
        idPrefix="x" warnings={[]} canEdit={true} onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('비고')).toHaveValue('해당없음')
  })

  it('선택지에 없는 기존 값도 비활성 옵션으로 남겨 값이 사라지지 않게 한다', () => {
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '암호화방식', type: 'select', options: ['없음', 'AES256'] })]}
        values={{ f1: 'SHA256' }} idPrefix="x" warnings={[]} canEdit={true} onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('암호화방식')).toHaveValue('SHA256')
    expect(screen.getByRole('option', { name: /SHA256/ })).toBeDisabled()
  })

  it('필수 미입력 경고가 있으면 항목 옆에 표시한다', () => {
    render(
      <CustomFieldsSection
        fields={[field('f1', { name: '개인정보여부', required: true })]} values={{}} idPrefix="x"
        warnings={[{
          kind: 'custom-required', scope: 'column', entityId: 'c1',
          message: '필수 항목 "개인정보여부"이(가) 비어 있습니다',
        }]}
        canEdit={true}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('필수')).toBeInTheDocument()
  })

  it('편집 권한이 없으면(canEdit=false) 값은 보이되 텍스트·불리언·선택 항목이 모두 잠긴다', () => {
    const onChange = vi.fn()
    render(
      <CustomFieldsSection
        fields={[
          field('f1', { name: '비고' }),
          field('f2', { name: '개인정보여부', type: 'boolean' }),
          field('f3', { name: '암호화방식', type: 'select', options: ['없음', 'AES256'] }),
        ]}
        values={{ f1: '메모', f2: 'true', f3: 'AES256' }}
        idPrefix="x" warnings={[]} canEdit={false} onChange={onChange}
      />,
    )
    const text = screen.getByLabelText('비고') as HTMLInputElement
    expect(text.value).toBe('메모')
    expect(text).toHaveAttribute('readonly')

    const boolField = screen.getByLabelText('개인정보여부') as HTMLInputElement
    expect(boolField.checked).toBe(true)
    expect(boolField).toBeDisabled()

    const selectField = screen.getByLabelText('암호화방식') as HTMLSelectElement
    expect(selectField.value).toBe('AES256')
    expect(selectField).toBeDisabled()
  })
})
