import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/**
 * 필수 여부를 표기하는 폼 라벨. 필수에만 별표를 붙이고 선택에는 아무것도 붙이지 않는다
 * (「(선택)」 표기와 섞으면 규칙이 흐려진다 — 설계 §5.2).
 * 별표는 시각 표시라 aria-hidden이고, 스크린리더에는 sr-only 텍스트로 전달한다.
 */
export function FieldLabel(
  { htmlFor, required, className, children }:
    { htmlFor?: string; required?: boolean; className?: string; children: ReactNode },
) {
  return (
    <Label htmlFor={htmlFor} className={className}>
      <span>{children}</span>
      {required && (
        <>
          <span aria-hidden="true" className="text-destructive">*</span>
          <span className="sr-only">(필수)</span>
        </>
      )}
    </Label>
  )
}
