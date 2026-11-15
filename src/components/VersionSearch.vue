<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { actionIcons } from '../config/icons'
import type { TreeNode, Version } from '../types/workspace'
import { displayVersionChange, displayVersionId } from '../utils/versions'

const props = defineProps<{ versions: Version[]; actionForVersion: (version: Version) => string }>()
const { close: X } = actionIcons
const emit = defineEmits<{ close: []; focus: [version: Version] }>()
type Query = { all: string; step: string; branch: string; subbranch: string; tag: string; action: string; entries: string }
const emptyQuery = (): Query => ({ all: '', step: '', branch: '', subbranch: '', tag: '', action: '', entries: '' })
const storageKey = 'canopy-recent-version-searches-v1'
const query = ref<Query>(emptyQuery())
const recent = ref<Query[]>([])
const firstInput = ref<HTMLInputElement | null>(null)
const hasQuery = computed(() => Object.values(query.value).some((part) => part.trim()))
function findMatchingEntry(nodes: TreeNode[], text: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.value.toLocaleLowerCase().includes(text) || node.description?.toLocaleLowerCase().includes(text)) return node
    const child = findMatchingEntry(node.children, text)
    if (child) return child
  }
}
const matches = computed(() => hasQuery.value ? props.versions.flatMap((version) => {
  const [step, branch, ...rest] = displayVersionId(version).split('.')
  const parts = [step ?? '', branch ?? '', rest.join('.')]
  const idQuery = [query.value.step, query.value.branch, query.value.subbranch].map((part) => part.trim())
  const identifier = idQuery.some(Boolean) && idQuery.every((part, index) => !part || parts[index]!.includes(part))
  const tagQuery = query.value.tag.trim().toLocaleLowerCase()
  const actionQuery = query.value.action.trim().toLocaleLowerCase()
  const entryQuery = query.value.entries.trim().toLocaleLowerCase()
  const allQuery = query.value.all.trim().toLocaleLowerCase()
  const action = actionQuery || allQuery ? props.actionForVersion(version).toLocaleLowerCase() : ''
  const tagTitle = !!tagQuery && !!version.tag?.title.toLocaleLowerCase().includes(tagQuery)
  const tagDescription = !!tagQuery && !!version.tag?.description.toLocaleLowerCase().includes(tagQuery)
  const actionMatches = !!actionQuery && (action.includes(actionQuery)
    || displayVersionChange(version).toLocaleLowerCase().includes(actionQuery))
  const entryMatch = entryQuery ? findMatchingEntry(version.data, entryQuery) : undefined
  const allEntryMatch = allQuery ? findMatchingEntry(version.data, allQuery) : undefined
  const entryMatches = !!entryMatch
  const allMatches = !!allQuery && (displayVersionId(version).toLocaleLowerCase().includes(allQuery)
    || !!version.tag?.title.toLocaleLowerCase().includes(allQuery)
    || !!version.tag?.description.toLocaleLowerCase().includes(allQuery)
    || action.includes(allQuery) || displayVersionChange(version).toLocaleLowerCase().includes(allQuery)
    || !!allEntryMatch)
  const reasons = [allMatches && 'All', identifier && 'Identifier', tagTitle && 'Tag title',
    tagDescription && 'Tag description', actionMatches && 'Action', entryMatches && 'Entry'].filter(Boolean)
  const matchedEntry = entryMatch ?? allEntryMatch
  const detail = matchedEntry ? [matchedEntry.value, matchedEntry.description].filter(Boolean).join(' · ')
    : actionMatches ? displayVersionChange(version) : version.tag?.description || displayVersionChange(version)
  return (!allQuery || allMatches) && (!idQuery.some(Boolean) || identifier)
    && (!tagQuery || tagTitle || tagDescription) && (!actionQuery || actionMatches) && (!entryQuery || entryMatches)
    ? [{ version, reasons, detail }] : []
}) : [])

function remember() {
  if (!hasQuery.value) return
  const item: Query = {
    all: query.value.all.trim(), step: query.value.step.trim(), branch: query.value.branch.trim(),
    subbranch: query.value.subbranch.trim(), tag: query.value.tag.trim(),
    action: query.value.action.trim(), entries: query.value.entries.trim(),
  }
  recent.value = [item, ...recent.value.filter((previous) => JSON.stringify(previous) !== JSON.stringify(item))].slice(0, 3)
  localStorage.setItem(storageKey, JSON.stringify(recent.value))
}
function recentLabel(item: Query) {
  const parts = [
    item.all && `All: ${item.all}`,
    (item.step || item.branch || item.subbranch) && [item.step, item.branch, item.subbranch].map((part) => part || '*').join('.'),
    item.tag && `Tag: ${item.tag}`, item.action && `Actions: ${item.action}`, item.entries && `Entries: ${item.entries}`,
  ]
  return parts.filter(Boolean).join(' · ')
}
function choose(version: Version) {
  remember()
  emit('focus', version)
}
onMounted(() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (Array.isArray(saved)) {
      recent.value = saved.flatMap((item: unknown) => {
        if (Array.isArray(item) && (item.length === 3 || item.length === 4) && item.every((part) => typeof part === 'string')) {
          return [{ ...emptyQuery(), step: item[0], branch: item[1], subbranch: item[2], tag: item[3] ?? '' }]
        }
        if (!item || typeof item !== 'object') return []
        const value = item as Record<string, unknown>
        const keys = Object.keys(emptyQuery()) as (keyof Query)[]
        if (!keys.every((key) => typeof value[key] === 'string')) return []
        return [{ all: value.all as string, step: value.step as string, branch: value.branch as string,
          subbranch: value.subbranch as string, tag: value.tag as string, action: value.action as string, entries: value.entries as string }]
      }).slice(0, 3)
    }
  } catch (error) {
    console.warn('Could not load recent version searches', error)
  }
  void nextTick(() => firstInput.value?.focus())
})
</script>

<template>
  <div class="editor-scrim search-scrim" @click.self="emit('close')" @keydown.esc.prevent.stop="emit('close')">
    <section class="version-search entry-editor" role="dialog" aria-modal="true" aria-label="Search versions">
      <div class="editor-heading"><span class="section-label">Search through</span><button type="button" class="quiet-icon" aria-label="Close search" @click="emit('close')"><X :size="17" /></button></div>
      <form class="version-search-fields" @submit.prevent="remember">
        <label class="version-search-row"><span>All</span><input ref="firstInput" v-model="query.all" aria-label="All" placeholder="Search everything" /></label>
        <div class="version-search-row">
          <span>Versions</span>
          <div class="version-search-number">
            <input v-model="query.step" aria-label="Version step" placeholder="Step" />
            <span>.</span><input v-model="query.branch" aria-label="Version branch" placeholder="Branch" />
            <span>.</span><input v-model="query.subbranch" aria-label="Version subbranch" placeholder="Subbranch" />
          </div>
        </div>
        <label class="version-search-row"><span>Tag &amp; Description</span><input v-model="query.tag" aria-label="Tag text" placeholder="Tag text or description" /></label>
        <label class="version-search-row"><span>Actions</span><input v-model="query.action" aria-label="Actions" placeholder="Action" /></label>
        <label class="version-search-row"><span>Entries &amp; Description</span><input v-model="query.entries" aria-label="Entries and description" placeholder="Entry text or description" /></label>
        <button type="submit" class="primary-button">Search</button>
      </form>
      <div v-if="!hasQuery" class="version-search-results">
        <span class="section-label">RECENT SEARCHES</span>
        <button v-for="item in recent" :key="JSON.stringify(item)" type="button" @click="query = { ...item }">{{ recentLabel(item) }}</button>
        <span v-if="!recent.length" class="interaction-empty">No recent searches</span>
      </div>
      <div v-else class="version-search-results">
        <span class="section-label">RESULTS</span>
        <button v-for="{ version, reasons, detail } in matches" :key="version.id" type="button" @click="choose(version)">
          <strong>{{ displayVersionId(version) }}<template v-if="version.tag"> · {{ version.tag.title }}</template></strong>
          <span>{{ reasons.join(', ') }} · {{ detail }}</span>
        </button>
        <span v-if="!matches.length" class="interaction-empty">No matching versions</span>
      </div>
    </section>
  </div>
</template>
