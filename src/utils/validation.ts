import type { CollaborationMetadata, CopyLink, Revision, StoredState, TreeNode, Version } from '../types/workspace'

export function isRevision(value: unknown): value is Revision {
  if (!value || typeof value !== 'object') return false
  const revision = value as Partial<Revision>
  return Number.isInteger(revision.clock) && revision.clock! >= 0
    && typeof revision.actor === 'string' && revision.actor.length > 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTreeNode(value: unknown): value is TreeNode {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.value !== 'string'
    || !Array.isArray(value.children)
    || (value.description !== undefined && typeof value.description !== 'string')) return false
  const pending = [...value.children]
  while (pending.length) {
    const node = pending.pop()
    if (!isRecord(node) || typeof node.id !== 'string' || typeof node.value !== 'string'
      || !Array.isArray(node.children)
      || (node.description !== undefined && typeof node.description !== 'string')) return false
    pending.push(...node.children)
  }
  return true
}

export function isVersion(value: unknown): value is Version {
  if (!isRecord(value) || typeof value.id !== 'string'
    || !(typeof value.parentId === 'string' || value.parentId === null)
    || (value.mergeSourceId !== undefined && typeof value.mergeSourceId !== 'string')
    || !Number.isFinite(value.step) || !Number.isFinite(value.lane)
    || typeof value.branch !== 'string' || typeof value.change !== 'string'
    || (value.createdBy !== undefined && typeof value.createdBy !== 'string')
    || !Number.isFinite(value.createdAt) || !Array.isArray(value.data)
    || !value.data.every(isTreeNode)) return false
  if (value.positions !== undefined
    && (!isRecord(value.positions) || !Object.values(value.positions).every((position) =>
      isRecord(position) && Number.isFinite(position.x) && Number.isFinite(position.y)))) return false
  return true
}

export function isCopyLink(value: unknown): value is CopyLink {
  return isRecord(value) && typeof value.sourceVersionId === 'string'
    && typeof value.sourceNodeId === 'string' && typeof value.targetVersionId === 'string'
    && typeof value.targetNodeId === 'string'
}

export function isCollaborationMetadata(value: unknown): value is CollaborationMetadata {
  return isRecord(value) && Number.isInteger(value.clock)
    && isRecord(value.versions) && Object.values(value.versions).every(isRevision)
    && isRecord(value.removed) && Object.values(value.removed).every(isRevision)
    && isRevision(value.active) && isRevision(value.copyLinks)
}

export function hasValidVersionStep(version: Version, parent: Version, mergeSource?: Version) {
  if (!version.mergeSourceId) return version.step === parent.step + 1
  if (!mergeSource || version.mergeSourceId === version.id) return false
  return version.step === Math.max(parent.step, mergeSource.step) + 1
    || version.step === parent.step + 1
}

export function isStoredState(value: unknown): value is StoredState {
  if (!isRecord(value) || !Array.isArray(value.versions) || !value.versions.every(isVersion)
    || typeof value.activeId !== 'string' || !Number.isInteger(value.nextNode)
    || !Number.isInteger(value.nextVersion) || !Number.isInteger(value.nextLane)
    || !Array.isArray(value.copyLinks) || !value.copyLinks.every(isCopyLink)) return false
  const versions = value.versions
  const byId = new Map(versions.map((version) => [version.id, version]))
  if (byId.size !== versions.length || !byId.has('v0') || !byId.has(value.activeId)) return false
  const root = byId.get('v0')!
  if (root.parentId !== null || root.step !== 0) return false
  for (const version of versions) {
    if (version.id === 'v0') continue
    const parent = version.parentId ? byId.get(version.parentId) : undefined
    const mergeSource = version.mergeSourceId ? byId.get(version.mergeSourceId) : undefined
    if (!parent || !hasValidVersionStep(version, parent, mergeSource)) return false
    const visited = new Set([version.id])
    let ancestor: Version | undefined = parent
    while (ancestor) {
      if (visited.has(ancestor.id)) return false
      visited.add(ancestor.id)
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
    }
    const nodeIds = new Set<string>()
    const pending = [...version.data]
    while (pending.length) {
      const node = pending.pop()!
      if (nodeIds.has(node.id)) return false
      nodeIds.add(node.id)
      pending.push(...node.children)
    }
  }
  return true
}

