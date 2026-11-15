<script setup lang="ts">
import { computed, ref, toRefs } from 'vue'
import { actionIcons } from '../config/icons'
import type { Version } from '../types/workspace'
import type { VersionCardModel } from '../types/graph'
import { versionColor } from '../utils/colors'
import TileLabel from './TileLabel.vue'
import { displayVersionChange, displayVersionId } from '../utils/versions'
import { outOfViewDirections, type MapDirection } from '../utils/treemap'

const props = defineProps<{ version: Version; model: VersionCardModel }>()
const { menu: MoreHorizontal, tag: TagIcon } = actionIcons
const { active, compareIds, compareMode, zoom, overNode, invalidNode, hoveredNode, selectedNodes, draggedSubtreeIds, draggedOriginalTile, selectionBox, windowDimensions, clientId, colorForUser, isReadOnly, versionTiles, duplicateValueLinks, displayCardPosition, cardHeight, rootLabelOffset, rootLabelX, versionAuthorColor, activeUsersFor, descendantsCount, isPreviewing, previewLabel, versionAction, cardData, mapViewport, cardMapView, mapTransform, changedEntries, tileSelectionColor, dragOverlayTiles, handleVersionClick, handleVersionDoubleClick, onVersionContext, onVersionMenu, startMapPan, zoomMap, startMapTileGesture, enterTile, moveTileTooltip, leaveTile, onTileClick, onTileDoubleClick, onTileContext } = toRefs(props.model)
const overlayTiles = computed(() => dragOverlayTiles.value(props.version))
const overlayIds = computed(() => new Set(overlayTiles.value.map((tile) => tile.id)))
const overviewHover = ref(false)
const previewPosition = ref({ left: 0, top: 0 })
const previewTiles = computed(() => versionTiles.value.get(props.version.id) ?? [])
const offscreenDirections = computed(() => outOfViewDirections(previewTiles.value, cardMapView.value(props.version), mapViewport.value(props.version)))
const directionAngles: Record<MapDirection, number> = {
  up: 0, 'up-right': 45, right: 90, 'down-right': 135,
  down: 180, 'down-left': 225, left: 270, 'up-left': 315,
}
const previewViewBox = computed(() => {
  const tiles = previewTiles.value
  if (!tiles.length) return '0 0 260 220'
  const left = Math.min(...tiles.map((tile) => tile.x))
  const top = Math.min(...tiles.map((tile) => tile.y))
  const right = Math.max(...tiles.map((tile) => tile.x + tile.width))
  const bottom = Math.max(...tiles.map((tile) => tile.y + tile.height))
  return `${left - 12} ${top - 12} ${right - left + 24} ${bottom - top + 24}`
})
function showOverviewPreview(event: PointerEvent) {
  if (!isReadOnly.value) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  previewPosition.value = {
    left: Math.max(8, Math.min(window.innerWidth - 288, bounds.right + 8)),
    top: Math.max(8, Math.min(window.innerHeight - 248, bounds.top)),
  }
  overviewHover.value = true
}
const renderedTiles = computed(() => {
  const view = cardMapView.value(props.version)
  const viewport = mapViewport.value(props.version)
  const margin = 16 + 4 / view.zoom
  const left = -view.panX / view.zoom - margin
  const top = -view.panY / view.zoom - margin
  const right = (viewport.width - view.panX) / view.zoom + margin
  const bottom = (viewport.height - view.panY) / view.zoom + margin
  const retained = new Set(props.version.id === active.value.id ? draggedSubtreeIds.value : [])
  return (versionTiles.value.get(props.version.id) ?? []).filter((tile) =>
    retained.has(tile.id) || (tile.x <= right && tile.x + tile.width >= left
      && tile.y <= bottom && tile.y + tile.height >= top))
})
</script>

<template>
  <article class="version-card" :class="{ active: version.id === active.id, compared: compareIds.includes(version.id), 'compare-pick': compareMode, compact: zoom < 0.66, 'lod-overview': isReadOnly, previewing: isPreviewing(version), 'root-version': version.id === 'v0' }"
    :data-version="version.id" :style="{ left: `${displayCardPosition(version).x}px`, top: `${displayCardPosition(version).y}px`, width: `${windowDimensions.width}px`, height: `${cardHeight(version)}px`, '--branch-color': versionColor(version), '--user-color': colorForUser(clientId), '--author-color': versionAuthorColor(version) }"
    @pointerenter="showOverviewPreview" @pointerleave="overviewHover = false"
    @click="handleVersionClick(version, $event)" @dblclick.stop="handleVersionDoubleClick(version)" @contextmenu="onVersionContext(version, $event)" :data-over="overNode === version.id">
    <span v-for="(user, index) in activeUsersFor(version.id)" :key="`active-${user.id}`"
      class="version-user-outline" :style="{ borderColor: user.color, borderWidth: `${2 / Math.min(1, zoom)}px`, inset: `${(-2 - index * 3) / Math.min(1, zoom)}px` }"></span>
    <span v-if="version.id === 'v0' && version.tag" class="version-tag-indicator" :title="`${version.tag.title}\n${version.tag.description}`"
      :style="{ transform: `scale(${1 / zoom})`, top: `${rootLabelOffset() - 42}px`, left: `${rootLabelX()}px` }"
      :aria-label="`Tag: ${version.tag.title}. ${version.tag.description}`" role="img"><TagIcon :size="18" /></span>
    <div v-if="version.id !== 'v0'" class="version-card-head">
      <span v-if="!isReadOnly" class="branch-mark" :style="{ background: versionColor(version) }"></span>
      <span class="version-header-id" :style="isReadOnly ? { fontSize: `${Math.min(28, 330 / displayVersionId(version).length)}px` } : undefined" :title="displayVersionId(version)">{{ displayVersionId(version) }}</span>
      <span v-if="version.tag && !isReadOnly" class="version-tag-indicator" :title="`${version.tag.title}\n${version.tag.description}`"
        :aria-label="`Tag: ${version.tag.title}. ${version.tag.description}`" role="img"><TagIcon :size="14" /></span>
      <span v-if="!isReadOnly" class="version-action-symbol" :title="versionAction(version).label" aria-hidden="true">{{ versionAction(version).symbol }}</span>
      <strong v-if="!isReadOnly" class="version-action">{{ version.change }}</strong>
      <span v-if="!isReadOnly" class="version-count">({{ descendantsCount(version.data) }} Entries)</span>
      <button class="card-menu quiet-icon" title="Version actions" @click.stop="onVersionMenu(version, $event)" @dblclick.stop><MoreHorizontal :size="isReadOnly ? 30 : 17" /></button>
    </div>
    <div v-if="isPreviewing(version)" class="preview-badge">{{ previewLabel() }}</div>
    <div v-if="isReadOnly || version.id === 'v0'" class="overview-map"
      @pointerdown="version.id === 'v0' && !isReadOnly && startMapPan($event, version)"
      @wheel="version.id === 'v0' && !isReadOnly && zoomMap($event, version)">
      <div class="overview-content" :class="{ 'root-overview-label': version.id === 'v0' }" :style="version.id === 'v0' ? { top: `${rootLabelOffset()}px`, left: `${rootLabelX()}px` } : undefined">
        <div class="overview-action" :class="{ 'has-tag': version.tag }">
          <span class="overview-action-symbol">{{ versionAction(version).symbol }}</span>
          <strong class="overview-action-detail">{{ displayVersionChange(version) || versionAction(version).label }}</strong>
          <span v-if="version.tag" class="overview-tag" :title="`${version.tag.title}\n${version.tag.description}`"
            :aria-label="`Tag: ${version.tag.title}. ${version.tag.description}`" tabindex="0"><TagIcon /></span>
        </div>
        <div class="overview-stats">
          <span><b>{{ descendantsCount(version.data) }}</b><small>entries</small></span>
          <span><b>{{ version.data.length }}</b><small>treemaps</small></span>
        </div>
      </div>
    </div>
    <div v-else class="mini-map" :class="{ empty: !cardData(version).length }"
      @pointerdown="startMapPan($event, version)" @wheel="zoomMap($event, version)">
      <template v-if="cardData(version).length">
        <svg :viewBox="`0 0 ${mapViewport(version).width} ${mapViewport(version).height}`" preserveAspectRatio="xMidYMid meet" class="treemap-svg">
          <g :transform="mapTransform(version)">
            <rect v-for="tile in renderedTiles" :key="tile.id"
              :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
              :class="['tree-tile', `depth-${tile.depth}`, { 'is-selected': selectedNodes.includes(tile.id) && version.id === active.id, 'is-peer-selected': !!tileSelectionColor(version.id, tile.id), 'is-different': changedEntries.get(version.id)?.has(tile.id), 'is-source': draggedSubtreeIds.includes(tile.id) && version.id === active.id, 'is-over': overNode === tile.id && version.id === active.id, 'is-invalid': invalidNode === tile.id && version.id === active.id, 'is-hovered': hoveredNode?.versionId === version.id && hoveredNode.nodeId === tile.id && !draggedSubtreeIds.includes(tile.id) }]"
              :data-node="tile.id" :style="{ '--tile-selection': tileSelectionColor(version.id, tile.id),
                '--tile-base': tile.depth === 0 ? 'var(--theme-entry-root)' : tile.depth === 3 ? 'var(--theme-entry-deep)' : tile.depth % 2 ? 'var(--theme-entry-odd)' : 'var(--theme-entry-even)' }"
              @pointerdown.stop="startMapTileGesture($event, version, tile.id)"
              @pointerenter="enterTile($event, version, tile.id)"
              @pointermove="moveTileTooltip($event, version.id, tile.id)"
              @pointerleave="leaveTile(version.id, tile.id)"
              @click.stop="onTileClick(version, tile.id, $event)"
              @dblclick.stop="onTileDoubleClick(version, tile.id)"
              @contextmenu="version.id === active.id && !isReadOnly && onTileContext($event, tile.id)">
              <title>{{ tile.label }}</title>
            </rect>
            <path v-for="link in duplicateValueLinks.get(version.id) ?? []" :key="link.id"
              :d="link.path" fill="none" stroke="var(--theme-duplicate-connector)" stroke-width="3"
              stroke-dasharray="4 3" opacity=".72" pointer-events="none" />
            <g v-for="tile in overlayTiles" :key="`drag-overlay-${tile.id}`" pointer-events="none">
              <rect :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                :class="['dragged-overlay', `depth-${tile.depth}`]"
                :fill="tile.depth === 0 ? 'var(--theme-entry-root)' : tile.depth === 3 ? 'var(--theme-entry-deep)' : tile.depth % 2 ? 'var(--theme-entry-odd)' : 'var(--theme-entry-even)'" />
              <TileLabel :tile="tile" class="tile-label" />
            </g>
            <TileLabel v-for="tile in renderedTiles.filter((item) =>
              !overlayIds.has(item.id))" :key="`label-${tile.id}`"
              :tile="tile" class="tile-label" />
            <rect v-if="version.id === active.id && draggedOriginalTile" class="drag-source-ghost"
              :x="draggedOriginalTile.x" :y="draggedOriginalTile.y"
              :width="draggedOriginalTile.width" :height="draggedOriginalTile.height"
              :rx="3" fill="transparent" stroke="var(--theme-drag-outline)"
              stroke-dasharray="4 3" stroke-width="3"
              pointer-events="none"></rect>
          </g>
        </svg>
      </template>
      <div v-else class="empty-map">
        <span class="empty-cross">+</span><span>Empty structure</span>
      </div>
      <span v-for="direction in offscreenDirections" :key="direction"
        :class="['map-direction-indicator', `direction-${direction}`]"
        :aria-label="`Entries outside view: ${direction}`" role="img">
        <svg viewBox="0 0 12 12" :style="{ transform: `rotate(${directionAngles[direction]}deg)` }" aria-hidden="true">
          <path d="M2 8 L6 4 L10 8" />
        </svg>
      </span>
      <div v-if="selectionBox?.versionId === version.id" class="selection-box"
        :style="{ left: `${selectionBox.left}%`, top: `${selectionBox.top}%`, width: `${selectionBox.width}%`, height: `${selectionBox.height}%` }"></div>
    </div>
  </article>
  <Teleport to=".app-shell">
    <div v-if="overviewHover && isReadOnly" class="overview-preview" :style="{ left: `${previewPosition.left}px`, top: `${previewPosition.top}px` }">
      <strong>{{ displayVersionId(version) }}</strong>
      <svg v-if="previewTiles.length" :viewBox="previewViewBox" role="img" :aria-label="`Treemap preview for ${displayVersionId(version)}`">
        <rect v-for="tile in previewTiles" :key="tile.id" :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
          :fill="tile.depth === 0 ? 'var(--theme-entry-root)' : tile.depth === 3 ? 'var(--theme-entry-deep)' : tile.depth % 2 ? 'var(--theme-entry-odd)' : 'var(--theme-entry-even)'"
          stroke="var(--theme-entry-outline)" stroke-width="3" />
        <TileLabel v-for="tile in previewTiles" :key="`preview-${tile.id}`" :tile="tile" class="tile-label" />
      </svg>
      <span v-else>Empty structure</span>
    </div>
  </Teleport>
</template>
