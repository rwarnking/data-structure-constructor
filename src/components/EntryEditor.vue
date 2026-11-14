<script setup lang="ts">
import { Check, Plus, X } from '@lucide/vue'
import type { EditorState } from '../types/workspace'

defineProps<{ editor: EditorState; setEntryValueInput: (element: unknown) => void }>()
const emit = defineEmits<{ close: []; commit: []; 'add-row': []; 'remove-row': [id: string] }>()
</script>

<template>
  <div class="editor-scrim" @click.self="emit('close')">
    <form class="entry-editor" :class="{ 'table-editor': editor.mode === 'create' }" @submit.prevent="emit('commit')">
      <div class="editor-heading"><span class="section-label">{{ editor.mode === 'create' ? 'NEW ENTRY' : 'CHANGE VALUE' }}</span><button type="button" class="quiet-icon" title="Close" @click="emit('close')"><X :size="17" /></button></div>
      <template v-if="editor.mode === 'create'">
        <div class="entry-draft-table-wrap">
          <table class="entry-draft-table">
            <thead><tr><th scope="col">Name / Value</th><th scope="col">Description</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
            <tbody>
              <tr v-for="(entry, index) in editor.entries" :key="entry.id">
                <td>
                  <input :id="`entry-value-${entry.id}`" :ref="index === 0 ? setEntryValueInput : undefined"
                    v-model="entry.value" maxlength="120" required placeholder="Entry name" />
                </td>
                <td><input :id="`entry-description-${entry.id}`" v-model="entry.description"
                  maxlength="400" placeholder="Optional description" /></td>
                <td>
                  <button v-if="editor.entries.length > 1" type="button" class="quiet-icon"
                    :aria-label="`Remove entry ${index + 1}`" @click="emit('remove-row', entry.id)"><X :size="14" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button" class="add-draft-button" @click="emit('add-row')"><Plus :size="14" /> Add another entry</button>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="emit('close')">Cancel</button><button type="submit" class="primary-button" :disabled="editor.entries.some((entry) => !entry.value.trim())"><Check :size="15" /> Add {{ editor.entries.length }} {{ editor.entries.length === 1 ? 'entry' : 'entries' }}</button></div>
      </template>
      <template v-else>
        <label class="editor-label" for="entry-value">New value</label>
        <input id="entry-value" :ref="setEntryValueInput" v-model="editor.value" maxlength="120" placeholder="e.g. Research notes" />
        <label class="editor-label" for="entry-description">Description <span>optional</span></label>
        <textarea id="entry-description" v-model="editor.description" maxlength="400" rows="3" placeholder="Shown when you hover over this entry"></textarea>
        <div class="editor-actions"><button type="button" class="cancel-button" @click="emit('close')">Cancel</button><button type="submit" class="primary-button" :disabled="!editor.value.trim()"><Check :size="15" /> Confirm</button></div>
      </template>
    </form>
  </div>
</template>
