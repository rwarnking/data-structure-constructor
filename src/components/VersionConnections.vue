<script setup lang="ts">
import type { Version } from '../types/workspace'
import { versionColor } from '../utils/colors'

defineProps<{
  graphBounds: { width: number; height: number }
  windowDimensions: { width: number; height: number }
  versions: Version[]; visibleVersions: Version[]; visibleConnectionVersions: Version[]
  visibleMergeConnectionVersions: Version[]; activeId: string
  connectionPath: (version: Version) => string
  connectionWidth: (version: Version) => number
  isBranchCurve: (version: Version) => boolean
  mergeConnectionPath: (version: Version) => string
  mergeConnectionColor: (version: Version) => string
  cardPosition: (version: Version) => { x: number; y: number }
  cardHeight: (version: Version) => number
  terminalTailEnd: (version: Version) => number
  connectorLabelPosition: (source: Version, destination: Version) => { x: number; y: number }
  mergeConnectorLabelPosition: (version: Version) => { x: number; y: number }
  versionAction: (version: Version) => { symbol: string; label: string }
}>()
const arrowSize = 1.6
</script>

<template>
  <svg class="connection-layer" :width="graphBounds.width + 260" :height="graphBounds.height">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5" :markerWidth="arrowSize" :markerHeight="arrowSize" markerUnits="strokeWidth" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="#f5f7f4" stroke-width="0.8" stroke-linejoin="round" /></marker>
    </defs>
    <template v-for="version in visibleConnectionVersions.filter((item) => item.parentId && !isBranchCurve(item))" :key="`edge-${version.id}`">
      <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :id="`version-connector-${version.id}`" :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === activeId || version.parentId === activeId ? 0.96 : 0.76" />
    </template>
    <template v-for="version in visibleConnectionVersions.filter((item) => item.parentId && isBranchCurve(item))" :key="`branch-edge-${version.id}`">
      <path :d="connectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :id="`version-connector-${version.id}`" :d="connectionPath(version)" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round" :opacity="version.id === activeId || version.parentId === activeId ? 0.96 : 0.76" />
    </template>
    <template v-for="version in visibleMergeConnectionVersions" :key="`merge-edge-${version.id}`">
      <path :d="mergeConnectionPath(version)" class="connection-outline" fill="none" stroke="#f5f7f4"
        :stroke-width="connectionWidth(version) + 10" stroke-linecap="round" stroke-linejoin="round" />
      <path :id="`merge-connector-${version.id}`" :d="mergeConnectionPath(version)" fill="none" :stroke="mergeConnectionColor(version)"
        :stroke-width="connectionWidth(version)" stroke-linecap="round" stroke-linejoin="round"
        :opacity="version.id === activeId || version.mergeSourceId === activeId ? 0.96 : 0.76" />
    </template>
    <template v-for="version in visibleVersions.filter((item) => !versions.some((child) => child.parentId === item.id))" :key="`tail-${version.id}`">
      <path :d="`M ${cardPosition(version).x + windowDimensions.width} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + windowDimensions.width + terminalTailEnd(version)}`" class="connection-outline" fill="none" stroke="#f5f7f4" :stroke-width="connectionWidth(version) + 10" stroke-linecap="butt" />
      <path :d="`M ${cardPosition(version).x + windowDimensions.width} ${cardPosition(version).y + cardHeight(version) / 2} H ${cardPosition(version).x + windowDimensions.width + terminalTailEnd(version)}`" fill="none" :stroke="versionColor(version)" :stroke-width="connectionWidth(version)" stroke-linecap="butt" marker-end="url(#arrow)" />
    </template>
    <text v-for="version in visibleConnectionVersions.filter((item) => item.parentId)" :key="`connector-symbol-${version.id}`"
      class="connector-symbol" aria-hidden="true" text-anchor="middle" dominant-baseline="central"
      :x="connectorLabelPosition(versions.find((item) => item.id === version.parentId)!, version).x"
      :y="connectorLabelPosition(versions.find((item) => item.id === version.parentId)!, version).y">
      {{ versionAction(version).symbol }}
    </text>
    <text v-for="version in visibleMergeConnectionVersions" :key="`merge-symbol-${version.id}`"
      class="connector-symbol" aria-hidden="true" text-anchor="middle" dominant-baseline="central"
      :x="mergeConnectorLabelPosition(version).x" :y="mergeConnectorLabelPosition(version).y">⋈</text>
  </svg>

</template>
