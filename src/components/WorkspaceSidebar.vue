<script setup lang="ts">
import { ChevronDown, Layers3, Moon, Sun } from '@lucide/vue'
import type { RoomStatus } from '../collaboration'
import type { InteractionEntry } from '../types/collaboration'
import type { Version } from '../types/workspace'
import { userColor, versionColor } from '../utils/colors'
import { findNode } from '../utils/tree'
import { displayVersionId } from '../utils/versions'

defineProps<{
  sidebarCollapsed: boolean; darkMode: boolean; currentRoomName: string; roomStatus: RoomStatus
  connectedUsers: { id: string; name: string; activeVersionId: string | null }[]
  clientId: string; versions: Version[]; recentInteractions: InteractionEntry[]
  branchCount: number; active: Version; activeNodes: number; activeChildren: number
}>()
const emit = defineEmits<{
  'toggle-sidebar': []; 'toggle-theme': []; 'change-room': []; 'copy-invite': []
  'focus-collaborator': [id: string]; 'focus-ping': [location: { x: number; y: number }]
  navigate: [entry: InteractionEntry, kind: 'node' | 'version']; 'focus-active': []
}>()
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <div class="sidebar-head">
      <span class="brand-mark"><Layers3 :size="19" :stroke-width="2.2" /></span>
      <span class="brand-name">DSC</span>
      <button class="quiet-icon sidebar-toggle" :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'" :aria-expanded="!sidebarCollapsed"
        @click="emit('toggle-sidebar')"><ChevronDown :size="16" /></button>
    </div>
    <section class="side-section settings-section">
      <button type="button" class="theme-toggle" @click="emit('toggle-theme')">
        <component :is="darkMode ? Sun : Moon" :size="15" />
        <span>{{ darkMode ? 'Light mode' : 'Dark mode' }}</span>
      </button>
    </section>
    <section class="side-section session-section">
      <div class="section-label">CURRENT ROOM</div>
      <div class="current-room-name" :title="currentRoomName">{{ currentRoomName }}</div>
      <div class="session-status" :class="`status-${roomStatus.state}`" role="status" aria-live="polite">
        {{ roomStatus.state === 'hosting' ? 'Hosting' : roomStatus.state === 'connected' ? 'Connected' : roomStatus.message }}
      </div>
      <div class="session-actions">
        <button type="button" class="session-button" @click="emit('change-room')">Change Room</button>
        <button type="button" class="session-button secondary" @click="emit('copy-invite')">Copy Invite</button>
      </div>
    </section>
    <section class="side-section collaborators-section">
      <div class="section-label">COLLABORATORS</div>
      <div class="collaborator-list">
        <button v-for="user in connectedUsers" :key="user.id" type="button" class="collaborator"
          :disabled="!user.activeVersionId || !versions.some((version) => version.id === user.activeVersionId)"
          :title="`${user.name} · ${user.activeVersionId ? displayVersionId(user.activeVersionId) : 'No active version'}`"
          @click="emit('focus-collaborator', user.id)">
          <span class="collaborator-avatar" :style="{ '--collaborator-color': userColor(user.id) }" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
          </span>
          <span class="collaborator-info"><strong>{{ user.name }}<span v-if="user.id === clientId"> (you)</span></strong>
            <small>{{ user.activeVersionId && versions.some((version) => version.id === user.activeVersionId)
              ? displayVersionId(user.activeVersionId)
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
          <span class="interaction-user" :style="{ color: userColor(entry.actorId) }">{{ entry.actorName }}</span>
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
            {{ displayVersionId(entry.versionId) }}
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
      <button type="button" class="active-version-card" title="Focus active version · F" @click="emit('focus-active')">
        <div class="active-version-top"><span class="version-pip" :style="{ background: versionColor(active) }"></span><span> Branch {{ active.branch }} | {{ displayVersionId(active.id) }} | Step {{ active.step }}</span></div>
        <strong>{{ active.change }}</strong>
        <div class="active-meta"><span>Entries</span><strong>{{ activeNodes }}</strong></div>
        <div class="active-meta"><span>Current step</span><strong>{{ String(active.step).padStart(2, '0') }}</strong></div>
        <div class="active-meta"><span>Paths from here</span><strong>{{ activeChildren }}</strong></div>
      </button>
    </section>
  </aside>

</template>
