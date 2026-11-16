import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { InteractionEntry, SyncDelta } from '../types/collaboration'
import type { StoredState } from '../types/workspace'
import { shortcutAction } from '../config/hotkeys'
import { interactionPatch, isInteractionEvent, parseInteractionLog, type InteractionActor, type InteractionCategory,
  type InteractionEvent, type InteractionLog, type InteractionMethod } from '../utils/interactionLog'

type Input = { time: number; method: InteractionMethod; cursor?: { x: number; y: number }; action: string }
type Viewport = { zoom: number; panX: number; panY: number }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function useInteractionRecorder(options: {
  state: Ref<StoredState>
  room: Ref<string>
  zoom: Ref<number>
  pan: Ref<{ x: number; y: number }>
  selectedNodes: Ref<string[]>
  actor: () => InteractionActor
  send: (message: unknown) => void
  notify: (message: string, error?: boolean) => void
}) {
  const logs = new Map<string, InteractionLog>()
  const current = shallowRef<InteractionLog | null>(null)
  const replaying = ref(false)
  const eventIds = new Map<string, Set<string>>()
  let input: Input = { time: Date.now(), method: 'system', action: 'Change' }
  let pendingIntent: Input | null = null
  let pendingAction: InteractionEntry | null = null
  let sequence = 0
  let viewportTimer = 0
  let viewportInput: Input | null = null
  let pointer: { x: number; y: number; time: number } | null = null
  const viewport = (): Viewport => ({ zoom: options.zoom.value, panX: options.pan.value.x, panY: options.pan.value.y })

  function forgetRoom(room: string) {
    logs.delete(room)
    eventIds.delete(room)
  }
  function stopRoom() {
    flushViewport()
    current.value = null
    pendingIntent = null
    pendingAction = null
    pointer = null
  }
  function startRoom(room: string, createEmpty = false) {
    flushViewport()
    replaying.value = false
    if (createEmpty) forgetRoom(room)
    const saved = logs.get(room)
    if (saved) current.value = saved
    else {
      const log: InteractionLog = { format: 'canopy-interaction-log', version: 1, room,
        initialState: clone(options.state.value), initialViewport: viewport(), events: [] }
      logs.set(room, log)
      current.value = log
    }
    if (!eventIds.has(room)) eventIds.set(room, new Set(current.value.events.map((event) => event.id)))
    input = { time: Date.now(), method: 'system', action: 'Change' }
    pendingIntent = null
    pendingAction = null
  }
  function append(event: InteractionEvent, broadcast = true) {
    if (!current.value || current.value.room !== options.room.value || replaying.value) return
    const ids = eventIds.get(current.value.room)
    if (ids?.has(event.id)) return
    ids?.add(event.id)
    current.value.events.push(clone(event))
    if (broadcast) options.send({ type: 'session-interaction', room: current.value.room, event })
  }
  function recentInput(action: string): Input {
    return Date.now() - input.time <= 5000 ? input : { time: Date.now(), method: 'system', action }
  }
  function record(category: InteractionCategory, action: string, extra: Partial<InteractionEvent> = {},
    source: Input = recentInput(action)) {
    const actor = options.actor()
    const time = performance.timeOrigin + performance.now()
    const event: InteractionEvent = {
      id: `${actor.id}-${Math.floor(time)}-${String(++sequence).padStart(12, '0')}`, actor, action, category, method: source.method,
      inputTime: Math.min(source.time, time), changeTime: time, ...(source.cursor ? { cursor: source.cursor } : {}), ...extra,
    }
    append(event)
  }
  function actionParameters(entry: InteractionEntry) {
    return {
      meaningful: true,
      ...(entry.versionId ? { versionId: entry.versionId } : {}),
      ...(entry.nodeId ? { nodeId: entry.nodeId } : {}),
      ...(entry.nodeLabel ? { nodeLabel: entry.nodeLabel } : {}),
      ...(entry.ping ? { x: entry.ping.x, y: entry.ping.y,
        ...(entry.ping.coordinateSpace ? { coordinateSpace: entry.ping.coordinateSpace } : {}) } : {}),
    }
  }
  function recordState(before: StoredState, after: StoredState, delta?: SyncDelta) {
    if (!current.value || replaying.value) return
    const patch = interactionPatch(before, after)
    if (delta) {
      patch.versions = clone(delta.versions.map((change) => change.version))
      patch.removed = delta.removed.map((removal) => removal.id)
      patch.versionRevisions = Object.fromEntries(delta.versions.map((change) => [change.version.id, change.revision]))
      patch.removalRevisions = Object.fromEntries(delta.removed.map((removal) => [removal.id, removal.revision]))
    }
    const action = pendingAction?.action ?? 'Committed change'
    const stateChanged = patch.versions.length || patch.removed.length || patch.copyLinks || patch.retiredVersionNumbers
      || patch.branching || before.nextNode !== after.nextNode || before.nextVersion !== after.nextVersion || before.nextLane !== after.nextLane
    if (stateChanged) {
      const oldVersions = new Map(before.versions.map((version) => [version.id, version]))
      const mapOnly = patch.versions.length > 0 && !patch.removed.length && !patch.copyLinks && !patch.retiredVersionNumbers
        && !patch.branching && before.nextNode === after.nextNode && before.nextVersion === after.nextVersion
        && before.nextLane === after.nextLane && patch.versions.every((version) => {
          const previous = oldVersions.get(version.id)
          return previous && JSON.stringify({ ...previous, mapView: undefined, numberSuffix: undefined })
            === JSON.stringify({ ...version, mapView: undefined, numberSuffix: undefined })
        })
      if (mapOnly) record('viewport', 'Version viewport', {
        patch, viewport: viewport(), parameters: { versionId: patch.versions[0]!.id, scope: 'version' },
      }, pendingIntent ?? recentInput('Version viewport'))
      else {
        record('state', action, { patch, parameters: {
          versionId: after.activeId, ...(pendingAction ? actionParameters(pendingAction) : {}),
        } }, pendingIntent ?? recentInput(action))
        pendingAction = null
      }
      pendingIntent = null
    }
    else if (before.activeId !== after.activeId) record('selection', 'Navigate',
      { selection: { versionId: after.activeId, nodeIds: [...options.selectedNodes.value] } })
  }
  function recordAction(entry: InteractionEntry) {
    if (/^(Created |Merged |Undid |Redid |Tagged |Removed tag )/.test(entry.action)) {
      if (pendingAction) record('input', pendingAction.action, { parameters: actionParameters(pendingAction) })
      pendingAction = entry
      queueMicrotask(() => {
        if (pendingAction !== entry) return
        pendingAction = null
        record('input', entry.action, { parameters: actionParameters(entry) })
      })
    } else {
      const source = /^(Joined|Left) room$/.test(entry.action)
        ? { time: Date.now(), method: 'system' as const, action: entry.action } : recentInput(entry.action)
      record('input', entry.action, { parameters: actionParameters(entry) }, source)
    }
  }
  function recordRemoteDeparture(entry: InteractionEntry) {
    append({ id: `session-${entry.id}`, actor: { id: entry.actorId, name: entry.actorName,
      color: entry.actorColor ?? '#0075b8' }, action: entry.action, category: 'input', method: 'system',
      inputTime: entry.createdAt, changeTime: entry.createdAt, parameters: { meaningful: true } }, false)
  }
  function capturePointer(event: PointerEvent) {
    if (replaying.value || !event.isTrusted) return
    const target = event.target instanceof Element ? event.target : null
    const button = target?.closest('button, [role="button"]')
    const tile = target?.closest<HTMLElement>('[data-node]')
    const version = target?.closest<HTMLElement>('[data-version]')
    const label = button?.getAttribute('aria-label') || button?.getAttribute('title') || button?.textContent?.trim()
    const action = button ? `Button: ${(label || 'button').slice(0, 120)}`
      : tile ? 'Select entry' : version ? 'Select version' : 'Mouse interaction'
    input = { time: Date.now(), method: button ? 'button' : 'mouse',
      cursor: { x: event.clientX, y: event.clientY }, action }
    if (button && /cancel|close/i.test(label || '')) pendingIntent = null
    else if (button && /add|create|new |edit|rename|delete|merge|split|attach|detach|paste|cut|undo|redo/i.test(label || '')) {
      pendingIntent ??= input
    }
    pointer = { x: event.clientX, y: event.clientY, time: input.time }
    record('input', action, { parameters: {
      ...(tile?.dataset.node ? { nodeId: tile.dataset.node } : {}),
      ...(version?.dataset.version ? { versionId: version.dataset.version } : {}),
      button: event.button, shift: event.shiftKey, control: event.ctrlKey || event.metaKey,
    } })
  }
  function capturePointerUp(event: PointerEvent) {
    if (replaying.value || !event.isTrusted || !pointer) return
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) {
      input = { ...input, time: pointer.time, cursor: { x: event.clientX, y: event.clientY }, action: 'Drag' }
      pendingIntent = input
      record('input', 'Drag', { parameters: { startX: pointer.x, startY: pointer.y } })
    }
    pointer = null
  }
  function captureKey(event: KeyboardEvent) {
    if (replaying.value || !event.isTrusted || event.repeat) return
    const action = shortcutAction(event)
    if (event.key === 'Escape') pendingIntent = null
    const undoRedo = (event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())
    if (!action && !undoRedo) return
    input = { time: Date.now(), method: 'hotkey', action: action ?? (event.key.toLowerCase() === 'z' ? 'undo' : 'redo') }
    if (/add|create|edit|rename|delete|merge|split|attach|detach|paste|cut|undo|redo/i.test(input.action)) pendingIntent ??= input
    record('input', input.action, { parameters: { key: event.key, control: event.ctrlKey || event.metaKey,
      shift: event.shiftKey, alt: event.altKey } })
  }
  function captureWheel(event: WheelEvent) {
    if (replaying.value || !event.isTrusted) return
    if (!(event.target instanceof Element) || !event.target.closest('.graph-canvas')) return
    input = { time: Date.now(), method: 'mouse', action: event.shiftKey ? 'Version zoom' : 'Graph zoom',
      cursor: { x: event.clientX, y: event.clientY } }
    record('input', input.action, { parameters: { deltaX: event.deltaX, deltaY: event.deltaY, shift: event.shiftKey } })
  }
  function captureText(event: Event) {
    if (replaying.value || !event.isTrusted) return
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      || target instanceof HTMLInputElement && ['password', 'file', 'hidden'].includes(target.type)) return
    const label = target.getAttribute('aria-label') || target.getAttribute('placeholder') || target.name
    if (!label) return
    input = { time: Date.now(), method: 'keyboard', action: `Input: ${label}` }
    record('input', input.action, { parameters: { value: target.value } })
  }
  watch([options.zoom, options.pan], () => {
    if (!current.value || replaying.value) return
    viewportInput ??= recentInput('Graph viewport')
    window.clearTimeout(viewportTimer)
    viewportTimer = window.setTimeout(flushViewport, 180)
  }, { deep: true })
  function flushViewport() {
    window.clearTimeout(viewportTimer)
    if (viewportInput && current.value && !replaying.value) {
      record('viewport', 'Graph viewport', { viewport: viewport() }, viewportInput)
    }
    viewportInput = null
  }
  watch(options.selectedNodes, (nodes) => {
    if (current.value && !replaying.value) record('selection', 'Selection',
      { selection: { versionId: options.state.value.activeId, nodeIds: [...nodes] } })
  }, { deep: true })
  function receive(message: unknown) {
    if (!message || typeof message !== 'object') return false
    const packet = message as { type?: unknown; room?: unknown; event?: unknown; log?: unknown }
    if (packet.type === 'session-interaction') {
      if (packet.room !== options.room.value || !isInteractionEvent(packet.event)) {
        options.notify('Ignored an invalid interaction record', true)
        return false
      }
      append(packet.event, false)
      return true
    }
    if (packet.type === 'session-log') {
      try {
        const incoming = parseInteractionLog(packet.log)
        if (incoming.room !== options.room.value || !current.value || current.value.room !== options.room.value) throw new Error('Wrong room')
        const events = new Map([...incoming.events, ...current.value.events].map((event) => [event.id, event]))
        current.value.initialState = incoming.initialState
        current.value.initialViewport = incoming.initialViewport
        current.value.events = [...events.values()]
        eventIds.set(current.value.room, new Set(events.keys()))
        return true
      } catch {
        options.notify('Ignored an invalid shared interaction log', true)
        return false
      }
    }
    return false
  }
  function exportLog(source: InteractionLog | null = current.value) {
    if (!source) { options.notify('No interaction log is available', true); return }
    const log = clone(source)
    log.events.sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id))
    const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `canopy-interactions-${log.room.replace(/[\\/:*?"<>|]/g, '_')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  function sendLog(reply: (message: unknown) => void) {
    if (current.value && current.value.room === options.room.value && !replaying.value) reply({ type: 'session-log', log: clone(current.value) })
  }
  onMounted(() => {
    window.addEventListener('pointerdown', capturePointer, true)
    window.addEventListener('pointerup', capturePointerUp, true)
    window.addEventListener('keydown', captureKey, true)
    window.addEventListener('wheel', captureWheel, true)
    window.addEventListener('input', captureText, true)
  })
  onUnmounted(() => {
    window.clearTimeout(viewportTimer)
    window.removeEventListener('pointerdown', capturePointer, true)
    window.removeEventListener('pointerup', capturePointerUp, true)
    window.removeEventListener('keydown', captureKey, true)
    window.removeEventListener('wheel', captureWheel, true)
    window.removeEventListener('input', captureText, true)
  })
  return { current, replaying, startRoom, stopRoom, forgetRoom, recordState, recordAction, recordRemoteDeparture, receive, sendLog, exportLog, flushViewport }
}
