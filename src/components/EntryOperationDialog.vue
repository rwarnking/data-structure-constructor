<script setup lang="ts">
import { actionIcons } from '../config/icons'
const { split: SplitIcon, mergeEntries: MergeEntriesIcon, add: Plus, close: X } = actionIcons
import type { EntryOperation, TreeNode } from '../types/workspace'
import { findNode } from '../utils/tree'

defineProps<{ entryOperation: EntryOperation; data: TreeNode[] }>()
const emit = defineEmits<{ close: []; commit: []; 'add-split': []; 'remove-split': [id: string] }>()
</script>

<template>
  <div class="editor-scrim" @click.self="emit('close')">
    <form class="entry-editor operation-editor" :class="{ 'table-editor': entryOperation.mode === 'split' }" @submit.prevent="emit('commit')">
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
        <div class="editor-actions"><button type="button" class="cancel-button" @click="emit('close')">Cancel</button><button type="submit" class="primary-button" :disabled="!entryOperation.value.trim()"><MergeEntriesIcon :size="15" /> Merge entries</button></div>
      </template>
      <template v-else>
        <p class="operation-note">Each original child must be assigned to exactly one resulting entry.</p>
        <div class="entry-draft-table-wrap">
          <table class="entry-draft-table">
            <thead><tr><th scope="col">Name / Value</th><th scope="col">Description</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
            <tbody>
              <tr v-for="(entry, index) in entryOperation.entries" :key="entry.id">
                <td><input :id="`split-value-${entry.id}`" v-model="entry.value" maxlength="120" required :aria-label="`Result ${index + 1} name`" placeholder="Entry name" /></td>
                <td><input :id="`split-description-${entry.id}`" v-model="entry.description" maxlength="400" :aria-label="`Result ${index + 1} description`" placeholder="Optional description" /></td>
                <td><button v-if="entryOperation.entries.length > 2" type="button" class="quiet-icon" :aria-label="`Remove result ${index + 1}`" @click="emit('remove-split', entry.id)"><X :size="14" /></button></td>
              </tr>
            </tbody>
          </table>
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
        <div class="editor-actions"><button type="button" class="cancel-button" @click="emit('close')">Cancel</button><button type="submit" class="primary-button" :disabled="entryOperation.entries.some((entry) => !entry.value.trim())"><SplitIcon :size="15" /> Split entry</button></div>
      </template>
    </form>
  </div>
</template>
