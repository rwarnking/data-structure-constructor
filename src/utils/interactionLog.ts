import type { CopyLink, EditorState, EntryOperation, RetiredVersionNumber, Revision, StoredState, Version } from '../types/workspace'
import { hasRootEntries, isCopyLink, isRecord, isRetiredVersionNumber, isRevision, isStoredState, isVersion, revisionIsNewer } from './validation'
import { findNode } from './tree'
import { assignVersionSuffixes, compareCopyLinks, reflowVersionLayout } from './versions'

export type InteractionActor = { id: string; name: string; color: string }
export type InteractionMethod = 'hotkey' | 'keyboard' | 'mouse' | 'button' | 'system'
export type InteractionCategory = 'state' | 'viewport' | 'selection' | 'input'
export type InteractionScreen = {
  width: number
  height: number
  sidebarCollapsed?: boolean
  actionSidebarCollapsed?: boolean
}
export type InteractionPatch = {
  versions: Version[]
  removed: string[]
  dependencies?: Version[]
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
export type InteractionDialog = {
  editor: EditorState | null
  operation: EntryOperation | null
  deleteOpen: boolean
  deleteMode: 'keep-children' | 'subtree' | 'detach-children'
}
export type InteractionMergeDialog = {
  versionIds: string[]
  decisions: Record<string, 'combine' | 'source' | 'target' | 'omit'>
  parentOverrides: Record<string, string>
  positionOverrides: Record<string, { x: number; y: number }>
}
export type InteractionTagDialog = { versionId: string; title: string; description: string }
export type InteractionEvent = {
  id: string
  sessionId?: string
  actor: InteractionActor
  action: string
  category: InteractionCategory
  method: InteractionMethod
  inputTime: number
  changeTime: number
  cursor?: { x: number; y: number }
  screen?: InteractionScreen
  parameters?: Record<string, string | number | boolean>
  patch?: InteractionPatch
  viewport?: { zoom: number; panX: number; panY: number }
  selection?: { versionId: string; nodeIds: string[] }
  dialog?: InteractionDialog
  mergeDialog?: InteractionMergeDialog | null
  tagDialog?: InteractionTagDialog | null
}
export type InteractionSession = {
  id: string
  actor: InteractionActor
  startedAt: number
  endedAt?: number
  initialState: StoredState
  initialViewport: { zoom: number; panX: number; panY: number }
  initialScreen?: InteractionScreen
  eventIds: string[]
}
export type InteractionLog = {
  format: 'canopy-interaction-log'
  version: 1
  room: string
  initialState: StoredState
  initialViewport: { zoom: number; panX: number; panY: number }
  events: InteractionEvent[]
  sessions?: InteractionSession[]
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
  // Dependencies restore missing ancestry without overwriting newer versions or tombstones.
  for (const version of patch.dependencies ?? []) {
    if (versions.has(version.id) || revisions.removed[version.id] || patch.removed.includes(version.id)) continue
    versions.set(version.id, clone(version))
    structural = true
  }
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

function isScreen(value: unknown): value is InteractionScreen {
  return isRecord(value) && Number.isFinite(value.width) && (value.width as number) > 0
    && Number.isFinite(value.height) && (value.height as number) > 0
    && (value.sidebarCollapsed === undefined || typeof value.sidebarCollapsed === 'boolean')
    && (value.actionSidebarCollapsed === undefined || typeof value.actionSidebarCollapsed === 'boolean')
}

function isActor(value: unknown): value is InteractionActor {
  return isRecord(value) && typeof value.id === 'string' && !!value.id
    && typeof value.name === 'string' && typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isDrafts(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item)
    && typeof item.id === 'string' && typeof item.value === 'string' && typeof item.description === 'string')
}

function isInteractionDialog(value: unknown): value is InteractionDialog {
  if (!isRecord(value) || typeof value.deleteOpen !== 'boolean'
    || !['keep-children', 'subtree', 'detach-children'].includes(String(value.deleteMode))) return false
  const editor = value.editor
  if (editor !== null && (!isRecord(editor) || (editor.mode === 'create'
    ? !(editor.parentId === null || typeof editor.parentId === 'string') || !isDrafts(editor.entries)
      || (editor.parentOf !== undefined && !isStringArray(editor.parentOf))
      || (editor.childOf !== undefined && !isStringArray(editor.childOf))
    : editor.mode !== 'rename' || editor.parentId !== null || typeof editor.nodeId !== 'string'
      || typeof editor.value !== 'string' || typeof editor.description !== 'string'))) return false
  const operation = value.operation
  if (operation !== null && (!isRecord(operation) || (operation.mode === 'split'
    ? typeof operation.nodeId !== 'string' || !isDrafts(operation.entries) || !isRecord(operation.assignments)
      || !Object.values(operation.assignments).every((item) => typeof item === 'string')
    : operation.mode !== 'merge' || !isStringArray(operation.nodeIds)
      || typeof operation.value !== 'string' || typeof operation.description !== 'string'))) return false
  return true
}

function isInteractionMergeDialog(value: unknown): value is InteractionMergeDialog {
  return isRecord(value) && isStringArray(value.versionIds) && value.versionIds.length >= 1
    && value.versionIds.length <= 2 && value.versionIds.every((id) => !!id)
    && new Set(value.versionIds).size === value.versionIds.length
    && isRecord(value.decisions) && Object.values(value.decisions)
      .every((decision) => typeof decision === 'string' && ['combine', 'source', 'target', 'omit'].includes(decision))
    && isRecord(value.parentOverrides) && Object.values(value.parentOverrides).every((parent) => typeof parent === 'string')
    && isRecord(value.positionOverrides) && Object.values(value.positionOverrides).every((position) =>
      isRecord(position) && typeof position.x === 'number' && Number.isFinite(position.x)
      && typeof position.y === 'number' && Number.isFinite(position.y))
}

function isInteractionSession(value: unknown): value is InteractionSession {
  return isRecord(value) && typeof value.id === 'string' && !!value.id && isActor(value.actor)
    && typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
    && (value.endedAt === undefined || typeof value.endedAt === 'number'
      && Number.isFinite(value.endedAt) && value.endedAt >= value.startedAt)
    && isStoredState(value.initialState) && !hasRootEntries(value.initialState)
    && isViewport(value.initialViewport)
    && (value.initialScreen === undefined || isScreen(value.initialScreen))
    && Array.isArray(value.eventIds) && value.eventIds.every((id) => typeof id === 'string')
}

function sessionBoundary(event: InteractionEvent) {
  const boundary = event.parameters?.sessionBoundary
  if (boundary === 'login' || event.action === 'Login' || event.action === 'Joined room') return 'login'
  if (boundary === 'logout' || event.action === 'Logout' || event.action === 'Left room') return 'logout'
  return undefined
}

function normalizeSessions(events: InteractionEvent[], initialState: StoredState,
  initialViewport: InteractionLog['initialViewport'], sourceSessions: InteractionSession[] = []) {
  const sessions = new Map<string, InteractionSession>()
  for (const source of sourceSessions) sessions.set(source.id, { ...clone(source), eventIds: [] })
  const active = new Map<string, string>()
  const counters = new Map<string, number>()
  const normalizedEvents: InteractionEvent[] = []

  for (const event of events) {
    const boundary = sessionBoundary(event)
    let id = event.sessionId
    if (!id && boundary === 'login') {
      const count = (counters.get(event.actor.id) ?? 0) + 1
      counters.set(event.actor.id, count)
      id = `${event.actor.id}:session:${count}`
    }
    id ??= active.get(event.actor.id) ?? `${event.actor.id}:legacy`
    let session = sessions.get(id)
    if (session && session.actor.id !== event.actor.id) throw new Error('Interaction session actor mismatch')
    if (!session) {
      session = { id, actor: clone(event.actor), startedAt: event.changeTime,
        initialState: clone(initialState), initialViewport: clone(initialViewport), eventIds: [] }
      sessions.set(id, session)
    }
    session.eventIds.push(event.id)
    if (boundary === 'login') {
      session.startedAt = event.changeTime
      active.set(event.actor.id, id)
    }
    else if (!event.sessionId && !active.has(event.actor.id)) active.set(event.actor.id, id)
    if (boundary === 'logout') {
      session.endedAt = event.changeTime
      if (active.get(event.actor.id) === id) active.delete(event.actor.id)
    }
    normalizedEvents.push({ ...event, sessionId: id })
  }
  return { events: normalizedEvents, sessions: [...sessions.values()] }
}

export function isInteractionEvent(value: unknown): value is InteractionEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isActor(value.actor)
    || value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !value.sessionId)
    || typeof value.action !== 'string' || !value.action
    || !['state', 'viewport', 'selection', 'input'].includes(String(value.category))
    || !['hotkey', 'keyboard', 'mouse', 'button', 'system'].includes(String(value.method))
    || !Number.isFinite(value.inputTime) || !Number.isFinite(value.changeTime)
    || (value.changeTime as number) < (value.inputTime as number)) return false
  if (value.cursor !== undefined && (!isRecord(value.cursor) || !Number.isFinite(value.cursor.x)
    || !Number.isFinite(value.cursor.y))) return false
  if (value.screen !== undefined && !isScreen(value.screen)) return false
  if (value.parameters !== undefined && (!isRecord(value.parameters) || !Object.values(value.parameters)
    .every((item) => typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)))) return false
  if (value.viewport !== undefined && !isViewport(value.viewport)) return false
  if (value.selection !== undefined && (!isRecord(value.selection) || typeof value.selection.versionId !== 'string'
    || !Array.isArray(value.selection.nodeIds) || !value.selection.nodeIds.every((id) => typeof id === 'string'))) return false
  if (value.dialog !== undefined && !isInteractionDialog(value.dialog)) return false
  if (value.mergeDialog !== undefined && value.mergeDialog !== null && !isInteractionMergeDialog(value.mergeDialog)) return false
  if (value.tagDialog !== undefined && value.tagDialog !== null
    && (!isRecord(value.tagDialog) || typeof value.tagDialog.versionId !== 'string' || !value.tagDialog.versionId
      || typeof value.tagDialog.title !== 'string' || typeof value.tagDialog.description !== 'string')) return false
  if (value.patch !== undefined) {
    const patch = value.patch
    if (!isRecord(patch) || !Array.isArray(patch.versions) || !patch.versions.every(isVersion)
      || !Array.isArray(patch.removed) || !patch.removed.every((id) => typeof id === 'string')
      || (patch.dependencies !== undefined && (!Array.isArray(patch.dependencies) || !patch.dependencies.every(isVersion)))
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

export function parseInteractionLog(value: unknown, validateReplay = true): InteractionLog {
  if (!isRecord(value) || value.format !== 'canopy-interaction-log' || value.version !== 1
    || typeof value.room !== 'string' || !value.room.trim() || !isStoredState(value.initialState)
    || hasRootEntries(value.initialState) || !isViewport(value.initialViewport)
    || !Array.isArray(value.events) || !value.events.every(isInteractionEvent)
    || new Set(value.events.map((event) => event.id)).size !== value.events.length
    || value.sessions !== undefined && (!Array.isArray(value.sessions) || !value.sessions.every(isInteractionSession)
      || new Set(value.sessions.map((session) => session.id)).size !== value.sessions.length)) {
    throw new Error('Invalid or unsupported interaction log')
  }
  const events = [...value.events].sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id))
  const normalized = normalizeSessions(events, value.initialState, value.initialViewport, value.sessions as InteractionSession[] | undefined)
  let state = value.initialState
  const revisions = newInteractionRevisions()
  if (validateReplay) {
    const sessions = new Map(normalized.sessions.map((session) => [session.id, {
      state: session.initialState, revisions: newInteractionRevisions(),
    }]))
    for (const event of normalized.events) {
      if (!event.patch) continue
      // Observations replay a participant's view, not an additional shared edit.
      if (event.parameters?.localObservation !== true) state = applyInteractionPatch(state, event.patch, revisions)
      const session = sessions.get(event.sessionId!)
      if (!session) throw new Error('Interaction session is missing')
      session.state = applyInteractionPatch(session.state, event.patch, session.revisions)
    }
  }
  return { format: 'canopy-interaction-log', version: 1, room: value.room,
    initialState: value.initialState, initialViewport: value.initialViewport, events: normalized.events,
    sessions: normalized.sessions }
}
