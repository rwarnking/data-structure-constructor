<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { getClientId, PeerRoom, type RoomStatus } from './collaboration'
import {
  GitBranch, GitCompareArrows, Plus, Maximize, Search, Copy, Trash2,
  Pencil, Unlink, ChevronDown, X, Check, Layers3, ClipboardPaste,
  ZoomIn, ZoomOut, RotateCcw, MoreHorizontal, Moon, Sun, Radio,
} from '@lucide/vue'

type TreeNode = { id: string; value: string; description?: string; children: TreeNode[] }
type CopyLink = { sourceVersionId: string; sourceNodeId: string; targetVersionId: string; targetNodeId: string }
type ClipboardEntry = { sourceVersionId: string; node: TreeNode }
type MapView = { zoom: number; panX: number; panY: number; manual: boolean }
type Version = {
  id: string
  parentId: string | null
  mergeSourceId?: string
  step: number
  lane: number
  branch: string
  change: string
  data: TreeNode[]
  createdBy?: string
  positions?: Record<string, { x: number; y: number }>
  mapView?: MapView
  createdAt: number
}
function fitMapViewToLayout(
  versionId: string,
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  view: MapView,
  padding = MAP_PADDING,
): MapView {
  const viewport = {
    width: versionId === 'v0' ? CARD_WIDTH - 2 : CARD_WIDTH - 14,
    height: versionId === 'v0' ? Math.max(1, graphBounds.value.height - 2) : CARD_HEIGHT - 47,
  }
  const geometry = mapGeometry(data, positions, viewport.width, viewport.height)
  const fit = Math.max(MAP_ZOOM_MIN, Math.min(
    1,
    (viewport.width - padding * 2) / geometry.width,
    (viewport.height - padding * 2) / geometry.height,
  ))
  if (view.zoom <= fit) return view
  return {
    zoom: fit,
    panX: (viewport.width - geometry.width * fit) / 2 - geometry.minX * fit,
    panY: (viewport.height - geometry.height * fit) / 2 - geometry.minY * fit,
    manual: true,
  }
}
type Tile = { id: string; label: string; x: number; y: number; width: number; height: number; depth: number }
type SpatialPreview = {
  x: number
  y: number
  versionId: string
  nodeId: string
  kind: 'move' | 'detach' | 'noop' | 'invalid'
  valid: boolean
  data: TreeNode[]
  positions: Record<string, { x: number; y: number }>
  view: MapView
}
type StoredState = { versions: Version[]; activeId: string; nextNode: number; nextVersion: number; nextLane: number; copyLinks: CopyLink[] }
type EditorState = { mode: 'create' | 'rename'; parentId: string | null; nodeId: string | null; value: string; description: string }
type FlatNode = { node: TreeNode; parentId: string | null; path: string; order: number }
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
  interactions?: InteractionEntry[]
  clock: number
}
type CollaborationMetadata = {
  clock: number
  versions: Record<string, Revision>
  removed: Record<string, Revision>
  active: Revision
  copyLinks: Revision
}
type InteractionEntry = {
  id: string
  actorId: string
  actorName: string
  action: string
  createdAt: number
  versionId?: string
  nodeId?: string
  nodeLabel?: string
  ping?: { x: number; y: number }
}
type RemoteUser = { name: string; activeVersionId: string | null; selectedNodeIds: string[]; lastSeen: number }
type Ping = { id: string; userId: string; x: number; y: number; createdAt: number }

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
const VERSION_TREEMAP_ASPECT = (CARD_WIDTH - 14) / (CARD_HEIGHT - 47)
const MAP_ZOOM_MIN = 0.0001
const MAP_ZOOM_MAX = 8
const ZOOM_MAX = 4
const branchColors = ['#176b68', '#d15a3b', '#a58127', '#4774a8', '#8a5c83', '#5b7d46']
const animalNames = [
  'Badger', 'Bison', 'Capybara', 'Dolphin', 'Falcon', 'Fox', 'Gecko', 'Hare',
  'Heron', 'Koala', 'Lynx', 'Marmot', 'Otter', 'Panda', 'Quokka', 'Raven',
  'Robin', 'Seal', 'Tiger', 'Wombat',
]
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
  const normalizedVersions = (value.versions ?? clone(seed.versions)).map((version) => {
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
  })
  const versionsById = new Map(normalizedVersions.map((version) => [version.id, version]))
  return {
    ...clone(seed), ...value,
    versions: normalizedVersions,
    copyLinks: (value.copyLinks ?? []).filter((link) => {
      const source = versionsById.get(link.sourceVersionId)
      const target = versionsById.get(link.targetVersionId)
      return !!source && !!target
        && !!findNode(source.data, link.sourceNodeId)
        && !!findNode(target.data, link.targetNodeId)
    }).sort(compareCopyLinks),
  }
}

const state = ref<StoredState>(readState())
const versions = computed(() => state.value.versions)
const active = computed(() => versions.value.find((version) => version.id === state.value.activeId) ?? versions.value[0]!)
const selectedNode = ref<string | null>(null)
const selectedNodes = ref<string[]>([])
const remoteUsers = ref<Record<string, RemoteUser>>({})
const userName = ref(localStorage.getItem('canopy-user-name')?.trim().slice(0, 32) || animalForUser(CLIENT_ID))
localStorage.setItem('canopy-user-name', userName.value)
const interactions = ref<InteractionEntry[]>([])
const hoveredNode = ref<{ versionId: string; nodeId: string } | null>(null)
const entryTooltip = ref<{ versionId: string; nodeId: string; description: string; x: number; y: number } | null>(null)
const pings = ref<Ping[]>([])
const pingMode = ref(false)
const darkMode = ref(localStorage.getItem('canopy-theme') === 'dark')
const sidebarCollapsed = ref(false)
const compareMode = ref(false)
const compareIds = ref<string[]>([])
const mergeMode = ref(false)
const mergeDecisions = ref<Record<string, 'combine' | 'source' | 'target' | 'omit'>>({})
const mergeParentOverrides = ref<Record<string, string>>({})
const comparisonSelectedNode = ref<string | null>(null)
const zoom = ref(1)
const isReadOnly = computed(() => zoom.value <= 0.35)
const pan = ref({ x: 40, y: 0 })
const graphCanvas = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: window.innerWidth, height: Math.max(400, window.innerHeight - 209) })
let canvasObserver: ResizeObserver | null = null
let panAnimationFrame: number | null = null
const draggingCanvas = ref(false)
const dragOrigin = ref({ x: 0, y: 0, panX: 0, panY: 0 })
const draggedNode = ref<string | null>(null)
const draggedPosition = ref<{ x: number; y: number } | null>(null)
const dragPreviewView = ref<MapView | null>(null)
const overNode = ref<string | null>(null)
const invalidNode = ref<string | null>(null)
const treeDrag = ref<{
  id: string
  x: number
  y: number
  moved: boolean
  space?: {
    grabX: number
    grabY: number
    width: number
    height: number
  }
} | null>(null)
const spatialPreview = ref<SpatialPreview | null>(null)
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
let suppressPingClick = false
let pingPointer: { id: number; x: number; y: number; moved: boolean } | null = null
const menu = ref<{
  x: number
  y: number
  kind: 'entry' | 'version' | 'canvas'
  nodeId?: string
  versionId?: string
} | null>(null)
const contextMenuElement = ref<HTMLElement | null>(null)
const contextMenuPosition = ref({ x: 0, y: 0 })
watch(menu, async (value) => {
  if (!value) return
  await nextTick()
  const element = contextMenuElement.value
  if (!element) return
  contextMenuPosition.value = {
    x: Math.max(4, Math.min(value.x, window.innerWidth - element.offsetWidth - 4)),
    y: Math.max(4, Math.min(value.y, window.innerHeight - element.offsetHeight - 4)),
  }
})
const editor = ref<EditorState | null>(null)
const entryValueInput = ref<HTMLInputElement | null>(null)
watch(editor, async (value) => {
  if (!value) return
  await nextTick()
  entryValueInput.value?.focus()
  entryValueInput.value?.setSelectionRange(value.value.length, value.value.length)
})
const clipboard = ref<ClipboardEntry | null>(readClipboard())
const toast = ref('')
const persistenceLabel = ref('Saved locally')
const roomInput = ref(new URLSearchParams(location.search).get('room') ?? '')
const roomStatus = ref<RoomStatus>({ state: 'idle', peers: 0, message: 'Not connected' })
const peerRoom = new PeerRoom()
const collaborationLabel = computed(() => roomStatus.value.state === 'connected' || roomStatus.value.state === 'hosting'
  ? `${roomStatus.value.peers} peer${roomStatus.value.peers === 1 ? '' : 's'}`
  : roomStatus.value.message)
const connectedUsers = computed(() => {
  if (roomStatus.value.state !== 'connected' && roomStatus.value.state !== 'hosting') return []
  return [
    { id: CLIENT_ID, name: userName.value.trim() || animalForUser(CLIENT_ID), activeVersionId: active.value.id },
    ...Object.entries(remoteUsers.value).map(([id, user]) => ({
      id, name: user.name, activeVersionId: user.activeVersionId,
    })),
  ]
})
const recentInteractions = computed(() => [...interactions.value]
  .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
  .slice(0, 10))
let toastTimer = 0
let presenceTimer = 0
let pingClickTimer = 0
let pingSequence = 0
let interactionSequence = 0
let tileTooltipTimer = 0
let tilePointer = { x: 0, y: 0 }
let persistenceQueue = Promise.resolve()
let skipNextPersist = false
let collaborationRoom = ''
let collaborationMetadata: CollaborationMetadata | null = null
let lastObservedState = JSON.stringify(state.value)
let applyingRemoteState = false

watch(selectedNode, (nodeId) => {
  if (!nodeId) selectedNodes.value = []
  else if (!selectedNodes.value.includes(nodeId)) selectedNodes.value = [nodeId]
})
watch([selectedNodes, () => active.value.id, userName], publishPresence, { deep: true })
watch(userName, (name) => {
  localStorage.setItem('canopy-user-name', name.trim().slice(0, 32) || animalForUser(CLIENT_ID))
})
watch(interactions, (entries) => {
  if (collaborationRoom) localStorage.setItem(interactionStorageKey(collaborationRoom), JSON.stringify(entries))
}, { deep: true })
watch(isReadOnly, (readOnly) => {
  if (!readOnly) return
  setSelectedNodes([])
  editor.value = null
  treeDrag.value = null
  draggedNode.value = null
  draggedPosition.value = null
  dragPreviewView.value = null
  overNode.value = null
  spatialPreview.value = null
})
watch(() => active.value.data, (data) => {
  const valid = selectedNodes.value.filter((id) => !!findNode(data, id))
  if (valid.length !== selectedNodes.value.length) setSelectedNodes(valid)
}, { deep: true })
watch(darkMode, (enabled) => localStorage.setItem('canopy-theme', enabled ? 'dark' : 'light'))

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

function interactionStorageKey(room: string) {
  return `canopy-interactions-${encodeURIComponent(room)}`
}

function animalForUser(userId: string) {
  let hash = 2166136261
  for (const character of userId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return animalNames[(hash >>> 0) % animalNames.length]!
}

function isInteractionEntry(value: unknown): value is InteractionEntry {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.actorId !== 'string'
    || typeof value.actorName !== 'string' || typeof value.action !== 'string'
    || !Number.isFinite(value.createdAt)
    || (value.versionId !== undefined && typeof value.versionId !== 'string')
    || (value.nodeId !== undefined && typeof value.nodeId !== 'string')
    || (value.nodeLabel !== undefined && typeof value.nodeLabel !== 'string')) return false
  return value.ping === undefined || (isRecord(value.ping)
    && Number.isFinite(value.ping.x) && Number.isFinite(value.ping.y))
}

function addInteraction(entry: InteractionEntry, broadcast = true) {
  if (interactions.value.some((item) => item.id === entry.id)) return
  interactions.value = [...interactions.value, entry]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-10)
  if (broadcast && collaborationRoom) peerRoom.send({ type: 'interaction', entry })
}

function logInteraction(
  action: string,
  reference: { versionId?: string; nodeId?: string; nodeLabel?: string; ping?: { x: number; y: number } } = {},
) {
  if (!collaborationRoom) return
  addInteraction({
    id: `${CLIENT_ID}-${Date.now()}-${++interactionSequence}`,
    actorId: CLIENT_ID,
    actorName: userName.value.trim() || animalForUser(CLIENT_ID),
    action,
    createdAt: Date.now(),
    ...reference,
  })
}

function newRevision(clock: number): Revision {
  return { clock, actor: CLIENT_ID }
}

function initializeCollaborationMetadata(room: string) {
  collaborationRoom = room
  try {
    const savedInteractions: unknown = JSON.parse(localStorage.getItem(interactionStorageKey(room)) ?? '[]')
    interactions.value = Array.isArray(savedInteractions) && savedInteractions.every(isInteractionEntry)
      ? savedInteractions.slice(-10)
      : []
  } catch {
    interactions.value = []
  }
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
  const copyLinks = JSON.stringify(previous.copyLinks) !== JSON.stringify(value.copyLinks)
    ? (collaborationMetadata.copyLinks = revision, { links: value.copyLinks, revision })
    : undefined
  const delta: SyncDelta = {
    type: 'sync-delta', versions: changed, removed, copyLinks,
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

function hasValidVersionStep(version: Version, parent: Version, mergeSource?: Version) {
  if (!version.mergeSourceId) return version.step === parent.step + 1
  if (!mergeSource || version.mergeSourceId === version.id) return false
  return version.step === Math.max(parent.step, mergeSource.step) + 1
    || version.step === parent.step + 1
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

function sendSyncSnapshot(reply: (message: unknown) => void) {
  if (!collaborationMetadata) return
  const snapshot: SyncSnapshot = {
    type: 'sync-snapshot',
    state: clone(state.value),
    versions: clone(collaborationMetadata.versions),
    removed: clone(collaborationMetadata.removed),
    active: clone(collaborationMetadata.active),
    copyLinks: clone(collaborationMetadata.copyLinks),
    interactions: clone(interactions.value),
    clock: collaborationMetadata.clock,
  }
  reply(snapshot)
}

function applySyncSnapshot(message: SyncSnapshot) {
  if (!isStoredState(message.state) || !isRevision(message.active) || !isRevision(message.copyLinks)
    || !Number.isFinite(message.clock) || !isRecord(message.versions) || !isRecord(message.removed)
    || !Object.values(message.versions).every(isRevision) || !Object.values(message.removed).every(isRevision)
    || (message.interactions !== undefined
      && (!Array.isArray(message.interactions) || !message.interactions.every(isInteractionEntry)))) {
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
  const localActiveId = state.value.activeId
  state.value = normalizeState(message.state)
  interactions.value = (message.interactions ?? []).slice(-10)
  state.value.activeId = state.value.versions.some((version) => version.id === localActiveId)
    ? localActiveId
    : state.value.versions.find((version) => version.id === 'v0')!.id
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
    const mergeSource = change.version.mergeSourceId
      ? versionsById.get(change.version.mergeSourceId)
      : undefined
    const validParent = change.version.id === 'v0'
      ? change.version.parentId === null && change.version.step === 0
      : !!parent && hasValidVersionStep(change.version, parent, mergeSource)
    if (!validParent) {
      notify('Ignored a shared version with a missing or invalid connection')
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
  if (message.copyLinks && Array.isArray(message.copyLinks.links)
    && message.copyLinks.links.every(isCopyLink) && isRevision(message.copyLinks.revision)) {
    collaborationMetadata.clock = Math.max(collaborationMetadata.clock, message.copyLinks.revision.clock)
    const merged = new Map(state.value.copyLinks.map((link) => [JSON.stringify(link), link]))
    for (const link of message.copyLinks.links) merged.set(JSON.stringify(link), link)
    const links = [...merged.values()].filter((link) => {
      const source = versionsById.get(link.sourceVersionId)
      const target = versionsById.get(link.targetVersionId)
      return !!source && !!target
        && !!findNode(source.data, link.sourceNodeId)
        && !!findNode(target.data, link.targetNodeId)
    }).sort(compareCopyLinks)
    if (JSON.stringify(links) !== JSON.stringify(state.value.copyLinks)) {
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
  } else if (packet.type === 'presence') {
    const presence = message as { userId?: unknown; name?: unknown; activeVersionId?: unknown; selectedNodeIds?: unknown }
    if (typeof presence.userId !== 'string' || !presence.userId || presence.userId === CLIENT_ID
      || !(typeof presence.activeVersionId === 'string' || presence.activeVersionId === null)
      || !Array.isArray(presence.selectedNodeIds)
      || !presence.selectedNodeIds.every((id) => typeof id === 'string')) return
    remoteUsers.value = {
      ...remoteUsers.value,
      [presence.userId]: {
        name: typeof presence.name === 'string' && presence.name.trim()
          ? presence.name.trim().slice(0, 32)
          : animalForUser(presence.userId),
        activeVersionId: presence.activeVersionId,
        selectedNodeIds: presence.selectedNodeIds,
        lastSeen: Date.now(),
      },
    }
  } else if (packet.type === 'presence-leave') {
    const userId = (message as { userId?: unknown }).userId
    if (typeof userId === 'string' && userId !== CLIENT_ID) {
      const { [userId]: _leaving, ...remainingUsers } = remoteUsers.value
      remoteUsers.value = remainingUsers
    }
  } else if (packet.type === 'ping') {
    const ping = message as { id?: unknown; userId?: unknown; x?: unknown; y?: unknown }
    if (typeof ping.id !== 'string' || typeof ping.userId !== 'string' || ping.userId === CLIENT_ID
      || !Number.isFinite(ping.x) || !Number.isFinite(ping.y)) return
    const entry = { id: ping.id, userId: ping.userId, x: ping.x as number, y: ping.y as number, createdAt: Date.now() }
    showPing(entry)
  } else if (packet.type === 'interaction') {
    const entry = (message as { entry?: unknown }).entry
    if (isInteractionEntry(entry) && entry.actorId !== CLIENT_ID) addInteraction(entry, false)
  }
}

function userColor(userId: string) {
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
function selectionColor(userId: string, secondary = false) {
  if (!secondary) return userColor(userId)
  let hash = 2166136261
  for (const character of userId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `hsl(${((hash >>> 0) + 52) % 360} 68% 46%)`
}
function publishPresence() {
  if (!collaborationRoom) return
  peerRoom.send({
    type: 'presence',
    userId: CLIENT_ID,
    name: userName.value.trim() || animalForUser(CLIENT_ID),
    activeVersionId: active.value.id,
    selectedNodeIds: selectedNodes.value,
  })
}
function showPing(ping: Ping) {
  pings.value = [...pings.value.filter((item) => item.id !== ping.id), ping]
  window.setTimeout(() => {
    pings.value = pings.value.filter((item) => item.id !== ping.id)
  }, 1600)
  playPingSound()
}
function sendPingAt(clientX: number, clientY: number) {
  const rect = graphCanvas.value?.getBoundingClientRect()
  if (!rect) return
  const ping = {
    id: `${CLIENT_ID}-${Date.now()}-${++pingSequence}`,
    userId: CLIENT_ID,
    x: (clientX - rect.left - pan.value.x) / zoom.value,
    y: (clientY - rect.top - pan.value.y) / zoom.value,
    createdAt: Date.now(),
  }
  showPing(ping)
  peerRoom.send({ type: 'ping', ...ping })
  logInteraction('Ping', { ping: { x: ping.x, y: ping.y } })
}

function focusCollaborator(userId: string) {
  const collaborator = connectedUsers.value.find((user) => user.id === userId)
  if (!collaborator?.activeVersionId) return
  const version = versions.value.find((item) => item.id === collaborator.activeVersionId)
  if (version) focusVersion(version)
}

function focusPingLocation(location: { x: number; y: number }) {
  const targetZoom = Math.min(ZOOM_MAX, Math.max(1, zoom.value))
  animateCamera(targetZoom, {
    x: canvasSize.value.width / 2 - location.x * targetZoom,
    y: canvasSize.value.height / 2 - location.y * targetZoom,
  })
}

function navigateInteraction(entry: InteractionEntry, kind: 'version' | 'node' | 'ping') {
  if (kind === 'ping' && entry.ping) {
    focusPingLocation(entry.ping)
    return
  }
  if (kind === 'node' && entry.nodeId) {
    const version = versions.value.find((item) => item.id === entry.versionId && findNode(item.data, entry.nodeId!))
    if (version) focusVersion(version)
    return
  }
  const version = versions.value.find((item) => item.id === entry.versionId)
  if (version) focusVersion(version)
}
function playPingSound() {
  try {
    const context = new window.AudioContext()
    const play = () => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(660, context.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(440, context.currentTime + 0.11)
      gain.gain.setValueAtTime(0.045, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.12)
      window.setTimeout(() => { void context.close().catch(() => undefined) }, 200)
    }
    if (context.state === 'suspended') void context.resume().then(play).catch(() => { void context.close() })
    else play()
  } catch {
    // Audio is optional; the visual ping still works when browser audio is unavailable.
  }
}
function handlePingPointer(event: PointerEvent) {
  if (pingMode.value) {
    if (event.button === 0 && !(event.target as HTMLElement).closest('.canvas-hotbar, button')) {
      pingPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }
    return
  }
  if (!event.altKey || event.button !== 0
    || (event.target as HTMLElement).closest('.canvas-hotbar, button')) return
  event.preventDefault()
  event.stopImmediatePropagation()
  suppressPingClick = true
  window.clearTimeout(pingClickTimer)
  pingClickTimer = window.setTimeout(() => { suppressPingClick = false }, 500)
  sendPingAt(event.clientX, event.clientY)
}
function trackPingPointerMove(event: PointerEvent) {
  if (pingPointer?.id === event.pointerId
    && Math.hypot(event.clientX - pingPointer.x, event.clientY - pingPointer.y) > 5) pingPointer.moved = true
}
function clearPingPointer(event: PointerEvent) {
  if (pingPointer?.id !== event.pointerId) return
  window.setTimeout(() => {
    if (pingPointer?.id === event.pointerId) pingPointer = null
  }, 0)
}
function handlePingClick(event: MouseEvent) {
  const pointer = pingPointer
  pingPointer = null
  if (!pingMode.value || event.button !== 0
    || pointer?.moved
    || (event.target as HTMLElement).closest('.canvas-hotbar, button, .copy-link, .copy-link-hit')) return
  sendPingAt(event.clientX, event.clientY)
}
function suppressPingClickEvent(event: MouseEvent) {
  if (!suppressPingClick) return
  event.preventDefault()
  event.stopImmediatePropagation()
  suppressPingClick = false
  window.clearTimeout(pingClickTimer)
}
function onRoomStatus(status: RoomStatus) {
  roomStatus.value = status
  if (status.state === 'connected' || status.state === 'hosting') publishPresence()
  if (status.state === 'idle') remoteUsers.value = {}
}
function enterTile(event: PointerEvent, version: Version, nodeId: string) {
  if (draggedNode.value && draggedSubtreeIds.value.includes(nodeId)) return
  hoveredNode.value = { versionId: version.id, nodeId }
  window.clearTimeout(tileTooltipTimer)
  entryTooltip.value = null
  if (treeDrag.value) return
  const description = findNode(cardData(version), nodeId)?.description?.trim()
  if (!description) return
  tilePointer = { x: event.clientX, y: event.clientY }
  tileTooltipTimer = window.setTimeout(() => {
    if (hoveredNode.value?.versionId === version.id && hoveredNode.value.nodeId === nodeId) {
      entryTooltip.value = { versionId: version.id, nodeId, description, ...tilePointer }
    }
  }, 2000)
}
function moveTileTooltip(event: PointerEvent, versionId: string, nodeId: string) {
  tilePointer = { x: event.clientX, y: event.clientY }
  if (entryTooltip.value?.versionId === versionId && entryTooltip.value.nodeId === nodeId) {
    entryTooltip.value = { ...entryTooltip.value, x: event.clientX, y: event.clientY }
  }
}
function leaveTile(versionId: string, nodeId: string) {
  if (hoveredNode.value?.versionId === versionId && hoveredNode.value.nodeId === nodeId) hoveredNode.value = null
  if (entryTooltip.value?.versionId === versionId && entryTooltip.value.nodeId === nodeId) entryTooltip.value = null
  window.clearTimeout(tileTooltipTimer)
}
function expireRemoteUsers() {
  const cutoff = Date.now() - 15000
  remoteUsers.value = Object.fromEntries(Object.entries(remoteUsers.value)
    .filter(([, user]) => user.lastSeen >= cutoff))
  publishPresence()
}

async function connectToRoom(mode: 'host' | 'join') {
  const room = roomInput.value.trim()
  if (!room || room.length > 80) {
    notify('Enter a room name of 1–80 characters')
    return
  }
  initializeCollaborationMetadata(room)
  try {
    if (mode === 'host') await peerRoom.hostRoom(room, handleRoomMessage, onRoomStatus)
    else await peerRoom.joinRoom(room, handleRoomMessage, onRoomStatus)
    publishPresence()
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
  peerRoom.send({ type: 'presence-leave', userId: CLIENT_ID })
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
    const localActiveId = state.value.activeId
    state.value = normalizeState(payload.state)
    state.value.activeId = state.value.versions.some((version) => version.id === localActiveId)
      ? localActiveId
      : state.value.versions.find((version) => version.id === 'v0')!.id
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
  const children = node.children.map((child) => ({ node: child, ...treeDimensions(child, positions) }))
  if (!children.length) return []

  let best: { score: number; layouts: Array<typeof children[number] & { x: number; y: number }> } | null = null
  for (let columns = 1; columns <= children.length; columns += 1) {
    const rows = Math.ceil(children.length / columns)
    const columnWidths = Array.from({ length: columns }, (_, column) =>
      Math.max(...children.filter((_, index) => index % columns === column).map((child) => child.width)))
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(...children.slice(row * columns, (row + 1) * columns).map((child) => child.height)))
    const columnOffsets = columnWidths.map((_, column) =>
      columnWidths.slice(0, column).reduce((sum, width) => sum + width + TREE_PADDING, 0))
    const rowOffsets = rowHeights.map((_, row) =>
      rowHeights.slice(0, row).reduce((sum, height) => sum + height + TREE_PADDING, 0))
    const width = columnWidths.reduce((sum, item) => sum + item, 0) + TREE_PADDING * (columns - 1) + TREE_PADDING * 2
    const height = rowHeights.reduce((sum, item) => sum + item, 0)
      + TREE_PADDING * (rows - 1) + TREE_PADDING * 2 + TREE_HEADER_HEIGHT
    const childArea = children.reduce((sum, child) => sum + child.width * child.height, 0)
    const waste = Math.max(0, (width * height - childArea) / Math.max(1, childArea))
    const score = Math.abs(Math.log((width / height) / VERSION_TREEMAP_ASPECT)) + waste * 0.025
    if (best && score >= best.score) continue
    best = {
      score,
      layouts: children.map((child, index) => ({
        ...child,
        x: TREE_PADDING + columnOffsets[index % columns]!,
        y: TREE_PADDING + TREE_HEADER_HEIGHT + rowOffsets[Math.floor(index / columns)]!,
      })),
    }
  }
  return best!.layouts
}
function outerTreemapDimensions(node: TreeNode, positions?: Record<string, { x: number; y: number }>): { width: number; height: number } {
  const size = treeDimensions(node, positions)
  const width = Math.max(size.width, size.height * VERSION_TREEMAP_ASPECT)
  return {
    width,
    height: Math.max(size.height, width / VERSION_TREEMAP_ASPECT),
  }
}
function treeDimensions(node: TreeNode, positions?: Record<string, { x: number; y: number }>): { width: number; height: number } {
  if (!node.children.length) return { width: LEAF_TILE_WIDTH, height: LEAF_TILE_HEIGHT }
  const children = childLayouts(node, positions)
  return {
    width: Math.max(...children.map((child) => child.x + child.width)) + TREE_PADDING,
    height: Math.max(...children.map((child) => child.y + child.height)) + TREE_PADDING,
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
    const size = outerTreemapDimensions(node, positions)
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
    Math.max(...data.filter((_, index) => index % columns === column).map((node) => outerTreemapDimensions(node, positions).width)))
  const rowCount = Math.ceil(data.length / columns)
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(...data.slice(row * columns, (row + 1) * columns).map((node) => outerTreemapDimensions(node, positions).height)))
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
  return resolveRootOverlaps(data, { ...defaults, ...existing, [nodeId]: position }, nodeId)
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
    const size = outerTreemapDimensions(node)
    const originTile = previousParents.has(node.id)
      ? tileForNode(previousData, previousPositions, node.id)
      : undefined
    const preferred = originTile
      ? { x: originTile.x + originTile.width + MAP_GAP, y: originTile.y }
      : { x: anchor.x - size.width / 2, y: anchor.y - size.height / 2 }
    positions[node.id] = nearestFreePosition(preferred, size, occupied, positions)
    occupied.push(node)
  }
  return resolveRootOverlaps(nextData, positions)
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
    const otherSize = outerTreemapDimensions(other)
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
function resolveRootOverlaps(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
  fixedId?: string,
) {
  const resolved = { ...positions }
  const ordered = fixedId
    ? [...data].sort((left, right) => Number(right.id === fixedId) - Number(left.id === fixedId))
    : data
  const occupied: TreeNode[] = []
  for (const node of ordered) {
    const position = resolved[node.id] ?? { x: 0, y: 0 }
    const size = outerTreemapDimensions(node)
    if (!nearestPositionIsFree(position, size, occupied, resolved)) {
      resolved[node.id] = nearestFreePosition(
        { x: position.x * CARD_WIDTH, y: position.y * TREE_MAP_HEIGHT },
        size,
        occupied,
        resolved,
      )
    }
    occupied.push(node)
  }
  return resolved
}
function nearestPositionIsFree(
  position: { x: number; y: number },
  size: { width: number; height: number },
  occupied: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
) {
  const candidate = { x: position.x * CARD_WIDTH, y: position.y * TREE_MAP_HEIGHT }
  return !occupied.some((other) => {
    const otherPosition = positions[other.id] ?? { x: 0, y: 0 }
    const otherSize = outerTreemapDimensions(other)
    return candidate.x < otherPosition.x * CARD_WIDTH + otherSize.width + MAP_GAP
      && candidate.x + size.width + MAP_GAP > otherPosition.x * CARD_WIDTH
      && candidate.y < otherPosition.y * TREE_MAP_HEIGHT + otherSize.height + MAP_GAP
      && candidate.y + size.height + MAP_GAP > otherPosition.y * TREE_MAP_HEIGHT
  })
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

    const lane = parent.lane === source.lane
      ? parent.lane + 1
      : Math.max(parent.lane, source.lane)
    for (const other of graph) {
      if (!mergeLineIds.has(other.id) && other.lane >= lane) other.lane += 1
    }
    mergeLine.forEach((lineVersion) => { lineVersion.lane = lane })
    nextLane += 1
  }

  graph.sort((left, right) => left.step - right.step || left.id.localeCompare(right.id))
  state.value.nextLane = nextLane
}

function createVersion(data: TreeNode[], change: string, forceNew = false) {
  if (isReadOnly.value) return null
  const parent = active.value
  const wasCentered = isVersionCentered(parent)
  const siblings = versions.value.filter((version) => version.parentId === parent.id)
  if (structureSignature(data) === structureSignature(parent.data)) {
    notify('No change · version not created')
    return null
  }
  const signature = structureSignature(data)
  const duplicate = forceNew
    ? undefined
    : siblings.find((version) => structureSignature(version.data) === signature)
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
  const fittedMapView = fitMapViewToLayout('new-version', data, positions, currentMapView)
  const version: Version = {
    id: `v${state.value.nextVersion++}-${CLIENT_ID}`, parentId: parent.id, step: parent.step + 1,
    lane, branch, change, data, createdBy: CLIENT_ID, positions,
    ...(currentMapView.manual ? { mapView: clone(fittedMapView) } : {}),
    createdAt: Date.now(),
  }
  state.value.versions.push(version)
  reflowLayout()
  state.value.activeId = version.id
  selectedNode.value = null
  compareMode.value = false
  if (!parent.data.length && data.length) centerVersionTreemaps(version.id, false)
  const previousNodes = flattenPaths(parent.data)
  const nextNodes = flattenPaths(version.data)
  const addedNodeId = [...nextNodes.keys()].find((nodeId) => !previousNodes.has(nodeId))
  const removedNodeId = [...previousNodes.keys()].find((nodeId) => !nextNodes.has(nodeId))
  const changedNodeId = [...nextNodes].find(([nodeId, item]) =>
    previousNodes.get(nodeId)?.value !== item.value)?.[0]
  const movedNodeId = [...nextNodes].find(([nodeId, item]) =>
    previousNodes.has(nodeId) && previousNodes.get(nodeId)?.parentId !== item.parentId)?.[0]
  const referenceNodeId = addedNodeId ?? removedNodeId ?? changedNodeId ?? movedNodeId
  logInteraction(`Created ${branch} · ${change}`, {
    versionId: version.id,
    nodeId: referenceNodeId,
    nodeLabel: referenceNodeId
      ? findNode(version.data, referenceNodeId)?.value ?? findNode(parent.data, referenceNodeId)?.value
      : undefined,
  })
  notify(`Created ${version.id} · ${change}`)
  panToVersion(version, wasCentered)
  return version
}

function addEntry(parentId: string | null = null) {
  if (isReadOnly.value) return
  editor.value = { mode: 'create', parentId, nodeId: null, value: '', description: '' }
}

function commitEditor() {
  if (isReadOnly.value || !editor.value) return
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
  if (isReadOnly.value) return
  const node = findNode(active.value.data, id)
  if (!node) return
  editor.value = { mode: 'rename', parentId: null, nodeId: id, value: node.value, description: node.description ?? '' }
}

function deleteEntry(id: string, mode: 'keep-children' | 'subtree' | 'detach-children') {
  if (isReadOnly.value) return
  const data = clone(active.value.data)
  const node = findNode(data, id)
  if (!node) return
  if (mode === 'subtree' && node.children.length
    && !window.confirm(`Delete ${node.value} and all ${countNodes(node.children)} descendant entries?`)) return
  const parent = findParent(data, id)
  const siblings = parent?.children ?? data
  const index = siblings.findIndex((entry) => entry.id === id)
  if (index < 0) return
  if (mode === 'keep-children') siblings.splice(index, 1, ...node.children)
  else if (mode === 'detach-children' && node.children.length) {
    const detached = node.children
    siblings.splice(index, 1)
    data.push(...detached)
  } else siblings.splice(index, 1)
  createVersion(data, `Delete ${node.value}`)
}

function detachEntry(id: string, preview?: SpatialPreview) {
  if (isReadOnly.value) return null
  const data = clone(active.value.data)
  const parent = findParent(data, id)
  if (!parent) return null
  const detached = removeNode(data, id)
  let version: Version | null = null
  if (detached) {
    data.push(detached)
    version = createVersion(data, `Detach ${detached.value}`)
    if (version && preview) {
      version.positions = clone(preview.positions)
      version.mapView = clone(preview.view)
    }
  }
  return version
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
    return {
      data,
      positions,
      view: fitMapViewToLayout(active.value.id, data, positions, mapViewFor(active.value), 0),
      kind: 'attach' as const,
    }
  }
  if (!spatialPreview.value) return null
  if (!spatialPreview.value.valid) return null
  return {
    data: spatialPreview.value.data,
    positions: spatialPreview.value.positions,
    view: spatialPreview.value.view,
    kind: spatialPreview.value.kind === 'detach' ? 'detach' as const : 'layout' as const,
  }
})

function attachEntry(sourceId: string, targetId: string, preview?: { data: TreeNode[]; positions: Record<string, { x: number; y: number }>; view: MapView }) {
  if (isReadOnly.value) return null
  if (!canAttach(sourceId, targetId)) return null
  const parent = findParent(active.value.data, sourceId)
  if (parent?.id === targetId) return null
  const data = clone(active.value.data)
  const source = removeNode(data, sourceId)
  const target = findNode(data, targetId)
  if (!source || !target) return null
  target.children.push(source)
  const version = createVersion(data, `Attach ${source.value} to ${target.value}`)
  if (version && preview) {
    version.positions = clone(preview.positions)
    version.mapView = clone(preview.view)
  }
  return version
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

function flattenNodes(nodes: TreeNode[], parentId: string | null = null, parentPath = ''): Map<string, FlatNode> {
  const result = new Map<string, FlatNode>()
  for (const [order, node] of nodes.entries()) {
    const path = parentPath ? `${parentPath}/${node.value}` : node.value
    result.set(node.id, { node, parentId, path, order })
    for (const [id, info] of flattenNodes(node.children, node.id, path)) result.set(id, info)
  }
  return result
}

function chooseCompare(id: string) {
  if (compareIds.value.includes(id)) compareIds.value = compareIds.value.filter((item) => item !== id)
  else compareIds.value = [...compareIds.value.slice(-1), id]
  mergeDecisions.value = {}
  mergeParentOverrides.value = {}
  comparisonSelectedNode.value = null
  if (compareIds.value.length === 2) showOverview.value = true
}

const showOverview = ref(false)
function startVersionSelection(mode: 'compare' | 'merge') {
  compareMode.value = mode === 'compare'
  mergeMode.value = mode === 'merge'
  compareIds.value = []
  mergeDecisions.value = {}
  mergeParentOverrides.value = {}
  comparisonSelectedNode.value = null
  showOverview.value = false
}
function closeVersionSelection() {
  compareMode.value = false
  mergeMode.value = false
  showOverview.value = false
  compareIds.value = []
  mergeDecisions.value = {}
  mergeParentOverrides.value = {}
  comparisonSelectedNode.value = null
}
const comparison = computed(() => {
  if (compareIds.value.length !== 2) return []
  const left = versions.value.find((item) => item.id === compareIds.value[0])
  const right = versions.value.find((item) => item.id === compareIds.value[1])
  if (!left || !right) return []
  const a = flattenNodes(left.data)
  const b = flattenNodes(right.data)
  const changes: { id: string; kind: string; label: string }[] = []
  for (const [id, item] of a) {
    const other = b.get(id)
    if (!other) changes.push({ id, kind: 'Removed', label: item.path })
    else if (item.parentId !== other.parentId || item.order !== other.order
      || (item.parentId === null && other.parentId === null
        && (Math.abs((left.positions?.[id]?.x ?? 0) - (right.positions?.[id]?.x ?? 0)) > 0.002
          || Math.abs((left.positions?.[id]?.y ?? 0) - (right.positions?.[id]?.y ?? 0)) > 0.002))) {
      changes.push({ id, kind: 'Relocated', label: item.path === other.path ? `${item.path} (position or parent changed)` : `${item.path} → ${other.path}` })
    }
    else if (item.node.value !== other.node.value || item.node.description !== other.node.description) {
      changes.push({ id, kind: 'Modified', label: `${item.path} → ${other.path}` })
    }
  }
  for (const [id, item] of b) if (!a.has(id)) changes.push({ id, kind: 'Added', label: item.path })
  return changes
})
const comparisonStatus = computed(() => new Map(comparison.value.map((change) => [change.id, change.kind.toLowerCase()])))
const mergeResult = computed(() => {
  if (!mergeMode.value || compareIds.value.length !== 2) return null
  const source = versions.value.find((item) => item.id === compareIds.value[0])
  const target = versions.value.find((item) => item.id === compareIds.value[1])
  if (!source || !target || source.id === target.id) return null
  const sourceNodes = flattenNodes(source.data)
  const targetNodes = flattenNodes(target.data)
  const values = new Map<string, { value: string; description?: string; parentId: string | null; order: number }>()
  const ids = [...new Set([...targetNodes.keys(), ...sourceNodes.keys()])]
  for (const id of ids) {
    const sourceEntry = sourceNodes.get(id)
    const targetEntry = targetNodes.get(id)
    const decision = mergeDecisions.value[id]
    if (decision === 'omit') continue
    const selected = decision === 'source' ? sourceEntry : decision === 'target' ? targetEntry : targetEntry ?? sourceEntry
    if (!selected) continue
    values.set(id, {
      value: selected.node.value,
      description: selected.node.description,
      parentId: selected.parentId,
      order: selected.order,
    })
  }

  const parentById = new Map([...values].map(([id, value]) => [id, value.parentId]))
  for (const [id, parentId] of Object.entries(mergeParentOverrides.value)) {
    if (!values.has(id) || (parentId && !values.has(parentId))) continue
    parentById.set(id, parentId || null)
  }
  for (const [id, parentId] of parentById) {
    if (parentId && !values.has(parentId)) parentById.set(id, null)
  }
  const checked = new Set<string>()
  for (const id of values.keys()) {
    if (checked.has(id)) continue
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let current: string | null | undefined = id
    while (current && values.has(current) && !checked.has(current)) {
      const cycleStart = pathIndex.get(current)
      if (cycleStart !== undefined) {
        for (const cycleId of path.slice(cycleStart)) parentById.set(cycleId, null)
        break
      }
      pathIndex.set(current, path.length)
      path.push(current)
      current = parentById.get(current)
    }
    path.forEach((item) => checked.add(item))
  }

  const nodes = new Map([...values].map(([id, value]) => [id, {
    id, value: value.value, ...(value.description ? { description: value.description } : {}), children: [] as TreeNode[],
  }]))
  const roots: TreeNode[] = []
  for (const id of [...values.keys()].sort((left, right) => values.get(left)!.order - values.get(right)!.order
    || ids.indexOf(left) - ids.indexOf(right))) {
    const node = nodes.get(id)
    if (!node) continue
    const parentId = parentById.get(id)
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const positions = positionsForData(target.data, roots, target.positions, mapViewFor(target), mapViewport(target))
  return { source, target, data: roots, positions }
})
const mergeRows = computed(() => {
  const merged = mergeResult.value
  if (!merged) return []
  const source = flattenNodes(merged.source.data)
  const target = flattenNodes(merged.target.data)
  const result = flattenNodes(merged.data)
  const ids = new Set([...source.keys(), ...target.keys()])
  const depth = (id: string, entries: Map<string, FlatNode>) => {
    let value = 0
    let parentId = entries.get(id)?.parentId
    while (parentId && entries.has(parentId)) {
      value += 1
      parentId = entries.get(parentId)?.parentId ?? null
    }
    return value
  }
  return [...ids].map((id) => {
    const sourceEntry = source.get(id)
    const targetEntry = target.get(id)
    return {
      id, sourceEntry, targetEntry, resultEntry: result.get(id),
      label: sourceEntry?.node.value ?? targetEntry!.node.value,
      shared: !!sourceEntry && !!targetEntry,
      depth: Math.max(sourceEntry ? depth(id, source) : 0, targetEntry ? depth(id, target) : 0),
    }
  }).sort((left, right) => Number(left.shared) - Number(right.shared)
    || left.depth - right.depth || left.label.localeCompare(right.label))
})
function mergeParentOptions(nodeId: string) {
  const data = mergeResult.value?.data ?? []
  const entry = findNode(data, nodeId)
  const excluded = new Set(entry ? descendants(entry) : [nodeId])
  return [...flattenNodes(data)].filter(([id]) => !excluded.has(id))
}
function setMergeParent(nodeId: string, parentId: string) {
  const validParent = !parentId || mergeParentOptions(nodeId).some(([id]) => id === parentId)
  if (!validParent) return
  mergeParentOverrides.value = { ...mergeParentOverrides.value, [nodeId]: parentId }
}
function mergeDecisionFor(row: { id: string; sourceEntry?: FlatNode; targetEntry?: FlatNode }) {
  return mergeDecisions.value[row.id]
    ?? (row.sourceEntry && row.targetEntry ? 'combine' : row.sourceEntry ? 'source' : 'target')
}
function setMergeDecision(nodeId: string, decision: 'combine' | 'source' | 'target' | 'omit') {
  mergeDecisions.value = { ...mergeDecisions.value, [nodeId]: decision }
  const overrides = { ...mergeParentOverrides.value }
  delete overrides[nodeId]
  mergeParentOverrides.value = overrides
}
function onMergeParentChange(nodeId: string, event: Event) {
  setMergeParent(nodeId, (event.target as HTMLSelectElement).value)
}
const comparisonPanels = computed(() => {
  if (compareIds.value.length !== 2) return []
  const source = versions.value.find((item) => item.id === compareIds.value[0])
  const target = versions.value.find((item) => item.id === compareIds.value[1])
  if (!source || !target) return []
  const panels = [
    { id: source.id, label: 'Source', version: source, data: source.data, positions: source.positions, role: 'source' },
    { id: target.id, label: 'Target', version: target, data: target.data, positions: target.positions, role: 'target' },
  ]
  return panels.map((panel) => ({
    ...panel,
    tiles: panel.data.flatMap((root, index) => tilesFor(root, panel.data, index, panel.positions)),
  }))
})
const comparisonViewBox = computed(() => {
  const tiles = comparisonPanels.value.flatMap((panel) => panel.tiles)
  if (!tiles.length) return '0 0 260 220'
  const left = Math.min(...tiles.map((tile) => tile.x))
  const top = Math.min(...tiles.map((tile) => tile.y))
  const right = Math.max(...tiles.map((tile) => tile.x + tile.width))
  const bottom = Math.max(...tiles.map((tile) => tile.y + tile.height))
  return `${left - MAP_PADDING} ${top - MAP_PADDING} ${Math.max(1, right - left) + MAP_PADDING * 2} ${Math.max(1, bottom - top) + MAP_PADDING * 2}`
})
function comparisonKind(nodeId: string) {
  return comparisonStatus.value.get(nodeId) ?? 'unchanged'
}
function comparisonGhosts(panelIndex: number) {
  const counterpart = comparisonPanels.value[panelIndex === 0 ? 1 : 0]
  const panel = comparisonPanels.value[panelIndex]
  if (!panel || !counterpart) return []
  const present = new Set(panel.tiles.map((tile) => tile.id))
  return counterpart.tiles.filter((tile) => !present.has(tile.id))
}
function selectComparedNode(nodeId: string) {
  comparisonSelectedNode.value = comparisonSelectedNode.value === nodeId ? null : nodeId
}

function confirmMerge() {
  const result = mergeResult.value
  if (!result) return
  const targetIsLatest = !versions.value.some((version) =>
    version.branch === result.target.branch && version.step > result.target.step)
  const siblings = versions.value.filter((version) => version.parentId === result.target.id)
  const nextVersionNumber = state.value.nextVersion++
  const branchNumber = siblings.reduce((highest, version) => {
    const suffix = version.branch.split('.').at(-1) ?? '0'
    return Math.max(highest, Number(suffix.replace(/^B/, '')) || 0)
  }, 0) + 1
  const branch = result.target.id === 'v0'
    ? `B${branchNumber}`
    : targetIsLatest ? result.target.branch : `${result.target.branch}.M${nextVersionNumber}`
  const version: Version = {
    id: `v${nextVersionNumber}-${CLIENT_ID}`,
    parentId: result.target.id,
    mergeSourceId: result.source.id,
    step: Math.max(result.source.step, result.target.step) + 1,
    lane: result.target.lane,
    branch,
    change: `Merge ${result.source.branch} into ${result.target.branch}`,
    data: clone(result.data),
    positions: clone(result.positions),
    createdBy: CLIENT_ID,
    createdAt: Date.now(),
  }
  const wasCentered = isVersionCentered(result.target)
  state.value.versions.push(version)
  compactVersionTreemaps(version.id, false)
  reflowLayout()
  state.value.activeId = version.id
  setSelectedNodes([])
  mergeMode.value = false
  compareMode.value = false
  showOverview.value = false
  compareIds.value = []
  mergeDecisions.value = {}
  mergeParentOverrides.value = {}
  notify(`Created merge ${displayVersionId(version.id)}`)
  logInteraction(`Merged ${result.source.branch} into ${result.target.branch}`, { versionId: version.id })
  panToVersion(version, wasCentered)
}

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
  if (versions.value.some((version) => !removeIds.has(version.id)
    && version.mergeSourceId && removeIds.has(version.mergeSourceId))) {
    notify('Cannot prune a version referenced by a merge')
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
  state.value.copyLinks = state.value.copyLinks.filter((link) =>
    !removeIds.has(link.sourceVersionId) && !removeIds.has(link.targetVersionId))
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
  if (compareMode.value || mergeMode.value) {
    chooseCompare(version.id)
    return
  }
  state.value.activeId = version.id
  setSelectedNodes([])
  menu.value = null
}

function activateVersionOnPointer(version: Version, event: PointerEvent) {
  if (compareMode.value || mergeMode.value || (event.target as HTMLElement).closest('button')) return
  state.value.activeId = version.id
}

function setSelectedNodes(nodeIds: string[]) {
  selectedNodes.value = [...new Set(nodeIds)]
  selectedNode.value = selectedNodes.value[0] ?? null
}

function onTileClick(version: Version, nodeId: string, event: MouseEvent) {
  if (suppressTileClick) {
    suppressTileClick = false
    return
  }
  if (compareMode.value || mergeMode.value) {
    chooseCompare(version.id)
    return
  }
  state.value.activeId = version.id
  if (isReadOnly.value) {
    setSelectedNodes([])
  } else if (event.shiftKey) {
    const selection = selectedNodes.value.includes(nodeId)
      ? selectedNodes.value.filter((id) => id !== nodeId)
      : [...selectedNodes.value, nodeId]
    setSelectedNodes(selection)
  } else {
    setSelectedNodes([nodeId])
  }
  menu.value = null
}

function onCanvasClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('.version-card, button')) return
  setSelectedNodes([])
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
  return versionConnectionPath(parent, version)
}
function versionConnectionPath(source: Version, destination: Version, endOffsetY = 0) {
  const from = cardPosition(source)
  const to = cardPosition(destination)
  const startX = from.x + CARD_WIDTH
  const startY = from.y + cardHeight(source) / 2
  const endX = to.x
  const endY = to.y + cardHeight(destination) / 2 + endOffsetY
  if (source.id === 'v0' && endOffsetY === 0) return `M ${startX} ${endY} H ${endX}`
  if (Math.abs(endY - startY) < 1) return `M ${startX} ${startY} H ${endX}`
  const direction = Math.sign(endY - startY)
  const cornerX = startX + (endX - startX) / 2
  const radius = Math.min(
    GRAPH_GAP_X / 4,
    Math.abs(endY - startY) / 2,
    cornerX - startX,
    endX - cornerX,
  )
  return `M ${startX} ${startY} H ${cornerX - radius} Q ${cornerX} ${startY} ${cornerX} ${startY + direction * radius} V ${endY - direction * radius} Q ${cornerX} ${endY} ${cornerX + radius} ${endY} H ${endX}`
}
function mergeConnectionPath(version: Version) {
  const source = versions.value.find((item) => item.id === version.mergeSourceId)
  if (!source) return ''
  return versionConnectionPath(source, version, 0, true)
}
function mergeConnectionColor(version: Version) {
  const source = versions.value.find((item) => item.id === version.mergeSourceId)
  return versionColor(source ?? version)
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
  const targetZoom = fitZoom.value
  animateCamera(targetZoom, {
    x: (canvasSize.value.width - graphBounds.value.width * targetZoom) / 2,
    y: (canvasSize.value.height - graphBounds.value.height * targetZoom) / 2,
  })
}
function versionColor(version: Version) {
  if (version.id === 'v0') return '#7b8580'
  const index = Math.max(0, Number(version.branch.match(/\d+/)?.[0] ?? 1) - 1)
  return branchColors[index % branchColors.length]!
}
function versionAuthorColor(version: Version) {
  const author = version.createdBy ?? version.id.match(/-([a-f0-9]{12})$/)?.[1]
  return author ? userColor(author) : '#7b8580'
}
function activeUsersFor(versionId: string) {
  const users = []
  if (active.value.id === versionId) users.push({ id: CLIENT_ID, color: userColor(CLIENT_ID) })
  for (const [id, user] of Object.entries(remoteUsers.value)) {
    if (user.activeVersionId === versionId) users.push({ id, color: userColor(id) })
  }
  return users
}
function tileSelectionHighlights(versionId: string, nodeId: string) {
  const highlights: { id: string; color: string }[] = []
  if (active.value.id === versionId) {
    const localIndex = selectedNodes.value.indexOf(nodeId)
    if (localIndex >= 0) highlights.push({ id: CLIENT_ID, color: selectionColor(CLIENT_ID, localIndex > 0) })
  }
  for (const [id, user] of Object.entries(remoteUsers.value)) {
    if (user.activeVersionId === versionId && user.selectedNodeIds.includes(nodeId)) {
      highlights.push({ id, color: userColor(id) })
    }
  }
  return highlights
}
function tileStrokeColor(versionId: string, nodeId: string) {
  if ((hoveredNode.value?.versionId === versionId && hoveredNode.value.nodeId === nodeId)
    || (versionId === active.value.id && overNode.value === nodeId)) return '#00a8ff'
  return tileSelectionHighlights(versionId, nodeId)[0]?.color ?? (darkMode.value ? '#101713' : '#fff')
}
function tileStrokeWidth(versionId: string, nodeId: string) {
  const isHighlighted = (hoveredNode.value?.versionId === versionId && hoveredNode.value.nodeId === nodeId)
    || (versionId === active.value.id && overNode.value === nodeId)
    || tileSelectionHighlights(versionId, nodeId).length > 0
  if (!isHighlighted) return 3
  const normalizedZoom = Math.max(0.35, Math.min(1, zoom.value))
  return 3 + (1 - normalizedZoom) * (7 / 0.65)
}
function descendantsCount(nodes: TreeNode[]) { return countNodes(nodes) }
function treeDepth(nodes: TreeNode[]): number {
  return nodes.length ? 1 + Math.max(...nodes.map((node) => treeDepth(node.children))) : 0
}
function versionAction(version: Version) {
  const previous = version.parentId ? versions.value.find((item) => item.id === version.parentId) : undefined
  if (!previous) return { label: 'root', symbol: '•' }
  const before = flattenPaths(previous.data)
  const after = flattenPaths(version.data)
  const added = [...after.keys()].filter((id) => !before.has(id)).length
  const removed = [...before.keys()].filter((id) => !after.has(id)).length
  let renamed = 0
  let modified = 0
  for (const [id, item] of after) {
    const old = before.get(id)
    if (!old) continue
    const oldNode = findNode(previous.data, id)
    const newNode = findNode(version.data, id)
    if (item.value !== old.value) renamed += 1
    if ((oldNode?.description ?? '') !== (newNode?.description ?? '')) modified += 1
  }
  const moved = [...after].filter(([id, item]) => before.has(id) && before.get(id)!.parentId !== item.parentId)
  if (added && !removed && !renamed && !modified) return { label: 'add', symbol: '+' }
  if (removed && !added && !renamed && !modified) return { label: 'delete', symbol: '−' }
  if (moved.length && !added && !removed && !renamed && !modified) {
    const item = moved[0]!
    const oldParent = before.get(item[0])!.parentId
    if (oldParent === null) return { label: 'attach', symbol: '↳' }
    if (item[1].parentId === null) return { label: 'detach', symbol: '↗' }
    return { label: 'move', symbol: '↔' }
  }
  if ((renamed || modified) && !added && !removed && !moved.length) {
    return renamed === 1 && modified === 0 ? { label: 'rename', symbol: '✎' } : { label: 'modify', symbol: '~' }
  }
  return { label: 'modify', symbol: '~' }
}
function cardData(version: Version): TreeNode[] {
  return version.data
}
function cardPositions(version: Version) {
  return version.positions
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
function centerVersionTreemaps(versionId: string, notifyUser = true) {
  const version = versions.value.find((item) => item.id === versionId)
  if (!version) return
  if (!version.data.length) {
    const viewport = mapViewport(version)
    version.mapView = {
      zoom: 1,
      panX: viewport.width / 2,
      panY: viewport.height / 2,
      manual: true,
    }
    if (notifyUser) notify('Treemaps centered and fitted')
    return
  }
  const positions = { ...defaultPositions(version.data, version.positions), ...version.positions }
  const extents = version.data.map((node) => {
    const position = positions[node.id]!
    const size = outerTreemapDimensions(node, positions)
    return {
      left: position.x * CARD_WIDTH,
      top: position.y * TREE_MAP_HEIGHT,
      right: position.x * CARD_WIDTH + size.width,
      bottom: position.y * TREE_MAP_HEIGHT + size.height,
    }
  })
  const left = Math.min(...extents.map((item) => item.left))
  const top = Math.min(...extents.map((item) => item.top))
  const right = Math.max(...extents.map((item) => item.right))
  const bottom = Math.max(...extents.map((item) => item.bottom))
  const viewport = mapViewport(version)
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const targetZoom = Math.max(MAP_ZOOM_MIN, Math.min(
    MAP_ZOOM_MAX,
    (viewport.width - MAP_PADDING * 2) / width,
    (viewport.height - MAP_PADDING * 2) / height,
  ))
  const offsetX = (viewport.width / targetZoom - width) / 2 - left
  const offsetY = (viewport.height / targetZoom - height) / 2 - top
  version.positions = Object.fromEntries(version.data.map((node) => {
    const position = positions[node.id]!
    return [node.id, {
      x: (position.x * CARD_WIDTH + offsetX) / CARD_WIDTH,
      y: (position.y * TREE_MAP_HEIGHT + offsetY) / TREE_MAP_HEIGHT,
    }]
  }))
  version.mapView = { zoom: targetZoom, panX: 0, panY: 0, manual: true }
  if (notifyUser) notify('Treemaps centered and fitted')
}
function compactVersionTreemaps(versionId: string, notifyUser = true) {
  const version = versions.value.find((item) => item.id === versionId)
  if (!version || !version.data.length) return
  const ordered = version.data.map((node, index) => ({
    node, index, size: outerTreemapDimensions(node, version.positions),
  })).sort((left, right) => right.size.height - left.size.height
    || right.size.width - left.size.width || left.index - right.index)
  const candidateWidths = [...new Set(ordered.reduce<number[]>((widths, item) => {
    widths.push((widths.at(-1) ?? MAP_PADDING) + item.size.width + (widths.length ? MAP_GAP : 0))
    return widths
  }, []))]
  let best: {
    area: number
    aspectDelta: number
    fitScale: number
    positions: Record<string, { x: number; y: number }>
  } | null = null
  for (const targetWidth of candidateWidths) {
    let x = MAP_PADDING
    let y = MAP_PADDING
    let rowHeight = 0
    let maxRight = MAP_PADDING
    let maxBottom = MAP_PADDING
    const placed = new Map<string, { x: number; y: number }>()
    for (const { node, size } of ordered) {
      if (x > MAP_PADDING && x + size.width > MAP_PADDING + targetWidth) {
        x = MAP_PADDING
        y += rowHeight + MAP_GAP
        rowHeight = 0
      }
      placed.set(node.id, { x, y })
      x += size.width + MAP_GAP
      rowHeight = Math.max(rowHeight, size.height)
      maxRight = Math.max(maxRight, x - MAP_GAP)
      maxBottom = Math.max(maxBottom, y + size.height)
    }
    const width = maxRight - MAP_PADDING
    const height = maxBottom - MAP_PADDING
    const area = width * height
    const viewport = mapViewport(version)
    const aspectDelta = Math.abs(Math.log((width / Math.max(1, height)) / (viewport.width / viewport.height)))
    const fitScale = Math.min(1, viewport.width / Math.max(1, width), viewport.height / Math.max(1, height))
    if (best && (fitScale < best.fitScale
      || (fitScale === best.fitScale && aspectDelta > best.aspectDelta)
      || (fitScale === best.fitScale && aspectDelta === best.aspectDelta && area >= best.area))) continue
    best = {
      area, aspectDelta, fitScale,
      positions: Object.fromEntries(version.data.map((node) => {
        const position = placed.get(node.id)!
        return [node.id, { x: position.x / CARD_WIDTH, y: position.y / TREE_MAP_HEIGHT }]
      })),
    }
  }
  if (!best) return
  version.positions = best.positions
  centerVersionTreemaps(version.id, false)
  if (notifyUser) notify('Treemap layout compacted')
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
  const layout = version.id === active.value.id ? previewLayout.value : null
  const view = layout?.view ?? mapViewFor(version)
  return `translate(${view.panX} ${view.panY}) scale(${view.zoom})`
}
const versionTiles = computed(() => {
  const result = new Map<string, Tile[]>()
  for (const version of versions.value) {
    const data = cardData(version)
    const positions = cardPositions(version)
    const tiles = data.flatMap((root, index) => tilesFor(root, data, index, positions))
    if (version.id === active.value.id && draggedNode.value) {
      const dragged = new Set(draggedSubtreeIds.value)
      tiles.sort((left, right) => Number(dragged.has(right.id)) - Number(dragged.has(left.id)))
    }
    result.set(version.id, tiles)
  }
  return result
})
const draggedSubtreeIds = computed(() => {
  const node = draggedNode.value ? findNode(active.value.data, draggedNode.value) : undefined
  return node ? descendants(node) : []
})
const duplicateValueLinks = computed(() => {
  const result = new Map<string, Array<{ id: string; path: string }>>()
  for (const version of versions.value) {
    const groups = new Map<string, Tile[]>()
    for (const tile of versionTiles.value.get(version.id) ?? []) {
      const group = groups.get(tile.label) ?? []
      group.push(tile)
      groups.set(tile.label, group)
    }
    const links: Array<{ id: string; path: string }> = []
    const connected = new Map((versionTiles.value.get(version.id) ?? []).map((tile) => [tile.id, tile.id]))
    const rootOf = (id: string): string => {
      const parent = connected.get(id)!
      if (parent === id) return id
      const root = rootOf(parent)
      connected.set(id, root)
      return root
    }
    const orderedGroups = [...groups].sort((left, right) =>
      Math.min(...left[1].map((tile) => tile.depth)) - Math.min(...right[1].map((tile) => tile.depth))
      || left[0].localeCompare(right[0]))
    for (const [label, tiles] of orderedGroups) {
      if (tiles.length < 2) continue
      const candidates = tiles.flatMap((first, index) => tiles.slice(index + 1).map((second) => ({
        first,
        second,
        isParentChild: findParent(cardData(version), first.id)?.id === second.id
          || findParent(cardData(version), second.id)?.id === first.id,
        distance: (first.x + first.width / 2 - second.x - second.width / 2) ** 2
          + (first.y + first.height / 2 - second.y - second.height / 2) ** 2,
      }))).sort((left, right) => Number(right.isParentChild) - Number(left.isParentChild)
        || left.distance - right.distance
        || left.first.id.localeCompare(right.first.id)
        || left.second.id.localeCompare(right.second.id))
      for (const { first, second } of candidates) {
        const firstRoot = rootOf(first.id)
        const secondRoot = rootOf(second.id)
        if (firstRoot === secondRoot) continue
        const firstParent = findParent(cardData(version), first.id)?.id
        const secondParent = findParent(cardData(version), second.id)?.id
        if (firstParent && secondParent && firstParent !== secondParent
          && rootOf(firstParent) === rootOf(secondParent)) {
          connected.set(firstRoot, secondRoot)
          continue
        }
        connected.set(firstRoot, secondRoot)
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
      }
    }
    result.set(version.id, links)
  }
  return result
})
function dragOverlayTiles(version: Version) {
  const nodeId = draggedNode.value
  const position = draggedPosition.value
  if (!nodeId || !position || version.id !== active.value.id) return []
  const original = tileForNode(active.value.data, active.value.positions, nodeId)
  if (!original) return []
  const deltaX = position.x * CARD_WIDTH - original.x
  const deltaY = position.y * TREE_MAP_HEIGHT - original.y
  const dragged = new Set(draggedSubtreeIds.value)
  return (versionTiles.value.get(version.id) ?? [])
    .filter((tile) => dragged.has(tile.id))
    .map((tile) => ({ ...tile, x: tile.x + deltaX, y: tile.y + deltaY }))
}
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
function nodeGraphBounds(versionId: string, nodeId: string) {
  const version = versions.value.find((item) => item.id === versionId)
  if (!version) return null
  const canvas = graphCanvas.value
  const card = [...(canvas?.querySelectorAll<HTMLElement>('.version-card') ?? [])]
    .find((item) => item.dataset.version === versionId)
  const element = [...(card?.querySelectorAll<SVGGraphicsElement>('.tree-tile') ?? [])]
    .find((item) => item.dataset.node === nodeId)
  if (canvas && element) {
    const tile = element.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const toGraphX = (value: number) => (value - canvasRect.left - pan.value.x) / zoom.value
    const toGraphY = (value: number) => (value - canvasRect.top - pan.value.y) / zoom.value
    return {
      left: toGraphX(tile.left), right: toGraphX(tile.right),
      top: toGraphY(tile.top), bottom: toGraphY(tile.bottom),
    }
  }
  const view = mapViewFor(version)
  for (const [index, root] of version.data.entries()) {
    const tile = tilesFor(root, version.data, index, version.positions).find((item) => item.id === nodeId)
    if (!tile) continue
    const position = cardPosition(version)
    const mapLeft = version.id === 'v0' ? 1 : 6
    const mapTop = version.id === 'v0' ? 1 : 39
    return {
      left: position.x + mapLeft + view.panX + tile.x * view.zoom,
      right: position.x + mapLeft + view.panX + (tile.x + tile.width) * view.zoom,
      top: position.y + mapTop + view.panY + tile.y * view.zoom,
      bottom: position.y + mapTop + view.panY + (tile.y + tile.height) * view.zoom,
    }
  }
  return null
}
const visibleCopyLinks = computed(() => state.value.copyLinks.filter((link) => {
  const source = versions.value.find((version) => version.id === link.sourceVersionId)
  const target = versions.value.find((version) => version.id === link.targetVersionId)
  return !!source && !!target
    && !!findNode(source.data, link.sourceNodeId)
    && !!findNode(target.data, link.targetNodeId)
}))
function copyLinkPath(link: CopyLink) {
  const source = nodeGraphBounds(link.sourceVersionId, link.sourceNodeId)
  const target = nodeGraphBounds(link.targetVersionId, link.targetNodeId)
  if (!source || !target) return ''
  const sourceCenter = { x: (source.left + source.right) / 2, y: (source.top + source.bottom) / 2 }
  const targetCenter = { x: (target.left + target.right) / 2, y: (target.top + target.bottom) / 2 }
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const sourceScale = Math.min(
    dx ? (source.right - source.left) / 2 / Math.abs(dx) : Infinity,
    dy ? (source.bottom - source.top) / 2 / Math.abs(dy) : Infinity,
  )
  const targetScale = Math.min(
    dx ? (target.right - target.left) / 2 / Math.abs(dx) : Infinity,
    dy ? (target.bottom - target.top) / 2 / Math.abs(dy) : Infinity,
  )
  const start = { x: sourceCenter.x + dx * sourceScale, y: sourceCenter.y + dy * sourceScale }
  const end = { x: targetCenter.x - dx * targetScale, y: targetCenter.y - dy * targetScale }
  const bend = Math.min(90, Math.max(24, distance * 0.15))
  const control = {
    x: (start.x + end.x) / 2 - (dy / distance) * bend,
    y: (start.y + end.y) / 2 + (dx / distance) * bend,
  }
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`
}
function activateCopyLink(link: CopyLink, event?: MouseEvent) {
  let versionId: string
  if (event) {
    const source = nodeGraphBounds(link.sourceVersionId, link.sourceNodeId)
    const target = nodeGraphBounds(link.targetVersionId, link.targetNodeId)
    const canvas = graphCanvas.value
    if (!source || !target || !canvas) return
    const canvasRect = canvas.getBoundingClientRect()
    const clientCenter = (bounds: NonNullable<typeof source>) => ({
      x: canvasRect.left + pan.value.x + ((bounds.left + bounds.right) / 2) * zoom.value,
      y: canvasRect.top + pan.value.y + ((bounds.top + bounds.bottom) / 2) * zoom.value,
    })
    const sourceCenter = clientCenter(source)
    const targetCenter = clientCenter(target)
    const sourceDistance = Math.hypot(
      event.clientX - sourceCenter.x,
      event.clientY - sourceCenter.y,
    )
    const targetDistance = Math.hypot(
      event.clientX - targetCenter.x,
      event.clientY - targetCenter.y,
    )
    versionId = sourceDistance <= targetDistance ? link.targetVersionId : link.sourceVersionId
  } else {
    versionId = active.value.id === link.sourceVersionId
      ? link.targetVersionId
      : link.sourceVersionId
  }
  const version = versions.value.find((item) => item.id === versionId)
  if (!version) return
  state.value.activeId = version.id
  focusVersion(version)
}

function tilesFor(
  root: TreeNode,
  forest: TreeNode[],
  _index: number,
  positions?: Record<string, { x: number; y: number }>,
): Tile[] {
  const position = positions?.[root.id] ?? defaultPositions(forest, positions)[root.id]!
  const size = outerTreemapDimensions(root)
  const offsetX = position.x * CARD_WIDTH
  const offsetY = position.y * TREE_MAP_HEIGHT
  const tiles: Tile[] = []
  const place = (node: TreeNode, x: number, y: number, width: number, height: number, depth: number) => {
    tiles.push({
      id: node.id, label: node.value,
      x, y, width, height, depth,
    })
    if (!node.children.length) return
    for (const childLayout of childLayouts(node)) {
      place(
        childLayout.node,
        x + childLayout.x,
        y + childLayout.y,
        childLayout.width,
        childLayout.height,
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
const draggedOriginalTile = computed(() => {
  if (!draggedNode.value) return null
  return tileForNode(active.value.data, active.value.positions, draggedNode.value) ?? null
})
function positionAt(version: Version, clientX: number, clientY: number, map: HTMLElement) {
  const drag = treeDrag.value
  const rect = map.getBoundingClientRect()
  const view = previewLayout.value?.view ?? mapViewFor(version)
  if (!drag?.space) {
    const x = ((clientX - rect.left) / zoom.value - view.panX) / view.zoom
    const y = ((clientY - rect.top) / zoom.value - view.panY) / view.zoom
    return {
      x: x / CARD_WIDTH,
      y: y / TREE_MAP_HEIGHT,
    }
  }
  const pointerX = ((clientX - rect.left) / zoom.value - view.panX) / view.zoom
  const pointerY = ((clientY - rect.top) / zoom.value - view.panY) / view.zoom
  return {
    x: (pointerX - drag.space.grabX * drag.space.width) / CARD_WIDTH,
    y: (pointerY - drag.space.grabY * drag.space.height) / TREE_MAP_HEIGHT,
  }
}
function treeNodeAt(clientX: number, clientY: number, map: HTMLElement) {
  const versionId = map.closest('.version-card')?.getAttribute('data-version')
  if (versionId !== active.value.id) return null
  const rect = map.getBoundingClientRect()
  const view = previewLayout.value?.view ?? mapViewFor(active.value)
  const localX = (clientX - rect.left) / zoom.value
  const localY = (clientY - rect.top) / zoom.value
  const x = (localX - view.panX) / view.zoom
  const y = (localY - view.panY) / view.zoom
  const tiles = active.value.data.flatMap((root, index) => tilesFor(root, active.value.data, index, active.value.positions))
  const draggedIds = new Set(draggedSubtreeIds.value)
  if (tiles.some((tile) => draggedIds.has(tile.id)
    && x >= tile.x && x <= tile.x + tile.width && y >= tile.y && y <= tile.y + tile.height)) return null
  for (let index = tiles.length - 1; index >= 0; index -= 1) {
    const tile = tiles[index]!
    if (draggedIds.has(tile.id)) continue
    if (x >= tile.x && x <= tile.x + tile.width && y >= tile.y && y <= tile.y + tile.height) return tile.id
  }
  return null
}
function rootPositionIsAvailable(
  version: Version,
  nodeId: string,
  position: { x: number; y: number },
  map: HTMLElement,
  data = version.data,
  positions = version.positions,
  sizeOverride?: { width: number; height: number },
  occupiedData = data,
  occupiedPositions = positions,
) {
  const node = findNode(data, nodeId)
  if (!node || !data.some((root) => root.id === nodeId)) return false
  const candidatePositions = { ...positions, [nodeId]: position }
  const view = fitMapViewToLayout(version.id, data, candidatePositions, mapViewFor(version), 0)
  const size = sizeOverride ?? outerTreemapDimensions(node)
  const left = position.x * CARD_WIDTH
  const top = position.y * TREE_MAP_HEIGHT
  const bounds = {
    left: -view.panX / view.zoom,
    top: -view.panY / view.zoom,
    right: (map.clientWidth - view.panX) / view.zoom,
    bottom: (map.clientHeight - view.panY) / view.zoom,
  }
  if (left < bounds.left || top < bounds.top
    || left + size.width > bounds.right || top + size.height > bounds.bottom) return false
  const occupied = occupiedData.filter((root) => root.id !== nodeId)
  return nearestPositionIsFree(position, size, occupied, { ...occupiedPositions, [nodeId]: position })
}
function spatialDropLayout(
  version: Version,
  nodeId: string,
  position: { x: number; y: number },
  map: HTMLElement,
): SpatialPreview {
  const data = clone(version.data)
  const existingPositions = { ...defaultPositions(data, version.positions), ...version.positions }
  const isRoot = data.some((root) => root.id === nodeId)
  let kind: SpatialPreview['kind'] = isRoot ? 'move' : 'detach'
  let nextData = data
  let positions = { ...existingPositions }
  if (isRoot) {
    positions[nodeId] = position
  } else {
    const parent = findParent(data, nodeId)
    const draggedTile = tileForNode(data, existingPositions, nodeId)
    const parentTile = parent ? tileForNode(data, existingPositions, parent.id) : null
    const center = draggedTile ? {
      x: position.x * CARD_WIDTH + draggedTile.width / 2,
      y: position.y * TREE_MAP_HEIGHT + draggedTile.height / 2,
    } : null
    const staysInParent = !!parentTile && !!center
      && center.x >= parentTile.x && center.x <= parentTile.x + parentTile.width
      && center.y >= parentTile.y && center.y <= parentTile.y + parentTile.height
    if (staysInParent) {
      kind = 'noop'
    } else {
      const detached = removeNode(data, nodeId)
      if (detached) {
        data.push(detached)
        nextData = data
        positions[nodeId] = position
      }
    }
  }
  const valid = kind === 'noop' || rootPositionIsAvailable(
    version,
    nodeId,
    position,
    map,
    nextData,
    positions,
    !isRoot ? tileForNode(version.data, version.positions, nodeId) : undefined,
    !isRoot ? version.data : nextData,
    !isRoot ? existingPositions : positions,
  )
  return {
    ...position,
    versionId: version.id,
    nodeId,
    kind: valid ? kind : 'invalid',
    valid,
    data: nextData,
    positions,
    view: valid ? fitMapViewToLayout(version.id, nextData, positions, mapViewFor(version), 0) : mapViewFor(version),
  }
}
function placeRoot(version: Version, nodeId: string, preview: SpatialPreview) {
  const map = document.querySelector<HTMLElement>(`.version-card[data-version="${version.id}"] .mini-map`)
  if (isReadOnly.value || !map || !rootPositionIsAvailable(version, nodeId, preview, map)) return false
  version.positions = clone(preview.positions)
  version.mapView = clone(preview.view)
  notify('Treemap layout updated')
  return true
}
function onTileContext(event: MouseEvent, nodeId: string) {
  if (isReadOnly.value || event.button !== 2) return
  event.preventDefault()
  event.stopPropagation()
  setSelectedNodes([nodeId])
  menu.value = { x: event.clientX, y: event.clientY, kind: 'entry', nodeId, versionId: active.value.id }
}
function onVersionContext(version: Version, event: MouseEvent) {
  if (event.button !== 2) return
  event.preventDefault()
  event.stopPropagation()
  menu.value = { x: event.clientX, y: event.clientY, kind: 'version', versionId: version.id }
}
function onCanvasContext(event: MouseEvent) {
  if (event.button !== 2 || (event.target as HTMLElement).closest('.tree-tile, .version-card')) return
  event.preventDefault()
  menu.value = { x: event.clientX, y: event.clientY, kind: 'canvas', versionId: active.value.id }
}
function handleAppClickCapture(event: MouseEvent) {
  if (suppressPingClick) {
    suppressPingClickEvent(event)
    return
  }
  if (menu.value && !(event.target as HTMLElement).closest('.context-menu')) menu.value = null
}
function startCanvasPan(event: PointerEvent) {
  if (event.button !== 0
    || (event.target as HTMLElement).closest('button, .version-card, .tree-tile, .copy-link-hit')) return
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
  event.stopPropagation()
  state.value.activeId = version.id
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
  if (isReadOnly.value) return
  state.value.activeId = version.id
  if (event.shiftKey) {
    startMapPan(event, version)
    return
  }
  startTreeDrag(event, nodeId)
}
function moveMapPan(event: PointerEvent) {
  const drag = mapPanDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const version = versions.value.find((item) => item.id === drag.versionId)
  if (!version) return
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= 3) return
  drag.moved = true
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
  if (moved) {
    commitMapView(versionId)
    suppressVersionClick = true
    suppressTileClick = true
    window.setTimeout(() => {
      suppressVersionClick = false
      suppressTileClick = false
    }, 0)
  } else if (transientMapViews.value[versionId]) scheduleMapViewCommit(versionId)
}
function focusVersion(version: Version) {
  const position = cardPosition(version)
  const availableWidth = Math.max(1, canvasSize.value.width - 100)
  const availableHeight = Math.max(1, canvasSize.value.height - 100)
  const targetZoom = Math.max(0.005, Math.min(ZOOM_MAX, availableWidth / CARD_WIDTH, availableHeight / cardHeight(version)))
  animateCamera(targetZoom, {
    x: canvasSize.value.width / 2 - (position.x + CARD_WIDTH / 2) * targetZoom,
    y: canvasSize.value.height / 2 - (position.y + cardHeight(version) / 2) * targetZoom,
  }, 420)
}
function focusActive() { focusVersion(active.value) }
function focusVersionById(versionId?: string | null) {
  const version = versions.value.find((item) => item.id === versionId)
  if (version) focusVersion(version)
}
function activateAndFocusVersion(version: Version) {
  state.value.activeId = version.id
  setSelectedNodes([])
  menu.value = null
  focusVersion(version)
}
function navigateVersion(direction: 'left' | 'right' | 'up' | 'down') {
  let destination: Version | undefined
  if (direction === 'left') {
    destination = versions.value.find((version) => version.id === active.value.parentId)
  } else if (direction === 'right') {
    const children = versions.value.filter((version) => version.parentId === active.value.id)
    destination = children.sort((left, right) =>
      Number(right.branch === active.value.branch) - Number(left.branch === active.value.branch)
      || Math.abs(left.lane - active.value.lane) - Math.abs(right.lane - active.value.lane)
      || left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0]
  } else {
    const lanes = [...new Set(versions.value.map((version) => version.lane)
      .filter((lane) => direction === 'up' ? lane < active.value.lane : lane > active.value.lane))]
      .sort((left, right) => direction === 'up' ? right - left : left - right)
    const targetLane = lanes[0]
    if (targetLane !== undefined) {
      destination = versions.value.filter((version) => version.lane === targetLane)
        .sort((left, right) => Math.abs(left.step - active.value.step) - Math.abs(right.step - active.value.step)
          || left.step - right.step || left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0]
    }
  }
  if (destination) activateAndFocusVersion(destination)
}
function cancelPanAnimation() {
  if (panAnimationFrame !== null) cancelAnimationFrame(panAnimationFrame)
  panAnimationFrame = null
}
function animateCamera(targetZoom: number, targetPan: { x: number; y: number }, duration = 360) {
  cancelPanAnimation()
  const start = { zoom: zoom.value, panX: pan.value.x, panY: pan.value.y }
  const startedAt = performance.now()
  const animate = (time: number) => {
    const progress = Math.min(1, (time - startedAt) / duration)
    const eased = 1 - (1 - progress) ** 3
    zoom.value = start.zoom + (targetZoom - start.zoom) * eased
    pan.value = {
      x: start.panX + (targetPan.x - start.panX) * eased,
      y: start.panY + (targetPan.y - start.panY) * eased,
    }
    if (progress < 1) panAnimationFrame = requestAnimationFrame(animate)
    else panAnimationFrame = null
  }
  panAnimationFrame = requestAnimationFrame(animate)
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
  if (isReadOnly.value) return
  event.preventDefault()
  const map = (event.currentTarget as SVGRectElement).closest<HTMLElement>('.mini-map')
  const rect = map?.getBoundingClientRect()
  const view = mapViewFor(active.value)
  const originalTile = tileForNode(active.value.data, active.value.positions, id)
  const pointerX = rect ? ((event.clientX - rect.left) / zoom.value - view.panX) / view.zoom : 0
  const pointerY = rect ? ((event.clientY - rect.top) / zoom.value - view.panY) / view.zoom : 0
  treeDrag.value = {
    id, x: event.clientX, y: event.clientY, moved: false,
    space: rect && originalTile ? {
      grabX: (pointerX - originalTile.x) / originalTile.width,
      grabY: (pointerY - originalTile.y) / originalTile.height,
      width: originalTile.width,
      height: originalTile.height,
    } : undefined,
  }
  draggedPosition.value = null
  dragPreviewView.value = clone(view)
}
function moveTreeDrag(event: PointerEvent) {
  const drag = treeDrag.value
  if (!drag) return
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) {
    drag.moved = true
    draggedNode.value = drag.id
    setSelectedNodes([drag.id])
    if (draggedSubtreeIds.value.includes(hoveredNode.value?.nodeId ?? '')) hoveredNode.value = null
    entryTooltip.value = null
    const original = tileForNode(active.value.data, active.value.positions, drag.id)
    draggedPosition.value = original ? { x: original.x / CARD_WIDTH, y: original.y / TREE_MAP_HEIGHT } : null
  }
  if (!drag.moved) return
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  const map = hit?.closest<HTMLElement>('.mini-map')
  const targetId = map ? treeNodeAt(event.clientX, event.clientY, map) : null
  const targetVersion = map?.closest('.version-card')?.getAttribute('data-version')
  const point = map && targetVersion === active.value.id
    ? positionAt(active.value, event.clientX, event.clientY, map)
    : null
  if (point) draggedPosition.value = point
  const parent = findParent(active.value.data, drag.id)
  if (targetId && targetVersion === active.value.id && parent?.id !== targetId && canAttach(drag.id, targetId)) {
    overNode.value = targetId
    invalidNode.value = null
    spatialPreview.value = null
    const view = previewLayout.value?.view ?? mapViewFor(active.value)
    if (dragPreviewView.value && view.zoom < dragPreviewView.value.zoom) dragPreviewView.value = clone(view)
    return
  }
  overNode.value = null
  const isDraggedDescendant = targetId ? draggedSubtreeIds.value.includes(targetId) : false
  invalidNode.value = targetId && targetVersion === active.value.id
    && parent?.id !== targetId && !isDraggedDescendant && !canAttach(drag.id, targetId)
    ? targetId : null
  if (map && targetVersion === active.value.id && point) {
    spatialPreview.value = spatialDropLayout(active.value, drag.id, point, map)
  } else {
    spatialPreview.value = null
  }
  const view = previewLayout.value?.view ?? spatialPreview.value?.view
  if (view && dragPreviewView.value && view.zoom < dragPreviewView.value.zoom) {
    dragPreviewView.value = clone(view)
  }
}
function finishTreeDrag(event: PointerEvent) {
  const drag = treeDrag.value
  if (!drag) return
  if (drag.moved) moveTreeDrag(event)
  const sourceVersionId = active.value.id
  const previewView = dragPreviewView.value
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const map = target?.closest<HTMLElement>('.mini-map')
  const targetVersion = target?.closest('.version-card')?.getAttribute('data-version')
  let committed = false
  if (drag.moved && map && targetVersion === active.value.id) {
    if (overNode.value && canAttach(drag.id, overNode.value)) {
      const layout = previewLayout.value
      committed = !!attachEntry(drag.id, overNode.value, layout ?? undefined)
    } else if (spatialPreview.value?.valid && spatialPreview.value.nodeId === drag.id) {
      const preview = spatialPreview.value
      if (preview.kind === 'move') {
        committed = placeRoot(active.value, drag.id, preview)
      } else if (preview.kind === 'detach') {
        committed = !!detachEntry(drag.id, preview)
      }
    }
  }
  const sourceVersion = versions.value.find((version) => version.id === sourceVersionId)
  if (sourceVersion && previewView && previewView.zoom < mapViewFor(sourceVersion).zoom
    && (active.value.id === sourceVersionId || !committed)) {
    sourceVersion.mapView = clone(previewView)
  }
  if (committed) setSelectedNodes([drag.id])
  if (drag.moved) {
    suppressVersionClick = true
    suppressTileClick = true
    window.setTimeout(() => {
      suppressVersionClick = false
      suppressTileClick = false
    }, 0)
  }
  treeDrag.value = null
  draggedNode.value = null
  draggedPosition.value = null
  dragPreviewView.value = null
  overNode.value = null
  invalidNode.value = null
  spatialPreview.value = null
}
function onKeydown(event: KeyboardEvent) {
  if (mergeMode.value && compareIds.value.length === 2) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeVersionSelection()
    }
    return
  }
  if ((event.target as HTMLElement).matches('input, textarea, select')) return
  const key = event.key.toLowerCase()
  const modified = event.ctrlKey || event.metaKey
  if (!modified && !event.altKey && !event.shiftKey && key === 'p' && !event.repeat) {
    event.preventDefault()
    pingMode.value = !pingMode.value
  }
  if (!modified && !event.altKey && !event.shiftKey && key === 'm' && !event.repeat) {
    event.preventDefault()
    if (mergeMode.value) closeVersionSelection()
    else startVersionSelection('merge')
  }
  if (!modified && !event.altKey && !event.shiftKey
    && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
    event.preventDefault()
    navigateVersion(key.slice(5) as 'left' | 'right' | 'up' | 'down')
  }
  if (!modified && key === 'n') { event.preventDefault(); createFreeEntry() }
  if (modified && event.key === 'Enter' && selectedNode.value) { event.preventDefault(); addEntry(selectedNode.value) }
  if (!modified && event.shiftKey && key === 'd' && selectedNode.value) { event.preventDefault(); detachEntry(selectedNode.value) }
  if (!modified && event.shiftKey && key === 'c') {
    event.preventDefault()
    if (compareMode.value) closeVersionSelection()
    else startVersionSelection('compare')
  }
  if (!modified && !event.altKey && !event.shiftKey && key === 'f') { event.preventDefault(); focusActive() }
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
  if (event.key === 'Escape') { menu.value = null; closeVersionSelection(); pingMode.value = false }
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
  presenceTimer = window.setInterval(expireRemoteUsers, 5000)
  void syncFromServer().then(() => {
    if (roomInput.value) return connectToRoom('join')
  })
})
onUnmounted(() => {
  peerRoom.close()
  for (const versionId of mapViewTimers.keys()) commitMapView(versionId)
  cancelPanAnimation()
  window.clearTimeout(tileTooltipTimer)
  canvasObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', moveTreeDrag)
  window.removeEventListener('pointermove', moveMapPan)
  window.removeEventListener('pointerup', finishTreeDrag)
  window.removeEventListener('pointerup', endMapPan)
  window.clearInterval(presenceTimer)
})

function createFreeEntry() { addEntry() }
function addEntryToVersion(versionId?: string) {
  if (versionId) state.value.activeId = versionId
  addEntry()
}
function copyEntry(nodeId: string) {
  const node = findNode(active.value.data, nodeId)
  if (!node) return
  clipboard.value = { sourceVersionId: active.value.id, node: clone(node) }
  sessionStorage.setItem('canopy-copy', JSON.stringify(clipboard.value))
  logInteraction(`Copied ${node.value}`, { versionId: active.value.id, nodeId, nodeLabel: node.value })
  notify(`Copied ${node.value}`)
}
function pasteEntry() {
  if (isReadOnly.value || !clipboard.value) return
  const copied = clone(clipboard.value)
  const rekey = (node: TreeNode): TreeNode => ({ ...node, id: `n${state.value.nextNode++}-${CLIENT_ID}`, children: node.children.map(rekey) })
  const newNode = rekey(copied.node)
  const version = createVersion([...clone(active.value.data), newNode], `Paste ${newNode.value}`, true)
  if (!version) return
  const source = versions.value.find((item) => item.id === copied.sourceVersionId)
  if (source) {
    const targetNode = version.data.find((node) => node.id === newNode.id)
    if (!targetNode) return
    state.value.copyLinks = [...state.value.copyLinks, {
      sourceVersionId: source.id, sourceNodeId: copied.node.id,
      targetVersionId: version.id, targetNodeId: targetNode.id,
    }].sort(compareCopyLinks)
  }
}
function pasteEntryToVersion(versionId?: string) {
  if (versionId) state.value.activeId = versionId
  pasteEntry()
}
function resetWorkspace() {
  if (window.confirm('Reset all local versions?')) {
    clearTransientMapViews()
    state.value = clone(seed)
  }
}
</script>

<template>
  <main class="app-shell" :class="{ dark: darkMode }" @click.capture="handleAppClickCapture" @wheel="onWheel">
    <div class="workspace" :inert="mergeMode && compareIds.length === 2">
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
          <button type="button" class="active-version-card" title="Focus active version · F" @click="focusActive">
            <div class="active-version-top"><span class="version-pip" :style="{ background: versionColor(active) }"></span><span> Branch {{ active.branch }} | {{ displayVersionId(active.id) }} | Step {{ active.step }}</span></div>
            <strong>{{ active.change }}</strong>
            <div class="active-meta"><span>Entries</span><strong>{{ activeNodes }}</strong></div>
            <div class="active-meta"><span>Current step</span><strong>{{ String(active.step).padStart(2, '0') }}</strong></div>
            <div class="active-meta"><span>Paths from here</span><strong>{{ activeChildren }}</strong></div>
          </button>
        </section>
        <section class="side-section settings-section">
          <button type="button" class="theme-toggle" @click="darkMode = !darkMode">
            <component :is="darkMode ? Sun : Moon" :size="15" />
            <span>{{ darkMode ? 'Light mode' : 'Dark mode' }}</span>
          </button>
        </section>
        <section class="side-section collaborators-section">
          <div class="section-label">COLLABORATORS</div>
          <label class="session-label" for="user-name">Your name</label>
          <input id="user-name" v-model="userName" class="user-name-input" maxlength="32" placeholder="Animal name"
            @blur="userName = userName.trim() || animalForUser(CLIENT_ID)" />
          <div class="collaborator-list">
            <button v-for="user in connectedUsers" :key="user.id" type="button" class="collaborator"
              :disabled="!user.activeVersionId || !versions.some((version) => version.id === user.activeVersionId)"
              :title="`${user.name} · ${user.activeVersionId ? displayVersionId(user.activeVersionId) : 'No active version'}`"
              @click="focusCollaborator(user.id)">
              <span class="collaborator-avatar" :style="{ '--collaborator-color': userColor(user.id) }" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
              </span>
              <span class="collaborator-info"><strong>{{ user.name }}</strong>
                <small>{{ user.activeVersionId && versions.some((version) => version.id === user.activeVersionId)
                  ? displayVersionId(user.activeVersionId)
                  : 'No active version' }}</small>
              </span>
            </button>
            <span v-if="!connectedUsers.length" class="collaborator-empty">Join a shared room to see collaborators.</span>
          </div>
        </section>
        <div class="sidebar-fill"></div>
        <section class="side-section interaction-section">
          <div class="interaction-heading"><span class="section-label">INTERACTION LOG</span><small>LAST 10</small></div>
          <ol v-if="recentInteractions.length" class="interaction-list">
            <li v-for="entry in recentInteractions" :key="entry.id">
              <span class="interaction-user" :style="{ color: userColor(entry.actorId) }">{{ entry.actorName }}</span>
              <span class="interaction-action">{{ entry.action }}</span>
              <button v-if="entry.ping" class="interaction-reference" type="button"
                :title="`Focus ping by ${entry.actorName}`" @click="focusPingLocation(entry.ping)">Ping location</button>
              <button v-if="entry.nodeId && entry.versionId
                && versions.some((version) => version.id === entry.versionId && findNode(version.data, entry.nodeId!))"
                class="interaction-reference" type="button" @click="navigateInteraction(entry, 'node')">
                {{ entry.nodeLabel || 'Entry' }}
              </button>
              <button v-if="entry.versionId && versions.some((version) => version.id === entry.versionId)"
                class="interaction-reference" type="button" @click="navigateInteraction(entry, 'version')">
                {{ displayVersionId(entry.versionId) }}
              </button>
              <span class="interaction-time">{{ new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
            </li>
          </ol>
          <span v-else class="interaction-empty">Collaborative actions appear here.</span>
        </section>
      </aside>

      <section class="canvas-region">
        <div ref="graphCanvas" class="graph-canvas" :class="{ 'ping-mode': pingMode }" @contextmenu="onCanvasContext" @pointerdown.capture="handlePingPointer" @pointermove.capture="trackPingPointerMove" @pointerup.capture="clearPingPointer" @pointercancel.capture="clearPingPointer" @click.capture="handlePingClick" @click="onCanvasClick" @pointerdown="startCanvasPan" @pointermove="moveCanvasPan" @pointerup="endCanvasPan" @pointercancel="endCanvasPan">
          <div class="canvas-grid"></div>
          <div class="graph-world" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
            <svg class="connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5" :markerWidth="TERMINAL_ARROW_SIZE" :markerHeight="TERMINAL_ARROW_SIZE" markerUnits="strokeWidth" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="#f5f7f4" stroke-width="0.8" stroke-linejoin="round" /></marker>
              </defs>
              <template v-for="version in versions.filter((item) => item.parentId && !isBranchCurve(item))" :key="`edge-${version.id}`">
                <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
                <path :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === active.id || version.parentId === active.id ? 0.96 : 0.76" />
              </template>
              <template v-for="version in versions.filter((item) => item.parentId && isBranchCurve(item))" :key="`branch-edge-${version.id}`">
                <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
                <path :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === active.id || version.parentId === active.id ? 0.96 : 0.76" />
              </template>
              <template v-for="version in versions.filter((item) => item.mergeSourceId)" :key="`merge-edge-${version.id}`">
                <path :d="mergeConnectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4"
                  :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
                <path :d="mergeConnectionPath(version)" fill="none" :stroke="mergeConnectionColor(version)"
                  :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round"
                  :opacity="version.id === active.id || version.mergeSourceId === active.id ? 0.96 : 0.76" />
              </template>
              <template v-for="version in versions.filter((item) => !versions.some((child) => child.parentId === item.id))" :key="`tail-${version.id}`">
                <path :d="`M ${cardPosition(version).x + CARD_WIDTH} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + CARD_WIDTH + terminalTailEnd(version)}`" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="butt" />
                <path :d="`M ${cardPosition(version).x + CARD_WIDTH} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + CARD_WIDTH + terminalTailEnd(version)}`" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="butt" marker-end="url(#arrow)" />
              </template>
            </svg>

            <article v-for="version in versions" :key="version.id" class="version-card" :class="{ active: version.id === active.id, compared: compareIds.includes(version.id), 'compare-pick': compareMode, compact: zoom < 0.66, previewing: isPreviewing(version), 'root-version': version.id === 'v0' }"
              :data-version="version.id" :style="{ left: `${cardPosition(version).x}px`, top: `${cardPosition(version).y}px`, width: `${CARD_WIDTH}px`, height: `${cardHeight(version)}px`, '--branch-color': versionColor(version), '--user-color': userColor(CLIENT_ID), '--author-color': versionAuthorColor(version) }"
              @pointerdown="activateVersionOnPointer(version, $event)"
              @click="selectVersion(version)" @dblclick.stop="focusVersion(version)" @contextmenu="onVersionContext(version, $event)" :data-over="overNode === version.id">
              <span v-for="(user, index) in activeUsersFor(version.id)" :key="`active-${user.id}`"
                class="version-user-outline" :style="{ borderColor: user.color, inset: `${-2 - index * 3}px` }"></span>
              <div v-if="version.id !== 'v0'" class="version-card-head">
                <span class="branch-mark" :style="{ background: versionColor(version) }"></span>
                <span class="version-header-id">{{ version.branch }} | {{ displayVersionId(version.id).replace(/^v/, 'V') }} | S{{ version.step }} |</span>
                <strong class="version-action">{{ version.change }}</strong>
                <span class="version-count">({{ descendantsCount(version.data) }} Entries)</span>
                <button class="card-menu quiet-icon" title="Version actions" @click.stop="menu = { x: $event.clientX, y: $event.clientY, kind: 'version', versionId: version.id }; selectedNode = null; state.activeId = version.id"><MoreHorizontal :size="17" /></button>
              </div>
              <div v-if="isPreviewing(version)" class="preview-badge">{{ previewLabel() }}</div>
              <div v-if="isReadOnly" class="overview-map">
                <div class="overview-action">
                  <span class="overview-action-symbol">{{ versionAction(version).symbol }}</span>
                  <strong>{{ versionAction(version).label }}</strong>
                </div>
                <div v-if="version.change" class="overview-action-detail">{{ version.change }}</div>
                <div class="overview-stats">
                  <span><b>{{ descendantsCount(version.data) }}</b> entries</span>
                  <span><b>{{ version.data.length }}</b> treemaps</span>
                </div>
              </div>
              <div v-else class="mini-map" :class="{ empty: !cardData(version).length, 'root-map': version.id === 'v0' }"
                @pointerdown="startMapPan($event, version)" @wheel="zoomMap($event, version)">
                <template v-if="cardData(version).length">
                  <svg :viewBox="`0 0 ${mapViewport(version).width} ${mapViewport(version).height}`" class="treemap-svg">
                    <g :transform="mapTransform(version)">
                      <rect v-for="tile in versionTiles.get(version.id) ?? []" :key="tile.id"
                        :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                        :class="['tree-tile', `depth-${tile.depth}`, { 'is-selected': selectedNodes.includes(tile.id) && version.id === active.id, 'is-source': draggedSubtreeIds.includes(tile.id) && version.id === active.id, 'is-over': overNode === tile.id && version.id === active.id, 'is-invalid': invalidNode === tile.id && version.id === active.id, 'is-hovered': hoveredNode?.versionId === version.id && hoveredNode.nodeId === tile.id && !draggedSubtreeIds.includes(tile.id) }]"
                        :data-node="tile.id" :fill="tile.depth === 0 ? '#deebe4' : tile.depth % 2 ? '#c1d9cc' : '#a9cab9'"
                        :style="{ '--tile-stroke': tileStrokeColor(version.id, tile.id), '--tile-stroke-width': `${tileStrokeWidth(version.id, tile.id)}px` }"
                        @pointerdown.stop="startMapTileGesture($event, version, tile.id)"
                        @pointerenter="enterTile($event, version, tile.id)"
                        @pointermove="moveTileTooltip($event, version.id, tile.id)"
                        @pointerleave="leaveTile(version.id, tile.id)"
                        @click.stop="onTileClick(version, tile.id, $event)" @contextmenu="version.id === active.id && !isReadOnly && onTileContext($event, tile.id)">
                      </rect>
                      <path v-for="link in duplicateValueLinks.get(version.id) ?? []" :key="link.id"
                        :d="link.path" fill="none" stroke="#748a7d" stroke-width="1.5"
                        stroke-dasharray="4 3" opacity=".72" pointer-events="none" />
                      <g v-for="tile in dragOverlayTiles(version)" :key="`drag-overlay-${tile.id}`" pointer-events="none">
                        <rect :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                          :class="['dragged-overlay', `depth-${tile.depth}`]"
                          :fill="tile.depth === 0 ? '#deebe4' : tile.depth % 2 ? '#c1d9cc' : '#a9cab9'" />
                        <text v-if="labelFontSize(tile) >= 7" :x="tile.x + 5"
                          :y="tile.y + labelFontSize(tile) + 4" :font-size="labelFontSize(tile)" class="tile-label">
                          {{ tile.label }}
                        </text>
                      </g>
                      <text v-for="tile in (versionTiles.get(version.id) ?? []).filter((item) =>
                        labelFontSize(item) >= 7 && !dragOverlayTiles(version).some((overlay) => overlay.id === item.id))" :key="`label-${tile.id}`"
                        :x="tile.x + 5" :y="tile.y + labelFontSize(tile) + 4" :font-size="labelFontSize(tile)" class="tile-label">{{ tile.label }}</text>
                      <rect v-if="version.id === active.id && draggedOriginalTile" class="drag-source-ghost"
                        :x="draggedOriginalTile.x" :y="draggedOriginalTile.y"
                        :width="draggedOriginalTile.width" :height="draggedOriginalTile.height"
                        :rx="3" fill="transparent" :stroke="tileStrokeColor(version.id, draggedOriginalTile.id)"
                        stroke-dasharray="4 3" :stroke-width="tileStrokeWidth(version.id, draggedOriginalTile.id)"
                        pointer-events="none"></rect>
                    </g>
                  </svg>
                </template>
                <div v-else class="empty-map" :class="{ 'root-empty': version.id === 'v0' }">
                  <span v-if="version.id === 'v0'" class="empty-set" aria-label="Empty set">∅</span>
                  <template v-else><span class="empty-cross">+</span><span>Empty structure</span></template>
                </div>
              </div>
            </article>
            <svg class="copy-connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height">
              <g v-for="(link, index) in visibleCopyLinks" :key="`copy-${index}`" class="copy-link-group">
                <path :d="copyLinkPath(link)" class="copy-link" fill="none" stroke="#cf7b32"
                  stroke-width="3" vector-effect="non-scaling-stroke" stroke-dasharray="7 4"
                  pointer-events="none" />
                <path :d="copyLinkPath(link)" class="copy-link-hit" fill="none" stroke="transparent"
                  stroke-width="8" vector-effect="non-scaling-stroke" pointer-events="stroke"
                  role="button" tabindex="0"
                  :aria-label="`Copied entry connection from ${displayVersionId(link.sourceVersionId)} to ${displayVersionId(link.targetVersionId)}. Click to switch versions.`"
                  @click.stop="activateCopyLink(link, $event)"
                  @keydown.enter.prevent.stop="activateCopyLink(link)"
                  @keydown.space.prevent.stop="activateCopyLink(link)">
                  <title>Copied entry connection. Click to focus the opposite version.</title>
                </path>
              </g>
            </svg>
            <span v-for="ping in pings" :key="ping.id" class="ping-origin"
              :style="{ left: `${ping.x}px`, top: `${ping.y}px`, '--ping-color': userColor(ping.userId) }">
              <span v-for="pulse in 3" :key="pulse" class="ping-ripple"
                :style="{ animationDelay: `${(pulse - 1) * 180}ms` }"></span>
            </span>
          </div>

          <div class="canvas-controls" @pointerdown.stop @click.stop>
            <div v-if="pingMode" class="ping-mode-banner" role="status">PING MODE · Click to place a ping · Press P or Esc to exit</div>
            <div v-if="isReadOnly" class="readonly-notice" role="status">READ ONLY · Zoom in to edit entries</div>
            <div class="canvas-hotbar" role="toolbar" aria-label="Quick actions">
            <button title="Create a free entry · N" aria-label="New free entry, N" :disabled="isReadOnly" @click="createFreeEntry"><Plus :size="16" /><span>New entry</span><kbd>N</kbd></button>
            <button title="Add a child to the selected entry · Ctrl/⌘+Enter" aria-label="Add child, Ctrl or Command+Enter" :disabled="isReadOnly || !selectedNode" @click="selectedNode && addEntry(selectedNode)"><GitBranch :size="16" /><span>Add child</span><kbd>Ctrl/⌘+↵</kbd></button>
            <button title="Detach the selected entry · Shift+D" aria-label="Detach selected, Shift+D" :disabled="isReadOnly || !selectedNode" @click="selectedNode && detachEntry(selectedNode)"><Unlink :size="16" /><span>Detach</span><kbd>Shift+D</kbd></button>
            <button title="Compare two versions · Shift+C" aria-label="Compare versions, Shift+C" :class="{ selected: compareMode }" @click="compareMode ? closeVersionSelection() : startVersionSelection('compare')"><GitCompareArrows :size="16" /><span>Compare</span><kbd>Shift+C</kbd></button>
            <button title="Merge two versions · M" aria-label="Merge versions, M" :class="{ selected: mergeMode }" @click="mergeMode ? closeVersionSelection() : startVersionSelection('merge')"><GitCompareArrows :size="16" /><span>Merge</span><kbd>M</kbd></button>
            <button title="Focus the active version · F" aria-label="Focus active version, F" @click="focusActive"><Maximize :size="16" /><span>Focus</span><kbd>F</kbd></button>
            <button title="Fit all versions in view · Shift+A" aria-label="Fit all versions, Shift+A" @click="fitGraph"><Layers3 :size="16" /><span>Fit all</span><kbd>Shift+A</kbd></button>
            <button title="Toggle Ping Mode · P" aria-label="Toggle Ping Mode, P" :aria-pressed="pingMode" :class="{ selected: pingMode }" @click="pingMode = !pingMode"><Radio :size="16" /><span>{{ pingMode ? 'Ping mode on' : 'Ping' }}</span><kbd>P</kbd></button>
            <span class="hotbar-divider" aria-hidden="true"></span>
            <button title="Zoom out · -" aria-label="Zoom out, minus" @click="zoomOut"><ZoomOut :size="16" /><kbd>−</kbd></button>
            <button title="Zoom in · +" aria-label="Zoom in, plus" @click="zoomIn"><ZoomIn :size="16" /><kbd>+</kbd></button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="compareMode || mergeMode || showOverview"
      :role="mergeMode && compareIds.length === 2 ? 'dialog' : undefined"
      :aria-modal="mergeMode && compareIds.length === 2 ? 'true' : undefined"
      :aria-label="mergeMode ? 'Branch merge' : 'Version comparison'"
      :class="{ 'merge-modal': mergeMode && compareIds.length === 2 }"
      @pointerdown.stop @pointerup.stop @pointermove.stop @pointercancel.stop @click.stop
      @dblclick.stop @contextmenu.stop @wheel.stop @touchmove.stop>
      <div class="compare-drawer" :class="{ open: compareIds.length === 2, 'merge-view': mergeMode }">
      <div class="drawer-head">
        <div>
          <span class="section-label">{{ mergeMode ? 'BRANCH MERGE' : 'VERSION COMPARISON' }}</span>
          <strong>{{ compareIds.length === 2
            ? `${displayVersionId(compareIds[0]!)} ${mergeMode ? '→' : '↔'} ${displayVersionId(compareIds[1]!)}`
            : mergeMode ? 'Choose source, then target' : 'Choose two versions' }}</strong>
          </div>
        <button class="quiet-icon" title="Close comparison" aria-label="Abort and close" @click="closeVersionSelection"><X :size="17" /></button>
      </div>
      <div v-if="compareIds.length === 2" class="comparison-content">
        <div class="compare-summary">
          <span class="compare-count">{{ comparison.length }}</span>
          <span>{{ comparison.length === 1 ? 'entry differs' : 'entries differ' }}</span>
        </div>
        <div v-if="mergeMode" class="merge-workspace">
          <div class="merge-view-head">
            <strong>Source</strong><strong>Merged result</strong><strong>Target</strong>
          </div>
          <div v-for="row in mergeRows" :key="row.id" class="merge-view-row" :data-node="row.id"
            :class="{ shared: row.shared, omitted: !row.resultEntry }">
            <div class="merge-entry-cell" :style="{ paddingLeft: `${8 + (row.sourceEntry ? row.depth : 0) * 12}px` }">
              <template v-if="row.sourceEntry">
                <strong>{{ row.sourceEntry.node.value }}</strong>
                <small>{{ row.sourceEntry.path }}</small>
              </template>
              <span v-else class="merge-empty">No source entry</span>
            </div>
            <div class="merge-result-cell">
              <template v-if="row.resultEntry">
                <strong>{{ row.resultEntry.node.value }}</strong>
                <small class="merge-result-path">{{ row.resultEntry.path }}</small>
              </template>
              <span v-else class="merge-empty">Disregarded</span>
              <div class="merge-entry-actions">
                <button v-if="row.sourceEntry" :class="{ selected: mergeDecisionFor(row) === 'source' }"
                  @click="setMergeDecision(row.id, 'source')">Source</button>
                <button v-if="row.targetEntry" :class="{ selected: mergeDecisionFor(row) === 'target' }"
                  @click="setMergeDecision(row.id, 'target')">Target</button>
                <button v-if="row.shared" :class="{ selected: mergeDecisionFor(row) === 'combine' }"
                  @click="setMergeDecision(row.id, 'combine')">Combine</button>
                <button :class="{ selected: mergeDecisionFor(row) === 'omit' }"
                  @click="setMergeDecision(row.id, 'omit')">Omit</button>
              </div>
              <label v-if="row.resultEntry" class="merge-parent-select">
                Parent
                <select :value="mergeParentOverrides[row.id] ?? row.resultEntry.parentId ?? ''"
                  :aria-label="`Parent for ${row.resultEntry.node.value} in merged result`"
                  @change="onMergeParentChange(row.id, $event)">
                  <option value="">Root</option>
                  <option v-for="[parentId, parent] in mergeParentOptions(row.id)" :key="parentId" :value="parentId">
                    {{ parent.path }}
                  </option>
                </select>
              </label>
            </div>
            <div class="merge-entry-cell" :style="{ paddingLeft: `${8 + (row.targetEntry ? row.depth : 0) * 12}px` }">
              <template v-if="row.targetEntry">
                <strong>{{ row.targetEntry.node.value }}</strong>
                <small>{{ row.targetEntry.path }}</small>
              </template>
              <span v-else class="merge-empty">No target entry</span>
            </div>
          </div>
        </div>
        <div v-else class="comparison-panels">
          <section v-for="(panel, panelIndex) in comparisonPanels" :key="panel.id" class="comparison-panel">
            <header><span>{{ panel.label }}</span><strong>{{ panel.version.branch }} · S{{ panel.version.step }}</strong></header>
            <svg :viewBox="comparisonViewBox" role="img" :aria-label="`${panel.label} treemap comparison`">
              <rect v-for="ghost in panelIndex < 2 ? comparisonGhosts(panelIndex) : []" :key="`ghost-${ghost.id}`"
                :x="ghost.x" :y="ghost.y" :width="ghost.width" :height="ghost.height"
                :data-node="ghost.id" role="button" tabindex="0"
                :class="['comparison-ghost', panelIndex === 0 ? 'added' : 'removed', { linked: comparisonSelectedNode === ghost.id }]"
                :aria-label="`${ghost.label} is absent from ${panel.label}`"
                @click="selectComparedNode(ghost.id)"
                @keydown.enter.prevent="selectComparedNode(ghost.id)" @keydown.space.prevent="selectComparedNode(ghost.id)" />
              <rect v-for="tile in panel.tiles" :key="tile.id"
                :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                :data-node="tile.id" role="button" tabindex="0"
                :class="['comparison-tile', comparisonKind(tile.id), { linked: comparisonSelectedNode === tile.id }]"
                :aria-label="`${tile.label}, ${comparisonKind(tile.id)}`"
                @click="selectComparedNode(tile.id)"
                @keydown.enter.prevent="selectComparedNode(tile.id)" @keydown.space.prevent="selectComparedNode(tile.id)" />
              <text v-for="tile in panel.tiles.filter((item) => item.width > 35 && item.height > 18)" :key="`label-${tile.id}`"
                :x="tile.x + 5" :y="tile.y + 16" :class="['comparison-label', { linked: comparisonSelectedNode === tile.id }]">{{ tile.label }}</text>
            </svg>
          </section>
        </div>
        <div v-if="!mergeMode" class="comparison-legend" aria-label="Difference legend">
          <span class="unchanged">Unchanged</span><span class="added">Added</span><span class="removed">Removed</span>
          <span class="modified">Modified</span><span class="relocated">Relocated / hierarchy changed</span>
        </div>
        <div v-if="mergeMode" class="merge-confirm-row">
          <div class="merge-actions">
            <button class="cancel-button" @click="closeVersionSelection">Abort merge</button>
            <button class="primary-button" :disabled="!mergeResult" @click="confirmMerge">
              <Check :size="15" /> Confirm merge
            </button>
          </div>
        </div>
        <div v-if="comparison.length" class="diff-list">
          <div v-for="change in comparison" :key="change.id" class="diff-item" :class="change.kind.toLowerCase()"
            @click="selectComparedNode(change.id)">
            <span>{{ change.kind }}</span><strong>{{ change.label }}</strong>
          </div>
        </div>
        <div v-else class="no-diff"><Check :size="17" /> These versions are structurally identical.</div>
      </div>
      <div v-else class="drawer-empty"><Search :size="18" /><span>Select the first version, then the second.</span></div>
    </div>
    </div>

    <div v-if="menu" ref="contextMenuElement" class="context-menu" :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }" @click.stop>
      <template v-if="menu.kind === 'version'">
        <div class="context-title">{{ menu.versionId === 'v0' ? 'ROOT ACTIONS' : 'VERSION ACTIONS' }}</div>
        <button v-if="!isReadOnly" @click="addEntryToVersion(menu.versionId); menu = null"><Plus :size="15" /> Add Entry</button>
        <button @click="focusActive(); menu = null"><Maximize :size="15" /> Focus active version</button>
        <button v-if="versions.find((version) => version.id === menu!.versionId)?.data.length" @click="centerVersionTreemaps(menu.versionId!); menu = null"><Maximize :size="15" /> Center all elements</button>
        <button v-if="!isReadOnly && versions.find((version) => version.id === menu!.versionId)?.data.length" @click="compactVersionTreemaps(menu.versionId!); menu = null"><Layers3 :size="15" /> Compact Layout</button>
        <template v-if="menu.versionId !== 'v0'">
          <div class="context-divider"></div>
          <button class="danger-action" @click="pruneVersion(menu.versionId!); menu = null"><Trash2 :size="15" /> Delete version and descendants</button>
        </template>
      </template>
      <template v-else-if="menu.kind === 'entry' && menu.nodeId">
        <div class="context-title">ENTRY ACTIONS</div>
        <template v-if="!isReadOnly">
          <button @click="addEntry(menu.nodeId); menu = null"><Plus :size="15" /> Add child</button>
          <button @click="renameEntry(menu.nodeId!); menu = null"><Pencil :size="15" /> Change value</button>
          <button v-if="findParent(active.data, menu.nodeId!)" @click="detachEntry(menu.nodeId!); menu = null"><Unlink :size="15" /> Detach from parent</button>
        </template>
        <template v-if="!isReadOnly && !(findNode(active.data, menu.nodeId!)?.children.length)">
          <button class="danger-action" @click="deleteEntry(menu.nodeId!, 'subtree'); menu = null"><Trash2 :size="15" /> Delete entry</button>
        </template>
        <template v-else-if="!isReadOnly">
          <div class="context-divider"></div>
          <button class="danger-action" @click="deleteEntry(menu.nodeId!, 'keep-children'); menu = null"><Trash2 :size="15" /> Delete selected entry, keep children</button>
          <button class="danger-action" @click="deleteEntry(menu.nodeId!, 'subtree'); menu = null"><Trash2 :size="15" /> Delete selected entry and its children</button>
          <button class="danger-action" @click="deleteEntry(menu.nodeId!, 'detach-children'); menu = null"><Trash2 :size="15" /> Delete selected entry, detach children</button>
        </template>
        <div class="context-divider"></div>
        <button @click="copyEntry(menu.nodeId!); menu = null"><Copy :size="15" /> Copy entry and subtree</button>
        <button v-if="clipboard && !isReadOnly" @click="pasteEntryToVersion(menu.versionId); menu = null"><ClipboardPaste :size="15" /> Add copied entry</button>
      </template>
      <template v-else>
        <div class="context-title">CANVAS ACTIONS</div>
        <button @click="focusActive(); menu = null"><Maximize :size="15" /> Focus active version</button>
        <button @click="fitGraph(); menu = null"><Layers3 :size="15" /> Fit all versions</button>
      </template>
    </div>
    <div v-if="editor" class="editor-scrim" @click.self="editor = null">
      <form class="entry-editor" @submit.prevent="commitEditor">
        <div class="editor-heading"><span class="section-label">{{ editor.mode === 'create' ? 'NEW ENTRY' : 'CHANGE VALUE' }}</span><button type="button" class="quiet-icon" title="Close" @click="editor = null"><X :size="17" /></button></div>
        <label class="editor-label" for="entry-value">{{ editor.mode === 'create' ? 'Entry name' : 'New value' }}</label>
        <input id="entry-value" ref="entryValueInput" v-model="editor.value" maxlength="120" placeholder="e.g. Research notes" />
        <label class="editor-label" for="entry-description">Description <span>optional</span></label>
        <textarea id="entry-description" v-model="editor.description" maxlength="400" rows="3" placeholder="Shown when you hover over this entry"></textarea>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="editor = null">Cancel</button><button type="submit" class="primary-button" :disabled="!editor.value.trim()"><Check :size="15" /> Confirm</button></div>
      </form>
    </div>
    <div v-if="entryTooltip" class="entry-tooltip" role="tooltip"
      :style="{ left: `${Math.min(entryTooltip.x + 14, window.innerWidth - 300)}px`, top: `${Math.min(entryTooltip.y + 16, window.innerHeight - 100)}px` }">
      {{ entryTooltip.description }}
    </div>
    <div v-if="toast" class="toast"><span></span>{{ toast }}</div>
  </main>
</template>

<script lang="ts">
export default { data: () => ({ window }) }
</script>