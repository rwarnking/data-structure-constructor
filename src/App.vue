<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { hierarchy, treemap } from 'd3-hierarchy'
import { getClientId, PeerRoom, type RoomStatus } from './collaboration'
import {
  GitBranch, GitCompareArrows, Plus, Maximize, Search, Copy, Trash2,
  Pencil, Unlink, ChevronDown, X, Check, Layers3, ClipboardPaste,
  ZoomIn, ZoomOut, RotateCcw, MoreHorizontal,
} from '@lucide/vue'

type TreeNode = { id: string; value: string; description?: string; children: TreeNode[] }
type CopyLink = { sourceVersionId: string; sourceNodeId: string; targetVersionId: string; targetNodeId: string }
type ClipboardEntry = { sourceVersionId: string; node: TreeNode }
type MapView = { zoom: number; panX: number; panY: number; manual: boolean }
type Version = {
  id: string
  parentId: string | null
  step: number
  lane: number
  branch: string
  change: string
  data: TreeNode[]
  positions?: Record<string, { x: number; y: number }>
  mapView?: MapView
  createdAt: number
}
type Tile = { id: string; label: string; x: number; y: number; width: number; height: number; depth: number }
type StoredState = { versions: Version[]; activeId: string; nextNode: number; nextVersion: number; nextLane: number; copyLinks: CopyLink[] }
type EditorState = { mode: 'create' | 'rename'; parentId: string | null; nodeId: string | null; value: string; description: string }
type Revision = { clock: number; actor: string }
type VersionChange = { version: Version; revision: Revision }
type VersionRemoval = { id: string; revision: Revision }
type SyncDelta = {
  type: 'sync-delta'
  versions: VersionChange[]
  removed: VersionRemoval[]
  active?: { id: string; revision: Revision }
  copyLinks?: { links: CopyLink[]; revision: Revision }
  nextNode: number
  nextVersion: number
  nextLane: number
}
type SyncSnapshot = {
  type: 'sync-snapshot'
  state: StoredState
  versions: Record<string, Revision>
  removed: Record<string, Revision>
  active: Revision
  copyLinks: Revision
  clock: number
}
type CollaborationMetadata = {
  clock: number
  versions: Record<string, Revision>
  removed: Record<string, Revision>
  active: Revision
  copyLinks: Revision
}

const STORAGE_KEY = 'canopy-data-structure-v1'
const CLIENT_ID = getClientId()
const DEV_WORKSPACE_API = import.meta.env.DEV
const CARD_WIDTH = 260
const CARD_HEIGHT = 260
const GRAPH_GAP_X = 170
const GRAPH_GAP_Y = 72
const TERMINAL_TAIL_LENGTH = 120
const TERMINAL_ARROW_SIZE = 1.6
const TERMINAL_ARROW_BASE_INSET = 0.3
const TREE_MAP_HEIGHT = CARD_HEIGHT - 40
const LEAF_TILE_WIDTH = 152
const LEAF_TILE_HEIGHT = 106
const TREE_PADDING = 8
const TREE_HEADER_HEIGHT = 28
const MAP_PADDING = 12
const MAP_GAP = 12
const MAP_ZOOM_MIN = 0.0001
const MAP_ZOOM_MAX = 8
const ZOOM_MAX = 4
const branchColors = ['#176b68', '#d15a3b', '#a58127', '#4774a8', '#8a5c83', '#5b7d46']
const seed: StoredState = {
  versions: [{
    id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure',
    data: [], createdAt: Date.now(),
  }],
  activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 3, copyLinks: [],
}

function readState(): StoredState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return normalizeState(JSON.parse(saved) as Partial<StoredState>)
    }
  } catch { /* Start with a clean graph if saved data is unreadable. */ }
  return structuredClone(seed)
}

function normalizeState(value: Partial<StoredState>): StoredState {
  return {
    ...clone(seed), ...value,
    versions: (value.versions ?? clone(seed.versions)).map((version) => {
      const positions = version.positions ?? {}
      const firstRoot = version.data[0]
      const savedView = version.mapView
      const validView = savedView && Number.isFinite(savedView.zoom) && savedView.zoom > 0
        && Number.isFinite(savedView.panX) && Number.isFinite(savedView.panY)
        && typeof savedView.manual === 'boolean'
      return {
        ...version,
        mapView: validView ? {
          ...savedView,
          zoom: Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, savedView.zoom)),
        } : undefined,
        positions: firstRoot
          ? positionsAfterMove(version.data, positions, firstRoot.id, positions[firstRoot.id] ?? defaultPositions(version.data, positions)[firstRoot.id]!)
          : positions,
      }
    }),
    copyLinks: [...(value.copyLinks ?? [])].sort(compareCopyLinks),
  }
}

const state = ref<StoredState>(readState())
const versions = computed(() => state.value.versions)
const active = computed(() => versions.value.find((version) => version.id === state.value.activeId) ?? versions.value[0]!)
const selectedNode = ref<string | null>(null)
const deletionMode = ref<'subtree' | 'detach'>('subtree')
const sidebarCollapsed = ref(false)
const compareMode = ref(false)
const compareIds = ref<string[]>([])
const zoom = ref(1)
const pan = ref({ x: 40, y: 0 })
const graphCanvas = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: window.innerWidth, height: Math.max(400, window.innerHeight - 209) })
let canvasObserver: ResizeObserver | null = null
let panAnimationFrame: number | null = null
const draggingCanvas = ref(false)
const dragOrigin = ref({ x: 0, y: 0, panX: 0, panY: 0 })
const draggedNode = ref<string | null>(null)
const overNode = ref<string | null>(null)
const invalidNode = ref<string | null>(null)
const treeDrag = ref<{
  id: string
  x: number
  y: number
  moved: boolean
  targetBounds?: { id: string; left: number; right: number; top: number; bottom: number }
  space?: {
    scaleX: number
    scaleY: number
    pointer: { x: number; y: number }
    rootId: string | null
    rootPosition: { x: number; y: number }
  }
} | null>(null)
const spatialPreview = ref<{ x: number; y: number; versionId: string; nodeId: string; parentId?: string } | null>(null)
const mapPanDrag = ref<{
  versionId: string
  pointerId: number
  x: number
  y: number
  panX: number
  panY: number
  moved: boolean
} | null>(null)
const transientMapViews = ref<Record<string, MapView>>({})
const mapViewTimers = new Map<string, number>()
let suppressVersionClick = false
let suppressTileClick = false
const menu = ref<{ x: number; y: number; nodeId: string | null; versionId?: string | null } | null>(null)
const editor = ref<EditorState | null>(null)
const clipboard = ref<ClipboardEntry | null>(readClipboard())
const toast = ref('')
const persistenceLabel = ref('Saved locally')
const roomInput = ref(new URLSearchParams(location.search).get('room') ?? '')
const roomStatus = ref<RoomStatus>({ state: 'idle', peers: 0, message: 'Not connected' })
const peerRoom = new PeerRoom()
const collaborationLabel = computed(() => roomStatus.value.state === 'connected' || roomStatus.value.state === 'hosting'
  ? `${roomStatus.value.peers} peer${roomStatus.value.peers === 1 ? '' : 's'}`
  : roomStatus.value.message)
let toastTimer = 0
let persistenceQueue = Promise.resolve()
let skipNextPersist = false
let collaborationRoom = ''
let collaborationMetadata: CollaborationMetadata | null = null
let lastObservedState = JSON.stringify(state.value)
let applyingRemoteState = false

watch(state, (value) => {
  const snapshot = JSON.stringify(value)
  localStorage.setItem(STORAGE_KEY, snapshot)
  if (!applyingRemoteState && snapshot !== lastObservedState) publishLocalChanges(value)
  lastObservedState = snapshot
  if (skipNextPersist) {
    skipNextPersist = false
    return
  }
  if (!DEV_WORKSPACE_API) return
  persistenceQueue = persistenceQueue.then(async () => {
    const response = await fetch('/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot,
    })
    if (!response.ok) throw new Error('Server save failed')
    persistenceLabel.value = 'Saved on server'
  }).catch(() => { persistenceLabel.value = 'Saved locally' })
}, { deep: true })

function revisionIsNewer(candidate: Revision | undefined, current: Revision | undefined) {
  return !!candidate && (!current || candidate.clock > current.clock
    || (candidate.clock === current.clock && candidate.actor.localeCompare(current.actor) > 0))
}

function compareCopyLinks(left: CopyLink, right: CopyLink) {
  return left.sourceVersionId.localeCompare(right.sourceVersionId)
    || left.sourceNodeId.localeCompare(right.sourceNodeId)
    || left.targetVersionId.localeCompare(right.targetVersionId)
    || left.targetNodeId.localeCompare(right.targetNodeId)
}

function metadataKey(room: string) {
  return `canopy-collaboration-${room}`
}

function newRevision(clock: number): Revision {
  return { clock, actor: CLIENT_ID }
}

function initializeCollaborationMetadata(room: string) {
  collaborationRoom = room
  const raw = localStorage.getItem(metadataKey(room))
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw)
      if (isCollaborationMetadata(value)) {
        collaborationMetadata = value
      }
    } catch {
      collaborationMetadata = null
    }
  }
  if (!collaborationMetadata) {
    const baseline = newRevision(1)
    collaborationMetadata = {
      clock: 1,
      versions: Object.fromEntries(state.value.versions.map((version) => [version.id, baseline])),
      removed: {},
      active: baseline,
      copyLinks: baseline,
    }
  } else {
    for (const version of state.value.versions) {
      collaborationMetadata.versions[version.id] ??= newRevision(collaborationMetadata.clock)
    }
  }
  persistCollaborationMetadata()
}

function persistCollaborationMetadata() {
  if (collaborationMetadata && collaborationRoom) {
    localStorage.setItem(metadataKey(collaborationRoom), JSON.stringify(collaborationMetadata))
  }
}

function publishLocalChanges(value: StoredState) {
  const previous = JSON.parse(lastObservedState) as StoredState
  if (!collaborationMetadata || !collaborationRoom) return
  const clock = ++collaborationMetadata.clock
  const revision = newRevision(clock)
  const previousVersions = new Map(previous.versions.map((version) => [version.id, version]))
  const currentVersions = new Map(value.versions.map((version) => [version.id, version]))
  const changed: VersionChange[] = []
  const removed: VersionRemoval[] = []
  for (const version of value.versions) {
    if (JSON.stringify(previousVersions.get(version.id)) === JSON.stringify(version)) continue
    collaborationMetadata.versions[version.id] = revision
    delete collaborationMetadata.removed[version.id]
    changed.push({ version, revision })
  }
  for (const version of previous.versions) {
    if (currentVersions.has(version.id)) continue
    collaborationMetadata.removed[version.id] = revision
    delete collaborationMetadata.versions[version.id]
    removed.push({ id: version.id, revision })
  }
  const active = previous.activeId !== value.activeId
    ? (collaborationMetadata.active = revision, { id: value.activeId, revision })
    : undefined
  const copyLinks = JSON.stringify(previous.copyLinks) !== JSON.stringify(value.copyLinks)
    ? (collaborationMetadata.copyLinks = revision, { links: value.copyLinks, revision })
    : undefined
  const delta: SyncDelta = {
    type: 'sync-delta', versions: changed, removed, active, copyLinks,
    nextNode: value.nextNode, nextVersion: value.nextVersion, nextLane: value.nextLane,
  }
  persistCollaborationMetadata()
  peerRoom.send(delta)
}

function isRevision(value: unknown): value is Revision {
  if (!value || typeof value !== 'object') return false
  const revision = value as Partial<Revision>
  return Number.isInteger(revision.clock) && revision.clock! >= 0
    && typeof revision.actor === 'string' && revision.actor.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function isVersion(value: unknown): value is Version {
  if (!isRecord(value) || typeof value.id !== 'string'
    || !(typeof value.parentId === 'string' || value.parentId === null)
    || !Number.isFinite(value.step) || !Number.isFinite(value.lane)
    || typeof value.branch !== 'string' || typeof value.change !== 'string'
    || !Number.isFinite(value.createdAt) || !Array.isArray(value.data)
    || !value.data.every(isTreeNode)) return false
  if (value.positions !== undefined
    && (!isRecord(value.positions) || !Object.values(value.positions).every((position) =>
      isRecord(position) && Number.isFinite(position.x) && Number.isFinite(position.y)))) return false
  return true
}

function isCopyLink(value: unknown): value is CopyLink {
  return isRecord(value) && typeof value.sourceVersionId === 'string'
    && typeof value.sourceNodeId === 'string' && typeof value.targetVersionId === 'string'
    && typeof value.targetNodeId === 'string'
}

function isCollaborationMetadata(value: unknown): value is CollaborationMetadata {
  return isRecord(value) && Number.isInteger(value.clock)
    && isRecord(value.versions) && Object.values(value.versions).every(isRevision)
    && isRecord(value.removed) && Object.values(value.removed).every(isRevision)
    && isRevision(value.active) && isRevision(value.copyLinks)
}

function isStoredState(value: unknown): value is StoredState {
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
    if (!parent || version.step !== parent.step + 1) return false
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

function sendSyncSnapshot(reply: (message: unknown) => void) {
  if (!collaborationMetadata) return
  const snapshot: SyncSnapshot = {
    type: 'sync-snapshot',
    state: clone(state.value),
    versions: clone(collaborationMetadata.versions),
    removed: clone(collaborationMetadata.removed),
    active: clone(collaborationMetadata.active),
    copyLinks: clone(collaborationMetadata.copyLinks),
    clock: collaborationMetadata.clock,
  }
  reply(snapshot)
}

function applySyncSnapshot(message: SyncSnapshot) {
  if (!isStoredState(message.state) || !isRevision(message.active) || !isRevision(message.copyLinks)
    || !Number.isFinite(message.clock) || !isRecord(message.versions) || !isRecord(message.removed)
    || !Object.values(message.versions).every(isRevision) || !Object.values(message.removed).every(isRevision)) {
    notify('Ignored an invalid shared-state snapshot')
    return
  }
  collaborationMetadata = {
    clock: Object.values(message.versions).reduce(
      (clock, revision) => Math.max(clock, revision.clock),
      Math.max(1, message.clock, message.active.clock),
    ),
    versions: message.versions,
    removed: message.removed,
    active: message.active,
    copyLinks: message.copyLinks,
  }
  state.value = normalizeState(message.state)
  reflowLayout()
  lastObservedState = JSON.stringify(state.value)
  applyingRemoteState = true
  persistCollaborationMetadata()
  localStorage.setItem(STORAGE_KEY, lastObservedState)
  void nextTick(() => { applyingRemoteState = false })
}

function applySyncDelta(message: SyncDelta) {
  if (!collaborationMetadata || !Array.isArray(message.versions) || !Array.isArray(message.removed)
    || !Number.isInteger(message.nextNode) || !Number.isInteger(message.nextVersion)
    || !Number.isInteger(message.nextLane)) {
    notify('Ignored an invalid shared-state update')
    return
  }
  const versionsById = new Map(state.value.versions.map((version) => [version.id, version]))
  let changed = false
  for (const change of message.versions) {
    if (change && isRevision(change.revision)) collaborationMetadata.clock = Math.max(collaborationMetadata.clock, change.revision.clock)
  }
  for (const removal of message.removed) {
    if (removal && isRevision(removal.revision)) collaborationMetadata.clock = Math.max(collaborationMetadata.clock, removal.revision.clock)
  }
  for (const removal of message.removed) {
    if (!removal || removal.id === 'v0' || typeof removal.id !== 'string' || !isRevision(removal.revision)
      || !revisionIsNewer(removal.revision, collaborationMetadata.removed[removal.id])) continue
    collaborationMetadata.removed[removal.id] = removal.revision
    const currentRevision = collaborationMetadata.versions[removal.id]
    if (revisionIsNewer(removal.revision, currentRevision)) {
      versionsById.delete(removal.id)
      delete collaborationMetadata.versions[removal.id]
      changed = true
    }
  }
  for (const change of message.versions) {
    if (!change || !isVersion(change.version) || !isRevision(change.revision)) {
      notify('Ignored an invalid shared version update')
      continue
    }
    const parent = change.version.parentId ? versionsById.get(change.version.parentId) : undefined
    const validParent = change.version.id === 'v0'
      ? change.version.parentId === null && change.version.step === 0
      : !!parent && change.version.step === parent.step + 1
    if (!validParent) {
      notify('Ignored a shared version with a missing or invalid parent')
      continue
    }
    const currentRevision = collaborationMetadata.versions[change.version.id]
    const removedRevision = collaborationMetadata.removed[change.version.id]
    if (!revisionIsNewer(change.revision, currentRevision) || revisionIsNewer(removedRevision, change.revision)) continue
    collaborationMetadata.versions[change.version.id] = change.revision
    delete collaborationMetadata.removed[change.version.id]
    versionsById.set(change.version.id, change.version)
    changed = true
  }
  let removedOrphan = true
  while (removedOrphan) {
    removedOrphan = false
    for (const [id, version] of versionsById) {
      if (id === 'v0' || !version.parentId || versionsById.has(version.parentId)) continue
      const currentRevision = collaborationMetadata.versions[id]
      const parentRemoval = collaborationMetadata.removed[version.parentId]
      const removalRevision = revisionIsNewer(currentRevision, parentRemoval) ? currentRevision : parentRemoval
      if (removalRevision) collaborationMetadata.removed[id] = removalRevision
      delete collaborationMetadata.versions[id]
      versionsById.delete(id)
      changed = true
      removedOrphan = true
    }
  }
  if (message.active && typeof message.active.id === 'string' && isRevision(message.active.revision)
    && versionsById.has(message.active.id)
    && revisionIsNewer(message.active.revision, collaborationMetadata.active)) {
    collaborationMetadata.clock = Math.max(collaborationMetadata.clock, message.active.revision.clock)
    collaborationMetadata.active = message.active.revision
    if (state.value.activeId !== message.active.id) changed = true
    state.value.activeId = message.active.id
  }
  if (message.copyLinks && Array.isArray(message.copyLinks.links)
    && message.copyLinks.links.every(isCopyLink) && isRevision(message.copyLinks.revision)) {
    collaborationMetadata.clock = Math.max(collaborationMetadata.clock, message.copyLinks.revision.clock)
    const merged = new Map(state.value.copyLinks.map((link) => [JSON.stringify(link), link]))
    for (const link of message.copyLinks.links) merged.set(JSON.stringify(link), link)
    const links = [...merged.values()].sort(compareCopyLinks)
    if (links.length !== state.value.copyLinks.length) {
      state.value.copyLinks = links
      changed = true
    }
    if (revisionIsNewer(message.copyLinks.revision, collaborationMetadata.copyLinks)) {
      collaborationMetadata.copyLinks = message.copyLinks.revision
    }
  }
  const nextNode = Math.max(state.value.nextNode, message.nextNode || 1)
  const nextVersion = Math.max(state.value.nextVersion, message.nextVersion || 1)
  const nextLane = Math.max(state.value.nextLane, message.nextLane || 1)
  if (nextNode !== state.value.nextNode || nextVersion !== state.value.nextVersion || nextLane !== state.value.nextLane) changed = true
  state.value.nextNode = nextNode
  state.value.nextVersion = nextVersion
  state.value.nextLane = nextLane
  if (!versionsById.has(state.value.activeId)) {
    state.value.activeId = versionsById.has('v0') ? 'v0' : versionsById.keys().next().value ?? ''
    changed = true
  }
  if (!changed) {
    persistCollaborationMetadata()
    return
  }
  state.value.versions = [...versionsById.values()].sort((left, right) =>
    left.step - right.step || left.id.localeCompare(right.id))
  reflowLayout()
  lastObservedState = JSON.stringify(state.value)
  applyingRemoteState = true
  persistCollaborationMetadata()
  localStorage.setItem(STORAGE_KEY, lastObservedState)
  void nextTick(() => { applyingRemoteState = false })
}

function handleRoomMessage(message: unknown, reply: (message: unknown) => void) {
  if (!message || typeof message !== 'object') return
  const packet = message as { type?: string }
  if (packet.type === 'sync-request') {
    sendSyncSnapshot(reply)
  } else if (packet.type === 'sync-snapshot') {
    applySyncSnapshot(packet as SyncSnapshot)
  } else if (packet.type === 'sync-delta') {
    applySyncDelta(packet as SyncDelta)
  }
}

async function connectToRoom(mode: 'host' | 'join') {
  const room = roomInput.value.trim()
  if (!room || room.length > 80) {
    notify('Enter a room name of 1–80 characters')
    return
  }
  initializeCollaborationMetadata(room)
  try {
    if (mode === 'host') await peerRoom.hostRoom(room, handleRoomMessage, (status) => { roomStatus.value = status })
    else await peerRoom.joinRoom(room, handleRoomMessage, (status) => { roomStatus.value = status })
    const url = new URL(location.href)
    url.searchParams.set('room', room)
    history.replaceState(null, '', url)
  } catch {
    notify(roomStatus.value.message)
  }
}

async function createSharedSession() {
  roomInput.value = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  await connectToRoom('host')
  if (roomStatus.value.state === 'hosting') await copySessionInvite()
}

async function copySessionInvite() {
  const url = new URL(location.href)
  url.searchParams.set('room', roomInput.value.trim())
  try {
    await navigator.clipboard.writeText(url.toString())
    notify('Invite link copied')
  } catch {
    notify('Could not access clipboard; copy the room name to invite peers')
  }
}

function leaveSharedSession() {
  peerRoom.close()
  collaborationRoom = ''
  collaborationMetadata = null
  const url = new URL(location.href)
  url.searchParams.delete('room')
  history.replaceState(null, '', url)
}

async function syncFromServer() {
  if (!DEV_WORKSPACE_API) {
    reflowLayout()
    await nextTick(initializeMapViews)
    return
  }
  try {
    const response = await fetch('/api/state')
    if (!response.ok) throw new Error('Server load failed')
    const payload = await response.json() as { state: StoredState | null }
    if (!payload.state) {
      reflowLayout()
      await nextTick(initializeMapViews)
      const snapshot = JSON.stringify(state.value)
      const saved = await fetch('/api/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot,
      })
      if (!saved.ok) throw new Error('Server save failed')
      persistenceLabel.value = 'Saved on server'
      requestAnimationFrame(fitGraph)
      return
    }
    skipNextPersist = true
    clearTransientMapViews()
    state.value = normalizeState(payload.state)
    reflowLayout()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
    persistenceLabel.value = 'Saved on server'
    await nextTick(initializeMapViews)
    requestAnimationFrame(fitGraph)
  } catch {
    reflowLayout()
    await nextTick(initializeMapViews)
    persistenceLabel.value = 'Saved locally'
  }
}

function notify(message: string) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2400)
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function readClipboard(): ClipboardEntry | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem('canopy-copy') ?? 'null') as ClipboardEntry | TreeNode | null
    if (!stored) return null
    if ('node' in stored) return stored
    return { sourceVersionId: state.value.activeId, node: stored }
  }
  catch { return null }
}
function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const match = findNode(node.children, id)
    if (match) return match
  }
  return undefined
}
function findParent(nodes: TreeNode[], id: string, parent: TreeNode | null = null): TreeNode | null | undefined {
  for (const node of nodes) {
    if (node.id === id) return parent
    const match = findParent(node.children, id, node)
    if (match !== undefined) return match
  }
  return undefined
}
function removeNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) return nodes.splice(index, 1)[0]
  for (const node of nodes) {
    const removed = removeNode(node.children, id)
    if (removed) return removed
  }
  return undefined
}
function descendants(node: TreeNode): string[] {
  return [node.id, ...node.children.flatMap(descendants)]
}
function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0)
}
function nodeParentIds(nodes: TreeNode[], parentId: string | null = null, result = new Map<string, string | null>()) {
  for (const node of nodes) {
    result.set(node.id, parentId)
    nodeParentIds(node.children, node.id, result)
  }
  return result
}
function makeNode(value: string, description = ''): TreeNode {
  return { id: `n${state.value.nextNode++}-${CLIENT_ID}`, value, ...(description ? { description } : {}), children: [] }
}
function structureSignature(data: TreeNode[]): string {
  const normalize = (node: TreeNode): [string, string, unknown[]] => [node.value, node.description ?? '', node.children.map(normalize)]
  return JSON.stringify(data.map(normalize))
}
function displayVersionId(id: string) {
  const peerId = id.match(/^(v\d+)-([a-f0-9]{12})$/)
  return peerId ? `${peerId[1]}-${peerId[2]!.slice(0, 4)}` : id
}
function childLayouts(node: TreeNode, positions?: Record<string, { x: number; y: number }>) {
  let nextX = 0
  return node.children.map((child) => {
    const size = treeDimensions(child, positions)
    const x = nextX
    const y = 0
    nextX = Math.max(nextX, x + size.width)
    return { node: child, x, y, ...size }
  })
}
function treeDimensions(node: TreeNode, positions?: Record<string, { x: number; y: number }>): { width: number; height: number } {
  if (!node.children.length) return { width: LEAF_TILE_WIDTH, height: LEAF_TILE_HEIGHT }
  const children = childLayouts(node, positions)
  return {
    width: children.reduce((width, child) => width + child.width, 0)
      + TREE_PADDING * Math.max(0, children.length - 1) + TREE_PADDING * 2,
    height: Math.max(...children.map((child) => child.height))
      + TREE_PADDING * 2 + TREE_HEADER_HEIGHT,
  }
}
function mapGeometry(
  data: TreeNode[],
  positions?: Record<string, { x: number; y: number }>,
  minWidth = CARD_WIDTH - 12,
  minHeight = CARD_HEIGHT - 65,
) {
  const defaults = defaultPositions(data, positions)
  const extents = data.map((node) => {
    const position = positions?.[node.id] ?? defaults[node.id]!
    const size = treeDimensions(node, positions)
    const left = position.x * CARD_WIDTH
    const top = position.y * TREE_MAP_HEIGHT
    return { left, top, right: left + size.width, bottom: top + size.height }
  })
  const minX = Math.min(0, ...extents.map((item) => item.left)) - MAP_PADDING
  const minY = Math.min(0, ...extents.map((item) => item.top)) - MAP_PADDING
  const maxX = Math.max(minX + minWidth, ...extents.map((item) => item.right + MAP_PADDING))
  const maxY = Math.max(minY + minHeight, ...extents.map((item) => item.bottom + MAP_PADDING))
  const width = maxX - minX
  const height = maxY - minY
  return { minX, minY, width, height, viewBox: `${minX} ${minY} ${width} ${height}` }
}
function defaultPositions(
  data: TreeNode[],
  positions?: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(data.length)))
  const columnWidths = Array.from({ length: Math.min(columns, data.length) }, (_, column) =>
    Math.max(...data.filter((_, index) => index % columns === column).map((node) => treeDimensions(node, positions).width)))
  const rowCount = Math.ceil(data.length / columns)
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(...data.slice(row * columns, (row + 1) * columns).map((node) => treeDimensions(node, positions).height)))
  const columnOffsets = columnWidths.map((_, column) =>
    columnWidths.slice(0, column).reduce((sum, width) => sum + width + MAP_PADDING, MAP_PADDING))
  const rowOffsets = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + MAP_PADDING, MAP_PADDING))
  return Object.fromEntries(data.map((node, index) => [
    node.id,
    { x: columnOffsets[index % columns]! / CARD_WIDTH, y: rowOffsets[Math.floor(index / columns)]! / TREE_MAP_HEIGHT },
  ]))
}
function positionsAfterMove(
  data: TreeNode[],
  existing: Record<string, { x: number; y: number }> | undefined,
  nodeId: string,
  position: { x: number; y: number },
) {
  const defaults = defaultPositions(data, existing)
  if (!data.some((node) => node.id === nodeId)) return { ...defaults, ...existing }
  return { ...defaults, ...existing, [nodeId]: position }
}
function positionsForData(
  previousData: TreeNode[],
  nextData: TreeNode[],
  previousPositions?: Record<string, { x: number; y: number }>,
  mapView?: MapView,
  viewport = { width: CARD_WIDTH - 14, height: CARD_HEIGHT - 47 },
) {
  const previousParents = nodeParentIds(previousData)
  const nextParents = nodeParentIds(nextData)
  const inherited = Object.fromEntries(Object.entries(previousPositions ?? {}).filter(([id]) =>
    previousParents.has(id) && nextParents.has(id) && previousParents.get(id) === nextParents.get(id)))
  const positions = { ...defaultPositions(nextData, inherited), ...inherited }
  const newRoots = nextData.filter((node) => previousParents.get(node.id) !== null)
  const occupied = nextData.filter((node) => !newRoots.some((added) => added.id === node.id))
  const view = mapView ?? { zoom: 1, panX: 0, panY: 0, manual: false }
  const anchor = {
    x: (viewport.width / 2 - view.panX) / view.zoom,
    y: (viewport.height / 2 - view.panY) / view.zoom,
  }
  for (const node of newRoots) {
    const size = treeDimensions(node)
    const originTile = previousParents.has(node.id)
      ? tileForNode(previousData, previousPositions, node.id)
      : undefined
    const preferred = originTile
      ? { x: originTile.x + originTile.width + MAP_GAP, y: originTile.y }
      : { x: anchor.x - size.width / 2, y: anchor.y - size.height / 2 }
    positions[node.id] = nearestFreePosition(preferred, size, occupied, positions)
    occupied.push(node)
  }
  return positions
}
function nearestFreePosition(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  occupied: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
) {
  const stepX = size.width + MAP_GAP
  const stepY = size.height + MAP_GAP
  const isFree = (candidate: { x: number; y: number }) => !occupied.some((other) => {
    const position = positions[other.id] ?? { x: 0, y: 0 }
    const otherSize = treeDimensions(other)
    return candidate.x < position.x * CARD_WIDTH + otherSize.width + MAP_GAP
      && candidate.x + size.width + MAP_GAP > position.x * CARD_WIDTH
      && candidate.y < position.y * TREE_MAP_HEIGHT + otherSize.height + MAP_GAP
      && candidate.y + size.height + MAP_GAP > position.y * TREE_MAP_HEIGHT
  })
  if (isFree(preferred)) return { x: preferred.x / CARD_WIDTH, y: preferred.y / TREE_MAP_HEIGHT }
  for (let ring = 1; ring <= Math.max(80, occupied.length * 2); ring += 1) {
    const candidates = [
      { x: preferred.x + ring * stepX, y: preferred.y },
      { x: preferred.x, y: preferred.y + ring * stepY },
      { x: preferred.x - ring * stepX, y: preferred.y },
      { x: preferred.x, y: preferred.y - ring * stepY },
    ]
    for (let offset = 1; offset < ring; offset += 1) {
      candidates.push(
        { x: preferred.x + ring * stepX, y: preferred.y + offset * stepY },
        { x: preferred.x - offset * stepX, y: preferred.y + ring * stepY },
        { x: preferred.x - ring * stepX, y: preferred.y - offset * stepY },
        { x: preferred.x + offset * stepX, y: preferred.y - ring * stepY },
      )
    }
    const free = candidates.slice(-4 * ring).find(isFree)
    if (free) return { x: free.x / CARD_WIDTH, y: free.y / TREE_MAP_HEIGHT }
  }
  const fallback = { ...preferred }
  while (!isFree(fallback)) fallback.x += stepX
  return { x: fallback.x / CARD_WIDTH, y: fallback.y / TREE_MAP_HEIGHT }
}
function reflowLayout() {
  const graph = state.value.versions
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

  graph.sort((left, right) => left.step - right.step || left.id.localeCompare(right.id))
  state.value.nextLane = nextLane
}

function createVersion(data: TreeNode[], change: string) {
  const parent = active.value
  const wasCentered = isVersionCentered(parent)
  const siblings = versions.value.filter((version) => version.parentId === parent.id)
  if (structureSignature(data) === structureSignature(parent.data)) {
    notify('No change · version not created')
    return null
  }
  const signature = structureSignature(data)
  const duplicate = siblings.find((version) => structureSignature(version.data) === signature)
  if (duplicate) {
    state.value.activeId = duplicate.id
    selectedNode.value = null
    notify(`Reopened existing ${duplicate.id}`)
    panToVersion(duplicate, wasCentered)
    return duplicate
  }
  const lane = parent.lane
  const branchNumber = siblings.reduce((highest, version) => {
    const finalPart = version.branch.split('.').at(-1) ?? '0'
    return Math.max(highest, Number(finalPart.replace(/^B/, '')) || 0)
  }, 0) + 1
  const branch = parent.id === 'v0'
    ? `B${branchNumber}`
    : siblings.length ? `${parent.branch}.${branchNumber}` : parent.branch
  const viewport = mapViewport(parent)
  const currentMapView = mapViewFor(parent)
  const positions = positionsForData(parent.data, data, parent.positions, currentMapView, viewport)
  const version: Version = {
    id: `v${state.value.nextVersion++}-${CLIENT_ID}`, parentId: parent.id, step: parent.step + 1,
    lane, branch, change, data, positions,
    ...(currentMapView.manual ? { mapView: clone(currentMapView) } : {}),
    createdAt: Date.now(),
  }
  state.value.versions.push(version)
  reflowLayout()
  state.value.activeId = version.id
  selectedNode.value = null
  compareMode.value = false
  notify(`Created ${version.id} · ${change}`)
  panToVersion(version, wasCentered)
  return version
}

function addEntry(parentId: string | null = null) {
  editor.value = { mode: 'create', parentId, nodeId: null, value: '', description: '' }
}

function commitEditor() {
  if (!editor.value) return
  const { mode, parentId, nodeId, value: rawValue, description: rawDescription } = editor.value
  const value = rawValue.trim()
  const description = rawDescription.trim()
  if (!value) return
  if (mode === 'create') {
    const data = clone(active.value.data)
    const node = makeNode(value, description)
    if (parentId) {
      const parent = findNode(data, parentId)
      if (!parent) return
      parent.children.push(node)
    } else data.push(node)
    editor.value = null
    createVersion(data, parentId ? `Add ${value}` : `Create ${value}`)
    return
  }
  const data = clone(active.value.data)
  const node = nodeId ? findNode(data, nodeId) : undefined
  if (!node || (node.value === value && (node.description ?? '') === description)) { editor.value = null; return }
  node.value = value
  if (description) node.description = description
  else delete node.description
  editor.value = null
  createVersion(data, `Rename to ${value}`)
}

function renameEntry(id: string) {
  const node = findNode(active.value.data, id)
  if (!node) return
  editor.value = { mode: 'rename', parentId: null, nodeId: id, value: node.value, description: node.description ?? '' }
}

function deleteEntry(id: string) {
  const data = clone(active.value.data)
  const node = findNode(data, id)
  if (!node) return
  if (deletionMode.value === 'detach' && node.children.length) {
    const detached = clone(node.children)
    node.children = []
    removeNode(data, id)
    data.push(...detached)
  } else removeNode(data, id)
  createVersion(data, `Delete ${node.value}`)
}

function detachEntry(id: string, position?: { x: number; y: number }) {
  const data = clone(active.value.data)
  const parent = findParent(data, id)
  if (!parent) return
  const detached = removeNode(data, id)
  if (detached) {
    data.push(detached)
    const version = createVersion(data, `Detach ${detached.value}`)
    if (version && position) {
      version.positions ??= {}
      version.positions[id] = position
    }
  }
}

function canAttach(sourceId: string, targetId: string, data = active.value.data) {
  const source = findNode(data, sourceId)
  return sourceId !== targetId && !!source && !descendants(source).includes(targetId)
}

const previewLayout = computed(() => {
  if (!draggedNode.value) return null
  if (overNode.value && canAttach(draggedNode.value, overNode.value)) {
    const data = clone(active.value.data)
    const parent = findParent(data, draggedNode.value)
    if (parent?.id === overNode.value) return null
    const source = removeNode(data, draggedNode.value)
    const target = findNode(data, overNode.value)
    if (!source || !target) return null
    target.children.push(source)
    const positions = positionsForData(active.value.data, data, active.value.positions)
    return { data, positions, kind: 'attach' as const }
  }
  if (!spatialPreview.value) return null
  const data = clone(active.value.data)
  const isRoot = data.some((node) => node.id === draggedNode.value)
  if (isRoot) {
    const positions = clone(active.value.positions ?? defaultPositions(data))
    return {
      data,
      positions: positionsAfterMove(data, positions, draggedNode.value, {
        x: spatialPreview.value.x, y: spatialPreview.value.y,
      }),
      kind: 'layout' as const,
    }
  }
  const detached = removeNode(data, draggedNode.value)
  if (!detached) return null
  data.push(detached)
  const positions = positionsForData(active.value.data, data, active.value.positions, active.value.mapView, mapViewport(active.value))
  positions[draggedNode.value] = { x: spatialPreview.value.x, y: spatialPreview.value.y }
  return { data, positions, kind: 'detach' as const }
})

function attachEntry(sourceId: string, targetId: string) {
  if (!canAttach(sourceId, targetId)) return
  const parent = findParent(active.value.data, sourceId)
  if (parent?.id === targetId) return
  const data = clone(active.value.data)
  const source = removeNode(data, sourceId)
  const target = findNode(data, targetId)
  if (!source || !target) return
  target.children.push(source)
  createVersion(data, `Attach ${source.value} to ${target.value}`)
}
function flattenPaths(nodes: TreeNode[], parentId: string | null = null, parentPath = ''): Map<string, { value: string; parentId: string | null; path: string }> {
  const result = new Map<string, { value: string; parentId: string | null; path: string }>()
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.value}` : node.value
    result.set(node.id, { value: node.value, parentId, path })
    for (const [id, info] of flattenPaths(node.children, node.id, path)) result.set(id, info)
  }
  return result
}

function chooseCompare(id: string) {
  if (compareIds.value.includes(id)) compareIds.value = compareIds.value.filter((item) => item !== id)
  else compareIds.value = [...compareIds.value.slice(-1), id]
  if (compareIds.value.length === 2) showOverview.value = true
}

const showOverview = ref(false)
const comparison = computed(() => {
  if (compareIds.value.length !== 2) return []
  const left = versions.value.find((item) => item.id === compareIds.value[0])
  const right = versions.value.find((item) => item.id === compareIds.value[1])
  if (!left || !right) return []
  const a = flattenPaths(left.data)
  const b = flattenPaths(right.data)
  const changes: { kind: string; label: string }[] = []
  for (const [id, item] of a) {
    const other = b.get(id)
    if (!other) changes.push({ kind: 'Removed', label: item.path })
    else {
      if (item.value !== other.value) changes.push({ kind: 'Changed', label: `${item.path} → ${other.path}` })
      if (item.parentId !== other.parentId) {
        const kind = item.parentId === null ? 'Attached' : other.parentId === null ? 'Detached' : 'Moved'
        changes.push({ kind, label: `${item.path} → ${other.path}` })
      }
    }
  }
  for (const [id, item] of b) if (!a.has(id)) changes.push({ kind: 'Added', label: item.path })
  return changes
})

function pruneVersion(id: string) {
  if (id === 'v0') return
  const removeIds = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const version of versions.value) {
      if (version.parentId && removeIds.has(version.parentId) && !removeIds.has(version.id)) {
        removeIds.add(version.id)
        changed = true
      }
    }
  }
  if (state.value.copyLinks.some((link) => removeIds.has(link.sourceVersionId) || removeIds.has(link.targetVersionId))) {
    notify('Cannot prune versions referenced by copied entries')
    return
  }
  const fallbackId = versions.value.find((version) => version.id === id)?.parentId ?? 'v0'
  if (!window.confirm(`Prune ${removeIds.size} version${removeIds.size === 1 ? '' : 's'} from this branch?`)) return
  for (const versionId of removeIds) {
    const timer = mapViewTimers.get(versionId)
    if (timer !== undefined) window.clearTimeout(timer)
    mapViewTimers.delete(versionId)
    delete transientMapViews.value[versionId]
  }
  state.value.versions = versions.value.filter((version) => !removeIds.has(version.id))
  reflowLayout()
  if (removeIds.has(state.value.activeId)) state.value.activeId = fallbackId
  compareIds.value = compareIds.value.filter((versionId) => !removeIds.has(versionId))
  notify('Branch pruned')
}

function selectVersion(version: Version) {
  if (suppressVersionClick) {
    suppressVersionClick = false
    return
  }
  if (compareMode.value) {
    chooseCompare(version.id)
    return
  }
  state.value.activeId = version.id
  selectedNode.value = null
  menu.value = null
}

function onTileClick(version: Version, nodeId: string) {
  if (suppressTileClick) {
    suppressTileClick = false
    return
  }
  if (compareMode.value) {
    chooseCompare(version.id)
    return
  }
  state.value.activeId = version.id
  selectedNode.value = zoom.value * mapViewFor(version).zoom > 0.35 ? nodeId : null
  menu.value = null
}

const activeNodes = computed(() => countNodes(active.value.data))
const branchCount = computed(() => new Set(versions.value.filter((version) => version.id !== 'v0').map((version) => version.branch.split('.')[0])).size)
const maxStep = computed(() => Math.max(...versions.value.map((version) => version.step)))
const maxLane = computed(() => Math.max(...versions.value.map((version) => version.lane)))
const activeChildren = computed(() => versions.value.filter((version) => version.parentId === active.value.id).length)

function cardPosition(version: Version) {
  const mainRow = canvasSize.value.height / 2 - CARD_HEIGHT / 2
  if (version.id === 'v0') return { x: 0, y: 0 }
  return { x: version.step * (CARD_WIDTH + GRAPH_GAP_X), y: mainRow + version.lane * (CARD_HEIGHT + GRAPH_GAP_Y) }
}
function cardHeight(version: Version) { return version.id === 'v0' ? graphBounds.value.height : CARD_HEIGHT }
const graphBounds = computed(() => ({
  width: Math.max(CARD_WIDTH, maxStep.value * (CARD_WIDTH + GRAPH_GAP_X) + CARD_WIDTH + 140),
  height: Math.max(
    canvasSize.value.height,
    canvasSize.value.height / 2 + CARD_HEIGHT / 2 + maxLane.value * (CARD_HEIGHT + GRAPH_GAP_Y) + 140,
  ),
}))
const fitZoom = computed(() => Math.max(0.005, Math.min(
  1,
  Math.max(1, canvasSize.value.width - 100) / graphBounds.value.width,
  Math.max(1, canvasSize.value.height - 100) / graphBounds.value.height,
)))
watch(canvasSize, () => {
  if (zoom.value < fitZoom.value) fitGraph()
})
function connectionPath(version: Version) {
  const parent = versions.value.find((item) => item.id === version.parentId)
  if (!parent) return ''
  const from = cardPosition(parent)
  const to = cardPosition(version)
  const startX = from.x + CARD_WIDTH
  const startY = from.y + cardHeight(parent) / 2
  const endX = to.x
  const endY = to.y + cardHeight(version) / 2
  if (parent.id === 'v0') return `M ${startX} ${endY} H ${endX}`
  if (Math.abs(endY - startY) < 1) return `M ${startX} ${startY} H ${endX}`
  const direction = Math.sign(endY - startY)
  const cornerX = startX + (endX - startX) / 2
  const radius = Math.min(GRAPH_GAP_X / 4, Math.abs(endY - startY) / 2)
  return `M ${startX} ${startY} H ${cornerX - radius} Q ${cornerX} ${startY} ${cornerX} ${startY + direction * radius} V ${endY - direction * radius} Q ${cornerX} ${endY} ${cornerX + radius} ${endY} H ${endX}`
}
function isBranchCurve(version: Version) {
  const parent = versions.value.find((item) => item.id === version.parentId)
  if (!parent || parent.id === 'v0') return false
  return Math.abs(cardPosition(parent).y + cardHeight(parent) / 2
    - cardPosition(version).y - cardHeight(version) / 2) >= 1
}
function connectionWidth(version: Version) {
  const parent = versions.value.find((item) => item.id === version.parentId)
  return Math.min(CARD_HEIGHT, cardHeight(version), parent ? cardHeight(parent) : CARD_HEIGHT) / 3
}
function terminalTailEnd(version: Version) {
  return TERMINAL_TAIL_LENGTH - TERMINAL_ARROW_BASE_INSET * connectionWidth(version)
}
function zoomAt(nextZoom: number, x = canvasSize.value.width / 2, y = canvasSize.value.height / 2) {
  cancelPanAnimation()
  if (nextZoom <= fitZoom.value) {
    fitGraph()
    return
  }
  const next = Math.max(fitZoom.value, Math.min(ZOOM_MAX, nextZoom))
  const ratio = next / zoom.value
  pan.value = { x: x - (x - pan.value.x) * ratio, y: y - (y - pan.value.y) * ratio }
  zoom.value = next
}
function zoomIn() { zoomAt(zoom.value * 1.25) }
function zoomOut() { zoomAt(zoom.value / 1.25) }
function fitGraph() {
  cancelPanAnimation()
  zoom.value = fitZoom.value
  pan.value = {
    x: (canvasSize.value.width - graphBounds.value.width * zoom.value) / 2,
    y: (canvasSize.value.height - graphBounds.value.height * zoom.value) / 2,
  }
}
function versionColor(version: Version) {
  if (version.id === 'v0') return '#7b8580'
  const index = Math.max(0, Number(version.branch.match(/\d+/)?.[0] ?? 1) - 1)
  return branchColors[index % branchColors.length]!
}
function descendantsCount(nodes: TreeNode[]) { return countNodes(nodes) }
function treeDepth(nodes: TreeNode[]): number {
  return nodes.length ? 1 + Math.max(...nodes.map((node) => treeDepth(node.children))) : 0
}
function cardData(version: Version): TreeNode[] {
  return version.id === active.value.id && previewLayout.value ? previewLayout.value.data : version.data
}
function cardPositions(version: Version) {
  return version.id === active.value.id && previewLayout.value ? previewLayout.value.positions : version.positions
}
const mapGeometries = computed(() => {
  const geometries = new Map<string, ReturnType<typeof mapGeometry>>()
  for (const version of versions.value) {
    geometries.set(version.id, mapGeometry(
      cardData(version), cardPositions(version),
      version.id === 'v0' ? CARD_WIDTH - 2 : CARD_WIDTH - 14,
      version.id === 'v0' ? graphBounds.value.height - 2 : CARD_HEIGHT - 47,
    ))
  }
  return geometries
})
function mapViewport(version: Version) {
  return {
    width: version.id === 'v0' ? CARD_WIDTH - 2 : CARD_WIDTH - 14,
    height: version.id === 'v0' ? Math.max(1, graphBounds.value.height - 2) : CARD_HEIGHT - 47,
  }
}
function mapViewFor(version: Version): MapView {
  const transient = transientMapViews.value[version.id]
  if (transient) return transient
  if (version.mapView) return version.mapView
  const geometry = mapGeometries.value.get(version.id) ?? mapGeometry(version.data, version.positions)
  const viewport = mapViewport(version)
  const fit = Math.min(1, (viewport.width - MAP_PADDING * 2) / geometry.width, (viewport.height - MAP_PADDING * 2) / geometry.height)
  const scale = Math.max(MAP_ZOOM_MIN, fit)
  return {
    zoom: scale,
    panX: (viewport.width - geometry.width * scale) / 2 - geometry.minX * scale,
    panY: (viewport.height - geometry.height * scale) / 2 - geometry.minY * scale,
    manual: false,
  }
}
function commitMapView(versionId: string) {
  const view = transientMapViews.value[versionId]
  const version = versions.value.find((item) => item.id === versionId)
  if (!view || !version) return
  const timer = mapViewTimers.get(versionId)
  if (timer !== undefined) window.clearTimeout(timer)
  mapViewTimers.delete(versionId)
  version.mapView = clone(view)
  delete transientMapViews.value[versionId]
}
function clearTransientMapViews() {
  for (const timer of mapViewTimers.values()) window.clearTimeout(timer)
  mapViewTimers.clear()
  transientMapViews.value = {}
  mapPanDrag.value = null
}
function scheduleMapViewCommit(versionId: string) {
  const timer = mapViewTimers.get(versionId)
  if (timer !== undefined) window.clearTimeout(timer)
  mapViewTimers.set(versionId, window.setTimeout(() => commitMapView(versionId), 180))
}
function initializeMapViews() {
  for (const version of versions.value) {
    if (!version.mapView) version.mapView = mapViewFor(version)
  }
}
watch(() => versions.value.map((version) => version.id).join(','), () => {
  void nextTick(initializeMapViews)
}, { flush: 'post' })
function mapTransform(version: Version) {
  const view = mapViewFor(version)
  return `translate(${view.panX} ${view.panY}) scale(${view.zoom})`
}
const versionTiles = computed(() => {
  const result = new Map<string, Tile[]>()
  for (const version of versions.value) {
    const data = cardData(version)
    const positions = cardPositions(version)
    result.set(version.id, data.flatMap((root, index) => tilesFor(root, data, index, positions)))
  }
  return result
})
function isPreviewing(version: Version) {
  return version.id === active.value.id && !!previewLayout.value
}
function previewLabel() {
  if (previewLayout.value?.kind === 'attach') return 'ATTACH PREVIEW'
  if (previewLayout.value?.kind === 'detach') return 'DETACH PREVIEW'
  return 'LAYOUT PREVIEW'
}
function labelFontSize(tile: Tile): number {
  return Math.max(0, Math.min(24, tile.height - 6, (tile.width - 10) / (tile.label.length * 0.58)))
}
function nodeGraphPoint(versionId: string, nodeId: string) {
  const version = versions.value.find((item) => item.id === versionId)
  if (!version) return null
  const view = mapViewFor(version)
  for (const [index, root] of version.data.entries()) {
    const tile = tilesFor(root, version.data, index, version.positions).find((item) => item.id === nodeId)
    if (!tile) continue
    const position = cardPosition(version)
    const mapLeft = version.id === 'v0' ? 1 : 6
    const mapTop = version.id === 'v0' ? 1 : 39
    return {
      x: position.x + mapLeft + view.panX + (tile.x + tile.width / 2) * view.zoom,
      y: position.y + mapTop + view.panY + (tile.y + tile.height / 2) * view.zoom,
    }
  }
  return null
}
function copyLinkPath(link: CopyLink) {
  const source = nodeGraphPoint(link.sourceVersionId, link.sourceNodeId)
  const target = nodeGraphPoint(link.targetVersionId, link.targetNodeId)
  if (!source || !target) return ''
  const lift = Math.max(55, Math.abs(target.x - source.x) * 0.18)
  const controlY = Math.min(source.y, target.y) - lift
  return `M ${source.x} ${source.y} C ${source.x} ${controlY}, ${target.x} ${controlY}, ${target.x} ${target.y}`
}

function tilesFor(
  root: TreeNode,
  forest: TreeNode[],
  _index: number,
  positions?: Record<string, { x: number; y: number }>,
): Tile[] {
  const position = positions?.[root.id] ?? defaultPositions(forest, positions)[root.id]!
  const size = treeDimensions(root)
  const offsetX = position.x * CARD_WIDTH
  const offsetY = position.y * TREE_MAP_HEIGHT
  const tiles: Tile[] = []
  const place = (node: TreeNode, x: number, y: number, width: number, height: number, depth: number) => {
    tiles.push({
      id: node.id, label: node.value,
      x, y, width, height, depth,
    })
    if (!node.children.length) return
    const innerWidth = width - TREE_PADDING * 2
    const innerHeight = height - TREE_PADDING * 2 - TREE_HEADER_HEIGHT
    const childSizes = new Map(node.children.map((child) => [child.id, treeDimensions(child)]))
    const wrapper: TreeNode = {
      id: `layout-${node.id}`, value: '', children: node.children.map((child) => ({ ...child, children: [] })),
    }
    const layout = treemap<TreeNode>()
      .tile((parent, x0, y0, _x1, y1) => {
        let nextX = x0
        for (const child of parent.children ?? []) {
          const childWidth = childSizes.get(child.data.id)?.width
          if (childWidth === undefined) continue
          child.x0 = nextX
          child.x1 = nextX + childWidth
          child.y0 = y0
          child.y1 = y1
          nextX = child.x1 + TREE_PADDING
        }
      })
      .size([innerWidth, innerHeight])
      .paddingInner(0)
    const rootLayout = hierarchy(wrapper, (item) => item.children)
      .sum((item) => {
        const childSize = childSizes.get(item.id)
        return childSize ? childSize.width * childSize.height : 0
      })
    for (const childLayout of layout(rootLayout).children ?? []) {
      const child = node.children.find((item) => item.id === childLayout.data.id)
      if (!child) continue
      place(
        child,
        x + TREE_PADDING + childLayout.x0,
        y + TREE_PADDING + TREE_HEADER_HEIGHT + childLayout.y0,
        childLayout.x1 - childLayout.x0,
        childLayout.y1 - childLayout.y0,
        depth + 1,
      )
    }
  }
  place(root, offsetX, offsetY, size.width, size.height, 0)
  return tiles
}
function tileForNode(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  nodeId: string,
) {
  for (const [index, root] of data.entries()) {
    const tile = tilesFor(root, data, index, positions).find((item) => item.id === nodeId)
    if (tile) return tile
  }
  return undefined
}
function positionAt(version: Version, clientX: number, clientY: number, map: HTMLElement) {
  const drag = treeDrag.value
  const rect = map.getBoundingClientRect()
  const view = mapViewFor(version)
  if (!drag?.space) {
    const geometry = mapGeometry(version.data, version.positions, map.clientWidth, map.clientHeight)
    const dragged = drag ? findNode(version.data, drag.id) : undefined
    const size = dragged ? treeDimensions(dragged) : { width: LEAF_TILE_WIDTH, height: LEAF_TILE_HEIGHT }
    const x = ((clientX - rect.left) / zoom.value - view.panX) / view.zoom + size.width * 0.5
    const y = ((clientY - rect.top) / zoom.value - view.panY) / view.zoom + size.height * 0.5
    return {
      x: (x - size.width / 2) / CARD_WIDTH,
      y: (y - size.height / 2) / TREE_MAP_HEIGHT,
    }
  }
  const deltaX = (clientX - drag.x) * drag.space.scaleX
  const deltaY = (clientY - drag.y) * drag.space.scaleY
  const x = drag.space.rootId ? drag.space.rootPosition.x + deltaX : drag.space.pointer.x + deltaX
  const y = drag.space.rootId ? drag.space.rootPosition.y + deltaY : drag.space.pointer.y + deltaY
  return { x, y }
}
function placeRoot(version: Version, nodeId: string, position: { x: number; y: number }) {
  const defaults = defaultPositions(version.data, version.positions)
  const defaultPosition = defaults[nodeId]!
  const normalizedPosition = Math.abs(position.x - defaultPosition.x) < 0.002 && Math.abs(position.y - defaultPosition.y) < 0.002
    ? defaultPosition : position
  version.positions ??= {}
  version.positions = positionsAfterMove(version.data, version.positions, nodeId, normalizedPosition)
  notify('Treemap layout updated')
  return true
}
function spatialPreviewStyle(version: Version) {
  if (spatialPreview.value?.versionId !== version.id) return {}
  const map = document.querySelector<HTMLElement>(`.version-card[data-version="${version.id}"] .mini-map`)
  const view = mapViewFor(version)
  const node = findNode(active.value.data, spatialPreview.value.nodeId)
  const size = node ? treeDimensions(node) : { width: LEAF_TILE_WIDTH, height: LEAF_TILE_HEIGHT }
  const parentTile = spatialPreview.value.parentId
    ? tileForNode(cardData(version), cardPositions(version), spatialPreview.value.parentId)
    : undefined
  const worldX = parentTile
    ? parentTile.x + TREE_PADDING + spatialPreview.value.x * CARD_WIDTH
    : spatialPreview.value.x * CARD_WIDTH
  const worldY = parentTile
    ? parentTile.y + TREE_PADDING * 2 + TREE_HEADER_HEIGHT + spatialPreview.value.y * TREE_MAP_HEIGHT
    : spatialPreview.value.y * TREE_MAP_HEIGHT
  return {
    left: `${view.panX + worldX * view.zoom}px`,
    top: `${view.panY + worldY * view.zoom}px`,
    width: `${size.width * view.zoom}px`,
    height: `${size.height * view.zoom}px`,
  }
}

function onTileContext(event: MouseEvent, nodeId: string) {
  event.preventDefault()
  selectedNode.value = nodeId
  menu.value = { x: event.clientX, y: event.clientY, nodeId }
}
function onCanvasContext(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('.tree-tile, .version-card')) return
  event.preventDefault()
  menu.value = { x: event.clientX, y: event.clientY, nodeId: null }
}
function startCanvasPan(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button, .version-card, .tree-tile')) return
  cancelPanAnimation()
  draggingCanvas.value = true
  dragOrigin.value = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveCanvasPan(event: PointerEvent) {
  if (!draggingCanvas.value) return
  pan.value = { x: dragOrigin.value.panX + event.clientX - dragOrigin.value.x, y: dragOrigin.value.panY + event.clientY - dragOrigin.value.y }
}
function endCanvasPan() { draggingCanvas.value = false }
function onWheel(event: WheelEvent) {
  event.preventDefault()
  zoomAt(zoom.value * Math.exp(-event.deltaY * 0.0012))
}
function zoomMap(event: WheelEvent, version: Version) {
  if (!event.shiftKey) return
  event.preventDefault()
  event.stopPropagation()
  const map = event.currentTarget as HTMLElement
  const rect = map.getBoundingClientRect()
  const pointerX = (event.clientX - rect.left) / zoom.value
  const pointerY = (event.clientY - rect.top) / zoom.value
  const current = mapViewFor(version)
  const nextZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, current.zoom * Math.exp(-event.deltaY * 0.0012)))
  const worldX = (pointerX - current.panX) / current.zoom
  const worldY = (pointerY - current.panY) / current.zoom
  transientMapViews.value[version.id] = {
    zoom: nextZoom,
    panX: pointerX - worldX * nextZoom,
    panY: pointerY - worldY * nextZoom,
    manual: true,
  }
  scheduleMapViewCommit(version.id)
}
function startMapPan(event: PointerEvent, version: Version) {
  if (!event.shiftKey || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const view = mapViewFor(version)
  const timer = mapViewTimers.get(version.id)
  if (timer !== undefined) window.clearTimeout(timer)
  mapViewTimers.delete(version.id)
  mapPanDrag.value = {
    versionId: version.id,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: view.panX,
    panY: view.panY,
    moved: false,
  }
}
function startMapTileGesture(event: PointerEvent, version: Version, nodeId: string) {
  if (event.shiftKey) {
    startMapPan(event, version)
    return
  }
  if (version.id === active.value.id) startTreeDrag(event, nodeId)
}
function moveMapPan(event: PointerEvent) {
  const drag = mapPanDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const version = versions.value.find((item) => item.id === drag.versionId)
  if (!version) return
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) drag.moved = true
  transientMapViews.value[version.id] = {
    ...mapViewFor(version),
    panX: drag.panX + (event.clientX - drag.x) / zoom.value,
    panY: drag.panY + (event.clientY - drag.y) / zoom.value,
    manual: true,
  }
}
function endMapPan(event: PointerEvent) {
  if (mapPanDrag.value?.pointerId !== event.pointerId) return
  const { versionId, moved } = mapPanDrag.value
  mapPanDrag.value = null
  commitMapView(versionId)
  if (moved) {
    suppressVersionClick = true
    suppressTileClick = true
    window.setTimeout(() => {
      suppressVersionClick = false
      suppressTileClick = false
    }, 0)
  }
}
function centerVersion(version: Version) {
  cancelPanAnimation()
  const position = cardPosition(version)
  const availableWidth = Math.max(1, canvasSize.value.width - 100)
  const availableHeight = Math.max(1, canvasSize.value.height - 100)
  zoom.value = Math.max(0.005, Math.min(ZOOM_MAX, availableWidth / CARD_WIDTH, availableHeight / cardHeight(version)))
  pan.value = {
    x: canvasSize.value.width / 2 - (position.x + CARD_WIDTH / 2) * zoom.value,
    y: canvasSize.value.height / 2 - (position.y + cardHeight(version) / 2) * zoom.value,
  }
}
function centerActive() { centerVersion(active.value) }
function cancelPanAnimation() {
  if (panAnimationFrame !== null) cancelAnimationFrame(panAnimationFrame)
  panAnimationFrame = null
}
function isVersionCentered(version: Version) {
  const position = cardPosition(version)
  const centerX = (position.x + CARD_WIDTH / 2) * zoom.value + pan.value.x
  const centerY = (position.y + cardHeight(version) / 2) * zoom.value + pan.value.y
  return Math.abs(centerX - canvasSize.value.width / 2) < 2
    && Math.abs(centerY - canvasSize.value.height / 2) < 2
}
function panToVersion(version: Version, centerImmediately: boolean) {
  cancelPanAnimation()
  const position = cardPosition(version)
  const width = CARD_WIDTH * zoom.value
  const height = cardHeight(version) * zoom.value
  const margin = 50
  const target = { ...pan.value }
  const left = position.x * zoom.value + target.x
  const right = left + width
  const top = position.y * zoom.value + target.y
  const bottom = top + height

  if (centerImmediately || width > canvasSize.value.width - margin * 2) {
    target.x = canvasSize.value.width / 2 - (position.x + CARD_WIDTH / 2) * zoom.value
  } else if (left < margin) target.x += margin - left
  else if (right > canvasSize.value.width - margin) target.x -= right - (canvasSize.value.width - margin)

  if (centerImmediately || height > canvasSize.value.height - margin * 2) {
    target.y = canvasSize.value.height / 2 - (position.y + cardHeight(version) / 2) * zoom.value
  } else if (top < margin) target.y += margin - top
  else if (bottom > canvasSize.value.height - margin) target.y -= bottom - (canvasSize.value.height - margin)

  if (centerImmediately) {
    pan.value = target
    return
  }
  const start = { ...pan.value }
  const startedAt = performance.now()
  const duration = 260
  const animate = (time: number) => {
    const progress = Math.min(1, (time - startedAt) / duration)
    const eased = 1 - (1 - progress) ** 3
    pan.value = {
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
    }
    if (progress < 1) panAnimationFrame = requestAnimationFrame(animate)
    else panAnimationFrame = null
  }
  panAnimationFrame = requestAnimationFrame(animate)
}
function startTreeDrag(event: PointerEvent, id: string) {
  if (event.button !== 0) return
  if (zoom.value <= 0.35) return
  event.preventDefault()
  const map = (event.currentTarget as SVGRectElement).closest<HTMLElement>('.mini-map')
  const rect = map?.getBoundingClientRect()
  const view = mapViewFor(active.value)
  const roots = active.value.data
  const root = roots.find((item) => descendants(item).includes(id))
  const defaults = defaultPositions(roots, active.value.positions)
  const rootPosition = root ? active.value.positions?.[root.id] ?? defaults[root.id]! : { x: 0, y: 0 }
  const size = treeDimensions(findNode(active.value.data, id) ?? roots[0]!)
  const pointer = rect ? {
    x: (((event.clientX - rect.left) / zoom.value - view.panX) / view.zoom - size.width / 2) / CARD_WIDTH,
    y: (((event.clientY - rect.top) / zoom.value - view.panY) / view.zoom - size.height / 2) / TREE_MAP_HEIGHT,
  } : { x: 0, y: 0 }
  treeDrag.value = {
    id, x: event.clientX, y: event.clientY, moved: false,
    space: rect ? {
      scaleX: 1 / zoom.value / view.zoom / CARD_WIDTH, scaleY: 1 / zoom.value / view.zoom / TREE_MAP_HEIGHT,
      pointer, rootId: root?.id === id ? id : null, rootPosition,
    } : undefined,
  }
}
function moveTreeDrag(event: PointerEvent) {
  const drag = treeDrag.value
  if (!drag) return
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) {
    drag.moved = true
    draggedNode.value = drag.id
  }
  if (!drag.moved) return
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  const target = hit?.closest<SVGRectElement>('.tree-tile')
  let targetId = target?.getAttribute('data-node') ?? null
  let targetVersion = target?.closest('.version-card')?.getAttribute('data-version')
  const locked = drag.targetBounds
  if (locked && event.clientX >= locked.left && event.clientX <= locked.right
    && event.clientY >= locked.top && event.clientY <= locked.bottom) {
    targetId = locked.id
    targetVersion = active.value.id
  } else {
    drag.targetBounds = undefined
    const sourceParent = findParent(active.value.data, drag.id)
    if (target && targetId && targetVersion === active.value.id && sourceParent?.id !== targetId
      && canAttach(drag.id, targetId)) {
      const rect = target.getBoundingClientRect()
      drag.targetBounds = { id: targetId, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }
  }
  if (targetId === drag.id) {
    overNode.value = null
    invalidNode.value = null
    const map = target?.closest<HTMLElement>('.mini-map')
    if (active.value.data.some((node) => node.id === drag.id) && map) {
      spatialPreview.value = {
        ...positionAt(active.value, event.clientX, event.clientY, map),
        versionId: active.value.id,
        nodeId: drag.id,
      }
    } else spatialPreview.value = null
    return
  }
  const parent = findParent(active.value.data, drag.id)
  if (targetId && targetVersion === active.value.id && parent?.id !== targetId && canAttach(drag.id, targetId)) {
    overNode.value = targetId
    invalidNode.value = null
    spatialPreview.value = null
    return
  }
  overNode.value = null
  invalidNode.value = targetId && targetVersion === active.value.id && !canAttach(drag.id, targetId)
    ? targetId : null
  if (targetId && targetVersion === active.value.id) {
    spatialPreview.value = null
    return
  }
  const map = hit?.closest<HTMLElement>('.mini-map')
  const versionId = map?.closest('.version-card')?.getAttribute('data-version')
  if (map && versionId === active.value.id) {
    const point = positionAt(active.value, event.clientX, event.clientY, map)
    spatialPreview.value = { ...point, versionId: active.value.id, nodeId: drag.id }
  } else spatialPreview.value = null
}
function finishTreeDrag(event: PointerEvent) {
  const drag = treeDrag.value
  if (!drag) return
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const map = target?.closest<HTMLElement>('.mini-map')
  const hitNode = target?.closest<SVGRectElement>('.tree-tile')?.getAttribute('data-node')
  const targetVersion = target?.closest('.version-card')?.getAttribute('data-version')
  const effectiveHitNode = hitNode === drag.id && spatialPreview.value ? null : hitNode
  const sourceParent = findParent(active.value.data, drag.id)
  const locked = drag.targetBounds
  const lockedTarget = locked && event.clientX >= locked.left && event.clientX <= locked.right
    && event.clientY >= locked.top && event.clientY <= locked.bottom
    ? locked.id : null
  const candidateTarget = lockedTarget ?? (targetVersion === active.value.id
    ? (effectiveHitNode === drag.id ? overNode.value : effectiveHitNode)
    : null
  )
  const targetNode = candidateTarget && sourceParent?.id !== candidateTarget && canAttach(drag.id, candidateTarget)
    ? candidateTarget : null
  let committed = false
  if (drag.moved && targetNode && canAttach(drag.id, targetNode)) {
    attachEntry(drag.id, targetNode)
    committed = true
  } else if (drag.moved && !effectiveHitNode && map && targetVersion === active.value.id) {
    if (active.value.data.some((node) => node.id === drag.id)) {
      const position = positionAt(active.value, event.clientX, event.clientY, map)
      committed = placeRoot(active.value, drag.id, position)
    } else {
      if (sourceParent) {
        const position = spatialPreview.value ?? positionAt(active.value, event.clientX, event.clientY, map)
        detachEntry(drag.id, position)
        committed = true
      }
    }
  }
  if (committed) {
    suppressVersionClick = true
    window.setTimeout(() => (suppressVersionClick = false), 0)
  }
  treeDrag.value = null
  draggedNode.value = null
  overNode.value = null
  invalidNode.value = null
  spatialPreview.value = null
}
function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).matches('input, textarea, select')) return
  const key = event.key.toLowerCase()
  const modified = event.ctrlKey || event.metaKey
  if (!modified && key === 'n') { event.preventDefault(); createFreeEntry() }
  if (modified && event.key === 'Enter' && selectedNode.value) { event.preventDefault(); addEntry(selectedNode.value) }
  if (!modified && event.shiftKey && key === 'd' && selectedNode.value) { event.preventDefault(); detachEntry(selectedNode.value) }
  if (!modified && event.shiftKey && key === 'c') {
    event.preventDefault()
    compareMode.value = !compareMode.value
    compareIds.value = []
  }
  if (!modified && event.shiftKey && key === 'f') { event.preventDefault(); centerActive() }
  if (!modified && event.shiftKey && key === 'a') { event.preventDefault(); fitGraph() }
  if (!modified && (event.key === '+' || event.key === '=')) { event.preventDefault(); zoomIn() }
  if (!modified && event.key === '-') { event.preventDefault(); zoomOut() }
  if (modified && key === 'c' && selectedNode.value) {
    event.preventDefault()
    copyEntry(selectedNode.value)
  }
  if (modified && key === 'v') {
    event.preventDefault()
    pasteEntry()
  }
  if (event.key === 'Escape') { menu.value = null; compareMode.value = false; compareIds.value = [] }
}
onMounted(() => {
  const measureCanvas = () => {
    if (graphCanvas.value) canvasSize.value = { width: graphCanvas.value.clientWidth, height: graphCanvas.value.clientHeight }
  }
  canvasObserver = new ResizeObserver(measureCanvas)
  if (graphCanvas.value) canvasObserver.observe(graphCanvas.value)
  measureCanvas()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointermove', moveTreeDrag)
  window.addEventListener('pointermove', moveMapPan)
  window.addEventListener('pointerup', finishTreeDrag)
  window.addEventListener('pointerup', endMapPan)
  void syncFromServer().then(() => {
    if (roomInput.value) return connectToRoom('join')
  })
})
onUnmounted(() => {
  peerRoom.close()
  for (const versionId of mapViewTimers.keys()) commitMapView(versionId)
  cancelPanAnimation()
  canvasObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', moveTreeDrag)
  window.removeEventListener('pointermove', moveMapPan)
  window.removeEventListener('pointerup', finishTreeDrag)
  window.removeEventListener('pointerup', endMapPan)
})

function createFreeEntry() { addEntry() }
function copyEntry(nodeId: string) {
  const node = findNode(active.value.data, nodeId)
  if (!node) return
  clipboard.value = { sourceVersionId: active.value.id, node: clone(node) }
  sessionStorage.setItem('canopy-copy', JSON.stringify(clipboard.value))
  notify(`Copied ${node.value}`)
}
function pasteEntry() {
  if (!clipboard.value) return
  const copied = clone(clipboard.value)
  const rekey = (node: TreeNode): TreeNode => ({ ...node, id: `n${state.value.nextNode++}-${CLIENT_ID}`, children: node.children.map(rekey) })
  const newNode = rekey(copied.node)
  const version = createVersion([...clone(active.value.data), newNode], `Paste ${newNode.value}`)
  if (!version) return
  const source = versions.value.find((item) => item.id === copied.sourceVersionId)
  const sourceBranch = source?.branch.split('.')[0]
  if (source && sourceBranch !== version.branch.split('.')[0]) {
    const targetNode = version.data.find((node) => structureSignature([node]) === structureSignature([newNode]))
    if (!targetNode) return
    state.value.copyLinks = [...state.value.copyLinks, {
      sourceVersionId: source.id, sourceNodeId: copied.node.id,
      targetVersionId: version.id, targetNodeId: targetNode.id,
    }].sort(compareCopyLinks)
  }
}
function resetWorkspace() {
  if (window.confirm('Reset all local versions?')) {
    clearTransientMapViews()
    state.value = clone(seed)
  }
}
</script>

<template>
  <main class="app-shell" @contextmenu="onCanvasContext" @wheel="onWheel">
    <div class="workspace">
      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-head">
          <span class="brand-mark"><Layers3 :size="19" :stroke-width="2.2" /></span>
          <span class="brand-name">Data Structure Constructor</span>
          <button class="quiet-icon sidebar-toggle" :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'" :aria-expanded="!sidebarCollapsed"
            @click="sidebarCollapsed = !sidebarCollapsed"><ChevronDown :size="16" /></button>
        </div>
        <section class="side-section session-section">
          <div class="section-label">SHARED SESSION</div>
          <label class="session-label" for="session-room">Room name</label>
          <input id="session-room" v-model="roomInput" maxlength="80" placeholder="Enter a room name" :disabled="roomStatus.state === 'connected' || roomStatus.state === 'hosting'" />
          <div class="session-status" :class="`status-${roomStatus.state}`" role="status" aria-live="polite">{{ collaborationLabel }}</div>
          <div v-if="roomStatus.state === 'idle' || roomStatus.state === 'error'" class="session-actions">
            <button type="button" class="session-button" @click="createSharedSession">New room</button>
            <button type="button" class="session-button" @click="connectToRoom('host')">Host</button>
            <button type="button" class="session-button" :disabled="!roomInput.trim()" @click="connectToRoom('join')">Join</button>
          </div>
          <div v-else class="session-actions">
            <button type="button" class="session-button" @click="copySessionInvite">Copy invite</button>
            <button type="button" class="session-button secondary" @click="leaveSharedSession">Leave</button>
          </div>
        </section>
        <section class="side-section overview-section">
          <div class="section-label">OVERVIEW</div>
          <div class="metric-row"><span>Branches</span><strong>{{ branchCount }}</strong></div>
          <div class="metric-row"><span>Versions</span><strong>{{ versions.length }}</strong></div>
        </section>
        <section class="side-section active-section">
          <div class="section-label">ACTIVE VERSION</div>
          <div class="active-version-card">
            <div class="active-version-top"><span class="version-pip" :style="{ background: versionColor(active) }"></span><span> Branch {{ active.branch }} | {{ displayVersionId(active.id) }} | Step {{ active.step }}</span></div>
            <strong>{{ active.change }}</strong>
            <div class="active-meta"><span>Entries</span><strong>{{ activeNodes }}</strong></div>
            <div class="active-meta"><span>Current step</span><strong>{{ String(active.step).padStart(2, '0') }}</strong></div>
            <div class="active-meta"><span>Paths from here</span><strong>{{ activeChildren }}</strong></div>
          </div>
        </section>
        <section class="side-section settings-section">
          <div class="section-label">DELETE BEHAVIOR</div>
          <label class="select-wrap"><select v-model="deletionMode" aria-label="Deletion behavior"><option value="subtree">Delete entire subtree</option><option value="detach">Keep children detached</option></select><ChevronDown :size="14" /></label>
        </section>
        <section v-if="zoom <= 0.35" class="side-section lod-section">
          <span class="lod-badge">READ ONLY</span>
        </section>
        <div class="sidebar-fill"></div>
      </aside>

      <section class="canvas-region">
        <div ref="graphCanvas" class="graph-canvas" @pointerdown="startCanvasPan" @pointermove="moveCanvasPan" @pointerup="endCanvasPan" @pointercancel="endCanvasPan">
          <div class="canvas-grid"></div>
          <div class="graph-world" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
            <svg class="connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height" aria-hidden="true">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5" :markerWidth="TERMINAL_ARROW_SIZE" :markerHeight="TERMINAL_ARROW_SIZE" markerUnits="strokeWidth" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="#f5f7f4" stroke-width="0.8" stroke-linejoin="round" /></marker>
                <marker id="copy-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#cf7b32" /></marker>
              </defs>
              <template v-for="version in versions.filter((item) => item.parentId && !isBranchCurve(item))" :key="`edge-${version.id}`">
                <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
                <path :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === active.id || version.parentId === active.id ? 0.96 : 0.76" />
              </template>
              <template v-for="version in versions.filter((item) => item.parentId && isBranchCurve(item))" :key="`branch-edge-${version.id}`">
                <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
                <path :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === active.id || version.parentId === active.id ? 0.96 : 0.76" />
              </template>
              <template v-for="version in versions.filter((item) => !versions.some((child) => child.parentId === item.id))" :key="`tail-${version.id}`">
                <path :d="`M ${cardPosition(version).x + CARD_WIDTH} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + CARD_WIDTH + terminalTailEnd(version)}`" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="butt" />
                <path :d="`M ${cardPosition(version).x + CARD_WIDTH} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + CARD_WIDTH + terminalTailEnd(version)}`" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="butt" marker-end="url(#arrow)" />
              </template>
              <path v-for="(link, index) in state.copyLinks" :key="`copy-${index}`" :d="copyLinkPath(link)"
                fill="none" stroke="#cf7b32" stroke-width="3" vector-effect="non-scaling-stroke" stroke-dasharray="7 4" marker-end="url(#copy-arrow)">
                <title>Copied entry connection</title>
              </path>
            </svg>

            <article v-for="version in versions" :key="version.id" class="version-card" :class="{ active: version.id === active.id, compared: compareIds.includes(version.id), 'compare-pick': compareMode, compact: zoom < 0.66, previewing: isPreviewing(version), 'root-version': version.id === 'v0' }"
              :data-version="version.id" :style="{ left: `${cardPosition(version).x}px`, top: `${cardPosition(version).y}px`, width: `${CARD_WIDTH}px`, height: `${cardHeight(version)}px`, '--branch-color': versionColor(version) }"
              @click="selectVersion(version)" @dblclick.stop="centerVersion(version)" :data-over="overNode === version.id">
              <div v-if="version.id !== 'v0'" class="version-card-head">
                <span class="branch-mark" :style="{ background: versionColor(version) }"></span>
                <span class="version-header-id">{{ version.branch }} | {{ displayVersionId(version.id).replace(/^v/, 'V') }} | S{{ version.step }} |</span>
                <strong class="version-action">{{ version.change }}</strong>
                <span class="version-count">({{ descendantsCount(version.data) }} Entries)</span>
                <button class="card-menu quiet-icon" title="Version actions" @click.stop="menu = { x: $event.clientX, y: $event.clientY, nodeId: null, versionId: version.id }; selectedNode = null; state.activeId = version.id"><MoreHorizontal :size="17" /></button>
              </div>
              <div v-if="isPreviewing(version)" class="preview-badge">{{ previewLabel() }}</div>
              <div v-if="zoom <= 0.35 && (version.id !== 'v0' || version.data.length)" class="overview-map">
                <strong><span>{{ descendantsCount(version.data) }}</span><small>Entries</small></strong>
                <div class="overview-stats">
                  <span>Depth <b>{{ treeDepth(version.data) }}</b></span>
                  <span>Independent trees <b>{{ version.data.length }}</b></span>
                  <span>Branch <b>{{ version.branch }}</b></span>
                </div>
              </div>
              <div v-else class="mini-map" :class="{ empty: !cardData(version).length, 'root-map': version.id === 'v0' }"
                @pointerdown="startMapPan($event, version)" @wheel="zoomMap($event, version)">
                <template v-if="cardData(version).length">
                  <svg :viewBox="`0 0 ${mapViewport(version).width} ${mapViewport(version).height}`" class="treemap-svg">
                    <g :transform="mapTransform(version)">
                      <rect v-for="tile in versionTiles.get(version.id) ?? []" :key="tile.id"
                        :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                        :class="['tree-tile', `depth-${tile.depth}`, { 'is-selected': selectedNode === tile.id && version.id === active.id, 'is-source': draggedNode === tile.id, 'is-over': overNode === tile.id, 'is-invalid': invalidNode === tile.id }]"
                        :data-node="tile.id" :fill="tile.depth === 0 ? '#deebe4' : tile.depth % 2 ? '#c1d9cc' : '#a9cab9'"
                        @pointerdown.stop="startMapTileGesture($event, version, tile.id)"
                        @click.stop="onTileClick(version, tile.id)" @contextmenu="version.id === active.id && zoom * mapViewFor(version).zoom > 0.35 && onTileContext($event, tile.id)">
                        <title v-if="findNode(cardData(version), tile.id)?.description">{{ findNode(cardData(version), tile.id)?.description }}</title>
                      </rect>
                      <text v-for="tile in (versionTiles.get(version.id) ?? []).filter((item) => labelFontSize(item) >= 7)" :key="`label-${tile.id}`"
                        :x="tile.x + 5" :y="tile.y + labelFontSize(tile) + 4" :font-size="labelFontSize(tile)" class="tile-label">{{ tile.label }}</text>
                    </g>
                  </svg>
                </template>
                <div v-else class="empty-map" :class="{ 'root-empty': version.id === 'v0' }">
                  <span v-if="version.id === 'v0'" class="empty-set" aria-label="Empty set">∅</span>
                  <template v-else><span class="empty-cross">+</span><span>Empty structure</span></template>
                </div>
                <div v-if="spatialPreview?.versionId === version.id && !previewLayout" class="spatial-preview" :style="spatialPreviewStyle(version)">
                  {{ findNode(active.data, spatialPreview.nodeId)?.value }}
                </div>
              </div>
            </article>
          </div>

          <div class="canvas-hotbar" role="toolbar" aria-label="Quick actions" @pointerdown.stop @click.stop>
            <button title="New free entry (N)" aria-label="New free entry, N" @click="createFreeEntry"><Plus :size="16" /><span>New entry</span><kbd>N</kbd></button>
            <button title="Add child (Ctrl/⌘+Enter)" aria-label="Add child, Ctrl or Command+Enter" :disabled="!selectedNode" @click="selectedNode && addEntry(selectedNode)"><GitBranch :size="16" /><span>Add child</span><kbd>Ctrl/⌘+↵</kbd></button>
            <button title="Detach selected (Shift+D)" aria-label="Detach selected, Shift+D" :disabled="!selectedNode" @click="selectedNode && detachEntry(selectedNode)"><Unlink :size="16" /><span>Detach</span><kbd>Shift+D</kbd></button>
            <button title="Compare versions (Shift+C)" aria-label="Compare versions, Shift+C" :class="{ selected: compareMode }" @click="compareMode = !compareMode; compareIds = []"><GitCompareArrows :size="16" /><span>Compare</span><kbd>Shift+C</kbd></button>
            <button title="Center active version (Shift+F)" aria-label="Center active version, Shift+F" @click="centerActive"><Maximize :size="16" /><span>Center</span><kbd>Shift+F</kbd></button>
            <button title="Fit all versions (Shift+A)" aria-label="Fit all versions, Shift+A" @click="fitGraph"><Layers3 :size="16" /><span>Fit all</span><kbd>Shift+A</kbd></button>
            <span class="hotbar-divider" aria-hidden="true"></span>
            <button title="Zoom out (-)" aria-label="Zoom out, minus" @click="zoomOut"><ZoomOut :size="16" /><kbd>−</kbd></button>
            <button title="Zoom in (+)" aria-label="Zoom in, plus" @click="zoomIn"><ZoomIn :size="16" /><kbd>+</kbd></button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="compareMode || showOverview" class="compare-drawer" :class="{ open: compareIds.length === 2 }">
      <div class="drawer-head"><div><span class="section-label">VERSION COMPARISON</span><strong>{{ compareIds.length === 2 ? `${compareIds[0]} ↔ ${compareIds[1]}` : 'Choose two versions' }}</strong></div><button class="quiet-icon" title="Close comparison" @click="compareMode = false; showOverview = false; compareIds = []"><X :size="17" /></button></div>
      <div v-if="compareIds.length === 2" class="comparison-content">
        <div class="compare-summary"><span class="compare-count">{{ comparison.length }}</span><span>structural {{ comparison.length === 1 ? 'change' : 'changes' }}</span></div>
        <div v-if="comparison.length" class="diff-list"><div v-for="(change, index) in comparison" :key="`${change.kind}-${index}`" class="diff-item" :class="change.kind.toLowerCase()"><span>{{ change.kind }}</span><strong>{{ change.label }}</strong></div></div>
        <div v-else class="no-diff"><Check :size="17" /> These versions are structurally identical.</div>
      </div>
      <div v-else class="drawer-empty"><Search :size="18" /><span>Choose two version cards in the graph.</span></div>
    </div>

    <div v-if="menu" class="context-scrim" @click="menu = null"></div>
    <div v-if="menu" class="context-menu" :style="{ left: `${Math.min(menu.x, window.innerWidth - 220)}px`, top: `${Math.min(menu.y, window.innerHeight - 230)}px` }" @click.stop>
      <template v-if="menu.versionId">
        <div class="context-title">VERSION ACTIONS</div>
        <button @click="centerActive(); menu = null"><Maximize :size="15" /> Center version</button>
        <div class="context-divider"></div>
        <button class="danger-action" @click="pruneVersion(menu.versionId!); menu = null"><Trash2 :size="15" /> Delete version and descendants</button>
      </template>
      <template v-else-if="menu.nodeId">
        <div class="context-title">ENTRY ACTIONS</div>
        <button @click="addEntry(menu.nodeId); menu = null"><Plus :size="15" /> Add child</button>
        <button @click="renameEntry(menu.nodeId!); menu = null"><Pencil :size="15" /> Change value</button>
        <button @click="detachEntry(menu.nodeId!); menu = null" :disabled="!findParent(active.data, menu.nodeId!)"><Unlink :size="15" /> Detach from parent</button>
        <button class="danger-action" @click="deleteEntry(menu.nodeId!); menu = null"><Trash2 :size="15" /> Delete entry</button>
        <div class="context-divider"></div>
        <button @click="copyEntry(menu.nodeId!); menu = null"><Copy :size="15" /> Copy entry and subtree</button>
        <button v-if="clipboard" @click="pasteEntry(); menu = null"><ClipboardPaste :size="15" /> Add copied entry</button>
      </template>
      <template v-else>
        <div class="context-title">STRUCTURE ACTIONS</div>
        <button @click="createFreeEntry(); menu = null"><Plus :size="15" /> New free entry</button>
        <button v-if="clipboard" @click="pasteEntry(); menu = null"><ClipboardPaste :size="15" /> Add copied entry</button>
        <button @click="centerActive(); menu = null"><Maximize :size="15" /> Center active version</button>
      </template>
    </div>
    <div v-if="editor" class="editor-scrim" @click.self="editor = null">
      <form class="entry-editor" @submit.prevent="commitEditor">
        <div class="editor-heading"><span class="section-label">{{ editor.mode === 'create' ? 'NEW ENTRY' : 'CHANGE VALUE' }}</span><button type="button" class="quiet-icon" title="Close" @click="editor = null"><X :size="17" /></button></div>
        <label class="editor-label" for="entry-value">{{ editor.mode === 'create' ? 'Entry name' : 'New value' }}</label>
        <input id="entry-value" v-model="editor.value" autofocus maxlength="120" placeholder="e.g. Research notes" />
        <label class="editor-label" for="entry-description">Description <span>optional</span></label>
        <textarea id="entry-description" v-model="editor.description" maxlength="400" rows="3" placeholder="Shown when you hover over this entry"></textarea>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="editor = null">Cancel</button><button type="submit" class="primary-button" :disabled="!editor.value.trim()"><Check :size="15" /> Commit version</button></div>
      </form>
    </div>
    <div v-if="toast" class="toast"><span></span>{{ toast }}</div>
  </main>
</template>

<script lang="ts">
export default { data: () => ({ window }) }
</script>