import type { CopyLink, RetiredVersionNumber, StoredState, TreeNode, Version, VersionNumber } from '../types/workspace'

export function structureSignature(data: TreeNode[]): string {
  const normalize = (node: TreeNode): [string, string, unknown[]] => [node.value, node.description ?? '', node.children.map(normalize)]
  return JSON.stringify(data.map(normalize))
}
export function displayVersionId(version: Version) {
  if (version.id === 'v0') return '00.00.000'
  if (!version.number) return version.id
  const { step, branch, subbranch } = version.number
  const base = `${String(step).padStart(2, '0')}.${String(branch).padStart(2, '0')}.${String(subbranch).padStart(3, '0')}`
  return version.numberSuffix ? `${base}.${version.numberSuffix}` : base
}

export function assignVersionSuffixes(versions: Version[], retired: RetiredVersionNumber[] = []) {
  const groups = new Map<string, { id: string; createdAt: number; suffix?: number; version?: Version }[]>()
  const liveIds = new Set(versions.map((version) => version.id))
  function add(id: string, number: VersionNumber, createdAt: number, suffix?: number, version?: Version) {
    const key = `${number.step}.${number.branch}.${number.subbranch}`
    const group = groups.get(key) ?? []
    group.push({ id, createdAt, suffix, version })
    groups.set(key, group)
  }
  for (const item of retired) if (!liveIds.has(item.id)) add(item.id, item.number, item.createdAt, item.suffix)
  for (const version of versions) {
    if (version.number) add(version.id, version.number, version.createdAt, undefined, version)
    else delete version.numberSuffix
  }
  for (const group of groups.values()) {
    const byCreation = (a: { id: string; createdAt: number }, b: { id: string; createdAt: number }) =>
      a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    // Keep retired labels reserved before assigning the remaining slots to live versions.
    const retiredItems = group.filter((item) => !item.version)
      .sort((a, b) => (a.suffix ?? 0) - (b.suffix ?? 0) || byCreation(a, b))
    const used = new Set<number>()
    const nextFree = () => { let index = 0; while (used.has(index)) index++; return index }
    for (const item of retiredItems) {
      const desired = item.suffix ?? 0
      used.add(used.has(desired) ? nextFree() : desired)
    }
    const liveItems = group.filter((item) => item.version)
      .sort(byCreation)
    for (const item of liveItems) {
      const index = nextFree()
      used.add(index)
      if (index) item.version!.numberSuffix = index
      else delete item.version!.numberSuffix
    }
  }
}

export function retireVersionNumbers(state: StoredState, versions: Version[]) {
  const retired = state.retiredVersionNumbers ??= []
  const keys = new Set(retired.map((item) => JSON.stringify([item.id, item.suffix ?? 0])))
  for (const version of versions) {
    const key = JSON.stringify([version.id, version.numberSuffix ?? 0])
    if (!version.number || keys.has(key)) continue
    retired.push({ id: version.id, number: { ...version.number }, createdAt: version.createdAt,
      ...(version.numberSuffix ? { suffix: version.numberSuffix } : {}) })
    keys.add(key)
  }
}

export function allocateVersionNumber(versions: Version[], parent: Version, id: string, owner: string, newBranch: boolean): VersionNumber {
  const parentNumber = parent.number
  if (parent.id !== 'v0' && parentNumber && !newBranch) {
    const sameOrigin = parentNumber.owner === owner
      && !versions.some((version) => version.parentId === parent.id && version.number?.origin === parentNumber.origin)
    return { ...parentNumber, step: parentNumber.step + 1,
      origin: sameOrigin ? parentNumber.origin : id, owner, scheme: 2 }
  }
  const branch = parentNumber?.branch ?? Math.max(0, ...versions.map((version) => version.number?.branch ?? 0)) + 1
  const subbranch = parent.id === 'v0' ? 1
    : Math.max(1, ...versions.filter((version) => version.number?.branch === branch)
      .map((version) => version.number?.subbranch ?? 0)) + 1
  return { step: (parentNumber?.step ?? 0) + 1, branch, subbranch, origin: id, owner, scheme: 2 }
}

export function assignMissingVersionNumbers(versions: Version[]) {
  const numbered: Version[] = []
  for (const version of [...versions].sort((a, b) => a.step - b.step || a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    if (version.id === 'v0') {
      numbered.push(version)
      continue
    }
    if (version.number?.scheme !== 2) {
      const parent = numbered.find((item) => item.id === version.parentId)
      if (!parent) continue
      const previous = version.number
      const owner = previous?.owner ?? version.createdBy ?? version.id.match(/-([a-f0-9]{12})$/)?.[1] ?? `legacy:${version.id}`
      const number = allocateVersionNumber(numbered, parent, version.id, owner, version.branch !== parent.branch)
      if (previous && parent.id === 'v0') number.branch = previous.branch
      version.number = previous ? { ...number, origin: previous.origin, owner: previous.owner } : number
    }
    numbered.push(version)
  }
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

