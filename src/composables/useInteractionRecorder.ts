import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { InteractionEntry, SyncDelta } from '../types/collaboration'
import type { StoredState } from '../types/workspace'
import { shortcutAction } from '../config/hotkeys'
import { interactionPatch, isInteractionEvent, parseInteractionLog, type InteractionActor, type InteractionCategory,
  type InteractionDialog, type InteractionEvent, type InteractionLog, type InteractionMethod, type InteractionScreen, type InteractionSession } from '../utils/interactionLog'

type Input = { time: number; method: InteractionMethod; cursor?: { x: number; y: number }; action: string }
type Viewport = { zoom: number; panX: number; panY: number }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function useInteractionRecorder(options: {
  state: Ref<StoredState>
  room: Ref<string>
  zoom: Ref<number>
  pan: Ref<{ x: number; y: number }>
  selectedNodes: Ref<string[]>
  screen: () => InteractionScreen
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
  let activeSessionId: string | null = null
  let recordedVersions = new Set<string>()
  const viewport = (): Viewport => ({ zoom: options.zoom.value, panX: options.pan.value.x, panY: options.pan.value.y })
  const screen = options.screen

  function forgetRoom(room: string) {
    logs.delete(room)
    eventIds.delete(room)
  }
  function stopRoom() {
    flushViewport()
    current.value = null
    activeSessionId = null
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
        initialState: clone(options.state.value), initialViewport: viewport(), events: [], sessions: [] }
      logs.set(room, log)
      current.value = log
    }
    current.value.sessions ??= []
    if (!eventIds.has(room)) eventIds.set(room, new Set(current.value.events.map((event) => event.id)))
    input = { time: Date.now(), method: 'system', action: 'Change' }
    pendingIntent = null
    pendingAction = null
    activeSessionId = null
    const actor = options.actor()
    const startedAt = Date.now()
    const sessionId = `${actor.id}-${startedAt}-${++sequence}`
    const session: InteractionSession = { id: sessionId, actor, startedAt, initialState: clone(options.state.value),
      initialViewport: viewport(), initialScreen: screen(), eventIds: [] }
    current.value.sessions.push(session)
    activeSessionId = sessionId
    recordedVersions = new Set(['v0'])
    record('input', 'Login', { parameters: { meaningful: true, sessionBoundary: 'login' } },
      { time: startedAt, method: 'system', action: 'Login' })
  }
  function append(event: InteractionEvent, broadcast = true) {
    if (!current.value || current.value.room !== options.room.value || replaying.value) return
    const ids = eventIds.get(current.value.room)
    if (ids?.has(event.id)) return
    ids?.add(event.id)
    const session = current.value.sessions?.find((item) => item.id === event.sessionId)
      ?? current.value.sessions?.filter((item) => item.actor.id === event.actor.id && item.endedAt === undefined).at(-1)
    const recorded = event.sessionId || !session ? event : { ...event, sessionId: session.id }
    current.value.events.push(clone(recorded))
    if (session && !session.eventIds.includes(event.id)) {
      session.eventIds.push(event.id)
      if (event.parameters?.sessionBoundary === 'logout') session.endedAt = event.changeTime
    }
    if (recorded.parameters?.sessionBoundary === 'logout' && activeSessionId === recorded.sessionId) activeSessionId = null
    if (broadcast) options.send({ type: 'session-interaction', room: current.value.room, event: recorded })
  }
  function recentInput(action: string): Input {
    return Date.now() - input.time <= 5000 ? input : { time: Date.now(), method: 'system', action }
  }
  function record(category: InteractionCategory, action: string, extra: Partial<InteractionEvent> = {},
    source: Input = recentInput(action)) {
    const actor = options.actor()
    const time = performance.timeOrigin + performance.now()
    const event: InteractionEvent = {
      id: `${actor.id}-${Math.floor(time)}-${String(++sequence).padStart(12, '0')}`,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}), actor, action, category, method: source.method,
      inputTime: Math.min(source.time, time), changeTime: time, screen: screen(),
      ...(source.cursor ? { cursor: source.cursor } : {}), ...extra,
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
    const available = new Map(after.versions.map((version) => [version.id, version]))
    const included = new Set([...recordedVersions, ...patch.versions.map((version) => version.id)])
    const dependencies: StoredState['versions'] = []
    const includeDependencies = (id: string | null | undefined) => {
      if (!id || included.has(id)) return
      const version = available.get(id)
      if (!version) throw new Error(`Missing interaction dependency: ${id}`)
      included.add(id)
      includeDependencies(version.parentId)
      includeDependencies(version.mergeSourceId)
      dependencies.push(version)
    }
    for (const version of patch.versions) {
      includeDependencies(version.parentId)
      includeDependencies(version.mergeSourceId)
    }
    if (dependencies.length) patch.dependencies = clone(dependencies)
    const action = pendingAction?.action ?? 'Committed change'
    const stateChanged = patch.versions.length || patch.removed.length || patch.copyLinks || patch.retiredVersionNumbers
      || patch.branching || before.nextNode !== after.nextNode || before.nextVersion !== after.nextVersion || before.nextLane !== after.nextLane
    if (stateChanged) {
      for (const id of patch.removed) recordedVersions.delete(id)
      for (const version of [...dependencies, ...patch.versions]) recordedVersions.add(version.id)
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
  function recordRemoteState(before: StoredState, after: StoredState) {
    if (!current.value || replaying.value) return
    const patch = interactionPatch(before, after)
    const source: Input = { time: Date.now(), method: 'system', action: 'Received shared changes' }
    if (patch.versions.length || patch.removed.length || patch.copyLinks || patch.retiredVersionNumbers
      || patch.branching || before.nextNode !== after.nextNode || before.nextVersion !== after.nextVersion
      || before.nextLane !== after.nextLane) {
      record('state', source.action, { patch, parameters: { localObservation: true } }, source)
    } else if (before.activeId !== after.activeId) {
      record('selection', 'Follow shared version',
        { selection: { versionId: after.activeId, nodeIds: [...options.selectedNodes.value] } }, source)
    }
  }
  function refreshSessionBaseline() {
    const session = current.value?.sessions?.find((item) => item.id === activeSessionId)
    if (!session || pendingIntent || pendingAction
      || current.value?.events.some((event) => event.sessionId === activeSessionId && event.category === 'state')) return false
    const nextState = JSON.stringify(options.state.value)
    const nextViewport = JSON.stringify(viewport())
    if (JSON.stringify(session.initialState) === nextState && JSON.stringify(session.initialViewport) === nextViewport) return false
    session.initialState = clone(options.state.value)
    session.initialViewport = viewport()
    session.initialScreen = screen()
    return true
  }
  function recordAction(entry: InteractionEntry) {
    if (entry.action === 'Joined room') { refreshSessionBaseline(); return }
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
      const boundary = entry.action === 'Left room' ? 'logout' : undefined
      record('input', boundary ? 'Logout' : entry.action, { parameters: {
        ...actionParameters(entry), ...(boundary ? { sessionBoundary: boundary } : {}),
      } }, source)
    }
  }
  function recordDialog(dialog: InteractionDialog) {
    if (!current.value || replaying.value) return
    record('input', 'Dialog state', { dialog: clone(dialog) })
  }
  function recordRemoteDeparture(entry: InteractionEntry) {
    const boundary = entry.action === 'Left room' ? 'logout' : undefined
    append({ id: `session-${entry.id}`, actor: { id: entry.actorId, name: entry.actorName,
      color: entry.actorColor ?? '#0075b8' }, action: boundary ? 'Logout' : entry.action, category: 'input', method: 'system',
      inputTime: entry.createdAt, changeTime: entry.createdAt,
      parameters: { meaningful: true, ...(boundary ? { sessionBoundary: boundary } : {}) } }, false)
  }
  function capturePointer(event: PointerEvent) {
    if (replaying.value || !event.isTrusted) return
    flushViewport()
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
      ...(button?.classList.contains('card-menu') ? { menuKind: 'version',
        x: event.clientX, y: event.clientY } : {}),
      ...(button?.closest('.context-menu') ? { menuAction: (label || 'Menu action').slice(0, 120) } : {}),
      button: event.button, shift: event.shiftKey, control: event.ctrlKey || event.metaKey,
    } })
  }
  function captureContextMenu(event: MouseEvent) {
    if (replaying.value || !event.isTrusted) return
    const target = event.target instanceof Element ? event.target : null
    const tile = target?.closest<HTMLElement>('[data-node]')
    const version = target?.closest<HTMLElement>('[data-version]')
    const kind = tile ? 'entry' : version ? 'version' : 'canvas'
    const source: Input = { time: Date.now(), method: 'mouse', action: `Open ${kind} menu`,
      cursor: { x: event.clientX, y: event.clientY } }
    input = source
    record('input', source.action, { parameters: {
      menuKind: kind, x: event.clientX, y: event.clientY,
      ...(tile?.dataset.node ? { nodeId: tile.dataset.node } : {}),
      ...(version?.dataset.version ? { versionId: version.dataset.version } : {}),
    } }, source)
  }
  function capturePointerUp(event: PointerEvent) {
    if (replaying.value || !event.isTrusted || !pointer) return
    flushViewport()
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
  function recordScreen() {
    record('input', 'Window layout', {}, { time: Date.now(), method: 'system', action: 'Window layout' })
  }
  watch([options.zoom, options.pan], () => {
    if (!current.value || replaying.value) return
    viewportInput ??= recentInput('Graph viewport')
    if (!viewportTimer) viewportTimer = window.setTimeout(flushViewport, 120)
  }, { deep: true })
  function flushViewport() {
    window.clearTimeout(viewportTimer)
    viewportTimer = 0
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
        const incoming = parseInteractionLog(packet.log, false)
        if (incoming.room !== options.room.value || !current.value || current.value.room !== options.room.value) throw new Error('Wrong room')
        const events = new Map([...incoming.events, ...current.value.events].map((event) => [event.id, event]))
        current.value.events = [...events.values()]
        const sessions = new Map((current.value.sessions ?? []).map((session) => [session.id, session]))
        for (const session of incoming.sessions ?? []) {
          const previous = sessions.get(session.id)
          sessions.set(session.id, previous ? { ...previous, ...session,
            eventIds: [...new Set([...previous.eventIds, ...session.eventIds])] } : session)
        }
        current.value.sessions = [...sessions.values()]
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
    let log: InteractionLog
    let raw = false
    try { log = parseInteractionLog(clone(source)) }
    catch (error) {
      log = clone(source)
      raw = true
      options.notify(`Replay validation failed; downloading raw interaction log: ${error instanceof Error ? error.message : String(error)}`, true)
    }
    if (!raw) log.events.sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id))
    const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `canopy-interactions-${log.room.replace(/[\\/:*?"<>|]/g, '_')}${raw ? '-raw' : ''}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  function sendLog(reply: (message: unknown) => void) {
    if (current.value && current.value.room === options.room.value && !replaying.value) {
      reply({ type: 'session-log', log: parseInteractionLog(clone(current.value), false) })
    }
  }
  onMounted(() => {
    window.addEventListener('pointerdown', capturePointer, true)
    window.addEventListener('pointerup', capturePointerUp, true)
    window.addEventListener('contextmenu', captureContextMenu, true)
    window.addEventListener('keydown', captureKey, true)
    window.addEventListener('wheel', captureWheel, true)
    window.addEventListener('input', captureText, true)
    window.addEventListener('resize', recordScreen)
  })
  onUnmounted(() => {
    window.clearTimeout(viewportTimer)
    window.removeEventListener('pointerdown', capturePointer, true)
    window.removeEventListener('pointerup', capturePointerUp, true)
    window.removeEventListener('contextmenu', captureContextMenu, true)
    window.removeEventListener('keydown', captureKey, true)
    window.removeEventListener('wheel', captureWheel, true)
    window.removeEventListener('input', captureText, true)
    window.removeEventListener('resize', recordScreen)
  })
  return { current, replaying, startRoom, stopRoom, forgetRoom, recordState, recordRemoteState, recordAction, recordRemoteDeparture,
    receive, sendLog, exportLog, flushViewport, refreshSessionBaseline, recordDialog, recordScreen }
}
