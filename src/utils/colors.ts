import type { Version } from '../types/workspace'

const branchColors = ['#176b68', '#d15a3b', '#a58127', '#4774a8', '#8a5c83', '#5b7d46']

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
  if (version.id === 'v0') return '#7b8580'
  const index = Math.max(0, Number(version.branch.match(/\d+/)?.[0] ?? 1) - 1)
  return branchColors[index % branchColors.length]!
}
