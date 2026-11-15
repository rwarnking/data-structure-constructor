<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Search, X } from '@lucide/vue'
import type { Version } from '../types/workspace'
import { displayVersionId } from '../utils/versions'

const props = defineProps<{ versions: Version[] }>()
const emit = defineEmits<{ close: []; focus: [version: Version] }>()
type Query = [string, string, string]
const storageKey = 'canopy-recent-version-searches-v1'
const query = ref<Query>(['', '', ''])
const recent = ref<Query[]>([])
const firstInput = ref<HTMLInputElement | null>(null)
const hasQuery = computed(() => query.value.some((part) => part.trim()))
const matches = computed(() => hasQuery.value ? props.versions.filter((version) => {
  const [step, branch, ...rest] = displayVersionId(version).split('.')
  const parts = [step ?? '', branch ?? '', rest.join('.')]
  return query.value.every((part, index) => !part.trim() || parts[index]!.includes(part.trim()))
}) : [])

function remember() {
  if (!hasQuery.value) return
  const item: Query = [query.value[0].trim(), query.value[1].trim(), query.value[2].trim()]
  recent.value = [item, ...recent.value.filter((previous) => previous.some((part, index) => part !== item[index]))].slice(0, 3)
  localStorage.setItem(storageKey, JSON.stringify(recent.value))
}
function choose(version: Version) {
  remember()
  emit('focus', version)
}
onMounted(() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (Array.isArray(saved)) recent.value = saved.filter((item): item is Query =>
      Array.isArray(item) && item.length === 3 && item.every((part) => typeof part === 'string')).slice(0, 3)
  } catch (error) {
    console.warn('Could not load recent version searches', error)
  }
  void nextTick(() => firstInput.value?.focus())
})
</script>

<template>
  <div class="editor-scrim search-scrim" @click.self="emit('close')" @keydown.esc.prevent.stop="emit('close')">
    <section class="version-search entry-editor" role="dialog" aria-modal="true" aria-label="Search versions">
      <div class="editor-heading"><span class="section-label">SEARCH VERSIONS</span><button type="button" class="quiet-icon" aria-label="Close search" @click="emit('close')"><X :size="17" /></button></div>
      <form class="version-search-fields" @submit.prevent="remember">
        <Search :size="16" />
        <input ref="firstInput" v-model="query[0]" aria-label="Version step" placeholder="Step" />
        <span>.</span><input v-model="query[1]" aria-label="Version branch" placeholder="Branch" />
        <span>.</span><input v-model="query[2]" aria-label="Version subbranch" placeholder="Subbranch" />
        <button type="submit" class="primary-button">Search</button>
      </form>
      <div v-if="!hasQuery" class="version-search-results">
        <span class="section-label">RECENT SEARCHES</span>
        <button v-for="item in recent" :key="JSON.stringify(item)" type="button" @click="query = [...item]">
          {{ item.map((part) => part || '*').join('.') }}
        </button>
        <span v-if="!recent.length" class="interaction-empty">No recent searches</span>
      </div>
      <div v-else class="version-search-results">
        <span class="section-label">RESULTS</span>
        <button v-for="version in matches" :key="version.id" type="button" @click="choose(version)">
          <strong>{{ displayVersionId(version) }}</strong><span>{{ version.change }}</span>
        </button>
        <span v-if="!matches.length" class="interaction-empty">No matching versions</span>
      </div>
    </section>
  </div>
</template>
