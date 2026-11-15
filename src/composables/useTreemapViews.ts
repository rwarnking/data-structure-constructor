import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { MapView, StoredState, TreeNode, Version } from '../types/workspace'
import { CARD_HEIGHT, CARD_WIDTH, TREE_MAP_HEIGHT, MAP_PADDING, MAP_ZOOM_MIN, MAP_ZOOM_MAX, compactTreemapPositions, defaultPositions, mapGeometry, outerTreemapDimensions } from '../utils/treemap'

export function useTreemapViews(options: {
  state: Ref<StoredState>
  versions: ComputedRef<Version[]>
  windowDimensions: ComputedRef<{ width: number; height: number }>
  zoom: Ref<number>
  cardHeight: (version: Version) => number
  notify: (message: string) => void
  suppressClicks: () => void
}) {
  const { state, versions, windowDimensions, zoom, cardHeight, notify, suppressClicks } = options
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const mapPanDrag = ref<{
    versionId: string
    pointerId: number
    x: number
    y: number
    panX: number
    panY: number
    scaleX: number
    scaleY: number
    moved: boolean
  } | null>(null)
  const transientMapViews = ref<Record<string, MapView>>({})
  const mapViewTimers = new Map<string, number>()
  function cardData(version: Version): TreeNode[] {
    return version.data
  }
  function cardPositions(version: Version) {
    return version.positions
  }
  const mapGeometries = computed(() => {
    const geometries = new Map<string, ReturnType<typeof mapGeometry>>()
    for (const version of versions.value) {
      if (!cardData(version).length) continue
      const viewport = mapViewport(version)
      geometries.set(version.id, mapGeometry(cardData(version), cardPositions(version), viewport.width, viewport.height))
    }
    return geometries
  })
  function mapViewport(version: Version) {
    if (version.id === 'v0') {
      return {
        width: windowDimensions.value.width - 2,
        height: cardHeight(version) - 2,
      }
    }
    return {
      width: CARD_WIDTH - 14,
      height: (CARD_WIDTH - 14) * Math.max(1, windowDimensions.value.height - 47)
        / Math.max(1, windowDimensions.value.width - 14),
    }
  }
  function mapViewFor(version: Version): MapView {
    const transient = transientMapViews.value[version.id]
    if (transient) return transient
    if (version.mapView && (version.id !== 'v0' || version.mapView.manual)) return version.mapView
    const viewport = mapViewport(version)
    const geometry = mapGeometries.value.get(version.id) ?? mapGeometry(version.data, version.positions, viewport.width, viewport.height)
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
    version.positions = compactTreemapPositions(version.data, mapViewport(version))
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
  function zoomMap(event: WheelEvent, version: Version) {
    if (!event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    suppressClicks()
    const map = event.currentTarget as HTMLElement
    const rect = map.getBoundingClientRect()
    const viewport = mapViewport(version)
    const pointerX = (event.clientX - rect.left) / zoom.value * viewport.width / (rect.width / zoom.value)
    const pointerY = (event.clientY - rect.top) / zoom.value * viewport.height / (rect.height / zoom.value)
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
    const target = event.currentTarget as Element
    const map = target.closest<HTMLElement>('.mini-map, .overview-map')
    if (!map) return
    const rect = map.getBoundingClientRect()
    const viewport = mapViewport(version)
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
      scaleX: viewport.width / (rect.width / zoom.value),
      scaleY: viewport.height / (rect.height / zoom.value),
      moved: false,
    }
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
      panX: drag.panX + (event.clientX - drag.x) / zoom.value * drag.scaleX,
      panY: drag.panY + (event.clientY - drag.y) / zoom.value * drag.scaleY,
      manual: true,
    }
  }
  function endMapPan(event: PointerEvent) {
    if (mapPanDrag.value?.pointerId !== event.pointerId) return
    const { versionId, moved } = mapPanDrag.value
    mapPanDrag.value = null
    if (moved) {
      commitMapView(versionId)
      suppressClicks()
    } else if (transientMapViews.value[versionId]) scheduleMapViewCommit(versionId)
  }
  return { transientMapViews, mapViewTimers, cardData, cardPositions, mapViewport, mapViewFor,
    centerVersionTreemaps, compactVersionTreemaps, commitMapView, clearTransientMapViews,
    initializeMapViews, zoomMap, startMapPan, moveMapPan, endMapPan }
}
