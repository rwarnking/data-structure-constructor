import type { Version } from '../types/workspace'
import { flattenNodes } from './tree'

export function changedEntryIds(version: Version, parent?: Version): Set<string> {
  if (!parent) return new Set()
  const before = flattenNodes(parent.data)
  const after = flattenNodes(version.data)
  const changed = new Set<string>()
  const sharedOrder = (entries: typeof before, other: typeof before) => {
    const counts = new Map<string | null, number>()
    const indices = new Map<string, number>()
    for (const [id, item] of entries) {
      if (other.get(id)?.parentId !== item.parentId) continue
      const index = counts.get(item.parentId) ?? 0
      indices.set(id, index)
      counts.set(item.parentId, index + 1)
    }
    return indices
  }
  const oldOrder = sharedOrder(before, after)
  const newOrder = sharedOrder(after, before)
  for (const [id, item] of after) {
    const previous = before.get(id)
    if (!previous || previous.node.value !== item.node.value
      || (previous.node.description ?? '') !== (item.node.description ?? '')
      || previous.parentId !== item.parentId) {
      changed.add(id)
      continue
    }
    if (oldOrder.get(id) !== newOrder.get(id)) changed.add(id)
  }
  return changed
}
