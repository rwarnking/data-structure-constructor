<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue'
import { Check, RotateCcw, Search, X } from '@lucide/vue'
import type { useVersionComparison } from '../composables/useVersionComparison'
import { labelFontSize } from '../utils/treemap'
import { displayVersionId } from '../utils/versions'

const props = defineProps<{ model: UnwrapNestedRefs<ReturnType<typeof useVersionComparison>> }>()
const emit = defineEmits<{ confirm: [] }>()
const { compareMode, mergeMode, showOverview, compareIds, closeVersionSelection, resetMerge, mergePreviewTiles, mergePreviewViewBox, moveMergeDrag, finishMergeDrag, cancelMergeDrag, mergeDropTarget, startMergeDrag, onMergeTileClick, mergeResult, mergeRows, setMergePicked, onMergeParentChange, mergeParentOptions, differentEntryCount, comparison, showDifferenceColors, comparisonPanels, comparisonViewBox, comparisonGhosts, comparisonSelectedNode, selectComparedNode, comparisonKinds } = toRefs(props.model)
</script>

<template>
  <div v-if="compareMode || mergeMode || showOverview"
    :role="mergeMode && compareIds.length === 2 ? 'dialog' : undefined"
    :aria-modal="mergeMode && compareIds.length === 2 ? 'true' : undefined"
    :aria-label="mergeMode ? 'Branch merge' : 'Version comparison'"
    :class="{ 'comparison-overlay': compareIds.length === 2, 'merge-overlay': mergeMode && compareIds.length === 2 }"
    @pointerdown.stop @pointerup.stop @pointermove.stop @pointercancel.stop @click.stop
    @dblclick.stop @contextmenu.stop @wheel.stop @touchmove.stop>
    <div class="compare-drawer" :class="{ open: compareIds.length === 2, 'merge-view': mergeMode }">
    <div class="drawer-head">
      <div>
        <span class="section-label">{{ mergeMode ? 'BRANCH MERGE' : 'VERSION COMPARISON' }}</span>
        <strong>{{ compareIds.length === 2
          ? `${displayVersionId(compareIds[0]!)} ${mergeMode ? '→' : '↔'} ${displayVersionId(compareIds[1]!)}`
          : mergeMode ? 'Choose source, then target' : 'Choose two versions' }}</strong>
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
                      :class="['merge-preview-tile', `depth-${tile.depth}`, { 'drop-target': mergeDropTarget === tile.id }]"
                      :data-node="tile.id" :fill="tile.depth === 0 ? '#deebe4' : tile.depth % 2 ? '#c1d9cc' : '#a9cab9'"
                      @pointerdown.stop="startMergeDrag($event, tile.id)" @click.stop="onMergeTileClick(tile.id)" />
                    <text v-if="labelFontSize(tile) >= 7" :x="tile.x + 5"
                      :y="tile.y + labelFontSize(tile) + 4" :font-size="labelFontSize(tile)" class="merge-preview-label">{{ tile.label }}</text>
                  </g>
                </svg>
                <div v-else class="merge-preview-empty">Pick entries from the list to build the resulting hierarchy.</div>
              </div>
            </section>
            <section class="merge-entry-list">
              <header><strong>Entry selection</strong><span>Pick entries and choose their result parent</span></header>
              <div class="merge-list-head">
                <strong>{{ mergeResult?.source.branch }} source</strong>
                <strong>Result</strong>
                <strong>{{ mergeResult?.target.branch }} target</strong>
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
          <div class="compare-summary">
            <span class="compare-count">{{ differentEntryCount }}</span>
            <span>{{ differentEntryCount === 1 ? 'entry differs' : 'entries differ' }}</span>
            <button type="button" class="small-button difference-toggle" :aria-pressed="showDifferenceColors"
              @click="showDifferenceColors = !showDifferenceColors">
              {{ showDifferenceColors ? 'Hide' : 'Show' }} difference highlights
            </button>
          </div>
          <div class="comparison-panels">
            <section v-for="(panel, panelIndex) in comparisonPanels" :key="panel.id" class="comparison-panel">
              <header><span>{{ panel.label }}</span><strong>{{ panel.version.branch }} · S{{ panel.version.step }}</strong></header>
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
                <text v-for="tile in panel.tiles.filter((item) => item.width > 35 && item.height > 18)" :key="`label-${tile.id}`"
                  :x="tile.x + 5" :y="tile.y + 16" :class="['comparison-label', { linked: comparisonSelectedNode === tile.id }]">{{ tile.label }}</text>
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
      <div v-else class="no-diff"><Check :size="17" /> These versions are structurally identical.</div>
    </div>
    <div v-else class="drawer-empty"><Search :size="18" /><span>Select the first version, then the second.</span></div>
  </div>
  </div>

</template>
