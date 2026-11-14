import type { CopyLink, StoredState, TreeNode, Version } from '../types/workspace'

export function structureSignature(data: TreeNode[]): string {
  const normalize = (node: TreeNode): [string, string, unknown[]] => [node.value, node.description ?? '', node.children.map(normalize)]
  return JSON.stringify(data.map(normalize))
}
export function displayVersionId(id: string) {
  const peerId = id.match(/^(v\d+)-([a-f0-9]{12})$/)
  return peerId ? `${peerId[1]}-${peerId[2]!.slice(0, 4)}` : id
}
export function reflowVersionLayout(state: StoredState) {
  const graph = state.versions
  const root = graph.find((version) => version.parentId === null)
  if (!root) return
  const byId = new Map(graph.map((version) => [version.id, version]))
  const children = new Map<string, Version[]>()
  for (const version of graph) {
    if (!version.parentId) continue
    children.set(version.parentId, [...(children.get(version.parentId) ?? []), version])
  }
  const lengthCache = new Map<string, number>()
  const branchLength = (version: Version): number => {
    const cached = lengthCache.get(version.id)
    if (cached !== undefined) return cached
    const length = 1 + Math.max(0, ...(children.get(version.id) ?? []).map(branchLength))
    lengthCache.set(version.id, length)
    return length
  }
  const orderedChildren = (version: Version) => [...(children.get(version.id) ?? [])]
    .sort((left, right) => branchLength(right) - branchLength(left) || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  const pending: { parent: Version; root: Version }[] = []

  const placeMainChain = (first: Version, lane: number) => {
    let current: Version | undefined = first
    while (current) {
      current.lane = lane
      const next = orderedChildren(current)
      for (const sideBranch of next.slice(1)) {
        pending.push({ parent: current, root: sideBranch })
      }
      current = next[0]
    }
  }

  root.lane = 0
  const origins = orderedChildren(root)
  for (const sideBranch of origins.slice(1)) pending.push({ parent: root, root: sideBranch })
  if (origins[0]) placeMainChain(origins[0], 0)

  let nextLane = 1
  while (pending.length) {
    pending.sort((left, right) => right.parent.step - left.parent.step
      || branchLength(right.root) - branchLength(left.root)
      || left.root.createdAt - right.root.createdAt
      || left.root.id.localeCompare(right.root.id))
    const branch = pending.shift()!
    if (!byId.has(branch.root.id)) continue
    placeMainChain(branch.root, nextLane)
    nextLane += 1
  }

  const mergeVersions = graph.filter((item) => item.mergeSourceId)
    .sort((left, right) => left.step - right.step || left.createdAt - right.createdAt)
  for (const version of mergeVersions) {
    const parent = version.parentId ? byId.get(version.parentId) : undefined
    const source = version.mergeSourceId ? byId.get(version.mergeSourceId) : undefined
    if (!parent || !source) continue
    const mergeLine: Version[] = []
    let current: Version | undefined = version
    while (current) {
      mergeLine.push(current)
      current = orderedChildren(current)[0]
    }
    const mergeLineIds = new Set(mergeLine.map((item) => item.id))
    if (version.branch === parent.branch) {
      mergeLine.forEach((lineVersion) => { lineVersion.lane = parent.lane })
      continue
    }

    const lane = Math.min(parent.lane, source.lane) + 1
    for (const other of graph) {
      if (!mergeLineIds.has(other.id) && other.lane >= lane) other.lane += 1
    }
    mergeLine.forEach((lineVersion) => { lineVersion.lane = lane })
    nextLane += 1
  }

  const lanes = [...new Set(graph.map((version) => version.lane))].sort((left, right) => left - right)
  const compactLanes = new Map(lanes.map((lane, index) => [lane, index]))
  for (const version of graph) version.lane = compactLanes.get(version.lane)!
  graph.sort((left, right) => left.step - right.step || left.id.localeCompare(right.id))
  state.nextLane = lanes.length
}


export function compareCopyLinks(left: CopyLink, right: CopyLink) {
  return left.sourceVersionId.localeCompare(right.sourceVersionId)
    || left.sourceNodeId.localeCompare(right.sourceNodeId)
    || left.targetVersionId.localeCompare(right.targetVersionId)
    || left.targetNodeId.localeCompare(right.targetNodeId)
}

