import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { StoredState, Version } from '../types/workspace'

const GRAPH_GAP_X = 300
const GRAPH_GAP_Y = 72
const ZOOM_MAX = 4

export function useGraphCamera(options: {
  versions: ComputedRef<Version[]>
  active: ComputedRef<Version>
  state: Ref<StoredState>
  compareIds: Ref<string[]>
  draggedVersionId: () => string | undefined
  zoom: Ref<number>
  pan: Ref<{ x: number; y: number }>
  canvasSize: Ref<{ width: number; height: number }>
  windowDimensions: ComputedRef<{ width: number; height: number }>
}) {
  const { versions, active, state, compareIds, draggedVersionId, zoom, pan, canvasSize, windowDimensions } = options
  const versionArrival = ref<{ versionId: string; from: { x: number; y: number }; progress: number } | null>(null)
  let versionArrivalFrame = 0
  let panAnimationFrame: number | null = null
  const draggingCanvas = ref(false)
  const dragOrigin = ref({ x: 0, y: 0, panX: 0, panY: 0 })
  const maxStep = computed(() => Math.max(...versions.value.map((version) => version.step)))
  const maxLane = computed(() => Math.max(...versions.value.map((version) => version.lane)))

  function cardPosition(version: Version) {
    const { width, height } = windowDimensions.value
    const mainRow = canvasSize.value.height / 2 - height / 2
    if (version.id === 'v0') return { x: 0, y: 0 }
    return { x: version.step * (width + GRAPH_GAP_X), y: mainRow + version.lane * (height + GRAPH_GAP_Y) }
  }
  function cardHeight(version: Version) {
    return version.id === 'v0' ? graphBounds.value.height : windowDimensions.value.height
  }
  function displayCardPosition(version: Version) {
    const arrival = versionArrival.value
    const target = cardPosition(version)
    if (!arrival || arrival.versionId !== version.id) return target
    const progress = 1 - (1 - arrival.progress) ** 3
    return {
      x: arrival.from.x + (target.x - arrival.from.x) * progress,
      y: arrival.from.y + (target.y - arrival.from.y) * progress,
    }
  }
  function startVersionArrival(version: Version, from: { x: number; y: number }) {
    if (versionArrivalFrame) cancelAnimationFrame(versionArrivalFrame)
    const startedAt = performance.now()
    versionArrival.value = { versionId: version.id, from, progress: 0 }
    const animate = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / 460)
      if (progress === 1) {
        versionArrival.value = null
        versionArrivalFrame = 0
        return
      }
      versionArrival.value = { versionId: version.id, from, progress }
      versionArrivalFrame = requestAnimationFrame(animate)
    }
    versionArrivalFrame = requestAnimationFrame(animate)
  }
  const graphBounds = computed(() => ({
    width: Math.max(windowDimensions.value.width, maxStep.value * (windowDimensions.value.width + GRAPH_GAP_X) + windowDimensions.value.width + 140),
    height: Math.max(
      canvasSize.value.height,
      canvasSize.value.height / 2 + windowDimensions.value.height / 2 + maxLane.value * (windowDimensions.value.height + GRAPH_GAP_Y) + 140,
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
  function focusVersion(version: Version) {
    const position = cardPosition(version)
    const availableWidth = Math.max(1, canvasSize.value.width - 100)
    const availableHeight = Math.max(1, canvasSize.value.height - 100)
    const targetZoom = Math.max(0.005, Math.min(ZOOM_MAX, availableWidth / windowDimensions.value.width, availableHeight / cardHeight(version)))
    animateCamera(targetZoom, {
      x: canvasSize.value.width / 2 - (position.x + windowDimensions.value.width / 2) * targetZoom,
      y: canvasSize.value.height / 2 - (position.y + cardHeight(version) / 2) * targetZoom,
    }, 420)
  }
  function focusActive() { focusVersion(active.value) }
  const visibleVersions = computed(() => {
    const marginX = windowDimensions.value.width + GRAPH_GAP_X
    const marginY = windowDimensions.value.height + GRAPH_GAP_Y
    const left = -pan.value.x / zoom.value - marginX
    const top = -pan.value.y / zoom.value - marginY
    const right = (canvasSize.value.width - pan.value.x) / zoom.value + marginX
    const bottom = (canvasSize.value.height - pan.value.y) / zoom.value + marginY
    const retained = new Set([state.value.activeId, ...compareIds.value])
    const draggedVersion = draggedVersionId()
    if (draggedVersion) retained.add(draggedVersion)
    return versions.value.filter((version) => {
      if (retained.has(version.id)) return true
      const position = cardPosition(version)
      return position.x <= right && position.x + windowDimensions.value.width >= left
        && position.y <= bottom && position.y + cardHeight(version) >= top
    })
  })
  const visibleConnectionVersions = computed(() => {
    const visible = new Set(visibleVersions.value.map((version) => version.id))
    return versions.value.filter((version) =>
      visible.has(version.id) || !!version.parentId && visible.has(version.parentId))
  })
  const visibleMergeConnectionVersions = computed(() => {
    const visible = new Set(visibleVersions.value.map((version) => version.id))
    return versions.value.filter((version) =>
      !!version.mergeSourceId && (visible.has(version.id) || visible.has(version.mergeSourceId)))
  })
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
    const centerX = (position.x + windowDimensions.value.width / 2) * zoom.value + pan.value.x
    const centerY = (position.y + cardHeight(version) / 2) * zoom.value + pan.value.y
    return Math.abs(centerX - canvasSize.value.width / 2) < 2
      && Math.abs(centerY - canvasSize.value.height / 2) < 2
  }
  function panToVersion(version: Version, centerImmediately: boolean) {
    cancelPanAnimation()
    const position = cardPosition(version)
    const width = windowDimensions.value.width * zoom.value
    const height = cardHeight(version) * zoom.value
    const margin = 50
    const target = { ...pan.value }
    const left = position.x * zoom.value + target.x
    const right = left + width
    const top = position.y * zoom.value + target.y
    const bottom = top + height

    if (centerImmediately || width > canvasSize.value.width - margin * 2) {
      target.x = canvasSize.value.width / 2 - (position.x + windowDimensions.value.width / 2) * zoom.value
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
  function stopGraphAnimations() {
    cancelPanAnimation()
    if (versionArrivalFrame) cancelAnimationFrame(versionArrivalFrame)
  }

  return { cardPosition, cardHeight, displayCardPosition, startVersionArrival, graphBounds,
    visibleVersions, visibleConnectionVersions, visibleMergeConnectionVersions, zoomAt, zoomIn, zoomOut, fitGraph,
    startCanvasPan, moveCanvasPan, endCanvasPan, onWheel, focusVersion, focusActive, animateCamera,
    isVersionCentered, panToVersion, stopGraphAnimations }
}
