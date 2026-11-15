<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue'
import { actionIcons } from '../config/icons'
const { confirm: Check, reset: RotateCcw, search: Search, close: X } = actionIcons
import type { useVersionComparison } from '../composables/useVersionComparison'
import type { Version } from '../types/workspace'
import TileLabel from './TileLabel.vue'
import { displayVersionId } from '../utils/versions'

const props = defineProps<{ model: UnwrapNestedRefs<ReturnType<typeof useVersionComparison>>; versions: Version[]; sidebarCollapsed: boolean; actionSidebarCollapsed: boolean }>()
const emit = defineEmits<{ confirm: [] }>()
const { compareMode, mergeMode, showOverview, compareIds, chooseCompare, closeVersionSelection, resetMerge, mergePreviewTiles, mergeDraggedTiles, mergePreviewViewBox, moveMergeDrag, finishMergeDrag, cancelMergeDrag, mergeDropTarget, startMergeDrag, onMergeTileClick, mergeResult, mergeRows, setMergePicked, onMergeParentChange, mergeParentOptions, differentEntryCount, comparison, showDifferenceColors, comparisonPanels, comparisonViewBox, comparisonGhosts, comparisonSelectedNode, selectComparedNode, comparisonKinds } = toRefs(props.model)
function versionLabel(id: string) {
  const version = props.versions.find((item) => item.id === id)
  return version ? displayVersionId(version) : id
}
</script>

<template>
  <div v-if="compareMode || mergeMode || showOverview"
    :role="mergeMode && compareIds.length === 2 ? 'dialog' : undefined"
    :aria-modal="mergeMode && compareIds.length === 2 ? 'true' : undefined"
    :aria-label="mergeMode ? 'Branch merge' : 'Version comparison'"
    :class="{ 'comparison-overlay': compareIds.length === 2, 'merge-overlay': mergeMode && compareIds.length === 2, 'sidebar-collapsed': sidebarCollapsed }"
    :style="compareIds.length === 2 ? { right: `${(actionSidebarCollapsed ? 48 : 270) + 12}px` } : undefined"
    @pointerdown.stop @pointerup.stop @pointermove.stop @pointercancel.stop @click.stop
    @dblclick.stop @contextmenu.stop @wheel.stop @touchmove.stop>
    <div class="compare-drawer" :class="{ open: compareIds.length === 2, 'merge-view': mergeMode }">
    <div class="drawer-head">
      <div>
        <span class="section-label">{{ mergeMode ? 'BRANCH MERGE' : 'VERSION COMPARISON' }}</span>
        <strong>{{ compareIds.length === 2
          ? `${versionLabel(compareIds[0]!)} ${mergeMode ? '→' : '↔'} ${versionLabel(compareIds[1]!)}`
          : mergeMode ? 'Choose source, then target' : 'Choose two versions' }}</strong>
        </div>
      <div v-if="compareIds.length === 2 && !mergeMode" class="compare-summary">
        <span class="compare-count">{{ differentEntryCount }}</span>
        <span>{{ differentEntryCount === 1 ? 'entry differs' : 'entries differ' }}</span>
        <button type="button" class="small-button difference-toggle" :aria-pressed="showDifferenceColors"
          @click="showDifferenceColors = !showDifferenceColors">{{ showDifferenceColors ? 'Hide' : 'Show' }} difference highlights</button>
      </div>
      <button class="quiet-icon" title="Close comparison" aria-label="Abort and close" @click="closeVersionSelection"><X :size="17" /></button>
    </div>
    <div v-if="compareIds.length === 2" class="comparison-content">
      <template v-if="mergeMode">
        <div class="merge-layout">
          <div class="merge-left-column">
            <section class="merge-preview">
              <header><strong>Resulting treemap</strong><button class="small-button merge-reset" type="button" @click="resetMerge"><RotateCcw :size="13" /> Reset</button></header>
              <div class="merge-preview-body">
                <svg v-if="mergePreviewTiles.length" class="merge-preview-canvas" :viewBox="mergePreviewViewBox"
                  preserveAspectRatio="xMidYMid meet" role="img" aria-label="Interactive resulting hierarchy preview"
                  @pointermove="moveMergeDrag" @pointerup="finishMergeDrag" @pointercancel="cancelMergeDrag">
                  <g v-for="tile in mergePreviewTiles" :key="tile.id">
                    <rect :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                      :class="['merge-preview-tile', 'tree-tile', `depth-${tile.depth}`, { 'is-over': mergeDropTarget === tile.id }]"
                      :data-node="tile.id" :style="{ '--tile-base': tile.depth === 0 ? 'var(--theme-entry-root)' : tile.depth === 3 ? 'var(--theme-entry-deep)' : tile.depth % 2 ? 'var(--theme-entry-odd)' : 'var(--theme-entry-even)' }"
                      @pointerdown.stop="startMergeDrag($event, tile.id)" @click.stop="onMergeTileClick(tile.id)"><title>{{ tile.label }}</title></rect>
                    <TileLabel :tile="tile" class="merge-preview-label" />
                  </g>
                  <g v-for="tile in mergeDraggedTiles" :key="`drag-${tile.id}`" pointer-events="none">
                    <rect :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height" class="dragged-overlay"
                      :fill="tile.depth === 0 ? 'var(--theme-entry-root)' : tile.depth === 3 ? 'var(--theme-entry-deep)' : tile.depth % 2 ? 'var(--theme-entry-odd)' : 'var(--theme-entry-even)'" />
                    <TileLabel :tile="tile" class="merge-preview-label" />
                  </g>
                </svg>
                <div v-else class="merge-preview-empty">Pick entries from the list to build the resulting hierarchy.</div>
              </div>
            </section>
            <section class="merge-entry-list">
              <header><strong>Entry selection</strong><span>Pick entries and choose their result parent</span></header>
              <div class="merge-list-scroll">
              <div class="merge-list-head">
                <strong>{{ mergeResult && displayVersionId(mergeResult.source) }} source</strong>
                <strong>Result</strong>
                <strong>{{ mergeResult && displayVersionId(mergeResult.target) }} target</strong>
              </div>
              <div class="merge-list-body">
                <div v-for="row in mergeRows" :key="row.id" class="merge-view-row"
                  :class="{ shared: row.shared, omitted: !row.resultEntry }">
                  <div class="merge-entry-cell">
                    <template v-if="row.sourceEntry">
                      <small>{{ row.sourceEntry.path.split('/').slice(0, -1).join(' / ') }}</small>
                      <strong>{{ row.sourceEntry.node.value }}</strong>
                    </template>
                    <span v-else class="merge-empty">—</span>
                  </div>
                  <div class="merge-result-cell">
                    <button type="button" :class="{ selected: !!row.resultEntry }"
                      @click="setMergePicked(row.id, true)">Pick</button>
                    <button type="button" :class="{ selected: !row.resultEntry }"
                      @click="setMergePicked(row.id, false)">Omit</button>
                    <select v-if="row.resultEntry" :value="row.resultEntry.parentId ?? ''"
                      :aria-label="`Parent for ${row.resultEntry.node.value} in merged result`"
                      @change="onMergeParentChange(row.id, $event)">
                      <option value="">Root</option>
                      <option v-for="[parentId, parent] in mergeParentOptions(row.id)" :key="parentId" :value="parentId">
                        {{ parent.path }}
                      </option>
                    </select>
                    <strong>{{ row.resultEntry?.node.value ?? row.label }}</strong>
                  </div>
                  <div class="merge-entry-cell">
                    <template v-if="row.targetEntry">
                      <small>{{ row.targetEntry.path.split('/').slice(0, -1).join(' / ') }}</small>
                      <strong>{{ row.targetEntry.node.value }}</strong>
                    </template>
                    <span v-else class="merge-empty">—</span>
                  </div>
                </div>
              </div>
              </div>
            </section>
          </div>
          <aside class="merge-changes">
            <header><span class="section-label">SOURCE CHANGES</span>
            <strong>{{ differentEntryCount }} different {{ differentEntryCount === 1 ? 'entry' : 'entries' }}</strong>
            </header>
            <div v-if="comparison.length" class="diff-list">
              <div v-for="change in comparison" :key="change.id" class="diff-item" :class="change.kind.toLowerCase()">
                <span>{{ change.kind }}</span><strong>{{ change.label }}</strong>
              </div>
            </div>
            <div v-else class="no-diff"><Check :size="17" /> These versions are structurally identical.</div>
          </aside>
        </div>
      </template>
      <template v-else>
        <div class="compare-layout">
          <div class="comparison-panels">
            <section v-for="(panel, panelIndex) in comparisonPanels" :key="panel.id" class="comparison-panel">
              <header><span>{{ panel.label }}</span><strong>{{ displayVersionId(panel.version) }}<template v-if="panel.version.tag"> · {{ panel.version.tag.title }}</template></strong></header>
              <svg :viewBox="comparisonViewBox" role="img" :aria-label="`${panel.label} treemap comparison`">
                <rect v-for="ghost in comparisonGhosts(panelIndex)" :key="`ghost-${ghost.id}`"
                  :x="ghost.x" :y="ghost.y" :width="ghost.width" :height="ghost.height"
                  :data-node="ghost.id" role="button" tabindex="0"
                  :class="['comparison-ghost', panelIndex === 0 ? 'added' : 'removed', { linked: comparisonSelectedNode === ghost.id }]"
                  :aria-label="`${ghost.label} is absent from ${panel.label}`"
                  @click="selectComparedNode(ghost.id)"
                  @keydown.enter.prevent="selectComparedNode(ghost.id)" @keydown.space.prevent="selectComparedNode(ghost.id)" />
                <rect v-for="tile in panel.tiles" :key="tile.id"
                  :x="tile.x" :y="tile.y" :width="tile.width" :height="tile.height"
                  :data-node="tile.id" role="button" tabindex="0"
                  :class="['comparison-tile', ...comparisonKinds(tile.id), { linked: comparisonSelectedNode === tile.id }]"
                  :aria-label="`${tile.label}, ${comparisonKinds(tile.id).join(' and ')}`"
                  @click="selectComparedNode(tile.id)"
                  @keydown.enter.prevent="selectComparedNode(tile.id)" @keydown.space.prevent="selectComparedNode(tile.id)" />
                <TileLabel v-for="tile in panel.tiles" :key="`label-${tile.id}`" :tile="tile"
                  :class="['comparison-label', { linked: comparisonSelectedNode === tile.id }]" />
              </svg>
            </section>
          </div>
          <div class="comparison-legend" aria-label="Difference legend">
            <span class="unchanged">Unchanged</span><span class="added">Added</span><span class="removed">Removed</span>
            <span class="modified">Modified</span><span class="relocated">Relocated / hierarchy changed</span>
          </div>
          <div v-if="comparison.length" class="diff-list">
            <div v-for="change in comparison" :key="change.id" class="diff-item" :class="change.kind.toLowerCase()"
              @click="selectComparedNode(change.id)">
              <span>{{ change.kind }}</span><strong>{{ change.label }}</strong>
            </div>
          </div>
          <div v-else class="no-diff"><Check :size="17" /> These versions are structurally identical.</div>
        </div>
      </template>
      <div v-if="mergeMode" class="merge-confirm-row">
        <div class="merge-actions">
          <button class="cancel-button" @click="closeVersionSelection">Abort merge</button>
          <button class="primary-button" :disabled="!mergeResult" @click="emit('confirm')">
            <Check :size="15" /> Confirm merge
          </button>
        </div>
      </div>
    </div>
    <div v-else class="drawer-empty">
      <Search :size="18" />
      <div>
        <span>{{ compareIds.length ? 'Select the second version.' : 'Select the first version, then the second.' }}</span>
        <div v-if="compareIds[0]" class="drawer-first-version">
          <span>{{ mergeMode ? 'Source' : 'First version' }}: <strong>{{ versionLabel(compareIds[0]) }}</strong></span>
          <button type="button" class="quiet-icon" :aria-label="`Deselect first version ${versionLabel(compareIds[0])}`"
            title="Deselect first version" @click="chooseCompare(compareIds[0])"><X :size="14" /></button>
        </div>
      </div>
    </div>
  </div>
  </div>

</template>
