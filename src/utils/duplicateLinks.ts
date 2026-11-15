import type { Tile, TreeNode } from '../types/workspace'
import { nodeParentIds } from './tree'

type Candidate = { first: Tile; second: Tile; firstIndex: number; secondIndex: number; distance: number; anchor: number }

function compareCandidates(left: Candidate, right: Candidate) {
  return left.distance - right.distance || left.first.id.localeCompare(right.first.id)
    || left.second.id.localeCompare(right.second.id)
    || left.firstIndex - right.firstIndex || left.secondIndex - right.secondIndex
}

export function duplicateLinks(data: TreeNode[], tiles: Tile[]) {
  const parents = nodeParentIds(data)
  const groups = new Map<string, Tile[]>()
  for (const tile of tiles) {
    const group = groups.get(tile.label) ?? []
    group.push(tile)
    groups.set(tile.label, group)
  }
  const connected = new Map(tiles.map((tile) => [tile.id, tile.id]))
  const rootOf = (id: string): string => {
    const parent = connected.get(id)!
    if (parent === id) return id
    const root = rootOf(parent)
    connected.set(id, root)
    return root
  }
  const links: Array<{ id: string; path: string }> = []
  const orderedGroups = [...groups].sort((left, right) =>
    Math.min(...left[1].map((tile) => tile.depth)) - Math.min(...right[1].map((tile) => tile.depth))
    || left[0].localeCompare(right[0]))
  for (const [label, group] of orderedGroups) {
    if (group.length < 2) continue
    function candidate(firstIndex: number, secondIndex: number, anchor: number): Candidate {
      const firstIndexOrdered = Math.min(firstIndex, secondIndex)
      const secondIndexOrdered = Math.max(firstIndex, secondIndex)
      const first = group[firstIndexOrdered]!
      const second = group[secondIndexOrdered]!
      return {
        first, second, anchor, firstIndex: firstIndexOrdered, secondIndex: secondIndexOrdered,
        distance: (first.x + first.width / 2 - second.x - second.width / 2) ** 2
          + (first.y + first.height / 2 - second.y - second.height / 2) ** 2,
      }
    }
    function connect({ first, second }: Candidate) {
      const firstRoot = rootOf(first.id)
      const secondRoot = rootOf(second.id)
      if (firstRoot === secondRoot) return false
      const firstParent = parents.get(first.id)
      const secondParent = parents.get(second.id)
      const suppressed = firstParent && secondParent && firstParent !== secondParent
        && rootOf(firstParent) === rootOf(secondParent)
      connected.set(firstRoot, secondRoot)
      if (suppressed) return true
      const start = { x: first.x + first.width / 2, y: first.y + first.height / 2 }
      const end = { x: second.x + second.width / 2, y: second.y + second.height / 2 }
      const dx = end.x - start.x
      const dy = end.y - start.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const bend = Math.min(24, Math.max(8, distance * 0.12))
      const control = {
        x: (start.x + end.x) / 2 - (dy / distance) * bend,
        y: (start.y + end.y) / 2 + (dx / distance) * bend,
      }
      links.push({
        id: `${first.id}:${second.id}:${label}`,
        path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      })
      return true
    }

    const indexes = new Map(group.map((tile, index) => [tile.id, index]))
    const parentEdges: Candidate[] = []
    for (let index = 0; index < group.length; index += 1) {
      const parent = parents.get(group[index]!.id)
      const parentIndex = parent === null || parent === undefined ? undefined : indexes.get(parent)
      if (parentIndex !== undefined) parentEdges.push(candidate(index, parentIndex, index))
    }
    parentEdges.sort(compareCandidates)
    let remaining = group.length - 1
    for (const edge of parentEdges) if (connect(edge)) remaining -= 1
    if (!remaining) continue

    const heap: Candidate[] = []
    function push(edge: Candidate) {
      let index = heap.length
      heap.push(edge)
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2)
        if (compareCandidates(heap[parent]!, edge) <= 0) break
        heap[index] = heap[parent]!
        index = parent
      }
      heap[index] = edge
    }
    function pop() {
      const first = heap[0]!
      const last = heap.pop()!
      if (heap.length) {
        let index = 0
        while (index * 2 + 1 < heap.length) {
          let child = index * 2 + 1
          if (child + 1 < heap.length && compareCandidates(heap[child + 1]!, heap[child]!) < 0) child += 1
          if (compareCandidates(last, heap[child]!) <= 0) break
          heap[index] = heap[child]!
          index = child
        }
        heap[index] = last
      }
      return first
    }
    function nearest(anchor: number) {
      const root = rootOf(group[anchor]!.id)
      let best: Candidate | undefined
      for (let index = 0; index < group.length; index += 1) {
        if (rootOf(group[index]!.id) === root) continue
        const first = group[Math.min(anchor, index)]!
        const second = group[Math.max(anchor, index)]!
        const distance = (first.x + first.width / 2 - second.x - second.width / 2) ** 2
          + (first.y + first.height / 2 - second.y - second.height / 2) ** 2
        if (!best || distance <= best.distance) {
          const edge = { first, second, distance, anchor, firstIndex: Math.min(anchor, index), secondIndex: Math.max(anchor, index) }
          if (!best || compareCandidates(edge, best) < 0) best = edge
        }
      }
      return best
    }
    for (let index = 0; index < group.length; index += 1) {
      const edge = nearest(index)
      if (edge) push(edge)
    }
    // Components only grow, so a queued nearest edge stays optimal until it becomes internal.
    while (remaining && heap.length) {
      const edge = pop()
      if (connect(edge)) remaining -= 1
      if (remaining) {
        const next = nearest(edge.anchor)
        if (next) push(next)
      }
    }
  }
  return links
}
