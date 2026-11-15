<script setup lang="ts">
import { computed, toRefs } from 'vue'
import { actionIcons } from '../config/icons'
import type { Version } from '../types/workspace'
import type { VersionCardModel } from '../types/graph'
import { userColor, versionColor } from '../utils/colors'
import TileLabel from './TileLabel.vue'
import { displayVersionChange, displayVersionId } from '../utils/versions'

const props = defineProps<{ version: Version; model: VersionCardModel }>()
const { menu: MoreHorizontal, tag: TagIcon } = actionIcons
const { active, compareIds, compareMode, zoom, overNode, invalidNode, hoveredNode, selectedNodes, draggedSubtreeIds, draggedOriginalTile, selectionBox, windowDimensions, clientId, isReadOnly, versionTiles, duplicateValueLinks, displayCardPosition, cardHeight, rootLabelOffset, rootLabelX, versionAuthorColor, activeUsersFor, descendantsCount, isPreviewing, previewLabel, versionAction, cardData, mapViewport, mapTransform, changedEntries, tileSelectionColor, dragOverlayTiles, handleVersionClick, handleVersionDoubleClick, onVersionContext, onVersionMenu, startMapPan, zoomMap, startMapTileGesture, enterTile, moveTileTooltip, leaveTile, onTileClick, onTileDoubleClick, onTileContext } = toRefs(props.model)
const overlayTiles = computed(() => dragOverlayTiles.value(props.version))
const overlayIds = computed(() => new Set(overlayTiles.value.map((tile) => tile.id)))
</script>

<template>
  <article class="version-card" :class="{ active: version.id === active.id, compared: compareIds.includes(version.id), 'compare-pick': compareMode, compact: zoom < 0.66, previewing: isPreviewing(version), 'root-version': version.id === 'v0' }"
    :data-version="version.id" :style="{ left: `${displayCardPosition(version).x}px`, top: `${displayCardPosition(version).y}px`, width: `${windowDimensions.width}px`, height: `${cardHeight(version)}px`, '--branch-color': versionColor(version), '--user-color': userColor(clientId), '--author-color': versionAuthorColor(version) }"
    @click="handleVersionClick(version, $event)" @dblclick.stop="handleVersionDoubleClick(version)" @contextmenu="onVersionContext(version, $event)" :data-over="overNode === version.id">
    <span v-for="(user, index) in activeUsersFor(version.id)" :key="`active-${user.id}`"
      class="version-user-outline" :style="{ borderColor: user.color, borderWidth: `${2 / Math.min(1, zoom)}px`, inset: `${(-2 - index * 3) / Math.min(1, zoom)}px` }"></span>
    <span v-if="version.id === 'v0' && version.tag" class="version-tag-indicator" :title="`${version.tag.title}\n${version.tag.description}`"
      :style="{ transform: `scale(${1 / zoom})`, top: `${rootLabelOffset() - 42}px`, left: `${rootLabelX()}px` }"
      :aria-label="`Tag: ${version.tag.title}. ${version.tag.description}`" role="img"><TagIcon :size="18" /></span>
    <div v-if="version.id !== 'v0'" class="version-card-head">
      <span class="branch-mark" :style="{ background: versionColor(version) }"></span>
      <span class="version-header-id" :title="displayVersionId(version)">{{ displayVersionId(version) }}</span>
      <span v-if="version.tag" class="version-tag-indicator" :title="`${version.tag.title}\n${version.tag.description}`"
        :aria-label="`Tag: ${version.tag.title}. ${version.tag.description}`" role="img"><TagIcon :size="14" /></span>
      <span class="version-action-symbol" :title="versionAction(version).label" aria-hidden="true">{{ versionAction(version).symbol }}</span>
      <strong class="version-action">{{ version.change }}</strong>
      <span class="version-count">({{ descendantsCount(version.data) }} Entries)</span>
      <button class="card-menu quiet-icon" title="Version actions" @click.stop="onVersionMenu(version, $event)" @dblclick.stop><MoreHorizontal :size="17" /></button>
    </div>
    <div v-if="isPreviewing(version)" class="preview-badge">{{ previewLabel() }}</div>
    <div v-if="isReadOnly || version.id === 'v0'" class="overview-map"
      @pointerdown="version.id === 'v0' && !isReadOnly && startMapPan($event, version)"
      @wheel="version.id === 'v0' && !isReadOnly && zoomMap($event, version)">
      <div class="overview-content" :class="{ 'root-overview-label': version.id === 'v0' }" :style="version.id === 'v0' ? { top: `${rootLabelOffset()}px`, left: `${rootLabelX()}px` } : undefined">
        <div class="overview-action" :class="{ 'has-tag': version.tag }">
          <span class="overview-action-symbol">{{ versionAction(version).symbol }}</span>
          <strong class="overview-action-detail">{{ displayVersionChange(version) || versionAction(version).label }}</strong>
          <TagIcon v-if="version.tag" class="overview-tag" :title="version.tag.title" aria-label="Tagged version" />
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
        <svg :viewBox="`0 0 ${mapViewport(version).width} ${mapViewport(version).height}`" preserveAspectRatio="none" class="treemap-svg">
          <g :transform="mapTransform(version)">
            <rect v-for="tile in versionTiles.get(version.id) ?? []" :key="tile.id"
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
            <TileLabel v-for="tile in (versionTiles.get(version.id) ?? []).filter((item) =>
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
      <div v-if="selectionBox?.versionId === version.id" class="selection-box"
        :style="{ left: `${selectionBox.left}%`, top: `${selectionBox.top}%`, width: `${selectionBox.width}%`, height: `${selectionBox.height}%` }"></div>
    </div>
  </article>
</template>
