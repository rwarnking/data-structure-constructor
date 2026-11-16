import type { CopyLink, RetiredVersionNumber, Revision, StoredState, Version } from '../types/workspace'
import { hasRootEntries, isCopyLink, isRecord, isRetiredVersionNumber, isRevision, isStoredState, isVersion, revisionIsNewer } from './validation'
import { findNode } from './tree'
import { assignVersionSuffixes, compareCopyLinks, reflowVersionLayout } from './versions'

export type InteractionActor = { id: string; name: string; color: string }
export type InteractionMethod = 'hotkey' | 'keyboard' | 'mouse' | 'button' | 'system'
export type InteractionCategory = 'state' | 'viewport' | 'selection' | 'input'
export type InteractionPatch = {
  versions: Version[]
  removed: string[]
  versionRevisions?: Record<string, Revision>
  removalRevisions?: Record<string, Revision>
  activeId: string
  nextNode: number
  nextVersion: number
  nextLane: number
  copyLinks?: CopyLink[]
  retiredVersionNumbers?: RetiredVersionNumber[]
  branching?: StoredState['branching']
}
export type InteractionEvent = {
  id: string
  actor: InteractionActor
  action: string
  category: InteractionCategory
  method: InteractionMethod
  inputTime: number
  changeTime: number
  cursor?: { x: number; y: number }
  parameters?: Record<string, string | number | boolean>
  patch?: InteractionPatch
  viewport?: { zoom: number; panX: number; panY: number }
  selection?: { versionId: string; nodeIds: string[] }
}
export type InteractionLog = {
  format: 'canopy-interaction-log'
  version: 1
  room: string
  initialState: StoredState
  initialViewport: { zoom: number; panX: number; panY: number }
  events: InteractionEvent[]
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
export type InteractionRevisions = { versions: Record<string, Revision>; removed: Record<string, Revision> }
export function newInteractionRevisions(): InteractionRevisions { return { versions: {}, removed: {} } }

export function interactionPatch(before: StoredState, after: StoredState): InteractionPatch {
  const previous = new Map(before.versions.map((version) => [version.id, version]))
  const current = new Set(after.versions.map((version) => version.id))
  return {
    versions: clone(after.versions.filter((version) => !same(previous.get(version.id), version))),
    removed: before.versions.filter((version) => !current.has(version.id)).map((version) => version.id),
    activeId: after.activeId, nextNode: after.nextNode, nextVersion: after.nextVersion, nextLane: after.nextLane,
    ...(!same(before.copyLinks, after.copyLinks) ? { copyLinks: clone(after.copyLinks) } : {}),
    ...(!same(before.retiredVersionNumbers, after.retiredVersionNumbers)
      ? { retiredVersionNumbers: clone(after.retiredVersionNumbers ?? []) } : {}),
    ...(!same(before.branching, after.branching) && after.branching ? { branching: clone(after.branching) } : {}),
  }
}

export function applyInteractionPatch(state: StoredState, patch: InteractionPatch, revisions = newInteractionRevisions()): StoredState {
  const previous = clone(state)
  const versions = new Map(previous.versions.map((version) => [version.id, version]))
  let structural = false
  for (const id of patch.removed) {
    const revision = patch.removalRevisions?.[id]
    if (revision) {
      if (!revisionIsNewer(revision, revisions.removed[id])) continue
      revisions.removed[id] = revision
      if (!revisionIsNewer(revision, revisions.versions[id])) continue
      delete revisions.versions[id]
    }
    if (versions.delete(id)) structural = true
  }
  for (const version of patch.versions) {
    const revision = patch.versionRevisions?.[version.id]
    if (revision) {
      if (!revisionIsNewer(revision, revisions.versions[version.id]) || revisionIsNewer(revisions.removed[version.id], revision)) continue
      revisions.versions[version.id] = revision
      delete revisions.removed[version.id]
    }
    const old = versions.get(version.id)
    if (!old || old.parentId !== version.parentId || old.mergeSourceId !== version.mergeSourceId) structural = true
    versions.set(version.id, clone(version))
  }
  const links = new Map(previous.copyLinks.map((link) => [JSON.stringify(link), link]))
  for (const link of patch.copyLinks ?? []) links.set(JSON.stringify(link), link)
  const copyLinks = [...links.values()].filter((link) => {
    const source = versions.get(link.sourceVersionId)
    const target = versions.get(link.targetVersionId)
    return !!source && !!target && !!findNode(source.data, link.sourceNodeId) && !!findNode(target.data, link.targetNodeId)
  }).sort(compareCopyLinks)
  const retired = new Map((previous.retiredVersionNumbers ?? [])
    .map((item) => [JSON.stringify([item.id, item.suffix ?? 0]), item]))
  for (const item of patch.retiredVersionNumbers ?? []) retired.set(JSON.stringify([item.id, item.suffix ?? 0]), item)
  const next = {
    ...previous,
    versions: [...versions.values()].sort((a, b) => a.step - b.step || a.id.localeCompare(b.id)),
    activeId: versions.has(patch.activeId) ? patch.activeId : versions.has(state.activeId) ? state.activeId : 'v0',
    nextNode: Math.max(state.nextNode, patch.nextNode),
    nextVersion: Math.max(state.nextVersion, patch.nextVersion),
    nextLane: Math.max(state.nextLane, patch.nextLane),
    copyLinks: clone(copyLinks),
    ...(retired.size ? { retiredVersionNumbers: clone([...retired.values()]) } : {}),
    ...(patch.branching && revisionIsNewer(patch.branching.revision, previous.branching?.revision)
      ? { branching: clone(patch.branching) } : {}),
  }
  if (structural) reflowVersionLayout(next)
  assignVersionSuffixes(next.versions, next.retiredVersionNumbers)
  if (!isStoredState(next) || hasRootEntries(next)) throw new Error('Interaction produces an invalid room state')
  return next
}

function isViewport(value: unknown): value is NonNullable<InteractionEvent['viewport']> {
  return isRecord(value) && Number.isFinite(value.zoom) && (value.zoom as number) > 0
    && Number.isFinite(value.panX) && Number.isFinite(value.panY)
}

export function isInteractionEvent(value: unknown): value is InteractionEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isRecord(value.actor)
    || typeof value.actor.id !== 'string' || !value.actor.id || typeof value.actor.name !== 'string'
    || typeof value.actor.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.actor.color)
    || typeof value.action !== 'string' || !value.action
    || !['state', 'viewport', 'selection', 'input'].includes(String(value.category))
    || !['hotkey', 'keyboard', 'mouse', 'button', 'system'].includes(String(value.method))
    || !Number.isFinite(value.inputTime) || !Number.isFinite(value.changeTime)
    || (value.changeTime as number) < (value.inputTime as number)) return false
  if (value.cursor !== undefined && (!isRecord(value.cursor) || !Number.isFinite(value.cursor.x)
    || !Number.isFinite(value.cursor.y))) return false
  if (value.parameters !== undefined && (!isRecord(value.parameters) || !Object.values(value.parameters)
    .every((item) => typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)))) return false
  if (value.viewport !== undefined && !isViewport(value.viewport)) return false
  if (value.selection !== undefined && (!isRecord(value.selection) || typeof value.selection.versionId !== 'string'
    || !Array.isArray(value.selection.nodeIds) || !value.selection.nodeIds.every((id) => typeof id === 'string'))) return false
  if (value.patch !== undefined) {
    const patch = value.patch
    if (!isRecord(patch) || !Array.isArray(patch.versions) || !patch.versions.every(isVersion)
      || !Array.isArray(patch.removed) || !patch.removed.every((id) => typeof id === 'string')
      || (patch.versionRevisions !== undefined && (!isRecord(patch.versionRevisions)
        || !Object.values(patch.versionRevisions).every(isRevision)))
      || (patch.removalRevisions !== undefined && (!isRecord(patch.removalRevisions)
        || !Object.values(patch.removalRevisions).every(isRevision)))
      || typeof patch.activeId !== 'string' || ![patch.nextNode, patch.nextVersion, patch.nextLane]
        .every((counter) => Number.isSafeInteger(counter) && (counter as number) > 0)
      || (patch.copyLinks !== undefined && (!Array.isArray(patch.copyLinks) || !patch.copyLinks.every(isCopyLink)))
      || (patch.retiredVersionNumbers !== undefined && (!Array.isArray(patch.retiredVersionNumbers)
        || !patch.retiredVersionNumbers.every(isRetiredVersionNumber)))
      || (patch.branching !== undefined && (!isRecord(patch.branching) || typeof patch.branching.enabled !== 'boolean'
        || !isRecord(patch.branching.revision) || !Number.isInteger(patch.branching.revision.clock)
        || typeof patch.branching.revision.actor !== 'string'))) return false
  }
  return (value.category !== 'state' || value.patch !== undefined)
    && (value.category !== 'viewport' || value.viewport !== undefined)
    && (value.category !== 'selection' || value.selection !== undefined)
}

export function parseInteractionLog(value: unknown): InteractionLog {
  if (!isRecord(value) || value.format !== 'canopy-interaction-log' || value.version !== 1
    || typeof value.room !== 'string' || !value.room.trim() || !isStoredState(value.initialState)
    || hasRootEntries(value.initialState) || !isViewport(value.initialViewport)
    || !Array.isArray(value.events) || !value.events.every(isInteractionEvent)
    || new Set(value.events.map((event) => event.id)).size !== value.events.length) {
    throw new Error('Invalid or unsupported interaction log')
  }
  const events = [...value.events].sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id))
  let state = value.initialState
  const revisions = newInteractionRevisions()
  for (const event of events) if (event.patch) state = applyInteractionPatch(state, event.patch, revisions)
  return { format: 'canopy-interaction-log', version: 1, room: value.room,
    initialState: value.initialState, initialViewport: value.initialViewport, events }
}
