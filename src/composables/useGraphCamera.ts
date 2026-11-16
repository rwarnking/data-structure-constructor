import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { StoredState, Version } from '../types/workspace'

const GRAPH_GAP_X = 300
const GRAPH_GAP_Y = 72
const ZOOM_MAX = 4
type PresetMode = 'all' | 'height' | 'neighborhood' | 'version'
const PRESET_ORDER: PresetMode[] = ['all', 'height', 'neighborhood', 'version']

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
  suppressClicks: () => void
}) {
  const { versions, active, state, compareIds, draggedVersionId, zoom, pan, canvasSize, windowDimensions, suppressClicks } = options
  const focusedVersionId = ref<string | null>(null)
  const preset = ref<{ mode: PresetMode; versionId?: string } | null>(null)
  let lastPresetMode: PresetMode = 'all'
  const versionArrival = ref<{ versionId: string; from: { x: number; y: number }; progress: number } | null>(null)
  let versionArrivalFrame = 0
  let panAnimationFrame: number | null = null
  const draggingCanvas = ref(false)
  const dragOrigin = ref({ x: 0, y: 0, panX: 0, panY: 0, moved: false })
  const maxStep = computed(() => Math.max(...versions.value.map((version) => version.step)))
  const maxLane = computed(() => Math.max(...versions.value.map((version) => version.lane)))

  function cardPosition(version: Version) {
    const { width, height } = windowDimensions.value
    const mainRow = canvasSize.value.height / 2 - height / 2
    if (version.id === 'v0') return { x: 0, y: Math.min(0, -pan.value.y / zoom.value) }
    return { x: version.step * (width + GRAPH_GAP_X), y: mainRow + version.lane * (height + GRAPH_GAP_Y) }
  }
  function cardHeight(version: Version) {
    return version.id === 'v0'
      ? Math.max(graphBounds.value.height, (canvasSize.value.height - pan.value.y) / zoom.value) - cardPosition(version).y
      : windowDimensions.value.height
  }
  function cardWidth(_version: Version) {
    return windowDimensions.value.width
  }
  function rootLabelOffset() {
    return (canvasSize.value.height / 2 - pan.value.y) / zoom.value - cardPosition(versionsById.value.get('v0')!).y
  }
  function rootVisibleBounds() {
    return {
      left: Math.max(0, -pan.value.x / zoom.value),
      right: Math.min(windowDimensions.value.width, (canvasSize.value.width - pan.value.x) / zoom.value),
    }
  }
  function rootLabelX() {
    const { left, right } = rootVisibleBounds()
    return left < right ? (left + right) / 2 : windowDimensions.value.width / 2
  }
  function rootLabelWidth() {
    const { left, right } = rootVisibleBounds()
    return Math.max(0, Math.min(340, right - left - 4))
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
  function boundsFor(items: Version[], includeRoot = false) {
    const cards = items.filter((version) => version.id !== 'v0')
    const positions = cards.map(cardPosition)
    if (!positions.length) {
      const { width, height } = windowDimensions.value
      return { left: 0, top: canvasSize.value.height / 2 - height / 2, right: width, bottom: canvasSize.value.height / 2 + height / 2 }
    }
    return {
      left: includeRoot ? 0 : Math.min(...positions.map((position) => position.x)),
      top: Math.min(...positions.map((position) => position.y)),
      right: Math.max(...positions.map((position, index) => position.x + cardWidth(cards[index]!))) + (includeRoot ? 140 : 0),
      bottom: Math.max(...positions.map((position, index) => position.y + cardHeight(cards[index]!))),
    }
  }
  const fitZoom = computed(() => {
    const bounds = boundsFor(versions.value, true)
    return Math.max(0.005, Math.min(1, Math.max(1, canvasSize.value.width - 100) / (bounds.right - bounds.left),
      Math.max(1, canvasSize.value.height - 100) / (bounds.bottom - bounds.top)))
  })
  watch([canvasSize, windowDimensions], ([size, dimensions], [oldSize, oldDimensions]) => {
    const current = preset.value
    if (!current) {
      const anchor = active.value
      if (anchor.id === 'v0') return
      const step = anchor.step
      const lane = anchor.lane
      pan.value = {
        x: pan.value.x + step * (oldDimensions.width - dimensions.width) * zoom.value,
        y: pan.value.y + (oldSize.height / 2 - oldDimensions.height / 2 + lane * oldDimensions.height
          - size.height / 2 + dimensions.height / 2 - lane * dimensions.height) * zoom.value,
      }
      return
    }
    const version = current.versionId && versions.value.find((item) => item.id === current.versionId)
    if (current.mode === 'version' && version) focusVersion(version, false)
    else if (current.mode === 'neighborhood' && version) focusNeighborhood(version, false)
    else if (current.mode === 'height') fitHeight(false)
    else if (current.mode === 'all') fitGraph(false)
  })
  function zoomAt(nextZoom: number, x = canvasSize.value.width / 2, y = canvasSize.value.height / 2) {
    preset.value = null
    focusedVersionId.value = null
    suppressClicks()
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
  function stepPreset(direction: 1 | -1) {
    const index = PRESET_ORDER.indexOf(lastPresetMode)
    const next = PRESET_ORDER[Math.max(0, Math.min(PRESET_ORDER.length - 1, index + direction))]
    if (next === 'all') fitGraph()
    else if (next === 'height') fitHeight()
    else if (next === 'neighborhood') focusNeighborhood()
    else focusActive()
  }
  function fitBounds(bounds: { left: number; top: number; right: number; bottom: number }, targetZoom: number, animate: boolean, preserveX = false) {
    const target = {
      x: preserveX ? canvasSize.value.width / 2 - (canvasSize.value.width / 2 - pan.value.x) / zoom.value * targetZoom
        : canvasSize.value.width / 2 - (bounds.left + bounds.right) / 2 * targetZoom,
      y: canvasSize.value.height / 2 - (bounds.top + bounds.bottom) / 2 * targetZoom,
    }
    if (animate) animateCamera(targetZoom, target, 360, true)
    else { cancelPanAnimation(); zoom.value = targetZoom; pan.value = target }
  }
  function fitGraph(animate = true) {
    focusedVersionId.value = null
    preset.value = { mode: 'all' }
    lastPresetMode = 'all'
    fitBounds(boundsFor(versions.value, true), fitZoom.value, animate)
  }
  function fitHeight(animate = true) {
    focusedVersionId.value = null
    preset.value = { mode: 'height' }
    lastPresetMode = 'height'
    const bounds = boundsFor(versions.value)
    if (active.value.id === 'v0') {
      const targetZoom = Math.max(0.005, Math.min(ZOOM_MAX,
        Math.max(1, canvasSize.value.height - 100) / (bounds.bottom - bounds.top)))
      fitBounds(bounds, targetZoom, animate, true)
      return
    }
    const position = cardPosition(active.value)
    const centerY = position.y + cardHeight(active.value) / 2
    const verticalRadius = Math.max(centerY - bounds.top, bounds.bottom - centerY)
    const targetZoom = Math.max(0.005, Math.min(ZOOM_MAX,
      Math.max(1, canvasSize.value.height - 100) / (verticalRadius * 2)))
    const target = {
      x: canvasSize.value.width / 2 - (position.x + cardWidth(active.value) / 2) * targetZoom,
      y: canvasSize.value.height / 2 - centerY * targetZoom,
    }
    if (animate) animateCamera(targetZoom, target, 360, true)
    else { cancelPanAnimation(); zoom.value = targetZoom; pan.value = target }
  }
  function focusNeighborhood(version = active.value, animate = true) {
    focusedVersionId.value = null
    preset.value = { mode: 'neighborhood', versionId: version.id }
    lastPresetMode = 'neighborhood'
    const ids = new Set([version.id, version.parentId, version.mergeSourceId])
    for (const candidate of versions.value) {
      if (candidate.parentId === version.id || candidate.mergeSourceId === version.id
        || (version.parentId && candidate.parentId === version.parentId)) ids.add(candidate.id)
    }
    const bounds = boundsFor(versions.value.filter((item) => ids.has(item.id)), ids.has('v0'))
    const targetZoom = Math.max(0.005, Math.min(ZOOM_MAX,
      Math.max(1, canvasSize.value.width - 100) / (bounds.right - bounds.left),
      Math.max(1, canvasSize.value.height - 100) / (bounds.bottom - bounds.top)))
    if (version.id === 'v0') {
      fitBounds(bounds, targetZoom, animate)
      return
    }
    const position = cardPosition(version)
    const target = {
      x: canvasSize.value.width / 2 - (position.x + cardWidth(version) / 2) * targetZoom,
      y: canvasSize.value.height / 2 - (position.y + cardHeight(version) / 2) * targetZoom,
    }
    if (animate) animateCamera(targetZoom, target, 360, true)
    else { cancelPanAnimation(); zoom.value = targetZoom; pan.value = target }
  }
  function startCanvasPan(event: PointerEvent) {
    const target = event.target as HTMLElement
    const card = target.closest<HTMLElement>('.version-card')
    if (event.button !== 0 || target.closest('button, .tree-tile, .copy-link-hit')
      || (card && (card.dataset.version !== focusedVersionId.value
        || !target.closest('.mini-map, .root-version .overview-map')))) return
    cancelPanAnimation()
    draggingCanvas.value = true
    dragOrigin.value = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y, moved: false }
  }
  function moveCanvasPan(event: PointerEvent) {
    if (!draggingCanvas.value) return
    if (!dragOrigin.value.moved && Math.hypot(event.clientX - dragOrigin.value.x, event.clientY - dragOrigin.value.y) <= 3) return
    if (!dragOrigin.value.moved) {
      dragOrigin.value.moved = true
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }
    preset.value = null
    focusedVersionId.value = null
    pan.value = { x: dragOrigin.value.panX + event.clientX - dragOrigin.value.x, y: dragOrigin.value.panY + event.clientY - dragOrigin.value.y }
  }
  function endCanvasPan() {
    if (draggingCanvas.value && dragOrigin.value.moved) suppressClicks()
    draggingCanvas.value = false
  }
  function onWheel(event: WheelEvent) {
    event.preventDefault()
    zoomAt(zoom.value * Math.exp(-event.deltaY * 0.0012))
  }
  function focusVersion(version: Version, animate = true) {
    focusedVersionId.value = version.id
    preset.value = { mode: 'version', versionId: version.id }
    lastPresetMode = 'version'
    const position = cardPosition(version)
    const availableWidth = Math.max(1, canvasSize.value.width - 100)
    const availableHeight = Math.max(1, canvasSize.value.height - 100)
    const height = version.id === 'v0' ? windowDimensions.value.height : cardHeight(version)
    const targetZoom = Math.max(0.005, Math.min(ZOOM_MAX, availableWidth / cardWidth(version), availableHeight / height))
    const target = {
      x: canvasSize.value.width / 2 - (position.x + cardWidth(version) / 2) * targetZoom,
      y: version.id === 'v0' ? canvasSize.value.height / 2 - (canvasSize.value.height / 2 - pan.value.y) / zoom.value * targetZoom
        : canvasSize.value.height / 2 - (position.y + height / 2) * targetZoom,
    }
    if (animate) animateCamera(targetZoom, target, 420, true)
    else { cancelPanAnimation(); zoom.value = targetZoom; pan.value = target }
  }
  function focusActive() { focusVersion(active.value) }
  const visibleVersions = computed<Version[]>((previous) => {
    const marginX = windowDimensions.value.width + GRAPH_GAP_X
    const marginY = windowDimensions.value.height + GRAPH_GAP_Y
    const left = -pan.value.x / zoom.value - marginX
    const top = -pan.value.y / zoom.value - marginY
    const right = (canvasSize.value.width - pan.value.x) / zoom.value + marginX
    const bottom = (canvasSize.value.height - pan.value.y) / zoom.value + marginY
    const retained = new Set([state.value.activeId, ...compareIds.value])
    const draggedVersion = draggedVersionId()
    if (draggedVersion) retained.add(draggedVersion)
    const visible = versions.value.filter((version) => {
      if (retained.has(version.id)) return true
      const position = cardPosition(version)
      return position.x <= right && position.x + cardWidth(version) >= left
        && position.y <= bottom && position.y + cardHeight(version) >= top
    })
    return previous && previous.length === visible.length && visible.every((version, index) => version === previous[index])
      ? previous : visible
  })
  function intersectsViewport(bounds: { left: number; top: number; right: number; bottom: number }, margin = 0) {
    return bounds.left <= (canvasSize.value.width - pan.value.x) / zoom.value + margin
      && bounds.right >= -pan.value.x / zoom.value - margin
      && bounds.top <= (canvasSize.value.height - pan.value.y) / zoom.value + margin
      && bounds.bottom >= -pan.value.y / zoom.value - margin
  }
  const versionsById = computed(() => new Map(versions.value.map((version) => [version.id, version])))
  function connectionInViewport(source: Version, destination: Version) {
    const from = displayCardPosition(source)
    const to = displayCardPosition(destination)
    const startX = from.x + cardWidth(source)
    const startY = from.y + cardHeight(source) / 2
    const endY = to.y + cardHeight(destination) / 2
    // Include the label position as well as the path, including the root's horizontal route.
    return intersectsViewport({
      left: Math.min(startX, to.x),
      right: Math.max(startX, to.x),
      top: Math.min(startY, endY),
      bottom: Math.max(startY, endY),
    }, windowDimensions.value.height / 3 + 100)
  }
  const visibleConnectionVersions = computed(() => {
    return versions.value.filter((version) => {
      const parent = version.parentId && versionsById.value.get(version.parentId)
      return !!parent && connectionInViewport(parent, version)
    })
  })
  const visibleMergeConnectionVersions = computed(() => {
    return versions.value.filter((version) => {
      const source = version.mergeSourceId && versionsById.value.get(version.mergeSourceId)
      return !!source && connectionInViewport(source, version)
    })
  })
  function cancelPanAnimation() {
    if (panAnimationFrame !== null) cancelAnimationFrame(panAnimationFrame)
    panAnimationFrame = null
  }
  function animateCamera(targetZoom: number, targetPan: { x: number; y: number }, duration = 360, keepPreset = false) {
    if (!keepPreset) { preset.value = null; focusedVersionId.value = null }
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
    const centerX = (position.x + cardWidth(version) / 2) * zoom.value + pan.value.x
    const centerY = (position.y + cardHeight(version) / 2) * zoom.value + pan.value.y
    return Math.abs(centerX - canvasSize.value.width / 2) < 2
      && Math.abs(centerY - canvasSize.value.height / 2) < 2
  }
  function panToVersion(version: Version, centerImmediately: boolean) {
    preset.value = centerImmediately ? { mode: 'version', versionId: version.id } : null
    focusedVersionId.value = centerImmediately ? version.id : null
    cancelPanAnimation()
    const position = cardPosition(version)
    const width = cardWidth(version) * zoom.value
    const height = cardHeight(version) * zoom.value
    const margin = 50
    const target = { ...pan.value }
    const left = position.x * zoom.value + target.x
    const right = left + width
    const top = position.y * zoom.value + target.y
    const bottom = top + height

    if (centerImmediately || width > canvasSize.value.width - margin * 2) {
      target.x = canvasSize.value.width / 2 - (position.x + cardWidth(version) / 2) * zoom.value
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

  return { focusedVersionId, versionArrival, cardPosition, cardWidth, cardHeight, rootLabelOffset, rootLabelX, rootLabelWidth, displayCardPosition, startVersionArrival, graphBounds,
    visibleVersions, visibleConnectionVersions, visibleMergeConnectionVersions, intersectsViewport, zoomAt, stepPreset, fitGraph, fitHeight, focusNeighborhood,
    startCanvasPan, moveCanvasPan, endCanvasPan, onWheel, focusVersion, focusActive, animateCamera,
    isVersionCentered, panToVersion, stopGraphAnimations }
}
