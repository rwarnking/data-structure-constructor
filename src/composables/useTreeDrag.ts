import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { MapView, SpatialPreview, StoredState, TreeNode, Version } from '../types/workspace'
import { descendants, findNode, findParent, removeNode } from '../utils/tree'
import { CARD_WIDTH, TREE_MAP_HEIGHT, defaultPositions, fitMapViewAfterDrag, positionsAfterDetach, positionsAfterMoves, positionsForData, tileForNode, tilesForForest } from '../utils/treemap'

export function useTreeDrag(options: {
  state: Ref<StoredState>; active: ComputedRef<Version>
  isReadOnly: ComputedRef<boolean>; selectedNodes: Ref<string[]>
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
  const { state, active, isReadOnly, selectedNodes, hoveredNode, entryTooltip, mapViewFor, mapViewport,
    canAttach, attachEntry, detachEntry, createVersion, setSelectedNodes, notify, suppressClicks } = options
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const draggedNode = ref<string | null>(null)
  const draggedPosition = ref<{ x: number; y: number } | null>(null)
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
    map: HTMLElement
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
        view: fitMapViewAfterDrag(active.value.data, active.value.positions, data, positions, mapViewFor(active.value), mapViewport(active.value)),
        kind: 'attach' as const,
      }
    }
    return null
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
  function pointInMap(version: Version, clientX: number, clientY: number, map: HTMLElement) {
    const rect = map.getBoundingClientRect()
    const view = mapViewFor(version)
    const viewport = mapViewport(version)
    const matrix = map.querySelector('svg')?.getScreenCTM()
    const local = matrix
      ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      : { x: (clientX - rect.left) * viewport.width / rect.width, y: (clientY - rect.top) * viewport.height / rect.height }
    return { x: (local.x - view.panX) / view.zoom, y: (local.y - view.panY) / view.zoom }
  }
  function positionAt(version: Version, clientX: number, clientY: number, map: HTMLElement) {
    const drag = treeDrag.value
    const pointer = pointInMap(version, clientX, clientY, map)
    if (!drag?.space) {
      return {
        x: pointer.x / CARD_WIDTH,
        y: pointer.y / TREE_MAP_HEIGHT,
      }
    }
    return {
      x: (pointer.x - drag.space.grabX * drag.space.width) / CARD_WIDTH,
      y: (pointer.y - drag.space.grabY * drag.space.height) / TREE_MAP_HEIGHT,
    }
  }
  function treeNodeAt(clientX: number, clientY: number, map: HTMLElement) {
    const rect = map.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
    const { x, y } = pointInMap(active.value, clientX, clientY, map)
    const tiles = tilesForForest(active.value.data, active.value.positions)
    let hit: typeof tiles[number] | undefined
    for (const tile of tiles) {
      if (x >= tile.x && x <= tile.x + tile.width && y >= tile.y && y <= tile.y + tile.height
        && (!hit || tile.depth >= hit.depth)) hit = tile
    }
    return hit?.id ?? null
  }
  function spatialDropLayout(
    version: Version,
    nodeId: string,
    position: { x: number; y: number },
  ): SpatialPreview {
    const data = clone(version.data)
    const existingPositions = { ...defaultPositions(data, version.positions), ...version.positions }
    const isRoot = data.some((root) => root.id === nodeId)
    const parentId = findParent(data, nodeId)?.id
    if (!isRoot) {
      const detached = removeNode(data, nodeId)
      if (detached) data.push(detached)
    }
    const requestedPositions = { ...existingPositions, [nodeId]: position }
    const positions = isRoot ? positionsAfterMoves(data, requestedPositions, [nodeId])
      : positionsAfterDetach(data, requestedPositions, [{ id: nodeId, parentId }])
    return {
      ...position,
      versionId: version.id,
      nodeId,
      kind: isRoot ? 'move' : 'detach',
      valid: true,
      data,
      positions,
      view: fitMapViewAfterDrag(version.data, version.positions, data, positions, mapViewFor(version), mapViewport(version)),
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
    const moves = ids.map((id) => ({ id, parentId: findParent(version.data, id)?.id }))
    for (const id of ids) {
      const tile = tileForNode(version.data, originalPositions, id)
      if (!tile) return { ...position, versionId: version.id, nodeId: anchorId, kind: 'invalid', valid: false, data, positions, view: mapViewFor(version) }
      if (findParent(data, id)) {
        const node = removeNode(data, id)
        if (node) data.push(node)
      }
      positions[id] = { x: (tile.x + deltaX) / CARD_WIDTH, y: (tile.y + deltaY) / TREE_MAP_HEIGHT }
    }
    const resolved = hasNested ? positionsAfterDetach(data, positions, moves) : positionsAfterMoves(data, positions, ids)
    return { ...position, versionId: version.id, nodeId: anchorId, kind: hasNested ? 'detach' : 'move',
      valid: true, data, positions: resolved, view: fitMapViewAfterDrag(version.data, version.positions, data, resolved, mapViewFor(version), mapViewport(version)) }
  }
  function placeRoot(version: Version, preview: SpatialPreview) {
    const map = document.querySelector<HTMLElement>(`.version-card[data-version="${version.id}"] .mini-map`)
    if (isReadOnly.value || !map) return false
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
    if (!map) return
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
    const pointer = pointInMap(version, event.clientX, event.clientY, map)
    treeDrag.value = {
      id: anchorId, ids, selection: [...selection], versionId: version.id, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, map,
      space: originalTile ? {
        grabX: (pointer.x - originalTile.x) / originalTile.width,
        grabY: (pointer.y - originalTile.y) / originalTile.height,
        width: originalTile.width,
        height: originalTile.height,
      } : undefined,
    }
    const tile = event.currentTarget as SVGRectElement
    if (tile.setPointerCapture) tile.setPointerCapture(event.pointerId)
    draggedPosition.value = null
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
    const map = drag.map
    const card = map.closest('.version-card')?.getBoundingClientRect()
    const inside = !!card && event.clientX >= card.left && event.clientX <= card.right
      && event.clientY >= card.top && event.clientY <= card.bottom
    const targetId = inside ? treeNodeAt(event.clientX, event.clientY, map) : null
    const point = inside ? positionAt(active.value, event.clientX, event.clientY, map) : null
    if (point) draggedPosition.value = point
    if (targetId && drag.ids.every((id) => canAttach(id, targetId))) {
      overNode.value = targetId
      invalidNode.value = null
      spatialPreview.value = null
      return
    }
    overNode.value = null
    invalidNode.value = targetId && draggedSubtreeIds.value.includes(targetId) && targetId !== drag.id ? targetId : null
    const ignoreTarget = targetId && (targetId !== drag.id || !!findParent(active.value.data, drag.id))
    if (point && !ignoreTarget) {
      spatialPreview.value = {
        ...point, versionId: drag.versionId, nodeId: drag.id,
        kind: drag.ids.some((id) => !!findParent(active.value.data, id)) ? 'detach' : 'move',
        valid: true, data: active.value.data, positions: active.value.positions ?? {}, view: mapViewFor(active.value),
      }
    } else {
      spatialPreview.value = null
    }
  }
  function finishTreeDrag(event: PointerEvent) {
    const drag = treeDrag.value
    if (!drag || drag.pointerId !== event.pointerId) return
    if (active.value.id !== drag.versionId) state.value.activeId = drag.versionId
    if (event.clientX !== drag.lastX || event.clientY !== drag.lastY) moveTreeDrag(event)
    const card = drag.map.closest('.version-card')?.getBoundingClientRect()
    const inside = !!card && event.clientX >= card.left && event.clientX <= card.right
      && event.clientY >= card.top && event.clientY <= card.bottom
    let committed = false
    if (drag.moved && inside) {
      if (overNode.value && drag.ids.every((id) => canAttach(id, overNode.value!))) {
        const layout = previewLayout.value
        if (drag.ids.length > 1 && layout) {
          const version = createVersion(layout.data, `Attach ${drag.ids.length} selected entries`, true)
          if (version) { version.positions = clone(layout.positions); version.mapView = clone(layout.view); committed = true }
        } else committed = !!attachEntry(drag.id, overNode.value, layout ?? undefined)
      } else if (spatialPreview.value?.valid && spatialPreview.value.nodeId === drag.id) {
        const preview = drag.ids.length > 1
          ? groupDropLayout(active.value, drag.ids, drag.id, spatialPreview.value)
          : spatialDropLayout(active.value, drag.id, spatialPreview.value)
        if (!preview.valid) notify('Cannot move the selected entries')
        if (preview.kind === 'move') {
          if (drag.ids.length > 1) {
            active.value.positions = clone(preview.positions)
            active.value.mapView = clone(preview.view)
            notify('Treemap layout updated')
            committed = true
          } else committed = placeRoot(active.value, preview)
        } else if (preview.kind === 'detach') {
          if (drag.ids.length > 1) {
            const version = createVersion(preview.data, `Detach ${drag.ids.length} selected entries`, true)
            if (version) { version.positions = clone(preview.positions); version.mapView = clone(preview.view); committed = true }
          } else committed = !!detachEntry(drag.id, preview)
        }
      }
    }
    if (committed) setSelectedNodes(drag.selection)
    if (drag.moved) {
      suppressClicks()
    }
    treeDrag.value = null
    draggedNode.value = null
    draggedPosition.value = null
    overNode.value = null
    invalidNode.value = null
    spatialPreview.value = null
  }
  function cancelTreeDrag(event: PointerEvent) {
    const drag = treeDrag.value
    if (!drag || drag.pointerId !== event.pointerId) return
    treeDrag.value = null
    draggedNode.value = null
    draggedPosition.value = null
    overNode.value = null
    invalidNode.value = null
    spatialPreview.value = null
  }
  return { draggedNode, draggedPosition, overNode, invalidNode, treeDrag, spatialPreview,
    draggedSubtreeIds, draggedOriginalTile, startTreeDrag, moveTreeDrag, finishTreeDrag, cancelTreeDrag }
}
