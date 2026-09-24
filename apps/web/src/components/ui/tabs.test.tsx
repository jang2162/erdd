import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

afterEach(cleanup)

describe('Tabs', () => {
  it('tablist·tab·tabpanel 역할을 갖추고 누르면 바뀐다', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="종류">
          <TabsTrigger value="a">가</TabsTrigger>
          <TabsTrigger value="b">나</TabsTrigger>
        </TabsList>
        <TabsContent value="a">내용 가</TabsContent>
        <TabsContent value="b">내용 나</TabsContent>
      </Tabs>,
    )
    expect(screen.getByRole('tablist', { name: '종류' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '가' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('내용 가')
    await userEvent.click(screen.getByRole('tab', { name: '나' }))
    expect(screen.getByRole('tab', { name: '나' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('내용 나')
  })

  it('탭 줄은 부모 폭 안에 묶이고 넘치면 다음 줄로 넘긴다 — 좁은 화면의 다이얼로그 밖으로 삐져나오지 않는다', () => {
    // jsdom 은 배치를 계산하지 않는다 — 줄바꿈을 만드는 클래스를 잠근다(실제 배치는 빌드한 CSS 로 브라우저에서 확인).
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="종류"><TabsTrigger value="a">가</TabsTrigger></TabsList>
      </Tabs>,
    )
    expect(screen.getByRole('tablist', { name: '종류' })).toHaveClass('max-w-full', 'flex-wrap')
  })
})
