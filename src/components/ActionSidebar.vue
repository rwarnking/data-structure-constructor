<script setup lang="ts">
import type { Component } from 'vue'
import { actionIcons as icons } from '../config/icons'
import { shortcutLabel, type ShortcutAction } from '../config/hotkeys'

type Item = { name: string; icon: Component; action?: ShortcutAction; gesture?: string; testId?: string; expandedOnly?: boolean }
defineProps<{
  collapsed: boolean
  disabled: (action: ShortcutAction) => boolean
  selected: (action: ShortcutAction) => boolean
}>()
const emit = defineEmits<{ toggle: []; action: [action: ShortcutAction] }>()
const groups: { name: string; items: Item[] }[] = [
  { name: 'Communication actions', items: [
    { name: 'Ping', icon: icons.clickPing, action: 'ping', gesture: 'Alt + click' },
  ] },
  { name: 'Local version actions', items: [
    { name: 'Select entry', icon: icons.selectEntry, gesture: 'Click entry', expandedOnly: true },
    { name: 'Select multiple entries', icon: icons.selectEntries, gesture: 'Shift + click entry', expandedOnly: true },
    { name: 'New free entry', icon: icons.add, action: 'newEntry', testId: 'new-entry' },
    { name: 'Delete node', icon: icons.delete, action: 'deleteNode' },
    { name: 'Add child', icon: icons.addChild, action: 'addChild' },
    { name: 'Group entries', icon: icons.group, action: 'group' },
    { name: 'Edit entry', icon: icons.edit, action: 'edit' },
    { name: 'Detach selected', icon: icons.detach, action: 'detach' },
    { name: 'Tag version', icon: icons.tag, action: 'tag' },
    { name: 'Merge entries', icon: icons.mergeEntries, action: 'mergeEntries' },
    { name: 'Split entry', icon: icons.split, action: 'split' },
    { name: 'Copy entry', icon: icons.copy, action: 'copy', expandedOnly: true },
    { name: 'Cut entry', icon: icons.cut, action: 'cut', expandedOnly: true },
    { name: 'Paste entry', icon: icons.paste, action: 'paste', expandedOnly: true },
  ] },
  { name: 'Global version actions', items: [
    { name: 'Activate version', icon: icons.activateVersion, gesture: 'Click version', expandedOnly: true },
    { name: 'Compare versions', icon: icons.compare, action: 'compare' },
    { name: 'Merge versions', icon: icons.mergeVersions, action: 'merge' },
    { name: 'Undo', icon: icons.undo, action: 'undo', expandedOnly: true },
    { name: 'Redo', icon: icons.redo, action: 'redo', expandedOnly: true },
    { name: 'Search versions', icon: icons.search, action: 'search' },
  ] },
  { name: 'Local viewport actions', items: [
    { name: 'Compact layout', icon: icons.compact, action: 'compact' },
    { name: 'Center all elements', icon: icons.center, action: 'center' },
    { name: 'Box select', icon: icons.boxSelect, gesture: 'Ctrl + drag', expandedOnly: true },
    { name: 'Zoom version', icon: icons.localZoom, gesture: 'Shift + wheel', expandedOnly: true },
    { name: 'Pan version', icon: icons.localPan, gesture: 'Shift + drag', expandedOnly: true },
  ] },
  { name: 'Global viewport actions', items: [
    { name: 'Zoom in preset', icon: icons.zoomIn, action: 'zoomIn' },
    { name: 'Zoom out preset', icon: icons.zoomOut, action: 'zoomOut' },
    { name: 'Zoom graph', icon: icons.globalZoom, gesture: 'Mouse wheel', expandedOnly: true },
    { name: 'Pan graph', icon: icons.globalPan, gesture: 'Mouse drag', expandedOnly: true },
    { name: 'Focus version', icon: icons.clickFocusVersion, gesture: 'Double-click version', expandedOnly: true },
    { name: 'Focus active version', icon: icons.focusVersion, action: 'focus' },
    { name: 'Focus neighborhood', icon: icons.neighborhood, action: 'neighborhood' },
    { name: 'Fit height', icon: icons.fitHeight, action: 'fitHeight' },
    { name: 'Fit all versions', icon: icons.fitAll, action: 'fitAll' },
    { name: 'Previous version', icon: icons.previousVersion, action: 'previous', expandedOnly: true },
    { name: 'Next version', icon: icons.nextVersion, action: 'next', expandedOnly: true },
    { name: 'Timeline above', icon: icons.timelineUp, action: 'up', expandedOnly: true },
    { name: 'Timeline below', icon: icons.timelineDown, action: 'down', expandedOnly: true },
    { name: 'First timeline', icon: icons.firstTimeline, action: 'firstLane', expandedOnly: true },
    { name: 'Last timeline', icon: icons.lastTimeline, action: 'lastLane', expandedOnly: true },
    { name: 'First version in timeline', icon: icons.firstVersion, action: 'firstVersion', expandedOnly: true },
    { name: 'Last version in timeline', icon: icons.lastVersion, action: 'lastVersion', expandedOnly: true },
  ] },
]
</script>

<template>
  <aside class="action-sidebar" :class="{ collapsed }" aria-label="Actions and shortcuts">
    <header>
      <strong v-if="!collapsed">Actions</strong>
      <button type="button" class="quiet-icon action-sidebar-toggle"
        :aria-label="collapsed ? 'Expand action sidebar' : 'Collapse action sidebar'"
        :aria-expanded="!collapsed" @click="emit('toggle')">
        <component :is="collapsed ? icons.previous : icons.next" :size="18" />
      </button>
    </header>
    <div class="action-sidebar-list">
      <section v-for="group in groups" :key="group.name" :aria-label="group.name">
        <h2 v-if="!collapsed">{{ group.name }}</h2>
        <template v-for="item in group.items.filter((item) => !collapsed || !item.expandedOnly)" :key="item.name">
          <button v-if="item.action" type="button" class="action-sidebar-item"
            :class="{ selected: selected(item.action) }"
            :data-action="item.testId" :disabled="disabled(item.action)"
            :title="`${item.name} · ${item.gesture || shortcutLabel(item.action)}`"
            :aria-label="`${item.name}, ${item.gesture || shortcutLabel(item.action, true)}`"
            @click="emit('action', item.action)">
            <component :is="item.icon" :size="17" />
            <span v-if="!collapsed">{{ item.name }}</span>
            <kbd v-if="!collapsed && (item.gesture || shortcutLabel(item.action))">{{ item.gesture || shortcutLabel(item.action) }}</kbd>
          </button>
          <div v-else class="action-sidebar-item action-sidebar-gesture" :title="`${item.name} · ${item.gesture}`">
            <component :is="item.icon" :size="17" />
            <span v-if="!collapsed">{{ item.name }}</span>
            <kbd v-if="!collapsed">{{ item.gesture }}</kbd>
          </div>
        </template>
      </section>
    </div>
  </aside>
</template>
