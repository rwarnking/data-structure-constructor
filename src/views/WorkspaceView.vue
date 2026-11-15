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
import { parseDataset, type Dataset } from '../services/dataset'
import VersionComparison from '../components/VersionComparison.vue'
import WorkspaceSidebar from '../components/WorkspaceSidebar.vue'
import VersionConnections from '../components/VersionConnections.vue'
import VersionCard from '../components/VersionCard.vue'
import type { VersionCardModel } from '../types/graph'
import { selectionColor, userColor, versionColor } from '../utils/colors'
import EntryEditor from '../components/EntryEditor.vue'
import EntryOperationDialog from '../components/EntryOperationDialog.vue'
import RoomManager from '../components/RoomManager.vue'
import VersionSearch from '../components/VersionSearch.vue'
import VersionTags from '../components/VersionTags.vue'
import StoryGuide from '../components/StoryGuide.vue'
import tutorial from '../content/tutorial.json'
import type { CopyLink, StoredState, Tile, TreeNode, Version, VersionTag } from '../types/workspace'
import { countNodes, findNode, findParent, flattenNodes, removeNode } from '../utils/tree'
import { duplicateLinks } from '../utils/duplicateLinks'
import { compareCopyLinks, displayVersionId, reflowVersionLayout } from '../utils/versions'
import { changedEntryIds } from '../utils/versionDifferences'
import { RootNotEmptyError } from '../utils/validation'
import { CARD_WIDTH, TREE_MAP_HEIGHT, tilesForForest, tileForNode } from '../utils/treemap'
import { shortcutAction, shortcutLabel } from '../config/hotkeys'
import { actionIcons, actionSymbols } from '../config/icons'
const { hierarchy: GitBranch, compare: GitCompareArrows, add: Plus, focus: Maximize,
  copy: Copy, delete: Trash2, previous: ChevronLeft, next: ChevronRight, edit: Pencil,
  detach: Unlink, close: X, layers: Layers3, paste: ClipboardPaste,
  ping: Radio, tutorial: TutorialIcon, tag: TagIcon } = actionIcons

type ClipboardEntry = { sourceVersionId: string; nodes: TreeNode[]; cut: boolean }
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
let initialRoomError = ''
let initialState: StoredState
try {
  initialState = readRoomState(currentRoomName.value, initialRooms.canMigrateLegacy)
} catch (error) {
  if (!(error instanceof RootNotEmptyError)) throw error
  initialRoomError = error.message
  initialState = structuredClone(seed)
}
const state = ref<StoredState>(initialState)
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
const searchOpen = ref(false)
const tutorialOpen = ref(false)
const tagsOpen = ref(false)
const tagVersionId = ref<string | null>(null)
const tagVersion = computed(() => tagVersionId.value ? versionsById.value.get(tagVersionId.value) : undefined)
function editTag(versionId?: string) {
  if (!versionId || !versionsById.value.has(versionId)) return
  tagVersionId.value = versionId
  tagsOpen.value = true
  menu.value = null
}
function saveTag(tag?: VersionTag) {
  const version = tagVersion.value
  if (!version) { notify('Version is no longer available'); tagsOpen.value = false; return }
  if (tag) version.tag = tag
  else delete version.tag
  logInteraction(tag ? `Tagged ${displayVersionId(version)}` : `Removed tag from ${displayVersionId(version)}`, { versionId: version.id })
  tagsOpen.value = false
  tagVersionId.value = null
}
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
const { versionArrival, cardPosition, cardHeight, rootLabelOffset, rootLabelX, displayCardPosition, graphBounds,
  visibleVersions, visibleConnectionVersions, visibleMergeConnectionVersions, stepPreset, fitGraph, fitHeight, focusNeighborhood,
  startCanvasPan, moveCanvasPan, endCanvasPan, onWheel, focusVersion, focusActive, animateCamera,
  stopGraphAnimations,
} = graphCamera

const treemapViews = useTreemapViews({ state, versions, windowDimensions, zoom, cardHeight, notify, suppressClicks: suppressGraphClicks })
const { mapViewTimers, cardData, cardPositions, mapViewport, mapViewFor,
  centerVersionTreemaps, compactVersionTreemaps, commitMapView, clearTransientMapViews, initializeMapViews,
  zoomMap, startMapPan, moveMapPan, endMapPan,
} = treemapViews
const selectionBox = ref<{ versionId: string; left: number; top: number; width: number; height: number } | null>(null)
let boxDrag: { versionId: string; pointerId: number; x: number; y: number; map: HTMLElement; initial: string[] } | null = null
function startMapGesture(event: PointerEvent, version: Version) {
  if ((event.ctrlKey || event.metaKey) && event.button === 0 && !isReadOnly.value
    && !(event.target as Element).closest('.tree-tile')) {
    event.preventDefault()
    event.stopPropagation()
    const map = event.currentTarget as HTMLElement
    const initial = event.shiftKey && version.id === active.value.id ? [...selectedNodes.value] : []
    state.value.activeId = version.id
    boxDrag = { versionId: version.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      map, initial }
    map.setPointerCapture(event.pointerId)
    return
  }
  startMapPan(event, version)
}
function moveBoxSelection(event: PointerEvent) {
  const drag = boxDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  const rect = drag.map.getBoundingClientRect()
  const left = Math.max(rect.left, Math.min(drag.x, event.clientX))
  const right = Math.min(rect.right, Math.max(drag.x, event.clientX))
  const top = Math.max(rect.top, Math.min(drag.y, event.clientY))
  const bottom = Math.min(rect.bottom, Math.max(drag.y, event.clientY))
  selectionBox.value = { versionId: drag.versionId, left: (left - rect.left) / rect.width * 100,
    top: (top - rect.top) / rect.height * 100, width: Math.max(0, right - left) / rect.width * 100,
    height: Math.max(0, bottom - top) / rect.height * 100 }
}
function endBoxSelection(event: PointerEvent, cancel = false) {
  const drag = boxDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  if (!cancel && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) {
    const rect = drag.map.getBoundingClientRect()
    const left = Math.max(rect.left, Math.min(drag.x, event.clientX))
    const right = Math.min(rect.right, Math.max(drag.x, event.clientX))
    const top = Math.max(rect.top, Math.min(drag.y, event.clientY))
    const bottom = Math.min(rect.bottom, Math.max(drag.y, event.clientY))
    const selected = [...drag.map.querySelectorAll<SVGRectElement>('.tree-tile')].filter((tile) => {
      const bounds = tile.getBoundingClientRect()
      return bounds.left <= right && bounds.right >= left && bounds.top <= bottom && bounds.bottom >= top
    }).map((tile) => tile.dataset.node).filter((id): id is string => !!id)
    setSelectedNodes([...new Set([...drag.initial, ...selected])])
    suppressGraphClicks()
  }
  boxDrag = null
  selectionBox.value = null
}
function cancelBoxSelection(event: PointerEvent) { endBoxSelection(event, true) }

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
  addEntry, addChildren, addParent, commitEditor, renameEntry, addEditorEntryRow, removeEditorEntryRow, deleteEntry,
  deleteSelectedEntries, openBulkDelete, openMergeEntries, openSplitEntry, addSplitEntry,
  removeSplitEntry, commitEntryOperation, detachEntry, canAttach, attachEntry,
} = useHierarchyEditor({ clientId: CLIENT_ID, state, active, selectedNodes, isReadOnly, createVersion, setSelectedNodes, notify })

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
} = useTreeDrag({ state, versions, active, zoom, isReadOnly, selectedNodes, hoveredNode, entryTooltip, mapViewFor, mapViewport,
  canAttach, attachEntry, detachEntry, createVersion, setSelectedNodes, notify, suppressClicks: suppressGraphClicks })

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
  let nextState: StoredState
  try { nextState = createEmpty ? clone(seed) : readRoomState(name) }
  catch (error) {
    if (!(error instanceof RootNotEmptyError)) throw error
    notify(`Cannot open room "${name}": ${error.message}`)
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
  if (isLocalOnlyRoom(name)) roomStatus.value = { state: 'idle', peers: 1, message: 'Local only' }
  else await connectAutomatically(name)
}

function localOnlyRoomKey(room: string) { return `canopy-local-only-${encodeURIComponent(room)}` }
function isLocalOnlyRoom(room: string) { return localStorage.getItem(localOnlyRoomKey(room)) === 'true' }

function exportData() {
  const dataset: Dataset = { format: 'canopy-dataset', version: 1, room: currentRoomName.value,
    state: clone(state.value), interactions: clone(recentInteractions.value) }
  const url = URL.createObjectURL(new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `canopy-${currentRoomName.value.replace(/[\\/:*?"<>|]/g, '_')}.json`
  link.click()
  URL.revokeObjectURL(url)
}

async function importData(file: File) {
  let dataset: Dataset
  try { dataset = parseDataset(JSON.parse(await file.text()) as unknown) }
  catch (error) { notify(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed'); return }
  const base = dataset.room.trim()
  let name = base
  let suffix = 0
  while (localRooms.value.includes(name) || localStorage.getItem(roomDataKey(name)) !== null
    || localStorage.getItem(localOnlyRoomKey(name)) !== null) {
    const tail = `_${++suffix}`
    name = `${base.slice(0, 80 - tail.length)}${tail}`
  }
  try {
    localStorage.setItem(roomDataKey(name), JSON.stringify(dataset.state))
    localStorage.setItem(interactionStorageKey(name), JSON.stringify(dataset.interactions))
    localStorage.setItem(localOnlyRoomKey(name), 'true')
  } catch (error) {
    localStorage.removeItem(roomDataKey(name))
    localStorage.removeItem(interactionStorageKey(name))
    localStorage.removeItem(localOnlyRoomKey(name))
    notify(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed')
    return
  }
  await activateRoom(name)
  notify(`Imported into local room "${name}"`)
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
  localStorage.removeItem(localOnlyRoomKey(room))
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

function switchFromBlockedRoom(room: string) {
  const name = room.trim()
  if (!name || name.length > 80) return
  const url = new URL(location.href)
  url.searchParams.set('room', name)
  location.assign(url.toString())
}

async function initializeCurrentRoom() {
  initializeCollaborationMetadata(currentRoomName.value)
  localStorage.setItem(roomDataKey(currentRoomName.value), JSON.stringify(state.value))
  reflowLayout()
  await nextTick(initializeMapViews)
  requestAnimationFrame(() => fitGraph())
  if (isLocalOnlyRoom(currentRoomName.value)) roomStatus.value = { state: 'idle', peers: 1, message: 'Local only' }
  else await connectAutomatically(currentRoomName.value)
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
    const stored = JSON.parse(sessionStorage.getItem(clipboardStorageKey(room)) ?? 'null') as ClipboardEntry | { sourceVersionId: string; node: TreeNode } | TreeNode | null
    if (!stored) return null
    if ('nodes' in stored) return stored
    if ('node' in stored) return { sourceVersionId: stored.sourceVersionId, nodes: [stored.node], cut: false }
    return { sourceVersionId: state.value.activeId, nodes: [stored], cut: false }
  }
  catch { console.warn(`Could not load clipboard for room "${room}"`); return null }
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
  if (suppressVersionClick) {
    suppressVersionClick = false
    return
  }
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
  const sameVersion = version.id === active.value.id
  window.clearTimeout(tileClickTimer)
  tileClickTimer = window.setTimeout(() => {
    state.value.activeId = version.id
    if (isReadOnly.value) {
      setSelectedNodes([])
    } else if (sameVersion && (additive || selectedNodes.value.includes(nodeId))) {
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
const visibleLanes = computed(() => {
  const lanes = new Map<number, Version[]>()
  for (const version of versions.value) {
    if (version.id === 'v0') continue
    const lane = lanes.get(version.lane) ?? []
    lane.push(version)
    lanes.set(version.lane, lane)
  }
  return [...lanes].map(([lane, items]) => {
    items.sort((a, b) => a.step - b.step || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    const top = pan.value.y + cardPosition(items[0]!).y * zoom.value
    const bottom = top + windowDimensions.value.height * zoom.value
    const visibleTop = Math.max(0, top)
    const visibleBottom = Math.min(canvasSize.value.height, bottom)
    return { lane, first: items[0]!, last: items[items.length - 1]!, top: visibleTop, height: visibleBottom - visibleTop }
  }).filter((lane) => lane.height > 0)
})
function navigateLane(version: Version) {
  const position = cardPosition(version)
  animateCamera(zoom.value, {
    x: canvasSize.value.width / 2 - (position.x + windowDimensions.value.width / 2) * zoom.value,
    y: pan.value.y,
  })
}

function connectionPath(version: Version) {
  const parent = version.parentId ? versionsById.value.get(version.parentId) : undefined
  if (!parent) return ''
  return versionConnectionPath(parent, version)
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
function mergeConnectionColor(version: Version) {
  const source = version.mergeSourceId ? versionsById.value.get(version.mergeSourceId) : undefined
  return versionColor(source ?? version)
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
  return author ? userColor(author) : 'var(--theme-branch-root)'
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
function tileSelectionColor(versionId: string, nodeId: string) {
  return tileSelectionHighlights(versionId, nodeId)[0]?.color
}
const changedEntries = computed(() => new Map(visibleVersions.value.map((version) => [
  version.id, changedEntryIds(version, version.parentId ? versionsById.value.get(version.parentId) : undefined),
])))
function descendantsCount(nodes: TreeNode[]) { return countNodes(nodes) }
function versionAction(version: Version) {
  const previous = version.parentId ? versionsById.value.get(version.parentId) : undefined
  if (!previous) return { label: 'root', symbol: actionSymbols.root }
  if (version.mergeSourceId || /^Merge \d+ entries into /.test(version.change)) {
    return { label: 'merge', symbol: actionSymbols.merge }
  }
  if (/^Split .+ into \d+ entries$/.test(version.change)) {
    return { label: 'split', symbol: actionSymbols.split }
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
  if (added && !removed && !renamed && !modified) return { label: 'add', symbol: actionSymbols.add }
  if (removed && !added && !renamed && !modified) return { label: 'delete', symbol: actionSymbols.delete }
  if (moved.length && !added && !removed && !renamed && !modified) {
    const item = moved[0]!
    const oldParent = before.get(item[0])!.parentId
    if (oldParent === null) return { label: 'attach', symbol: actionSymbols.attach }
    if (item[1].parentId === null) return { label: 'detach', symbol: actionSymbols.detach }
    return { label: 'move', symbol: actionSymbols.move }
  }
  if ((renamed || modified) && !added && !removed && !moved.length) {
    return renamed === 1 && modified === 0 ? { label: 'rename', symbol: actionSymbols.rename } : { label: 'modify', symbol: actionSymbols.modify }
  }
  return { label: 'modify', symbol: actionSymbols.modify }
}
function cardMapView(version: Version) {
  const layout = version.id === active.value.id ? previewLayout.value : null
  return layout?.view ?? mapViewFor(version)
}
function mapTransform(version: Version) {
  const view = cardMapView(version)
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
    result.set(version.id, duplicateLinks(cardData(version), versionTiles.value.get(version.id) ?? []))
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
function nodeGraphBounds(versionId: string, nodeId: string, tileIndex?: Map<string, Tile>) {
  const version = versionsById.value.get(versionId)
  if (!version) return null
  const view = mapViewFor(version)
  const viewport = mapViewport(version)
  const mapWidth = version.id === 'v0' ? windowDimensions.value.width - 2 : windowDimensions.value.width - 12
  const mapHeight = version.id === 'v0' ? cardHeight(version) - 2 : cardHeight(version) - 47
  const scaleX = mapWidth / viewport.width
  const scaleY = mapHeight / viewport.height
  const tile = tileIndex ? tileIndex.get(nodeId) : tileForNode(version.data, version.positions, nodeId)
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
const copyLinksWithBounds = computed(() => {
  const counts = new Map<string, number>()
  for (const link of state.value.copyLinks) {
    for (const id of [link.sourceVersionId, link.targetVersionId]) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const indexes = new Map<string, Map<string, Tile>>()
  function endpoint(versionId: string, nodeId: string) {
    const version = versionsById.value.get(versionId)
    if (!version) return null
    let index = indexes.get(versionId)
    if (!index && counts.get(versionId)! > 1) {
      index = new Map(tilesForForest(version.data, version.positions).map((tile) => [tile.id, tile]))
      indexes.set(versionId, index)
    }
    return nodeGraphBounds(versionId, nodeId, index)
  }
  return state.value.copyLinks.flatMap((link) => {
    const source = endpoint(link.sourceVersionId, link.sourceNodeId)
    const target = endpoint(link.targetVersionId, link.targetNodeId)
    return source && target ? [{ link, source, target, path: copyLinkPath(source, target) }] : []
  })
})
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
  if (isReadOnly.value || compareMode.value || mergeMode.value) return
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
    if (shortcutAction(event) === 'dismiss') {
      event.preventDefault()
      closeVersionSelection()
    }
    return
  }
  const target = event.target
  if (target instanceof Element && (target.closest('input, textarea, select, [role="textbox"]')
    || target instanceof HTMLElement && target.isContentEditable)) return
  const action = shortcutAction(event)
  if (!action) return
  if ((action === 'addChild' || action === 'detach') && !selectedNode.value) return
  if ((action === 'copy' || action === 'cut') && !selectedNodes.value.length) return
  event.preventDefault()
  switch (action) {
    case 'search': searchOpen.value = true; break
    case 'ping': pingMode.value = !pingMode.value; break
    case 'merge': if (mergeMode.value) closeVersionSelection(); else startVersionSelection('merge', active.value.id); break
    case 'previous': navigateVersion('left'); break
    case 'next': navigateVersion('right'); break
    case 'up': navigateVersion('up'); break
    case 'down': navigateVersion('down'); break
    case 'newEntry': createFreeEntry(); break
    case 'addChild': addChildren(); break
    case 'detach': if (selectedNode.value) detachEntry(selectedNode.value); break
    case 'compare': if (compareMode.value) closeVersionSelection(); else startVersionSelection('compare', active.value.id); break
    case 'focus': focusActive(); break
    case 'fitAll': fitGraph(); break
    case 'zoomIn': stepPreset(1); break
    case 'zoomOut': stepPreset(-1); break
    case 'selectAll': setSelectedNodes([...flattenNodes(active.value.data).keys()]); break
    case 'copy': case 'cut': copyEntries(selectedNodes.value, action === 'cut'); break
    case 'paste': pasteEntry(); break
    case 'dismiss': searchOpen.value = false; menu.value = null; closeVersionSelection(); pingMode.value = false; break
  }
}
function measureCanvas() {
  browserViewport.value = { width: window.innerWidth, height: window.innerHeight }
  if (graphCanvas.value) canvasSize.value = { width: graphCanvas.value.clientWidth, height: graphCanvas.value.clientHeight }
}
onMounted(() => {
  if (initialRoomError) return
  canvasObserver = new ResizeObserver(measureCanvas)
  if (graphCanvas.value) canvasObserver.observe(graphCanvas.value)
  measureCanvas()
  window.addEventListener('resize', measureCanvas)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointermove', moveTreeDrag)
  window.addEventListener('pointermove', moveMapPan)
  window.addEventListener('pointermove', moveBoxSelection)
  window.addEventListener('pointerup', finishTreeDrag)
  window.addEventListener('pointercancel', cancelTreeDrag)
  window.addEventListener('pointerup', endMapPan)
  window.addEventListener('pointerup', endBoxSelection)
  window.addEventListener('pointercancel', cancelBoxSelection)
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
  window.removeEventListener('pointermove', moveBoxSelection)
  window.removeEventListener('pointerup', finishTreeDrag)
  window.removeEventListener('pointercancel', cancelTreeDrag)
  window.removeEventListener('pointerup', endMapPan)
  window.removeEventListener('pointerup', endBoxSelection)
  window.removeEventListener('pointercancel', cancelBoxSelection)
  window.clearInterval(presenceTimer)
})

function createFreeEntry() { addEntry() }
function addEntryToVersion(versionId?: string) {
  if (versionId) state.value.activeId = versionId
  addEntry()
}
function copyEntry(nodeId: string) {
  copyEntries([nodeId], false)
}
function copyEntries(nodeIds: string[], cut: boolean) {
  const flat = flattenNodes(active.value.data)
  const selected = new Set(nodeIds.filter((id) => flat.has(id)))
  const nodes = [...flat].filter(([id, item]) => {
    if (!selected.has(id)) return false
    let parentId = item.parentId
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = flat.get(parentId)?.parentId ?? null
    }
    return true
  }).map(([, item]) => clone(item.node))
  if (!nodes.length) return
  clipboard.value = { sourceVersionId: active.value.id, nodes, cut }
  sessionStorage.setItem(clipboardStorageKey(currentRoomName.value), JSON.stringify(clipboard.value))
  const label = nodes.length === 1 ? nodes[0]!.value : `${nodes.length} entry subtrees`
  logInteraction(`${cut ? 'Cut' : 'Copied'} ${label}`, { versionId: active.value.id, nodeId: nodes[0]!.id, nodeLabel: nodes[0]!.value })
  notify(`${cut ? 'Cut' : 'Copied'} ${label}`)
}
function pasteEntry() {
  if (!clipboard.value) return
  if (isReadOnly.value) {
    notify('Zoom in to paste entries')
    return
  }
  const copied = clone(clipboard.value)
  const source = versionsById.value.get(copied.sourceVersionId)
  if (copied.cut && (!source || copied.nodes.some((node) => !findNode(source.data, node.id)))) {
    notify('Cannot cut: the source version or entry is no longer available')
    return
  }
  if (copied.cut && source?.id === active.value.id) {
    notify('Choose another version before pasting cut entries')
    return
  }
  const rekey = (node: TreeNode): TreeNode => ({ ...node, id: `n${state.value.nextNode++}-${CLIENT_ID}`, children: node.children.map(rekey) })
  const newNodes = copied.nodes.map(rekey)
  const label = newNodes.length === 1 ? newNodes[0]!.value : `${newNodes.length} entries`
  const version = createVersion([...clone(active.value.data), ...newNodes], `Paste ${label}`, true)
  if (!version) return
  if (source) {
    state.value.copyLinks = [...state.value.copyLinks, ...copied.nodes.map((node, index) => ({
      sourceVersionId: source.id, sourceNodeId: node.id,
      targetVersionId: version.id, targetNodeId: newNodes[index]!.id,
    }))].sort(compareCopyLinks)
  }
  if (copied.cut && source) {
    const sourceData = clone(source.data)
    for (const node of copied.nodes) removeNode(sourceData, node.id)
    state.value.activeId = source.id
    const removal = createVersion(sourceData, `Cut ${label}`, true)
    if (!removal) {
      state.value.activeId = version.id
      notify('Copied entries, but could not create the cut source version')
      return
    }
    state.value.activeId = version.id
    graphCamera.panToVersion(version, false)
    clipboard.value = null
    sessionStorage.removeItem(clipboardStorageKey(currentRoomName.value))
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
  selectionBox,
  windowDimensions,
  isReadOnly,
  versionTiles,
  duplicateValueLinks,
  displayCardPosition,
  cardHeight,
  rootLabelOffset,
  rootLabelX,
  versionAuthorColor,
  activeUsersFor,
  descendantsCount,
  isPreviewing,
  previewLabel,
  versionAction,
  cardData,
  mapViewport,
  cardMapView,
  mapTransform,
  changedEntries,
  tileSelectionColor,
  dragOverlayTiles,
  handleVersionClick,
  handleVersionDoubleClick,
  onVersionContext,
  onVersionMenu,
  startMapPan: startMapGesture,
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
  <main v-if="initialRoomError" class="app-shell blocked-room" :class="{ dark: darkMode }">
    <section class="entry-editor" role="alert">
      <h1>Cannot open room "{{ currentRoomName }}"</h1>
      <p>{{ initialRoomError }}. The saved room data has not been changed.</p>
      <button type="button" class="primary-button" @click="roomDialogOpen = true">Choose another room</button>
    </section>
    <RoomManager v-if="roomDialogOpen" v-model="newRoomName" :local-rooms="localRooms" :current-room-name="currentRoomName"
      @close="roomDialogOpen = false" @activate="switchFromBlockedRoom" @delete="deleteLocalRoom" @create="switchFromBlockedRoom(newRoomName)" />
  </main>
  <main v-else class="app-shell" :class="{ dark: darkMode }" @click.capture="handleAppClickCapture">
    <div class="workspace" :inert="mergeMode && compareIds.length === 2">
      <WorkspaceSidebar :sidebar-collapsed="sidebarCollapsed" :dark-mode="darkMode" :current-room-name="currentRoomName"
        :room-status="roomStatus" :local-only="isLocalOnlyRoom(currentRoomName)" :connected-users="connectedUsers" :client-id="CLIENT_ID" :versions="versions"
        :recent-interactions="recentInteractions" :branch-count="branchCount" :active="active"
        :active-nodes="activeNodes" :active-children="activeChildren"
        @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" @toggle-theme="darkMode = !darkMode"
        @change-room="roomDialogOpen = true" @copy-invite="copySessionInvite" @focus-collaborator="focusCollaborator"
        @focus-ping="focusPingLocation" @navigate="navigateInteraction" @focus-active="focusActive"
        @import-data="importData" @export-data="exportData" @show-tags="tagVersionId = null; tagsOpen = true" />

      <section class="canvas-region">
        <div ref="graphCanvas" class="graph-canvas" :class="{ 'ping-mode': pingMode }" @wheel="onWheel" @contextmenu="onCanvasContext" @pointerdown.capture="handlePingPointer" @pointermove.capture="trackPingPointerMove" @pointerup.capture="clearPingPointer" @pointercancel.capture="clearPingPointer" @click.capture="handlePingClick" @click="onCanvasClick" @pointerdown="startCanvasPan" @pointermove="moveCanvasPan" @pointerup="endCanvasPan" @pointercancel="endCanvasPan">
          <div class="canvas-grid"></div>
          <button type="button" class="tutorial-button quiet-icon" aria-label="Open tutorial" title="Open tutorial"
            @pointerdown.stop @click.stop="tutorialOpen = true"><TutorialIcon :size="21" /></button>
          <div class="graph-world" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
            <VersionConnections :graph-bounds="graphBounds" :window-dimensions="windowDimensions" :versions="versions"
              :visible-versions="visibleVersions" :visible-connection-versions="visibleConnectionVersions"
              :visible-merge-connection-versions="visibleMergeConnectionVersions" :active-id="active.id"
              :connection-path="connectionPath" :connection-width="connectionWidth"
              :merge-connection-path="mergeConnectionPath" :merge-connection-color="mergeConnectionColor"
              :card-position="cardPosition" :display-card-position="displayCardPosition" :card-height="cardHeight" :terminal-tail-end="terminalTailEnd"
              :arriving-version-id="versionArrival?.versionId" />

            <VersionCard v-for="version in visibleVersions" :key="version.id" :version="version" :model="cardModel" />
            <svg class="copy-connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height">
              <g v-for="({ link, path }, index) in visibleCopyLinks" :key="`copy-${index}`" class="copy-link-group">
                <path :d="path" class="copy-link" fill="none" stroke="var(--theme-copy-connector)"
                  stroke-width="3" vector-effect="non-scaling-stroke" stroke-dasharray="7 4"
                  pointer-events="none" />
                <path :d="path" class="copy-link-hit" fill="none" stroke="transparent"
                  stroke-width="8" vector-effect="non-scaling-stroke" pointer-events="stroke"
                  role="button" tabindex="0"
                  :aria-label="`Copied entry connection from ${displayVersionId(versionsById.get(link.sourceVersionId)!)} to ${displayVersionId(versionsById.get(link.targetVersionId)!)}. Click to switch versions.`"
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

          <template v-for="lane in visibleLanes" :key="lane.lane">
            <button type="button" class="lane-navigation lane-navigation-left" :class="{ 'active-lane': active.id !== 'v0' && active.lane === lane.lane }" :data-lane="lane.lane"
              :aria-label="`Go to beginning of lane ${lane.lane + 1}`" title="Go to beginning of lane"
              :style="{ top: `${lane.top}px`, height: `${lane.height}px`, '--lane-color': versionColor(lane.first), '--user-color': userColor(CLIENT_ID) }"
              @pointerdown.stop @click.stop="navigateLane(lane.first)"><ChevronLeft :size="Math.min(18, lane.height)" /></button>
            <button type="button" class="lane-navigation lane-navigation-right" :class="{ 'active-lane': active.id !== 'v0' && active.lane === lane.lane }" :data-lane="lane.lane"
              :aria-label="`Go to end of lane ${lane.lane + 1}`" title="Go to end of lane"
              :style="{ top: `${lane.top}px`, height: `${lane.height}px`, '--lane-color': versionColor(lane.last), '--user-color': userColor(CLIENT_ID) }"
              @pointerdown.stop @click.stop="navigateLane(lane.last)"><ChevronRight :size="Math.min(18, lane.height)" /></button>
          </template>

          <div class="canvas-controls" @pointerdown.stop @click.stop @wheel.stop>
            <div v-if="pingMode" class="ping-mode-banner" role="status">PING MODE · Click to place a ping · Press {{ shortcutLabel('ping') }} or {{ shortcutLabel('dismiss') }} to exit</div>
            <div class="canvas-hotbar" role="toolbar" aria-label="Quick actions">
            <button data-action="new-entry" :title="`Create a free entry · ${shortcutLabel('newEntry')}`" :aria-label="`New free entry, ${shortcutLabel('newEntry', true)}`" @click="createFreeEntry"><Plus :size="16" /><span>New entry</span><kbd>{{ shortcutLabel('newEntry') }}</kbd></button>
            <button :title="`Add a child to selected entries · ${shortcutLabel('addChild')}`" :aria-label="`Add child, ${shortcutLabel('addChild', true)}`" :disabled="isReadOnly || !selectedNode" @click="addChildren"><GitBranch :size="16" /><span>Add child</span><kbd>{{ shortcutLabel('addChild') }}</kbd></button>
            <button :title="`Detach the selected entry · ${shortcutLabel('detach')}`" :aria-label="`Detach selected, ${shortcutLabel('detach', true)}`" :disabled="isReadOnly || !selectedNode" @click="selectedNode && detachEntry(selectedNode)"><Unlink :size="16" /><span>Detach</span><kbd>{{ shortcutLabel('detach') }}</kbd></button>
            <button :title="`Compare two versions · ${shortcutLabel('compare')}`" :aria-label="`Compare versions, ${shortcutLabel('compare', true)}`" :class="{ selected: compareMode }" @click="compareMode ? closeVersionSelection() : startVersionSelection('compare', active.id)"><GitCompareArrows :size="16" /><span>Compare</span><kbd>{{ shortcutLabel('compare') }}</kbd></button>
            <button :title="`Merge two versions · ${shortcutLabel('merge')}`" :aria-label="`Merge versions, ${shortcutLabel('merge', true)}`" :class="{ selected: mergeMode }" @click="mergeMode ? closeVersionSelection() : startVersionSelection('merge', active.id)"><GitCompareArrows :size="16" /><span>Merge</span><kbd>{{ shortcutLabel('merge') }}</kbd></button>
            <button :title="`Focus the active version · ${shortcutLabel('focus')}`" :aria-label="`Focus active version, ${shortcutLabel('focus', true)}`" @click="focusActive"><Maximize :size="16" /><span>Focus</span><kbd>{{ shortcutLabel('focus') }}</kbd></button>
            <button title="Focus the active version and its neighbors" aria-label="Focus neighborhood" @click="focusNeighborhood()"><GitBranch :size="16" /><span>Neighborhood</span></button>
            <button title="Fit all lanes vertically" aria-label="Fit height" @click="fitHeight()"><Maximize :size="16" /><span>Fit height</span></button>
            <button :title="`Fit all versions in view · ${shortcutLabel('fitAll')}`" :aria-label="`Fit all versions, ${shortcutLabel('fitAll', true)}`" @click="fitGraph()"><Layers3 :size="16" /><span>Fit all</span><kbd>{{ shortcutLabel('fitAll') }}</kbd></button>
            <button :title="`Toggle Ping Mode · ${shortcutLabel('ping')}`" :aria-label="`Toggle Ping Mode, ${shortcutLabel('ping', true)}`" :aria-pressed="pingMode" :class="{ selected: pingMode }" @click="pingMode = !pingMode"><Radio :size="16" /><span>{{ pingMode ? 'Ping mode on' : 'Ping' }}</span><kbd>{{ shortcutLabel('ping') }}</kbd></button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <VersionComparison :model="comparisonModel" :versions="versions" @confirm="confirmMerge" />

    <div v-if="menu" ref="contextMenuElement" class="context-menu" :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }" @click.stop>
      <template v-if="menu.kind === 'version'">
        <div class="context-title">{{ menu.versionId === 'v0' ? 'ROOT ACTIONS' : 'VERSION ACTIONS' }}</div>
        <button @click="addEntryToVersion(menu.versionId); menu = null"><Plus :size="15" /> Add Entry</button>
        <button @click="editTag(menu.versionId)"><TagIcon :size="15" /> {{ versionsById.get(menu.versionId!)?.tag ? 'Edit tag' : 'Add tag' }}</button>
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
          <button @click="addChildren(); menu = null"><Plus :size="15" /> Add child</button>
          <button @click="addParent(); menu = null"><GitBranch :size="15" /> Add parent</button>
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
    <VersionSearch v-if="searchOpen" :versions="versions" @close="searchOpen = false"
      @focus="activateAndFocusVersion($event); searchOpen = false" />
    <VersionTags v-if="tagsOpen" :versions="versions" :editing="tagVersion"
      @close="tagsOpen = false; tagVersionId = null" @save="saveTag($event)" @remove="saveTag()"
      @focus="activateAndFocusVersion($event); tagsOpen = false" />
    <StoryGuide v-if="tutorialOpen" :story="tutorial" @close="tutorialOpen = false" />
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