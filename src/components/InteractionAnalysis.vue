<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import InteractionVisualizations from './InteractionVisualizations.vue'
import { abstractInteractions, interactionVersionLabels } from '../utils/interactionAnalysis'
import type { InteractionEvent, InteractionLog } from '../utils/interactionLog'

const props = defineProps<{ log: InteractionLog }>()
defineEmits<{ close: [] }>()
const selected = ref<InteractionEvent | null>(null)
const inspection = ref<{ label: string; events: InteractionEvent[] } | null>(null)
const inspector = ref<HTMLElement | null>(null)
const abstract = ref(false)
const grouped = computed(() => abstractInteractions(props.log))
const events = computed(() => abstract.value ? grouped.value.events : props.log.events)
const analysisLog = computed(() => ({ ...props.log, events: events.value }))
const labels = computed(() => interactionVersionLabels(props.log))
const eventSteps = computed(() => new Map(events.value.map((event, index) => [event.id, index + 1])))
const selectedSources = computed(() => selected.value
  ? abstract.value ? [...(grouped.value.sources.get(selected.value.id) ?? [selected.value])]
    .sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id)) : [selected.value]
  : [])
const inspectedEvents = computed(() => inspection.value?.events ?? events.value)
watch(abstract, () => { inspection.value = null; selected.value = null })
function inspect(label: string, entries: InteractionEvent[]) {
  inspection.value = { label, events: entries }
  selected.value = null
  void nextTick(() => inspector.value?.scrollIntoView({ block: 'nearest' }))
}
const start = computed(() => events.value[0]?.changeTime ?? 0)
const duration = computed(() => events.value.length ? events.value.at(-1)!.changeTime - start.value : 0)
const counts = (values: string[]) => Object.entries(values.reduce<Record<string, number>>((result, value) => {
  result[value] = (result[value] ?? 0) + 1
  return result
}, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
const actions = computed(() => counts(events.value.map((event) => event.action)))
const categories = computed(() => counts(events.value.map((event) => event.category)))
const methods = computed(() => counts(events.value.map((event) => event.method)))
const users = computed(() => {
  const result = new Map<string, { name: string; color: string; actions: string[]; versions: number; branches: number }>()
  const versions = new Set(props.log.initialState.versions.map((version) => version.id))
  const branches = new Set(props.log.initialState.versions.map((version) => version.branch))
  for (const event of events.value) {
    const user = result.get(event.actor.id) ?? { name: event.actor.name, color: event.actor.color, actions: [], versions: 0, branches: 0 }
    user.actions.push(event.action)
    for (const version of event.patch?.versions ?? []) {
      if (!versions.has(version.id)) { versions.add(version.id); user.versions++ }
      if (!branches.has(version.branch)) { branches.add(version.branch); user.branches++ }
    }
    result.set(event.actor.id, user)
  }
  return [...result.entries()].sort((a, b) => b[1].actions.length - a[1].actions.length)
})
const createdVersions = computed(() => users.value.reduce((sum, [, user]) => sum + user.versions, 0))
const createdBranches = computed(() => users.value.reduce((sum, [, user]) => sum + user.branches, 0))
const transitions = computed(() => {
  const meaningful = events.value.filter((event) => event.category === 'state' || /^(undo|redo|ping|navigate)/i.test(event.action))
  return counts(meaningful.slice(1).map((event, index) => `${meaningful[index]!.action} → ${event.action}`)).slice(0, 12)
})
const buckets = computed(() => {
  const first = start.value
  const span = Math.max(1, duration.value)
  const result = Array.from({ length: 10 }, (_, index) => ({
    index, count: 0, users: new Map<string, number>(), actions: [] as string[],
  }))
  for (const event of events.value) {
    const bin = result[Math.min(9, Math.max(0, Math.floor((event.changeTime - first) / span * 10)))]!
    bin.count++
    bin.users.set(event.actor.id, (bin.users.get(event.actor.id) ?? 0) + 1)
    bin.actions.push(event.action)
  }
  return result
})
const maxBucket = computed(() => Math.max(1, ...buckets.value.map((bucket) => bucket.count)))
const latencies = computed(() => events.value.map((event) => event.changeTime - event.inputTime))
const averageLatency = computed(() => latencies.value.length
  ? latencies.value.reduce((sum, value) => sum + value, 0) / latencies.value.length : 0)
const averageGap = computed(() => events.value.length > 1
  ? (events.value.at(-1)!.changeTime - events.value[0]!.changeTime) / (events.value.length - 1) : 0)
const visits = computed(() => counts(events.value.flatMap((event) => {
  const id = event.selection?.versionId ?? (typeof event.parameters?.versionId === 'string' ? event.parameters.versionId : undefined)
  return id ? [labels.value.get(id) ?? 'Unknown version'] : []
})).slice(0, 10))
const viewportEvents = computed(() => events.value.filter((event) => event.viewport))
const areas = computed(() => counts(viewportEvents.value.map((event) => {
  const view = event.viewport!
  return `${Math.round(-view.panX / view.zoom / 300)}, ${Math.round(-view.panY / view.zoom / 300)}`
})).slice(0, 5))
const cancellations = computed(() => events.value.filter((event) => /cancel|close|dismiss/i.test(event.action)).length)
const undo = computed(() => events.value.filter((event) => event.action.toLowerCase() === 'undo').length)
const redo = computed(() => events.value.filter((event) => event.action.toLowerCase() === 'redo').length)
function seconds(ms: number) { return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` }
</script>

<template>
  <div class="editor-scrim analysis-scrim">
    <section class="interaction-analysis" role="dialog" aria-modal="true" aria-label="Interaction log analysis">
      <header class="analysis-header">
        <div><h2>Interaction log analysis</h2><p>{{ log.room }} · {{ events.length }} interactions · {{ seconds(duration) }}</p>
          <label><input v-model="abstract" type="checkbox" /> Abstract interactions</label></div>
        <button type="button" class="cancel-button" @click="$emit('close')">Close</button>
      </header>
      <div class="analysis-content">
        <section>
          <h3>Session overview</h3>
          <div class="analysis-metrics">
            <div><strong>{{ events.length }}</strong><span>Interactions</span></div>
            <div><strong>{{ createdVersions }}</strong><span>Versions created</span></div>
            <div><strong>{{ createdBranches }}</strong><span>Branches created</span></div>
            <div><strong>{{ undo }} / {{ redo }}</strong><span>Undo / redo</span></div>
            <div><strong>{{ seconds(averageLatency) }}</strong><span>Average input-to-change</span></div>
            <div><strong>{{ seconds(averageGap) }}</strong><span>Average time between actions</span></div>
          </div>
          <p>Categories: {{ categories.map(([name, count]) => `${name} ${count}`).join(' · ') || 'None' }}</p>
          <p>Input methods: {{ methods.map(([name, count]) => `${name} ${count}`).join(' · ') || 'None' }}</p>
          <p>{{ latencies.filter((value) => value < 100).length }} immediate (&lt;100ms);
            {{ latencies.filter((value) => value >= 1000).length }} took at least one second.</p>
          <p>{{ cancellations }} cancel, close, or dismiss inputs (potentially interrupted interactions).</p>
        </section>
        <section>
          <h3>Activity over time</h3>
          <div class="analysis-bars" aria-label="Interaction frequency in ten time intervals">
            <div v-for="bucket in buckets" :key="bucket.index" :title="`Interval ${bucket.index + 1}: ${bucket.count} interactions, ${bucket.users.size} users; ${counts(bucket.actions).slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ')}`">
              <span :style="{ height: `${Math.max(2, bucket.count / maxBucket * 100)}%` }"></span><small>{{ bucket.count }}</small>
            </div>
          </div>
          <p>Each bar represents one tenth of the session. Multi-user intervals: {{ buckets.filter((bucket) => bucket.users.size > 1).length }}.</p>
          <table><thead><tr><th>User</th><th v-for="bucket in buckets" :key="bucket.index">{{ bucket.index + 1 }}</th></tr></thead>
            <tbody><tr v-for="[id, user] in users" :key="id"><td>{{ user.name }}</td>
              <td v-for="bucket in buckets" :key="bucket.index">{{ bucket.users.get(id) ?? 0 }}</td></tr></tbody></table>
        </section>
        <section>
          <h3>User contributions</h3>
          <table><thead><tr><th>User</th><th>Actions</th><th>Versions</th><th>Branches</th><th>Most common actions</th></tr></thead>
            <tbody><tr v-for="[id, user] in users" :key="id"><td><span :style="{ color: user.color }">{{ user.name }}</span> <small>{{ id }}</small></td>
              <td>{{ user.actions.length }}</td><td>{{ user.versions }}</td><td>{{ user.branches }}</td>
              <td>{{ counts(user.actions).slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ') }}</td></tr></tbody>
          </table>
        </section>
        <section>
          <h3>Action types and transitions</h3>
          <p>{{ actions.map(([name, count]) => `${name} (${count})`).join(' · ') || 'No actions' }}</p>
          <ol><li v-for="[transition, count] in transitions" :key="transition">{{ transition }} <strong>× {{ count }}</strong></li></ol>
        </section>
        <section>
          <h3>Navigation and viewport</h3>
          <p>{{ viewportEvents.length }} viewport changes;
            {{ events.filter((event) => /zoom/i.test(event.action)).length }} zoom interactions;
            {{ events.filter((event) => /pan|drag/i.test(event.action)).length }} pan or drag interactions.</p>
          <p>Visited versions: {{ visits.map(([id, count]) => `${id} (${count})`).join(' · ') || 'None recorded' }}</p>
          <p>Revisited graph areas (300-unit grid): {{ areas.map(([area, count]) => `${area} (${count})`).join(' · ') || 'None recorded' }}</p>
          <p v-if="viewportEvents.length">Viewport from
            {{ viewportEvents[0]!.viewport!.panX.toFixed(1) }}, {{ viewportEvents[0]!.viewport!.panY.toFixed(1) }}
            to {{ viewportEvents.at(-1)!.viewport!.panX.toFixed(1) }}, {{ viewportEvents.at(-1)!.viewport!.panY.toFixed(1) }}.</p>
        </section>
        <section ref="inspector">
          <h3>Inspect interactions</h3>
          <p v-if="inspection">Showing {{ inspectedEvents.length }} events: {{ inspection.label }}
            <button type="button" class="analysis-clear" @click="inspection = null; selected = null">Show all</button></p>
          <div class="analysis-raw"><ol><li v-for="event in inspectedEvents" :key="event.id">
            <span class="analysis-step">{{ eventSteps.get(event.id) }}.</span>
            <button type="button" @click="selected = event">{{ new Date(event.changeTime).toLocaleTimeString() }} · {{ event.actor.name }} · {{ event.action }}</button>
          </li></ol><pre v-if="selected">{{ JSON.stringify(selectedSources.length === 1 ? selectedSources[0] : selectedSources, null, 2) }}</pre></div>
        </section>
        <InteractionVisualizations :log="analysisLog" :version-labels="labels" :abstract="abstract" @inspect="inspect" />
      </div>
    </section>
  </div>
</template>
