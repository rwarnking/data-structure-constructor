<script setup lang="ts">
import { GitBranch, Layers3, Plus, X } from '@lucide/vue'
import type { EntryOperation, TreeNode } from '../types/workspace'
import { findNode } from '../utils/tree'

defineProps<{ entryOperation: EntryOperation; data: TreeNode[] }>()
const emit = defineEmits<{ close: []; commit: []; 'add-split': []; 'remove-split': [id: string] }>()
</script>

<template>
  <div class="editor-scrim" @click.self="emit('close')">
    <form class="entry-editor operation-editor" @submit.prevent="emit('commit')">
      <div class="editor-heading">
        <span class="section-label">{{ entryOperation.mode === 'merge' ? 'MERGE ENTRIES' : 'SPLIT ENTRY' }}</span>
        <button type="button" class="quiet-icon" title="Close" @click="emit('close')"><X :size="17" /></button>
      </div>
      <template v-if="entryOperation.mode === 'merge'">
        <p class="operation-note">Selected entries and their children will be combined under one entry. Existing descendants are kept without duplication.</p>
        <label class="editor-label" for="merge-entry-value">Resulting entry name</label>
        <input id="merge-entry-value" v-model="entryOperation.value" maxlength="120" />
        <label class="editor-label" for="merge-entry-description">Description <span>optional</span></label>
        <textarea id="merge-entry-description" v-model="entryOperation.description" maxlength="400" rows="3"></textarea>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="emit('close')">Cancel</button><button type="submit" class="primary-button" :disabled="!entryOperation.value.trim()"><Layers3 :size="15" /> Merge entries</button></div>
      </template>
      <template v-else>
        <p class="operation-note">Each original child must be assigned to exactly one resulting entry.</p>
        <div v-for="(entry, index) in entryOperation.entries" :key="entry.id" class="entry-draft-row">
          <div class="entry-draft-heading"><strong>Result {{ index + 1 }}</strong><button v-if="entryOperation.entries.length > 2" type="button" class="quiet-icon" :aria-label="`Remove result ${index + 1}`" @click="emit('remove-split', entry.id)"><X :size="14" /></button></div>
          <label class="editor-label" :for="`split-value-${entry.id}`">Entry name</label>
          <input :id="`split-value-${entry.id}`" v-model="entry.value" maxlength="120" />
          <label class="editor-label" :for="`split-description-${entry.id}`">Description <span>optional</span></label>
          <textarea :id="`split-description-${entry.id}`" v-model="entry.description" maxlength="400" rows="2"></textarea>
        </div>
        <button type="button" class="add-draft-button" @click="emit('add-split')"><Plus :size="14" /> Add result entry</button>
        <div v-if="findNode(data, entryOperation.nodeId)?.children.length" class="child-assignment-list">
          <strong>Assign existing children</strong>
          <label v-for="child in findNode(data, entryOperation.nodeId)!.children" :key="child.id">
            <span>{{ child.value }}</span>
            <select v-model="entryOperation.assignments[child.id]" :aria-label="`Assign ${child.value} to a result entry`">
              <option v-for="(entry, index) in entryOperation.entries" :key="entry.id" :value="entry.id">Result {{ index + 1 }} · {{ entry.value || 'Unnamed' }}</option>
            </select>
          </label>
        </div>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="emit('close')">Cancel</button><button type="submit" class="primary-button" :disabled="entryOperation.entries.some((entry) => !entry.value.trim())"><GitBranch :size="15" /> Split entry</button></div>
      </template>
    </form>
  </div>
</template>
