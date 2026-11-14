<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { getClientId } from '../collaboration'
import { useCollaboration } from '../composables/useCollaboration'
import type { InteractionEntry } from '../types/collaboration'
import { useVersionComparison } from '../composables/useVersionComparison'
import { useGraphCamera } from '../composables/useGraphCamera'
import { useTreemapViews } from '../composables/useTreemapViews'
import { useTreeDrag } from '../composables/useTreeDrag'
import { useHierarchyEditor } from '../composables/useHierarchyEditor'
import { useVersionHistory } from '../composables/useVersionHistory'
import { createRoomStorage, LAST_ROOM_KEY } from '../services/roomStorage'
import VersionComparison from '../components/VersionComparison.vue'
import WorkspaceSidebar from '../components/WorkspaceSidebar.vue'
import VersionConnections from '../components/VersionConnections.vue'
import VersionCard from '../components/VersionCard.vue'
import type { VersionCardModel } from '../types/graph'
import { selectionColor, userColor, versionColor } from '../utils/colors'
import EntryEditor from '../components/EntryEditor.vue'
import EntryOperationDialog from '../components/EntryOperationDialog.vue'
import RoomManager from '../components/RoomManager.vue'
import type { CopyLink, StoredState, Tile, TreeNode, Version } from '../types/workspace'
import { countNodes, findNode, findParent, flattenNodes, nodeParentIds } from '../utils/tree'
import { compareCopyLinks, displayVersionId, reflowVersionLayout } from '../utils/versions'
import { CARD_WIDTH, TREE_MAP_HEIGHT, tilesForForest, tileForNode } from '../utils/treemap'
import {
  GitBranch, GitCompareArrows, Plus, Maximize, Copy, Trash2,
  Pencil, Unlink, X, Layers3, ClipboardPaste, ZoomIn, ZoomOut, Radio,
} from '@lucide/vue'

type ClipboardEntry = { sourceVersionId: string; node: TreeNode }
const CLIENT_ID = getClientId()
const GRAPH_GAP_X = 300
const TERMINAL_TAIL_LENGTH = GRAPH_GAP_X
const TERMINAL_ARROW_BASE_INSET = 0.3
const SIDEBAR_LAYOUT_WIDTH = 238
const ZOOM_MAX = 4
const { seed, roomDataKey, persistLocalRooms, initializeLocalRooms, readRoomState, normalizeState } = createRoomStorage()
const initialRooms = initializeLocalRooms()
const localRooms = ref(initialRooms.rooms)
const currentRoomName = ref(initialRooms.currentRoom)
const state = ref<StoredState>(readRoomState(currentRoomName.value, initialRooms.canMigrateLegacy))
const versions = computed(() => state.value.versions)
const versionsById = computed(() => new Map(versions.value.map((version) => [version.id, version])))
const active = computed(() => versions.value.find((version) => version.id === state.value.activeId) ?? versions.value[0]!)
const comparisonController = useVersionComparison(versions, (version) => mapViewFor(version), (version) => mapViewport(version))
const comparisonModel = reactive(comparisonController)
const {
  compareMode, compareIds, mergeMode, chooseCompare, startVersionSelection, closeVersionSelection,
} = comparisonController

const selectedNode = ref<string | null>(null)
const selectedNodes = ref<string[]>([])
const hoveredNode = ref<{ versionId: string; nodeId: string } | null>(null)
const entryTooltip = ref<{ versionId: string; nodeId: string; description: string; x: number; y: number } | null>(null)
const pingMode = ref(false)
const darkMode = ref(localStorage.getItem('canopy-theme') === 'dark')
const sidebarCollapsed = ref(false)
const zoom = ref(1)
const isReadOnly = computed(() => zoom.value <= 0.35)
const pan = ref({ x: 40, y: 0 })
const graphCanvas = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: window.innerWidth, height: Math.max(400, window.innerHeight - 209) })
const browserViewport = ref({ width: window.innerWidth, height: window.innerHeight })
let canvasObserver: ResizeObserver | null = null
let suppressVersionClick = false
let suppressTileClick = false
let suppressCanvasClick = false
let versionClickTimer = 0
let pendingCompareVersion: Version | null = null
let tileClickTimer = 0
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
const windowDimensions = computed(() => {
  const viewportWidth = Math.max(320, browserViewport.value.width - SIDEBAR_LAYOUT_WIDTH)
  const viewportHeight = Math.max(300, browserViewport.value.height)
  const aspect = viewportWidth / viewportHeight
  const width = Math.max(240, Math.min(460, viewportWidth * 0.36, viewportHeight * 0.48 * aspect))
  const height = Math.min(440, width / aspect)
  return { width, height }
})
const clipboard = ref<ClipboardEntry | null>(readClipboard(currentRoomName.value))
const toast = ref('')
const roomDialogOpen = ref(false)
const newRoomName = ref('')
let toastTimer = 0
let presenceTimer = 0
let pingClickTimer = 0
let tileTooltipTimer = 0
let tilePointer = { x: 0, y: 0 }

watch([compareMode, mergeMode], () => {
  window.clearTimeout(versionClickTimer)
  pendingCompareVersion = null
})

const graphCamera = useGraphCamera({ versions, active, state, compareIds, draggedVersionId: () => treeDrag.value?.versionId,
  zoom, pan, canvasSize, windowDimensions, suppressClicks: suppressGraphClicks })
const { cardPosition, cardHeight, displayCardPosition, graphBounds,
  visibleVersions, visibleConnectionVersions, visibleMergeConnectionVersions, zoomIn, zoomOut, fitGraph,
  startCanvasPan, moveCanvasPan, endCanvasPan, onWheel, focusVersion, focusActive, animateCamera,
  stopGraphAnimations,
} = graphCamera

const treemapViews = useTreemapViews({ state, versions, windowDimensions, zoom, cardHeight,
  focusedVersionId: graphCamera.focusedVersionId, notify, suppressClicks: suppressGraphClicks })
const { mapViewTimers, cardData, cardPositions, mapViewport, mapViewFor,
  centerVersionTreemaps, compactVersionTreemaps, commitMapView, clearTransientMapViews, initializeMapViews,
  zoomMap, startMapPan, moveMapPan, endMapPan,
} = treemapViews

const {
  remoteUsers, pings, roomStatus, peerRoom, connectedUsers, recentInteractions, metadataKey,
  interactionStorageKey, logInteraction, initializeCollaborationMetadata, sendPingAt,
  expireRemoteUsers, connectAutomatically, resetRoomTracking, setObservedState, finishRoomSwitch,
} = useCollaboration({
  clientId: CLIENT_ID, state, active, selectedNodes, currentRoomName, graphCanvas, pan, zoom,
  normalizeState, roomDataKey, reflowLayout, fitGraph, notify,
  followVersion: (version) => {
    const wasCentered = graphCamera.isVersionCentered(active.value)
    state.value.activeId = version.id
    setSelectedNodes([])
    graphCamera.panToVersion(version, wasCentered)
  },
})

const { createVersion, confirmMerge, pruneVersion } = useVersionHistory({
  clientId: CLIENT_ID, state, versions, active, selectedNode, windowDimensions,
  comparison: comparisonController, camera: graphCamera, treemaps: treemapViews,
  reflowLayout, setSelectedNodes, notify, logInteraction,
})

const { editor, setEntryValueInput, entryOperation, bulkDeleteMode, bulkDeleteDialog,
  addEntry, commitEditor, renameEntry, addEditorEntryRow, removeEditorEntryRow, deleteEntry,
  deleteSelectedEntries, openBulkDelete, openMergeEntries, openSplitEntry, addSplitEntry,
  removeSplitEntry, commitEntryOperation, detachEntry, canAttach, attachEntry,
} = useHierarchyEditor({ clientId: CLIENT_ID, state, active, selectedNodes, isReadOnly, createVersion, setSelectedNodes })

function suppressGraphClicks() {
  suppressVersionClick = true
  suppressTileClick = true
  suppressCanvasClick = true
  window.clearTimeout(versionClickTimer)
  pendingCompareVersion = null
  window.clearTimeout(tileClickTimer)
  window.setTimeout(() => { suppressVersionClick = false; suppressTileClick = false; suppressCanvasClick = false }, 0)
}

const { draggedNode, draggedPosition, dragPreviewView, overNode, invalidNode, treeDrag, spatialPreview,
  previewLayout, draggedSubtreeIds, draggedOriginalTile, startTreeDrag, moveTreeDrag, finishTreeDrag, cancelTreeDrag,
} = useTreeDrag({ state, versions, active, zoom, isReadOnly, hoveredNode, entryTooltip, mapViewFor, mapViewport,
  canAttach, attachEntry, detachEntry, setSelectedNodes, notify, suppressClicks: suppressGraphClicks })

watch(selectedNode, (nodeId) => {
  if (!nodeId) selectedNodes.value = []
  else if (!selectedNodes.value.includes(nodeId)) selectedNodes.value = [nodeId]
})
watch(isReadOnly, (readOnly) => {
  if (!readOnly) return
  setSelectedNodes([])
  if (editor.value?.mode === 'rename') editor.value = null
  entryOperation.value = null
  bulkDeleteDialog.value = false
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
async function activateRoom(room: string, createEmpty = false) {
  const name = room.trim()
  if (!name || name.length > 80) {
    notify('Room names must contain 1–80 characters')
    return
  }
  peerRoom.send({ type: 'presence-leave', userId: CLIENT_ID })
  peerRoom.close()
  remoteUsers.value = {}
  clearTransientMapViews()
  setSelectedNodes([])
  editor.value = null
  entryOperation.value = null
  bulkDeleteDialog.value = false
  menu.value = null
  resetRoomTracking()
  if (!localRooms.value.includes(name)) {
    localRooms.value = [...localRooms.value, name]
    persistLocalRooms(localRooms.value)
  }
  currentRoomName.value = name
  localStorage.setItem(LAST_ROOM_KEY, name)
  const url = new URL(location.href)
  url.searchParams.set('room', name)
  history.replaceState(null, '', url)
  const nextState = createEmpty ? clone(seed) : readRoomState(name)
  clipboard.value = readClipboard(name)
  setObservedState(nextState)
  state.value = nextState
  await nextTick()
  finishRoomSwitch()
  initializeCollaborationMetadata(name)
  localStorage.setItem(roomDataKey(name), JSON.stringify(state.value))
  reflowLayout()
  await nextTick(initializeMapViews)
  roomDialogOpen.value = false
  fitGraph()
  await connectAutomatically(name)
}

async function copySessionInvite() {
  const url = new URL(location.href)
  url.searchParams.set('room', currentRoomName.value)
  try {
    await navigator.clipboard.writeText(url.toString())
    notify('Invite link copied')
  } catch {
    notify('Could not access clipboard; copy the room name to invite peers')
  }
}

function deleteLocalRoom(room: string) {
  if (room === currentRoomName.value) return
  if (!window.confirm(`Delete room "${room}"? Its locally stored data will be removed.`)) return
  localStorage.removeItem(roomDataKey(room))
  localStorage.removeItem(metadataKey(room))
  localStorage.removeItem(interactionStorageKey(room))
  sessionStorage.removeItem(clipboardStorageKey(room))
  localRooms.value = localRooms.value.filter((savedRoom) => savedRoom !== room)
  persistLocalRooms(localRooms.value)
}

function createRoomFromDialog() {
  const name = newRoomName.value.trim()
  if (!name || name.length > 80) {
    notify('Enter a room name of 1–80 characters')
    return
  }
  newRoomName.value = ''
  void activateRoom(name, !localRooms.value.includes(name))
}

async function initializeCurrentRoom() {
  initializeCollaborationMetadata(currentRoomName.value)
  localStorage.setItem(roomDataKey(currentRoomName.value), JSON.stringify(state.value))
  reflowLayout()
  await nextTick(initializeMapViews)
  requestAnimationFrame(fitGraph)
  await connectAutomatically(currentRoomName.value)
}

function notify(message: string) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2400)
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function clipboardStorageKey(room: string) {
  return `canopy-copy-${encodeURIComponent(room)}`
}

function readClipboard(room: string): ClipboardEntry | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(clipboardStorageKey(room)) ?? 'null') as ClipboardEntry | TreeNode | null
    if (!stored) return null
    if ('node' in stored) return stored
    return { sourceVersionId: state.value.activeId, node: stored }
  }
  catch { return null }
}
function reflowLayout() { reflowVersionLayout(state.value) }

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

function handleVersionClick(version: Version, event: MouseEvent) {
  if (compareMode.value || mergeMode.value) {
    if (event.detail > 1) return
    if (pendingCompareVersion) {
      window.clearTimeout(versionClickTimer)
      selectVersion(pendingCompareVersion)
    }
    const mode = compareMode.value ? 'compare' : 'merge'
    pendingCompareVersion = version
    versionClickTimer = window.setTimeout(() => {
      pendingCompareVersion = null
      if ((mode === 'compare' && compareMode.value) || (mode === 'merge' && mergeMode.value)) selectVersion(version)
    }, 500)
    return
  }
  window.clearTimeout(versionClickTimer)
  pendingCompareVersion = null
  versionClickTimer = window.setTimeout(() => selectVersion(version), 220)
}

function handleVersionDoubleClick(version: Version) {
  window.clearTimeout(versionClickTimer)
  pendingCompareVersion = null
  activateAndFocusVersion(version)
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
  const additive = event.shiftKey
  window.clearTimeout(tileClickTimer)
  tileClickTimer = window.setTimeout(() => {
    state.value.activeId = version.id
    if (isReadOnly.value) {
      setSelectedNodes([])
    } else if (additive || selectedNodes.value.includes(nodeId)) {
      const selection = selectedNodes.value.includes(nodeId)
        ? selectedNodes.value.filter((id) => id !== nodeId)
        : [...selectedNodes.value, nodeId]
      setSelectedNodes(selection)
    } else {
      setSelectedNodes([nodeId])
    }
    menu.value = null
  }, 220)
}

function onTileDoubleClick(version: Version, nodeId: string) {
  window.clearTimeout(tileClickTimer)
  if (compareMode.value || mergeMode.value || isReadOnly.value) return
  state.value.activeId = version.id
  renameEntry(nodeId)
}

function onCanvasClick(event: MouseEvent) {
  if (suppressCanvasClick) return
  if ((event.target as HTMLElement).closest('.version-card, button')) return
  setSelectedNodes([])
  menu.value = null
}

const activeNodes = computed(() => countNodes(active.value.data))
const branchCount = computed(() => new Set(versions.value.filter((version) => version.id !== 'v0').map((version) => version.branch.split('.')[0])).size)
const activeChildren = computed(() => versions.value.filter((version) => version.parentId === active.value.id).length)

function connectionPath(version: Version) {
  const parent = version.parentId ? versionsById.value.get(version.parentId) : undefined
  if (!parent) return ''
  return versionConnectionPath(parent, version)
}
function connectorLabelPosition(source: Version, destination: Version) {
  const from = displayCardPosition(source)
  const to = displayCardPosition(destination)
  return {
    x: (from.x + windowDimensions.value.width + to.x) / 2,
    y: (from.y + cardHeight(source) / 2 + to.y + cardHeight(destination) / 2) / 2,
  }
}
function versionConnectionPath(source: Version, destination: Version, endOffsetY = 0) {
  const from = displayCardPosition(source)
  const to = displayCardPosition(destination)
  const startX = from.x + windowDimensions.value.width
  const startY = from.y + cardHeight(source) / 2
  const endX = to.x
  const endY = to.y + cardHeight(destination) / 2 + endOffsetY
  if (source.id === 'v0' && endOffsetY === 0) return `M ${startX} ${endY} H ${endX}`
  if (Math.abs(endY - startY) < 1) return `M ${startX} ${startY} H ${endX}`
  const direction = Math.sign(endY - startY)
  const maxRadius = Math.min(GRAPH_GAP_X / 4, Math.abs(endY - startY) / 2)
  const cornerX = startX + (endX - startX) / 2
  const radius = Math.min(maxRadius, cornerX - startX, endX - cornerX)
  return `M ${startX} ${startY} H ${cornerX - radius} Q ${cornerX} ${startY} ${cornerX} ${startY + direction * radius} V ${endY - direction * radius} Q ${cornerX} ${endY} ${cornerX + radius} ${endY} H ${endX}`
}
function mergeConnectionPath(version: Version) {
  const source = version.mergeSourceId ? versionsById.value.get(version.mergeSourceId) : undefined
  if (!source) return ''
  return versionConnectionPath(source, version)
}
function mergeConnectorLabelPosition(version: Version) {
  const source = version.mergeSourceId ? versionsById.value.get(version.mergeSourceId) : undefined
  return connectorLabelPosition(source ?? version, version)
}
function mergeConnectionColor(version: Version) {
  const source = version.mergeSourceId ? versionsById.value.get(version.mergeSourceId) : undefined
  return versionColor(source ?? version)
}
function isBranchCurve(version: Version) {
  const parent = version.parentId ? versionsById.value.get(version.parentId) : undefined
  if (!parent || parent.id === 'v0') return false
  return Math.abs(cardPosition(parent).y + cardHeight(parent) / 2
    - cardPosition(version).y - cardHeight(version) / 2) >= 1
}
function connectionWidth(version: Version) {
  const parent = version.parentId ? versionsById.value.get(version.parentId) : undefined
  return Math.min(windowDimensions.value.height, cardHeight(version), parent ? cardHeight(parent) : windowDimensions.value.height) / 3
}
function terminalTailEnd(version: Version) {
  return TERMINAL_TAIL_LENGTH - TERMINAL_ARROW_BASE_INSET * connectionWidth(version)
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
  const selectedColor = tileSelectionHighlights(versionId, nodeId)[0]?.color
  if (selectedColor) return selectedColor
  if ((hoveredNode.value?.versionId === versionId && hoveredNode.value.nodeId === nodeId)
    || (versionId === active.value.id && overNode.value === nodeId)) return '#00a8ff'
  return darkMode.value ? '#101713' : '#fff'
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
function versionAction(version: Version) {
  const previous = version.parentId ? versionsById.value.get(version.parentId) : undefined
  if (!previous) return { label: 'root', symbol: '•' }
  if (version.mergeSourceId || /^Merge \d+ entries into /.test(version.change)) {
    return { label: 'merge', symbol: '⋈' }
  }
  if (/^Split .+ into \d+ entries$/.test(version.change)) {
    return { label: 'split', symbol: 'Y' }
  }
  const before = flattenNodes(previous.data)
  const after = flattenNodes(version.data)
  const added = [...after.keys()].filter((id) => !before.has(id)).length
  const removed = [...before.keys()].filter((id) => !after.has(id)).length
  let renamed = 0
  let modified = 0
  for (const [id, item] of after) {
    const old = before.get(id)
    if (!old) continue
    if (item.node.value !== old.node.value) renamed += 1
    if ((old.node.description ?? '') !== (item.node.description ?? '')) modified += 1
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
function mapTransform(version: Version) {
  const layout = version.id === active.value.id ? previewLayout.value : null
  const view = layout?.view ?? mapViewFor(version)
  return `translate(${view.panX} ${view.panY}) scale(${view.zoom})`
}
const versionTiles = computed(() => {
  const result = new Map<string, Tile[]>()
  for (const version of visibleVersions.value) {
    const data = cardData(version)
    const positions = cardPositions(version)
    const tiles = tilesForForest(data, positions)
    if (version.id === active.value.id && draggedNode.value) {
      const dragged = new Set(draggedSubtreeIds.value)
      tiles.sort((left, right) => Number(dragged.has(right.id)) - Number(dragged.has(left.id)))
    }
    result.set(version.id, tiles)
  }
  return result
})
const duplicateValueLinks = computed(() => {
  const result = new Map<string, Array<{ id: string; path: string }>>()
  for (const version of visibleVersions.value) {
    const parents = nodeParentIds(cardData(version))
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
        isParentChild: parents.get(first.id) === second.id || parents.get(second.id) === first.id,
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
        const firstParent = parents.get(first.id)
        const secondParent = parents.get(second.id)
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
function nodeGraphBounds(versionId: string, nodeId: string) {
  const version = versionsById.value.get(versionId)
  if (!version) return null
  const view = mapViewFor(version)
  const viewport = mapViewport(version)
  const mapWidth = version.id === 'v0' ? windowDimensions.value.width - 2 : windowDimensions.value.width - 12
  const mapHeight = version.id === 'v0' ? cardHeight(version) - 2 : cardHeight(version) - 47
  const scaleX = mapWidth / viewport.width
  const scaleY = mapHeight / viewport.height
  const tile = tileForNode(version.data, version.positions, nodeId)
  if (tile) {
    const position = displayCardPosition(version)
    const mapLeft = version.id === 'v0' ? 1 : 6
    const mapTop = version.id === 'v0' ? 1 : 39
    return {
      left: position.x + mapLeft + (view.panX + tile.x * view.zoom) * scaleX,
      right: position.x + mapLeft + (view.panX + (tile.x + tile.width) * view.zoom) * scaleX,
      top: position.y + mapTop + (view.panY + tile.y * view.zoom) * scaleY,
      bottom: position.y + mapTop + (view.panY + (tile.y + tile.height) * view.zoom) * scaleY,
    }
  }
  return null
}
const copyLinksWithBounds = computed(() => state.value.copyLinks.flatMap((link) => {
  const source = nodeGraphBounds(link.sourceVersionId, link.sourceNodeId)
  const target = nodeGraphBounds(link.targetVersionId, link.targetNodeId)
  return source && target ? [{ link, source, target, path: copyLinkPath(source, target) }] : []
}))
const visibleCopyLinks = computed(() => copyLinksWithBounds.value.filter(({ source, target }) =>
  graphCamera.intersectsViewport({
    left: Math.min(source.left, target.left),
    right: Math.max(source.right, target.right),
    top: Math.min(source.top, target.top),
    bottom: Math.max(source.bottom, target.bottom),
  }, 90 + 20 / zoom.value)
))
function copyLinkPath(source: NonNullable<ReturnType<typeof nodeGraphBounds>>, target: NonNullable<ReturnType<typeof nodeGraphBounds>>) {
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

function onTileContext(event: MouseEvent, nodeId: string) {
  if (isReadOnly.value || event.button !== 2) return
  event.preventDefault()
  event.stopPropagation()
  if (!selectedNodes.value.includes(nodeId)) setSelectedNodes([nodeId])
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
function startMapTileGesture(event: PointerEvent, version: Version, nodeId: string) {
  if (isReadOnly.value) return
  state.value.activeId = version.id
  if (event.shiftKey) {
    startMapPan(event, version)
    return
  }
  startTreeDrag(event, version, nodeId)
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
function measureCanvas() {
  browserViewport.value = { width: window.innerWidth, height: window.innerHeight }
  if (graphCanvas.value) canvasSize.value = { width: graphCanvas.value.clientWidth, height: graphCanvas.value.clientHeight }
}
onMounted(() => {
  canvasObserver = new ResizeObserver(measureCanvas)
  if (graphCanvas.value) canvasObserver.observe(graphCanvas.value)
  measureCanvas()
  window.addEventListener('resize', measureCanvas)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointermove', moveTreeDrag)
  window.addEventListener('pointermove', moveMapPan)
  window.addEventListener('pointerup', finishTreeDrag)
  window.addEventListener('pointercancel', cancelTreeDrag)
  window.addEventListener('pointerup', endMapPan)
  presenceTimer = window.setInterval(expireRemoteUsers, 5000)
  void initializeCurrentRoom()
})
onUnmounted(() => {
  peerRoom.close()
  for (const versionId of mapViewTimers.keys()) commitMapView(versionId)
  stopGraphAnimations()
  window.clearTimeout(versionClickTimer)
  window.clearTimeout(tileClickTimer)
  window.clearTimeout(tileTooltipTimer)
  canvasObserver?.disconnect()
  window.removeEventListener('resize', measureCanvas)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', moveTreeDrag)
  window.removeEventListener('pointermove', moveMapPan)
  window.removeEventListener('pointerup', finishTreeDrag)
  window.removeEventListener('pointercancel', cancelTreeDrag)
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
  sessionStorage.setItem(clipboardStorageKey(currentRoomName.value), JSON.stringify(clipboard.value))
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
function onVersionMenu(version: Version, event: MouseEvent) {
  menu.value = { x: event.clientX, y: event.clientY, kind: 'version', versionId: version.id }
  selectedNode.value = null
  state.value.activeId = version.id
}

const cardModel: VersionCardModel = reactive({
  active,
  compareIds,
  compareMode,
  zoom,
  overNode,
  invalidNode,
  hoveredNode,
  selectedNodes,
  draggedSubtreeIds,
  draggedOriginalTile,
  windowDimensions,
  isReadOnly,
  versionTiles,
  duplicateValueLinks,
  displayCardPosition,
  cardHeight,
  versionAuthorColor,
  activeUsersFor,
  descendantsCount,
  isPreviewing,
  previewLabel,
  versionAction,
  cardData,
  mapViewport,
  mapTransform,
  tileStrokeColor,
  tileStrokeWidth,
  dragOverlayTiles,
  handleVersionClick,
  handleVersionDoubleClick,
  onVersionContext,
  onVersionMenu,
  startMapPan,
  zoomMap,
  startMapTileGesture,
  enterTile,
  moveTileTooltip,
  leaveTile,
  onTileClick,
  onTileDoubleClick,
  onTileContext,
  clientId: CLIENT_ID,
})
</script>

<template>
  <main class="app-shell" :class="{ dark: darkMode }" @click.capture="handleAppClickCapture" @wheel="onWheel">
    <div class="workspace" :inert="mergeMode && compareIds.length === 2">
      <WorkspaceSidebar :sidebar-collapsed="sidebarCollapsed" :dark-mode="darkMode" :current-room-name="currentRoomName"
        :room-status="roomStatus" :connected-users="connectedUsers" :client-id="CLIENT_ID" :versions="versions"
        :recent-interactions="recentInteractions" :branch-count="branchCount" :active="active"
        :active-nodes="activeNodes" :active-children="activeChildren"
        @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" @toggle-theme="darkMode = !darkMode"
        @change-room="roomDialogOpen = true" @copy-invite="copySessionInvite" @focus-collaborator="focusCollaborator"
        @focus-ping="focusPingLocation" @navigate="navigateInteraction" @focus-active="focusActive" />

      <section class="canvas-region">
        <div ref="graphCanvas" class="graph-canvas" :class="{ 'ping-mode': pingMode }" @contextmenu="onCanvasContext" @pointerdown.capture="handlePingPointer" @pointermove.capture="trackPingPointerMove" @pointerup.capture="clearPingPointer" @pointercancel.capture="clearPingPointer" @click.capture="handlePingClick" @click="onCanvasClick" @pointerdown="startCanvasPan" @pointermove="moveCanvasPan" @pointerup="endCanvasPan" @pointercancel="endCanvasPan">
          <div class="canvas-grid"></div>
          <div class="graph-world" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
            <VersionConnections :graph-bounds="graphBounds" :window-dimensions="windowDimensions" :versions="versions"
              :visible-versions="visibleVersions" :visible-connection-versions="visibleConnectionVersions"
              :visible-merge-connection-versions="visibleMergeConnectionVersions" :active-id="active.id"
              :connection-path="connectionPath" :connection-width="connectionWidth" :is-branch-curve="isBranchCurve"
              :merge-connection-path="mergeConnectionPath" :merge-connection-color="mergeConnectionColor"
              :card-position="cardPosition" :display-card-position="displayCardPosition" :card-height="cardHeight" :terminal-tail-end="terminalTailEnd"
              :connector-label-position="connectorLabelPosition" :merge-connector-label-position="mergeConnectorLabelPosition"
              :version-action="versionAction" />

            <VersionCard v-for="version in visibleVersions" :key="version.id" :version="version" :model="cardModel" />
            <svg class="copy-connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height">
              <g v-for="({ link, path }, index) in visibleCopyLinks" :key="`copy-${index}`" class="copy-link-group">
                <path :d="path" class="copy-link" fill="none" stroke="#cf7b32"
                  stroke-width="3" vector-effect="non-scaling-stroke" stroke-dasharray="7 4"
                  pointer-events="none" />
                <path :d="path" class="copy-link-hit" fill="none" stroke="transparent"
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
            <div class="canvas-hotbar" role="toolbar" aria-label="Quick actions">
            <button title="Create a free entry · N" aria-label="New free entry, N" @click="createFreeEntry"><Plus :size="16" /><span>New entry</span><kbd>N</kbd></button>
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

    <VersionComparison :model="comparisonModel" @confirm="confirmMerge" />

    <div v-if="menu" ref="contextMenuElement" class="context-menu" :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }" @click.stop>
      <template v-if="menu.kind === 'version'">
        <div class="context-title">{{ menu.versionId === 'v0' ? 'ROOT ACTIONS' : 'VERSION ACTIONS' }}</div>
        <button @click="addEntryToVersion(menu.versionId); menu = null"><Plus :size="15" /> Add Entry</button>
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
          <button v-if="selectedNodes.length >= 2" @click="openMergeEntries(); menu = null"><Layers3 :size="15" /> Merge selected entries</button>
          <button v-if="selectedNodes.length >= 2" class="danger-action" @click="openBulkDelete(); menu = null"><Trash2 :size="15" /> Delete selected entries</button>
          <button v-if="selectedNodes.length === 1 && selectedNodes[0] === menu.nodeId" @click="openSplitEntry(menu.nodeId!); menu = null"><GitBranch :size="15" /> Split entry</button>
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
    <EntryEditor v-if="editor" :editor="editor" :set-entry-value-input="setEntryValueInput"
      @close="editor = null" @commit="commitEditor" @add-row="addEditorEntryRow" @remove-row="removeEditorEntryRow" />
    <div v-if="bulkDeleteDialog" class="editor-scrim" @click.self="bulkDeleteDialog = false">
      <form class="entry-editor operation-editor" @submit.prevent="deleteSelectedEntries(bulkDeleteMode)">
        <div class="editor-heading"><span class="section-label">DELETE {{ selectedNodes.length }} SELECTED ENTRIES</span><button type="button" class="quiet-icon" title="Close" @click="bulkDeleteDialog = false"><X :size="17" /></button></div>
        <label class="editor-label" for="bulk-delete-mode">How should children be handled?</label>
        <select id="bulk-delete-mode" v-model="bulkDeleteMode">
          <option value="keep-children">Remove selected entries and keep children in their place</option>
          <option value="subtree">Delete selected entries and their descendants</option>
          <option value="detach-children">Remove selected entries and detach children to roots</option>
        </select>
        <p class="operation-note">The complete selection is applied as one new version.</p>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="bulkDeleteDialog = false">Cancel</button><button type="submit" class="primary-button danger-button"><Trash2 :size="15" /> Delete entries</button></div>
      </form>
    </div>
    <EntryOperationDialog v-if="entryOperation" :entry-operation="entryOperation" :data="active.data"
      @close="entryOperation = null" @commit="commitEntryOperation" @add-split="addSplitEntry" @remove-split="removeSplitEntry" />
    <RoomManager v-if="roomDialogOpen" v-model="newRoomName" :local-rooms="localRooms" :current-room-name="currentRoomName"
      @close="roomDialogOpen = false" @activate="activateRoom" @delete="deleteLocalRoom" @create="createRoomFromDialog" />
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