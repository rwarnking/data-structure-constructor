<script setup lang="ts">
import { computed } from 'vue'
import type { Tile } from '../types/workspace'
import { layoutTileLabel } from '../utils/treemap'

const props = defineProps<{ tile: Tile }>()
const layout = computed(() => layoutTileLabel(props.tile))
</script>

<template>
  <text v-if="layout.lines.length" :x="tile.x + 5" :y="tile.y + layout.fontSize + 4"
    :style="{ fontSize: `${layout.fontSize}px` }" :aria-label="tile.label">
    <tspan v-for="(line, index) in layout.lines" :key="index" :x="tile.x + 5"
      :dy="index ? layout.fontSize * 1.15 : 0">{{ line }}</tspan>
  </text>
</template>
