import { peerColor } from '@erdd/core'
import { useEditorStore } from './store.js'

const MAX_AVATARS = 3

/** 이름의 첫 글자(한글은 첫 음절, 영문은 첫 글자 대문자). */
function initialOf(name: string): string {
  const first = [...name][0] ?? '?'
  return first.toUpperCase()
}

/** 같은 프로젝트를 보고 있는 다른 사용자들. 자기 아바타는 정보가 없어 제외한다. */
export function PresenceBar({ selfUserId }: { selfUserId: string }) {
  const peers = useEditorStore((s) => s.peers)
  const others = peers.filter((p) => p.userId !== selfUserId)
  if (others.length === 0) return null

  const shown = others.slice(0, MAX_AVATARS)
  const rest = others.length - shown.length
  return (
    <div className="flex items-center gap-1" aria-label="함께 보는 사용자">
      {shown.map((p) => (
        <span
          key={p.userId}
          title={p.name}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: peerColor(p.userId) }}
        >
          {initialOf(p.name)}
        </span>
      ))}
      {rest > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          +{rest}
        </span>
      )}
    </div>
  )
}
