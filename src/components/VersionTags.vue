<script setup lang="ts">
import { computed } from 'vue'
import type { Version, VersionTag } from '../types/workspace'
import { displayVersionId } from '../utils/versions'
import { actionIcons } from '../config/icons'

const props = defineProps<{ versions: Version[]; editing?: Version; draft: VersionTag }>()
const emit = defineEmits<{ close: []; save: [tag: VersionTag]; remove: []; focus: [version: Version]; 'update:draft': [draft: VersionTag] }>()
const { close: Close } = actionIcons
const title = computed({ get: () => props.draft.title, set: (value: string) => emit('update:draft', { ...props.draft, title: value }) })
const description = computed({ get: () => props.draft.description, set: (value: string) => emit('update:draft', { ...props.draft, description: value }) })
</script>

<template>
  <div class="editor-scrim" @click.self="emit('close')" @keydown.esc.stop="emit('close')">
    <form v-if="editing" class="entry-editor" role="dialog" aria-modal="true" aria-label="Version tag"
      @submit.prevent="emit('save', { title: draft.title.trim(), description: draft.description.trim() })">
      <div class="editor-heading"><span class="section-label">TAG {{ displayVersionId(editing) }}</span>
        <button type="button" class="quiet-icon" aria-label="Close tag editor" @click="emit('close')"><Close :size="17" /></button></div>
      <label class="editor-label" for="tag-title">Title</label>
      <input id="tag-title" v-model="title" maxlength="120" required autofocus />
      <label class="editor-label" for="tag-description">Description</label>
      <textarea id="tag-description" v-model="description" maxlength="2000" rows="4"></textarea>
      <div class="editor-actions">
        <button v-if="editing.tag" type="button" class="cancel-button" @click="emit('remove')">Remove tag</button>
        <button type="button" class="cancel-button" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary-button" :disabled="!draft.title.trim()">Save tag</button>
      </div>
    </form>
    <section v-else class="entry-editor" role="dialog" aria-modal="true" aria-label="All tags">
      <div class="editor-heading"><span class="section-label">ALL TAGS</span>
        <button type="button" class="quiet-icon" aria-label="Close tags" @click="emit('close')"><Close :size="17" /></button></div>
      <div class="version-search-results">
        <button v-for="version in versions.filter((item) => item.tag)" :key="version.id" type="button" @click="emit('focus', version)">
          <strong>{{ version.tag?.title }} · {{ displayVersionId(version) }}</strong>
          <span>{{ version.tag?.description }}</span>
        </button>
        <span v-if="!versions.some((version) => version.tag)" class="interaction-empty">No tags in this room</span>
      </div>
    </section>
  </div>
</template>
