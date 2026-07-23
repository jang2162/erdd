import { useEffect, useState } from 'react'
import { trpc } from './trpc.js'

export function App() {
  const [status, setStatus] = useState('연결 확인 중…')

  useEffect(() => {
    trpc.health.ping
      .query()
      .then((r) => setStatus(`서버 연결됨 (v${r.version})`))
      .catch(() => setStatus('서버에 연결할 수 없음'))
  }, [])

  return (
    <main>
      <h1>ERDD</h1>
      <p>{status}</p>
    </main>
  )
}
