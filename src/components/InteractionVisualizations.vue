<script setup lang="ts">
import { computed } from 'vue'
import { analyzeInteractions } from '../utils/interactionAnalysis'
import type { InteractionEvent, InteractionLog } from '../utils/interactionLog'

const props = defineProps<{ log: InteractionLog; versionLabels: Map<string, string>; abstract: boolean }>()
const emit = defineEmits<{ inspect: [label: string, events: InteractionEvent[]] }>()
const data = computed(() => analyzeInteractions(props.log, props.versionLabels))
const maxMatrix = computed(() => Math.max(1, ...data.value.users.flatMap((user) =>
  [...user.actions.values()].map((events) => events.length))))
const maxFlow = computed(() => Math.max(1, ...data.value.flows.map((flow) => flow.count)))
const maxHeat = computed(() => Math.max(1, ...data.value.heatmap.cells.map((cell) => cell.duration)))
const maxVersion = computed(() => Math.max(1, ...data.value.versions.map((version) => version.events.length)))
function shade(value: number, max: number) { return `rgba(52, 123, 113, ${0.08 + 0.62 * value / max})` }
function seconds(ms: number) { return `${(ms / 1000).toFixed(1)}s` }
function inspect(label: string, events: InteractionEvent[]) {
  const unique = new Map(events.map((event) => [event.id, event]))
  emit('inspect', label, [...unique.values()].sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id)))
}
</script>

<template>
  <section class="analysis-visualization">
    <h3>User × action matrix</h3>
    <p>{{ abstract ? 'Counts grouped interactions.' : 'Counts recorded events; one operation can produce multiple records.' }} Select a count to inspect its events.</p>
    <div v-if="data.users.length" class="analysis-table-scroll">
      <table class="analysis-matrix">
        <thead><tr><th scope="col">User</th><th v-for="action in data.actions" :key="action" scope="col">{{ action }}</th></tr></thead>
        <tbody><tr v-for="user in data.users" :key="user.id">
          <th scope="row"><span :style="{ color: user.color }">{{ user.name }}</span><small> {{ user.id }}</small></th>
          <td v-for="action in data.actions" :key="action">
            <button v-if="user.actions.has(action)" type="button" class="analysis-cell"
              :style="{ background: shade(user.actions.get(action)!.length, maxMatrix) }"
              :aria-label="`${user.name}: ${action}, ${user.actions.get(action)!.length} events`"
              @click="inspect(`${user.name} · ${action}`, user.actions.get(action)!)">{{ user.actions.get(action)!.length }}</button>
            <span v-else>0</span>
          </td>
        </tr></tbody>
      </table>
    </div>
    <p v-else>No recorded interactions.</p>
  </section>

  <section class="analysis-visualization">
    <h3>Interaction flow diagram</h3>
    <p>Most frequent consecutive state, undo, redo, ping, or navigation records for the same user.</p>
    <div v-if="data.flows.length" class="analysis-flow">
      <button v-for="flow in data.flows" :key="JSON.stringify([flow.from, flow.to])" type="button"
        :aria-label="`${flow.from} → ${flow.to}: ${flow.count} transitions`"
        @click="inspect(`${flow.from} → ${flow.to}`, flow.events)">
        <span>{{ flow.from }}</span><span aria-hidden="true">→</span><span>{{ flow.to }}</span>
        <strong>{{ flow.count }}</strong><i :style="{ width: `${flow.count / maxFlow * 100}%` }"></i>
      </button>
    </div>
    <p v-else>Not enough recorded actions to show transitions.</p>
  </section>

  <section class="analysis-visualization">
    <h3>Viewport activity heatmap</h3>
    <p>Darker cells indicate more estimated time at the last recorded graph viewport origin between each user's events. Idle time may be included;
      time before the first graph viewport and after the last event is unknown. Version-canvas viewports are excluded.</p>
    <div v-if="data.heatmap.cells.length" class="analysis-heatmap"
      :style="{ gridTemplateColumns: `repeat(${data.heatmap.columns}, minmax(38px, 1fr))`, gridTemplateRows: `repeat(${data.heatmap.rows}, 38px)` }"
      aria-label="Graph viewport activity heatmap">
      <button v-for="cell in data.heatmap.cells" :key="`${cell.x},${cell.y}`" type="button"
        :style="{ gridColumn: cell.x + 1, gridRow: cell.y + 1, background: shade(cell.duration, maxHeat) }"
        :aria-label="`Graph area ${cell.x + 1}, ${cell.y + 1}: ${seconds(cell.duration)}`"
        @click="inspect(`Viewport area ${cell.x + 1}, ${cell.y + 1}`, cell.events)">{{ seconds(cell.duration) }}</button>
    </div>
    <p v-if="data.heatmap.cells.length">Top-left origin: {{ data.heatmap.minX.toFixed(0) }}, {{ data.heatmap.minY.toFixed(0) }} graph units;
      cell size: {{ data.heatmap.cellSize.toFixed(0) }} units. Right is +x; down is +y.</p>
    <p v-else>No timed graph viewport activity recorded.</p>
  </section>

  <section class="analysis-visualization">
    <h3>Version activity map</h3>
    <p>Recorded events explicitly referencing each version, ranked by frequency; darker means more events. Select a version to inspect its events.</p>
    <div v-if="data.versions.length" class="analysis-version-map">
      <button v-for="version in data.versions" :key="version.id" type="button"
        :style="{ background: shade(version.events.length, maxVersion) }"
        :aria-label="`Version ${version.label}: ${version.events.length} events`"
        @click="inspect(`Version ${version.label}`, version.events)">
        <strong>{{ version.label }}</strong><span>{{ version.events.length }} events</span>
      </button>
    </div>
    <p v-else>No version references recorded.</p>
  </section>
</template>
