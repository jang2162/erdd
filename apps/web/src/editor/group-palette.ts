// 데이터 도면 팔레트 계열의 그룹 색상. 서로 구분되는 채도.
export const GROUP_PALETTE = [
  '#0E7A6C', // teal
  '#C89B3C', // key gold
  '#3B6FB0', // blue
  '#9C5BB0', // purple
  '#C4453C', // red
  '#4C8C4A', // green
  '#B06A2C', // amber
  '#5A6270', // slate
]

/** usedColors에 없는 첫 색을 반환, 모두 쓰였으면 개수 기준 순환. */
export function nextGroupColor(usedColors: string[]): string {
  const used = new Set(usedColors)
  const free = GROUP_PALETTE.find((c) => !used.has(c))
  if (free) return free
  return GROUP_PALETTE[usedColors.length % GROUP_PALETTE.length]!
}
