<script setup lang="ts">
import { actionIcons } from '../config/icons'
const { delete: Trash2, close: X } = actionIcons

defineProps<{ localRooms: string[]; currentRoomName: string }>()
const newRoomName = defineModel<string>({ required: true })
const emit = defineEmits<{ close: []; activate: [room: string]; delete: [room: string]; create: [] }>()
</script>

<template>
  <div class="editor-scrim room-manager-scrim" @click.self="emit('close')">
    <section class="entry-editor room-manager" role="dialog" aria-modal="true" aria-labelledby="room-manager-title">
      <div class="editor-heading">
        <span id="room-manager-title" class="section-label">CHANGE ROOM</span>
        <button type="button" class="quiet-icon" title="Close" @click="emit('close')"><X :size="17" /></button>
      </div>
      <p class="operation-note">Each room keeps its own branches, versions, entries, and interaction log on this device.</p>
      <div class="local-room-list">
        <div v-for="room in localRooms" :key="room" class="local-room-row">
          <button type="button" class="local-room-select" :disabled="room === currentRoomName"
            @click="emit('activate', room)">
            <span>{{ room }}</span><small v-if="room === currentRoomName">Current</small>
          </button>
          <button v-if="room !== currentRoomName" type="button" class="local-room-delete"
            :aria-label="`Delete locally saved room ${room}`" @click="emit('delete', room)">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
      <form class="new-room-form" @submit.prevent="emit('create')">
        <label class="editor-label" for="new-room-name">Create a new empty room</label>
        <input id="new-room-name" v-model="newRoomName" maxlength="80" placeholder="Room name" />
        <div class="editor-actions">
          <button type="button" class="cancel-button" @click="emit('close')">Cancel</button>
          <button type="submit" class="primary-button" :disabled="!newRoomName.trim()">Create room</button>
        </div>
      </form>
    </section>
  </div>
</template>
