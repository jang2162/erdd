import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CLI_VERSION } from '@/testing/cli-version'
import { AppVersion } from './app-version'

describe('AppVersion', () => {
  it('빌드 시 주입한 @erdd/cli 버전을 v 접두사로 렌더한다', () => {
    render(<AppVersion />)
    expect(screen.getByText(`v${CLI_VERSION}`)).toBeInTheDocument()
  })
})
