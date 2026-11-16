<script setup lang="ts">
import { ref } from 'vue'
import { actionIcons } from '../config/icons'
const { delete: Trash2, close: X } = actionIcons

defineProps<{ localRooms: string[]; currentRoomName: string }>()
const newRoomName = defineModel<string>({ required: true })
const emit = defineEmits<{ close: []; activate: [room: string]; delete: [room: string]; create: []; error: [] }>()
const joinInput = ref('')
const joinError = ref('')
function reportError(message: string) {
  joinError.value = message
  emit('error')
}
function joinRoom() {
  const input = joinInput.value.trim()
  let room = input
  if (/^(?:https?|ftp):/i.test(input) || /^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    let url: URL
    try { url = new URL(input) }
    catch { reportError('Enter a valid room URL or name.'); return }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reportError('Room links must use HTTP or HTTPS.')
      return
    }
    room = url.searchParams.get('room')?.trim() ?? ''
    if (!room) { reportError('The room link must include a room name.'); return }
  }
  if (!room || room.length > 80) {
    reportError('Enter a room name of 1–80 characters.')
    return
  }
  joinError.value = ''
  emit('activate', room)
}
</script>

<template>
  <div class="editor-scrim room-manager-scrim" @click.self="emit('close')">
    <section class="entry-editor room-manager" role="dialog" aria-modal="true" aria-labelledby="room-manager-title">
      <div class="editor-heading">
        <span id="room-manager-title" class="section-label">CHANGE ROOM</span>
        <button type="button" class="quiet-icon" title="Close" @click="emit('close')"><X :size="17" /></button>
      </div>
      <p class="operation-note">Each room keeps its own branches, versions, entries, and ten recent interactions on this device.</p>
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
        <div class="room-form-row">
          <input id="new-room-name" v-model="newRoomName" maxlength="80" placeholder="Room name" />
          <button type="submit" class="primary-button" :disabled="!newRoomName.trim()">Create room</button>
        </div>
      </form>
      <form class="new-room-form" @submit.prevent="joinRoom">
        <label class="editor-label" for="join-room-name">Join a room</label>
        <div class="room-form-row">
          <input id="join-room-name" v-model="joinInput" placeholder="Room name or invite link" @input="joinError = ''" />
          <button type="submit" class="primary-button">Join room</button>
        </div>
        <p v-if="joinError" class="room-error" role="alert">{{ joinError }}</p>
        <div class="editor-actions">
          <button type="button" class="cancel-button" @click="emit('close')">Cancel</button>
        </div>
      </form>
    </section>
  </div>
</template>
