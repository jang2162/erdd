import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Peer } from '@erdd/core'
import { peerColor } from '@erdd/core'
import { useEditorStore } from './store.js'
import { PresenceBar } from './presence.js'

const ME = 'u-me'
const peer = (userId: string, name: string): Peer => ({ userId, name, selection: null })

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('PresenceBar', () => {
  it('나 말고 아무도 없으면 아무것도 그리지 않는다', () => {
    useEditorStore.getState().setPeers([peer(ME, '나')])
    const { container } = render(<PresenceBar selfUserId={ME} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('다른 참여자의 이니셜을 사용자 색으로 보여준다', () => {
    useEditorStore.getState().setPeers([peer(ME, '나'), peer('u2', '김동료')])
    render(<PresenceBar selfUserId={ME} />)
    const avatar = screen.getByTitle('김동료')
    expect(avatar).toHaveTextContent('김')
    expect(avatar).toHaveStyle({ background: peerColor('u2') })
  })

  it('3명을 넘으면 나머지를 +N으로 접는다', () => {
    useEditorStore.getState().setPeers([
      peer(ME, '나'), peer('u2', '둘'), peer('u3', '셋'), peer('u4', '넷'), peer('u5', '다섯'),
    ])
    render(<PresenceBar selfUserId={ME} />)
    expect(screen.getByTitle('둘')).toBeInTheDocument()
    expect(screen.queryByTitle('다섯')).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })
})
