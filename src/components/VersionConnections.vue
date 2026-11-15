<script setup lang="ts">
import { computed } from 'vue'
import type { Version } from '../types/workspace'
import { versionColor } from '../utils/colors'

const props = defineProps<{
  graphBounds: { width: number; height: number }
  windowDimensions: { width: number; height: number }
  versions: Version[]; visibleVersions: Version[]; visibleConnectionVersions: Version[]
  visibleMergeConnectionVersions: Version[]; activeId: string
  connectionPath: (version: Version) => string
  connectionWidth: (version: Version) => number
  mergeConnectionPath: (version: Version) => string
  mergeConnectionColor: (version: Version) => string
  cardPosition: (version: Version) => { x: number; y: number }
  displayCardPosition: (version: Version) => { x: number; y: number }
  cardHeight: (version: Version) => number
  terminalTailEnd: (version: Version) => number
  arrivingVersionId?: string
}>()
const arrowSize = 1.6
const versionsById = computed(() => new Map(props.versions.map((version) => [version.id, version])))
const parentIds = computed(() => new Set(props.versions.map((version) => version.parentId)))
function isCurved(source: Version, destination: Version) {
  if (source.id === 'v0') return false
  const from = props.displayCardPosition(source)
  const to = props.displayCardPosition(destination)
  return Math.abs(from.y + props.cardHeight(source) / 2 - to.y - props.cardHeight(destination) / 2) >= 1
}
const curvedConnections = computed(() => props.visibleConnectionVersions.filter((version) => {
  const parent = version.parentId ? versionsById.value.get(version.parentId) : undefined
  return !!parent && isCurved(parent, version)
}))
const mergeConnections = computed(() => props.visibleMergeConnectionVersions.map((version) => {
  const source = version.mergeSourceId ? versionsById.value.get(version.mergeSourceId) : undefined
  return { version, curved: !!source && isCurved(source, version) }
}))
const straightGroups = computed(() => {
  const groups: Array<{ ids: string[]; paths: string[]; lane: number; color: string; width: number; opacity: number; end: number; batchable: boolean }> = []
  for (const version of props.visibleConnectionVersions) {
    if (!version.parentId) continue
    const parent = versionsById.value.get(version.parentId)
    if (!parent || isCurved(parent, version)) continue
    const path = props.connectionPath(version)
    const width = props.connectionWidth(version)
    const color = versionColor(version)
    const opacity = version.id === props.activeId || version.parentId === props.activeId ? 0.96 : 0.76
    const from = props.displayCardPosition(parent)
    const to = props.displayCardPosition(version)
    const start = from.x + props.windowDimensions.width
    const end = to.x
    const batchable = parent.id !== 'v0' && version.step === parent.step + 1
      && Math.abs(from.y + props.cardHeight(parent) / 2 - to.y - props.cardHeight(version) / 2) < 1
    const previous = groups[groups.length - 1]
    if (batchable && previous?.batchable && previous.lane === version.lane && previous.color === color
      && previous.width === width && previous.opacity === opacity && start > previous.end + width + 10) {
      previous.ids.push(version.id)
      previous.paths.push(path)
      previous.end = end
    } else {
      groups.push({ ids: [version.id], paths: [path], lane: version.lane, color, width, opacity, end, batchable })
    }
  }
  return groups
})
</script>

<template>
  <svg class="connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5" :markerWidth="arrowSize" :markerHeight="arrowSize" markerUnits="strokeWidth" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="var(--theme-connector-outline)" stroke-width="0.8" stroke-linejoin="round" /></marker>
    </defs>
    <template v-for="group in straightGroups" :key="`edge-${group.ids[0]}`">
      <path :d="group.paths.join(' ')" class="connection-outline" fill="none" stroke="var(--theme-connector-outline)" :stroke-width="group.width + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :data-version-connectors="group.ids.join(' ')" :d="group.paths.join(' ')" fill="none" :stroke="group.color" :stroke-width="group.width" stroke-linecap="round" stroke-linejoin="round" :opacity="group.opacity" />
    </template>
    <template v-for="{ version } in mergeConnections.filter((item) => !item.curved)" :key="`merge-edge-${version.id}`">
      <path :d="mergeConnectionPath(version)" class="connection-outline" fill="none" stroke="var(--theme-connector-outline)"
        :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :id="`merge-connector-${version.id}`" :d="mergeConnectionPath(version)" fill="none" :stroke="mergeConnectionColor(version)"
        :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round"
        :opacity="version.id === activeId || version.mergeSourceId === activeId ? 0.96 : 0.76" />
    </template>
    <template v-for="version in visibleVersions.filter((item) => !parentIds.has(item.id) && item.id !== arrivingVersionId)" :key="`tail-${version.id}`">
      <path :d="`M ${cardPosition(version).x + windowDimensions.width} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + windowDimensions.width + terminalTailEnd(version)}`" class="connection-outline" fill="none" stroke="var(--theme-connector-outline)" :stroke-width="connectionWidth(version) + 10" stroke-linecap="butt" />
      <path :data-version-tail="version.id" :d="`M ${cardPosition(version).x + windowDimensions.width} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + windowDimensions.width + terminalTailEnd(version)}`" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="butt" marker-end="url(#arrow)" />
    </template>
    <template v-for="version in curvedConnections" :key="`branch-edge-${version.id}`">
      <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="var(--theme-connector-outline)" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :data-version-connectors="version.id" :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === activeId || version.parentId === activeId ? 0.96 : 0.76" />
    </template>
    <template v-for="{ version } in mergeConnections.filter((item) => item.curved)" :key="`merge-edge-${version.id}`">
      <path :d="mergeConnectionPath(version)" class="connection-outline" fill="none" stroke="var(--theme-connector-outline)"
        :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :id="`merge-connector-${version.id}`" :d="mergeConnectionPath(version)" fill="none" :stroke="mergeConnectionColor(version)"
        :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round"
        :opacity="version.id === activeId || version.mergeSourceId === activeId ? 0.96 : 0.76" />
    </template>
  </svg>

</template>
