import type { Version } from '../types/workspace'

const branchColors = [1, 2, 3, 4, 5, 6].map((number) => `var(--theme-branch-${number})`)
export const collaboratorColors = [
  '#0075b8', '#d55e00', '#009e73', '#c675a3', '#8a6d00',
  '#9566cc', '#d33f3f', '#007f82', '#a36a4c', '#62800b',
]

export function userColor(userId: string) {
  let hash = 2166136261
  for (const character of userId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const value = hash >>> 0
  const hue = value % 360
  const saturation = 58 + ((value >>> 9) % 22)
  const lightness = 35 + ((value >>> 17) % 19)
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}
export function selectionColor(userId: string, secondary = false) {
  if (!secondary) return userColor(userId)
  let hash = 2166136261
  for (const character of userId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `hsl(${((hash >>> 0) + 52) % 360} 68% 46%)`
}
export function versionColor(version: Version) {
  if (version.id === 'v0') return 'var(--theme-branch-root)'
  const index = Math.max(0, Number(version.branch.match(/\d+/)?.[0] ?? 1) - 1)
  return branchColors[index % branchColors.length]!
}
