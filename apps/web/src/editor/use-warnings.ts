import { useMemo } from 'react'
import { computeWarnings, type Warning } from '@erdd/core'
import { useEditorStore } from './store.js'

/**
 * 모델 경고의 단일 소재지. 헤더의 「모델 검사」 배지(건수)와 검사 다이얼로그(목록)가 이것을 함께
 * 본다 — 계산이 두 벌이 되면 배지 수와 목록 길이가 갈릴 수 있다.
 */
export function useWarnings(): Warning[] {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  return useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])
}
