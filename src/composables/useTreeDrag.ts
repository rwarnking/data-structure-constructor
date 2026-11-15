import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { MapView, SpatialPreview, StoredState, TreeNode, Version } from '../types/workspace'
import { descendants, findNode, findParent, removeNode } from '../utils/tree'
import { CARD_WIDTH, TREE_MAP_HEIGHT, defaultPositions, fitMapViewToLayout, nearestPositionIsFree, outerTreemapDimensions, positionsForData, tileForNode, tilesForForest } from '../utils/treemap'

export function useTreeDrag(options: {
  state: Ref<StoredState>; versions: ComputedRef<Version[]>; active: ComputedRef<Version>
  zoom: Ref<number>; isReadOnly: ComputedRef<boolean>; selectedNodes: Ref<string[]>
  hoveredNode: Ref<{ versionId: string; nodeId: string } | null>
  entryTooltip: Ref<{ versionId: string; nodeId: string; description: string; x: number; y: number } | null>
  mapViewFor: (version: Version) => MapView
  mapViewport: (version: Version) => { width: number; height: number }
  canAttach: (source: string, target: string, data?: TreeNode[]) => boolean
  attachEntry: (source: string, target: string, preview?: { data: TreeNode[]; positions: Record<string, { x: number; y: number }>; view: MapView }) => Version | null
  detachEntry: (id: string, preview?: SpatialPreview) => Version | null
  createVersion: (data: TreeNode[], change: string, forceNew?: boolean) => Version | null
  setSelectedNodes: (ids: string[]) => void; notify: (message: string) => void; suppressClicks: () => void
}) {
  const { state, versions, active, zoom, isReadOnly, selectedNodes, hoveredNode, entryTooltip, mapViewFor, mapViewport,
    canAttach, attachEntry, detachEntry, createVersion, setSelectedNodes, notify, suppressClicks } = options
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const draggedNode = ref<string | null>(null)
  const draggedPosition = ref<{ x: number; y: number } | null>(null)
  const dragPreviewView = ref<MapView | null>(null)
  const overNode = ref<string | null>(null)
  const invalidNode = ref<string | null>(null)
  const treeDrag = ref<{
    id: string
    ids: string[]
    selection: string[]
    versionId: string
    pointerId: number
    x: number
    y: number
    lastX: number
    lastY: number
    moved: boolean
    space?: {
      grabX: number
      grabY: number
      width: number
      height: number
    }
  } | null>(null)
  const spatialPreview = ref<SpatialPreview | null>(null)
  const previewLayout = computed(() => {
    if (!draggedNode.value) return null
    const ids = treeDrag.value?.ids ?? [draggedNode.value]
    if (overNode.value && ids.every((id) => canAttach(id, overNode.value!))) {
      const data = clone(active.value.data)
      if (ids.every((id) => findParent(data, id)?.id === overNode.value)) return null
      const sources = ids.map((id) => removeNode(data, id))
      const target = findNode(data, overNode.value)
      if (sources.some((source) => !source) || !target) return null
      target.children.push(...sources.filter((source): source is TreeNode => !!source))
      const positions = positionsForData(active.value.data, data, active.value.positions)
      return {
        data,
        positions,
        view: fitMapViewToLayout(data, positions, mapViewFor(active.value), 0),
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

  const draggedSubtreeIds = computed(() => {
    if (!draggedNode.value) return []
    return (treeDrag.value?.ids ?? [draggedNode.value]).flatMap((id) => {
      const node = findNode(active.value.data, id)
      return node ? descendants(node) : []
    })
  })
  const draggedOriginalTile = computed(() => {
    if (!draggedNode.value) return null
    return tileForNode(active.value.data, active.value.positions, draggedNode.value) ?? null
  })
  function positionAt(version: Version, clientX: number, clientY: number, map: HTMLElement) {
    const drag = treeDrag.value
    const rect = map.getBoundingClientRect()
    const view = previewLayout.value?.view ?? mapViewFor(version)
    const viewport = mapViewport(version)
    const localX = (clientX - rect.left) / zoom.value * viewport.width / (rect.width / zoom.value)
    const localY = (clientY - rect.top) / zoom.value * viewport.height / (rect.height / zoom.value)
    if (!drag?.space) {
      const x = (localX - view.panX) / view.zoom
      const y = (localY - view.panY) / view.zoom
      return {
        x: x / CARD_WIDTH,
        y: y / TREE_MAP_HEIGHT,
      }
    }
    const pointerX = (localX - view.panX) / view.zoom
    const pointerY = (localY - view.panY) / view.zoom
    return {
      x: (pointerX - drag.space.grabX * drag.space.width) / CARD_WIDTH,
      y: (pointerY - drag.space.grabY * drag.space.height) / TREE_MAP_HEIGHT,
    }
  }
  function treeNodeAt(clientX: number, clientY: number, map: HTMLElement) {
    const versionId = map.closest('.version-card')?.getAttribute('data-version')
    if (versionId !== active.value.id) return null
    if (overNode.value) {
      const currentTarget = [...map.querySelectorAll<SVGRectElement>('.tree-tile')]
        .find((tile) => tile.dataset.node === overNode.value)
      const bounds = currentTarget?.getBoundingClientRect()
      if (bounds && clientX >= bounds.left && clientX <= bounds.right
        && clientY >= bounds.top && clientY <= bounds.bottom) return overNode.value
    }
    const rect = map.getBoundingClientRect()
    const view = previewLayout.value?.view ?? mapViewFor(active.value)
    const viewport = mapViewport(active.value)
    const localX = (clientX - rect.left) / zoom.value * viewport.width / (rect.width / zoom.value)
    const localY = (clientY - rect.top) / zoom.value * viewport.height / (rect.height / zoom.value)
    const x = (localX - view.panX) / view.zoom
    const y = (localY - view.panY) / view.zoom
    const tiles = tilesForForest(active.value.data, active.value.positions)
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
    data = version.data,
    positions = version.positions,
    sizeOverride?: { width: number; height: number },
    occupiedData = data,
    occupiedPositions = positions,
  ) {
    const node = findNode(data, nodeId)
    if (!node || !data.some((root) => root.id === nodeId)) return false
    const candidatePositions = { ...positions, [nodeId]: position }
    const view = fitMapViewToLayout(data, candidatePositions, mapViewFor(version), 0)
    const size = sizeOverride ?? outerTreemapDimensions(node)
    const left = position.x * CARD_WIDTH
    const top = position.y * TREE_MAP_HEIGHT
    const bounds = {
      left: -view.panX / view.zoom,
      top: -view.panY / view.zoom,
      right: (mapViewport(version).width - view.panX) / view.zoom,
      bottom: (mapViewport(version).height - view.panY) / view.zoom,
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
      view: valid ? fitMapViewToLayout(nextData, positions, mapViewFor(version), 0) : mapViewFor(version),
    }
  }
  function groupDropLayout(version: Version, ids: string[], anchorId: string, position: { x: number; y: number }): SpatialPreview {
    const originalPositions = { ...defaultPositions(version.data, version.positions), ...version.positions }
    const anchor = tileForNode(version.data, originalPositions, anchorId)
    const data = clone(version.data)
    const positions = { ...originalPositions }
    const deltaX = anchor ? position.x * CARD_WIDTH - anchor.x : 0
    const deltaY = anchor ? position.y * TREE_MAP_HEIGHT - anchor.y : 0
    const hasNested = ids.some((id) => !!findParent(version.data, id))
    for (const id of ids) {
      const tile = tileForNode(version.data, originalPositions, id)
      if (!tile) return { ...position, versionId: version.id, nodeId: anchorId, kind: 'invalid', valid: false, data, positions, view: mapViewFor(version) }
      if (findParent(data, id)) {
        const node = removeNode(data, id)
        if (node) data.push(node)
      }
      positions[id] = { x: (tile.x + deltaX) / CARD_WIDTH, y: (tile.y + deltaY) / TREE_MAP_HEIGHT }
    }
    const valid = ids.every((id) => rootPositionIsAvailable(version, id, positions[id]!, data, positions))
    return { ...position, versionId: version.id, nodeId: anchorId, kind: valid ? (hasNested ? 'detach' : 'move') : 'invalid',
      valid, data, positions, view: valid ? fitMapViewToLayout(data, positions, mapViewFor(version), 0) : mapViewFor(version) }
  }
  function placeRoot(version: Version, nodeId: string, preview: SpatialPreview) {
    const map = document.querySelector<HTMLElement>(`.version-card[data-version="${version.id}"] .mini-map`)
    if (isReadOnly.value || !map || !rootPositionIsAvailable(version, nodeId, preview)) return false
    version.positions = clone(preview.positions)
    version.mapView = clone(preview.view)
    notify('Treemap layout updated')
    return true
  }
  function startTreeDrag(event: PointerEvent, version: Version, id: string) {
    if (event.button !== 0) return
    if (isReadOnly.value) return
    event.preventDefault()
    const map = (event.currentTarget as SVGRectElement).closest<HTMLElement>('.mini-map')
    const rect = map?.getBoundingClientRect()
    const view = mapViewFor(version)
    const viewport = mapViewport(version)
    const selection = version.id === active.value.id && selectedNodes.value.includes(id) ? selectedNodes.value : [id]
    state.value.activeId = version.id
    const selected = new Set(selection)
    const ids = selection.filter((item) => {
      let parent = findParent(version.data, item)
      while (parent) {
        if (selected.has(parent.id)) return false
        parent = findParent(version.data, parent.id)
      }
      return !!findNode(version.data, item)
    })
    const anchorId = ids.find((item) => item === id || descendants(findNode(version.data, item)!).includes(id)) ?? id
    const originalTile = tileForNode(version.data, version.positions, anchorId)
    const pointerX = rect
      ? (((event.clientX - rect.left) / zoom.value * viewport.width / (rect.width / zoom.value)) - view.panX) / view.zoom
      : 0
    const pointerY = rect
      ? (((event.clientY - rect.top) / zoom.value * viewport.height / (rect.height / zoom.value)) - view.panY) / view.zoom
      : 0
    treeDrag.value = {
      id: anchorId, ids, selection: [...selection], versionId: version.id, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false,
      space: rect && originalTile ? {
        grabX: (pointerX - originalTile.x) / originalTile.width,
        grabY: (pointerY - originalTile.y) / originalTile.height,
        width: originalTile.width,
        height: originalTile.height,
      } : undefined,
    }
    const tile = event.currentTarget as SVGRectElement
    if (tile.setPointerCapture) tile.setPointerCapture(event.pointerId)
    draggedPosition.value = null
    dragPreviewView.value = clone(view)
  }
  function moveTreeDrag(event: PointerEvent) {
    const drag = treeDrag.value
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    if (active.value.id !== drag.versionId) state.value.activeId = drag.versionId
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) {
      drag.moved = true
      draggedNode.value = drag.id
      if (!selectedNodes.value.includes(drag.id)) setSelectedNodes([drag.id])
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
    if (targetId && targetVersion === active.value.id
      && !drag.ids.every((id) => findParent(active.value.data, id)?.id === targetId)
      && drag.ids.every((id) => canAttach(id, targetId))) {
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
      && parent?.id !== targetId && !isDraggedDescendant && !drag.ids.every((id) => canAttach(id, targetId))
      ? targetId : null
    if (map && targetVersion === active.value.id && point) {
      spatialPreview.value = invalidNode.value ? null : drag.ids.length > 1
        ? groupDropLayout(active.value, drag.ids, drag.id, point)
        : spatialDropLayout(active.value, drag.id, point)
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
    if (!drag || drag.pointerId !== event.pointerId) return
    if (active.value.id !== drag.versionId) state.value.activeId = drag.versionId
    if (drag.moved && (event.clientX !== drag.lastX || event.clientY !== drag.lastY)) moveTreeDrag(event)
    const sourceVersionId = active.value.id
    const previewView = dragPreviewView.value
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const map = target?.closest<HTMLElement>('.mini-map')
    const targetVersion = target?.closest('.version-card')?.getAttribute('data-version')
    let committed = false
    if (drag.moved && map && targetVersion === active.value.id) {
      if (overNode.value && drag.ids.every((id) => canAttach(id, overNode.value!))) {
        const layout = previewLayout.value
        if (drag.ids.length > 1 && layout) {
          const version = createVersion(layout.data, `Attach ${drag.ids.length} selected entries`, true)
          if (version) { version.positions = clone(layout.positions); version.mapView = clone(layout.view); committed = true }
        } else committed = !!attachEntry(drag.id, overNode.value, layout ?? undefined)
      } else if (spatialPreview.value?.valid && spatialPreview.value.nodeId === drag.id) {
        const preview = spatialPreview.value
        if (preview.kind === 'move') {
          if (drag.ids.length > 1) {
            active.value.positions = clone(preview.positions)
            active.value.mapView = clone(preview.view)
            notify('Treemap layout updated')
            committed = true
          } else committed = placeRoot(active.value, drag.id, preview)
        } else if (preview.kind === 'detach') {
          if (drag.ids.length > 1) {
            const version = createVersion(preview.data, `Detach ${drag.ids.length} selected entries`, true)
            if (version) { version.positions = clone(preview.positions); version.mapView = clone(preview.view); committed = true }
          } else committed = !!detachEntry(drag.id, preview)
        }
      }
    }
    const sourceVersion = versions.value.find((version) => version.id === sourceVersionId)
    if (sourceVersion && previewView && previewView.zoom < mapViewFor(sourceVersion).zoom
      && (active.value.id === sourceVersionId || !committed)) {
      sourceVersion.mapView = clone(previewView)
    }
    if (committed) setSelectedNodes(drag.selection)
    if (drag.moved) {
      suppressClicks()
    }
    treeDrag.value = null
    draggedNode.value = null
    draggedPosition.value = null
    dragPreviewView.value = null
    overNode.value = null
    invalidNode.value = null
    spatialPreview.value = null
  }
  function cancelTreeDrag(event: PointerEvent) {
    const drag = treeDrag.value
    if (!drag || drag.pointerId !== event.pointerId) return
    const version = versions.value.find((item) => item.id === drag.versionId)
    if (version && dragPreviewView.value && dragPreviewView.value.zoom < mapViewFor(version).zoom) {
      version.mapView = clone(dragPreviewView.value)
    }
    treeDrag.value = null
    draggedNode.value = null
    draggedPosition.value = null
    dragPreviewView.value = null
    overNode.value = null
    invalidNode.value = null
    spatialPreview.value = null
  }
  return { draggedNode, draggedPosition, dragPreviewView, overNode, invalidNode, treeDrag, spatialPreview,
    previewLayout, draggedSubtreeIds, draggedOriginalTile, startTreeDrag, moveTreeDrag, finishTreeDrag, cancelTreeDrag }
}
