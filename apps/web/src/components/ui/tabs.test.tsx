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
})
