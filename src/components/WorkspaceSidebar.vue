<script setup lang="ts">
import { ref } from 'vue'
import { actionIcons, actionSymbols } from '../config/icons'
import { shortcutLabel } from '../config/hotkeys'
import type { RoomStatus } from '../collaboration'
import type { InteractionEntry } from '../types/collaboration'
import type { Version } from '../types/workspace'
import { versionColor } from '../utils/colors'
import { findNode } from '../utils/tree'
import { displayVersionChange, displayVersionId } from '../utils/versions'

const props = defineProps<{
  sidebarCollapsed: boolean; darkMode: boolean; currentRoomName: string; roomStatus: RoomStatus; localOnly: boolean
  connectedUsers: { id: string; name: string; activeVersionId: string | null }[]
  clientId: string; versions: Version[]; recentInteractions: InteractionEntry[]
  colorForUser: (id: string) => string
  branchCount: number; active: Version; activeNodes: number; activeChildren: number
  volume: number; muted: boolean; branchingEnabled: boolean
  replayMode: boolean
}>()
const { expand: ChevronDown, export: Download, layers: Layers3, darkMode: Moon,
  settings: Settings, lightMode: Sun, import: Upload, tag: TagIcon, changeRoom: ChangeRoom } = actionIcons
const settingsOpen = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const importKind = ref<'data' | 'replay'>('data')
function chooseImport(kind: 'data' | 'replay') {
  importKind.value = kind
  importInput.value?.click()
}
function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    if (importKind.value === 'replay') emit('replay-file', file)
    else emit('import-data', file)
  }
  input.value = ''
  settingsOpen.value = false
}
function versionLabel(id: string) {
  const version = props.versions.find((item) => item.id === id)
  return version ? displayVersionId(version) : id
}
function interactionSymbol(entry: InteractionEntry) {
  const action = (entry.action.split(' · ').at(-1) ?? entry.action).toLowerCase()
  if (entry.ping) return '◎'
  if (action.includes('merge')) return actionSymbols.merge
  if (action.includes('split')) return actionSymbols.split
  if (action.includes('delete') || action.includes('cut') || action.includes('removed')) return actionSymbols.delete
  if (action.includes('detach')) return actionSymbols.detach
  if (action.includes('move')) return actionSymbols.move
  if (action.includes('add') || action.includes('create') || action.includes('paste')) return actionSymbols.add
  return actionSymbols.modify
}
function interactionAvailable(entry: InteractionEntry) {
  return !!entry.ping || !!entry.versionId && props.versions.some((version) => version.id === entry.versionId)
}
function focusInteraction(entry: InteractionEntry) {
  if (entry.ping) emit('focus-ping', entry.ping)
  else if (entry.nodeId && entry.versionId && props.versions.some((version) =>
    version.id === entry.versionId && findNode(version.data, entry.nodeId!))) emit('navigate', entry, 'node')
  else {
    const version = props.versions.find((item) => item.id === entry.versionId)
    const parent = props.versions.find((item) => item.id === version?.parentId)
    if (entry.nodeId && parent && findNode(parent.data, entry.nodeId)) {
      emit('navigate', { ...entry, versionId: parent.id }, 'node')
    } else emit('navigate', entry, 'version')
  }
}
const emit = defineEmits<{
  'toggle-sidebar': []; 'toggle-theme': []; 'change-room': []; 'copy-invite': []
  'focus-collaborator': [id: string]; 'focus-ping': [location: { x: number; y: number }]
  navigate: [entry: InteractionEntry, kind: 'node' | 'version']; 'focus-active': []
  'import-data': [file: File]; 'export-data': []; 'show-tags': []
  'export-log': []; 'replay-file': [file: File]
  'set-volume': [value: number]; 'toggle-mute': []; 'set-branching': [enabled: boolean]
}>()
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <div class="sidebar-head">
      <span class="brand-mark"><Layers3 :size="19" :stroke-width="2.2" /></span>
      <span class="brand-name">HIVERSE</span>
      <button class="quiet-icon sidebar-settings" title="Settings" aria-label="Settings" :aria-expanded="settingsOpen"
        @click="settingsOpen = !settingsOpen"><Settings :size="16" /></button>
      <button class="quiet-icon sidebar-toggle" :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'" :aria-expanded="!sidebarCollapsed"
        @click="emit('toggle-sidebar')"><ChevronDown :size="16" /></button>
    </div>
    <div v-if="sidebarCollapsed" class="compact-sidebar">
      <button type="button" class="quiet-icon compact-room" title="Change Room" aria-label="Change Room"
        @click="emit('change-room')"><ChangeRoom :size="19" /></button>
      <div class="compact-collaborators" aria-label="Collaborators">
        <button v-for="user in connectedUsers" :key="user.id" type="button" class="collaborator compact-user"
          :disabled="!user.activeVersionId || !versions.some((version) => version.id === user.activeVersionId)"
          :title="`${user.name} · ${user.activeVersionId ? versionLabel(user.activeVersionId) : 'No active version'}`"
          :aria-label="`Focus ${user.name}${user.id === clientId ? ' (you)' : ''}`"
          @click="emit('focus-collaborator', user.id)">
          <span class="collaborator-avatar" :style="{ '--collaborator-color': colorForUser(user.id) }" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
          </span>
        </button>
      </div>
      <div class="sidebar-fill"></div>
      <ol class="compact-interactions" aria-label="Interaction log">
        <li v-for="entry in recentInteractions" :key="entry.id">
          <button type="button" class="quiet-icon compact-interaction" :disabled="!interactionAvailable(entry)"
            :style="{ color: entry.actorColor || colorForUser(entry.actorId) }" :title="`${entry.actorName}: ${entry.action}`"
            :aria-label="`${entry.actorName}: ${entry.action}`" @click="focusInteraction(entry)">{{ interactionSymbol(entry) }}</button>
        </li>
      </ol>
    </div>
    <section v-if="settingsOpen" class="side-section settings-section">
      <button type="button" class="theme-toggle" @click="emit('show-tags'); settingsOpen = false"><TagIcon :size="15" /><span>Show tagged versions</span></button>
      <button type="button" class="theme-toggle" @click="emit('toggle-mute')">{{ muted ? 'Unmute sound' : 'Mute sound' }}</button>
      <label class="volume-control">Volume
        <input type="range" min="0" max="1" step="0.05" :value="volume" aria-label="Volume"
          @input="emit('set-volume', Number(($event.target as HTMLInputElement).value))" />
      </label>
      <button type="button" class="theme-toggle" :disabled="replayMode" :aria-pressed="branchingEnabled" @click="emit('set-branching', !branchingEnabled)">
        Branching {{ branchingEnabled ? 'on' : 'off' }}
      </button>
      <button type="button" class="theme-toggle" @click="emit('toggle-theme')">
        <component :is="darkMode ? Sun : Moon" :size="15" />
        <span>{{ darkMode ? 'Light mode' : 'Dark mode' }}</span>
      </button>
      <button type="button" class="theme-toggle" @click="chooseImport('data')"><Upload :size="15" /><span>Import data</span></button>
      <button type="button" class="theme-toggle" @click="emit('export-data'); settingsOpen = false"><Download :size="15" /><span>Export data</span></button>
      <button v-if="!replayMode" type="button" class="theme-toggle" @click="emit('export-log')"><Download :size="15" /><span>Export Interaction Log</span></button>
      <button type="button" class="theme-toggle" @click="chooseImport('replay')"><Upload :size="15" /><span>Replay Interaction Log</span></button>
      <input ref="importInput" type="file" accept=".json,application/json" hidden @change="importFile" />
    </section>
    <section class="side-section session-section">
      <div class="section-label">CURRENT ROOM</div>
      <div class="current-room-name" :title="currentRoomName">{{ currentRoomName }}</div>
      <div class="session-status" :class="`status-${roomStatus.state}`" role="status" aria-live="polite">
        {{ roomStatus.state === 'hosting' ? 'Hosting' : roomStatus.state === 'connected' ? 'Connected' : roomStatus.message }}
      </div>
      <div class="session-actions">
        <button type="button" class="session-button" @click="emit('change-room')">Change Room</button>
        <button type="button" class="session-button secondary" :disabled="localOnly"
          :title="localOnly ? 'Imported rooms are local only' : 'Copy room invite'" @click="emit('copy-invite')">Copy Invite</button>
      </div>
    </section>
    <section class="side-section collaborators-section">
      <div class="section-label">COLLABORATORS</div>
      <div class="collaborator-list">
        <button v-for="user in connectedUsers" :key="user.id" type="button" class="collaborator"
          :disabled="!user.activeVersionId || !versions.some((version) => version.id === user.activeVersionId)"
          :title="`${user.name} · ${user.activeVersionId ? versionLabel(user.activeVersionId) : 'No active version'}`"
          @click="emit('focus-collaborator', user.id)">
          <span class="collaborator-avatar" :style="{ '--collaborator-color': colorForUser(user.id) }" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
          </span>
          <span class="collaborator-info"><strong>{{ user.name }}<span v-if="user.id === clientId"> (you)</span></strong>
            <small>{{ user.activeVersionId && versions.some((version) => version.id === user.activeVersionId)
              ? versionLabel(user.activeVersionId)
              : 'No active version' }}</small>
          </span>
        </button>
      </div>
    </section>
    <div class="sidebar-fill"></div>
    <section class="side-section interaction-section">
      <div class="interaction-heading"><span class="section-label">INTERACTION LOG</span><small>LAST 10</small></div>
      <ol v-if="recentInteractions.length" class="interaction-list">
        <li v-for="entry in recentInteractions" :key="entry.id">
          <span class="interaction-user" :style="{ color: entry.actorColor || colorForUser(entry.actorId) }">{{ entry.actorName }}</span>
          <span class="interaction-action">{{ entry.action }}</span>
          <button v-if="entry.ping" class="interaction-reference" type="button"
            :title="`Focus ping by ${entry.actorName}`" @click="emit('focus-ping', entry.ping)">Ping location</button>
          <button v-if="entry.nodeId && entry.versionId
            && versions.some((version) => version.id === entry.versionId && findNode(version.data, entry.nodeId!))"
            class="interaction-reference" type="button" @click="emit('navigate', entry, 'node')">
            {{ entry.nodeLabel || 'Entry' }}
          </button>
          <button v-if="entry.versionId && versions.some((version) => version.id === entry.versionId)"
            class="interaction-reference" type="button" @click="emit('navigate', entry, 'version')">
            {{ versionLabel(entry.versionId) }}
          </button>
          <span class="interaction-time">{{ new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
        </li>
      </ol>
      <span v-else class="interaction-empty">Room actions appear here.</span>
    </section>
    <section class="side-section overview-section">
      <div class="section-label">ROOM OVERVIEW</div>
      <div class="metric-row"><span>Branches</span><strong>{{ branchCount }}</strong></div>
      <div class="metric-row"><span>Versions</span><strong>{{ versions.length }}</strong></div>
    </section>
    <section class="side-section active-section">
      <div class="section-label">YOUR ACTIVE VERSION</div>
      <button type="button" class="active-version-card" :title="`Focus active version · ${shortcutLabel('focus')}`" @click="emit('focus-active')">
        <div class="active-version-top"><span class="version-pip" :style="{ background: versionColor(active) }"></span><span :title="displayVersionId(active)">{{ displayVersionId(active) }}</span></div>
        <strong>{{ displayVersionChange(active) }}</strong>
        <div class="active-meta"><span>Entries</span><strong>{{ activeNodes }}</strong></div>
        <div class="active-meta"><span>Current step</span><strong>{{ String(active.number?.step ?? 0).padStart(2, '0') }}</strong></div>
        <div class="active-meta"><span>Paths from here</span><strong>{{ activeChildren }}</strong></div>
      </button>
    </section>
  </aside>

</template>
