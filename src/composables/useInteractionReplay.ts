import { computed, onUnmounted, ref, shallowRef } from 'vue'
import type { InteractionActor, InteractionEvent, InteractionLog } from '../utils/interactionLog'

export function useInteractionReplay(options: {
  reset: () => void
  initialize: (log: InteractionLog) => void
  apply: (event: InteractionEvent) => void
}) {
  const log = shallowRef<InteractionLog | null>(null)
  const playing = ref(false)
  const speed = ref(1)
  const index = ref(0)
  const selectedActorId = ref<string | null>(null)
  const actors = computed(() => {
    const found = new Map<string, InteractionActor>()
    for (const session of log.value?.sessions ?? []) found.set(session.actor.id, session.actor)
    for (const event of log.value?.events ?? []) found.set(event.actor.id, event.actor)
    return [...found.values()]
  })
  const events = computed(() => log.value?.events.filter((event) => event.actor.id === selectedActorId.value) ?? [])
  const cursorPositions = ref<Record<string, { x: number; y: number; name: string; color: string }>>({})
  let frame = 0
  let time = 0
  let lastFrame = 0
  let initialized = false
  let activeSessionId: string | null = null
  let tracks = new Map<string, InteractionEvent[]>()

  function pause() {
    playing.value = false
    cancelAnimationFrame(frame)
    frame = 0
    lastFrame = 0
  }
  function initializeSession(sessionId: string | undefined, reset: boolean) {
    if (!log.value) return
    if (reset) options.reset()
    const session = sessionId
      ? log.value.sessions?.find((item) => item.id === sessionId)
      : undefined
    options.initialize(session ? { ...log.value, initialState: session.initialState,
      initialViewport: session.initialViewport } : log.value)
    activeSessionId = sessionId ?? null
  }
  function startBaseline() {
    if (!log.value || initialized) return
    const first = events.value[0]
    initializeSession(first?.sessionId, false)
    initialized = true
  }
  function execute(event: InteractionEvent) {
    if (event.sessionId !== activeSessionId) initializeSession(event.sessionId, true)
    const boundary = event.parameters?.sessionBoundary
    if (boundary === 'login' || boundary === 'logout'
      || event.action === 'Login' || event.action === 'Logout'
      || event.action === 'Joined room' || event.action === 'Left room') return
    options.apply(event)
  }
  function updateCursors(position: number) {
    const selected = selectedActorId.value
    const positions = selected ? tracks.get(selected) ?? [] : []
    const first = events.value[0]?.changeTime ?? 0
    const at = first + position
    let low = 0
    let high = positions.length
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (positions[mid]!.changeTime <= at) low = mid + 1
      else high = mid
    }
    const previous = positions[low - 1]
    if (!previous?.cursor) {
      cursorPositions.value = {}
      return
    }
    const next = positions[low]
    const amount = next && next.changeTime > previous.changeTime
      ? Math.min(1, (at - previous.changeTime) / (next.changeTime - previous.changeTime)) : 0
    cursorPositions.value = { [selected!]: {
      x: previous.cursor.x + ((next?.cursor?.x ?? previous.cursor.x) - previous.cursor.x) * amount,
      y: previous.cursor.y + ((next?.cursor?.y ?? previous.cursor.y) - previous.cursor.y) * amount,
      name: previous.actor.name, color: previous.actor.color,
    } }
  }
  function beginning() {
    pause()
    options.reset()
    index.value = 0
    time = 0
    initialized = false
    activeSessionId = null
    cursorPositions.value = {}
    startBaseline()
    updateCursors(time)
  }
  function load(value: InteractionLog) {
    log.value = value
    selectedActorId.value = value.events[0]?.actor.id ?? value.sessions?.[0]?.actor.id ?? null
    tracks = new Map()
    for (const event of value.events) {
      if (!event.cursor) continue
      const track = tracks.get(event.actor.id) ?? []
      track.push(event)
      tracks.set(event.actor.id, track)
    }
    beginning()
  }
  function tick(now: number) {
    if (!playing.value || !log.value) return
    if (lastFrame) time += (now - lastFrame) * speed.value
    lastFrame = now
    const sequence = events.value
    const first = sequence[0]?.changeTime ?? 0
    while (index.value < sequence.length && sequence[index.value]!.changeTime - first <= time) {
      execute(sequence[index.value]!)
      index.value++
    }
    updateCursors(time)
    if (index.value >= sequence.length) { pause(); return }
    frame = requestAnimationFrame(tick)
  }
  function play() {
    if (!log.value || playing.value) return
    if (initialized && index.value >= events.value.length) beginning()
    startBaseline()
    playing.value = true
    frame = requestAnimationFrame(tick)
  }
  function next() {
    const sequence = events.value
    if (!log.value || index.value >= sequence.length) return
    startBaseline()
    const event = sequence[index.value]!
    const first = sequence[0]!.changeTime
    time = Math.max(time, event.changeTime - first)
    execute(event)
    index.value++
    updateCursors(time)
    lastFrame = 0
    if (index.value >= sequence.length) pause()
  }
  function seek(target: number) {
    if (!log.value) return
    pause()
    const bounded = Math.max(0, Math.min(events.value.length, Math.floor(target)))
    if (bounded < index.value || !initialized) beginning()
    while (index.value < bounded) {
      execute(events.value[index.value]!)
      index.value++
    }
    const sequence = events.value
    time = bounded ? sequence[bounded - 1]!.changeTime - (sequence[0]?.changeTime ?? 0) : 0
    updateCursors(time)
  }
  function end() {
    if (!log.value) return
    pause()
    startBaseline()
    const sequence = events.value
    while (index.value < sequence.length) {
      execute(sequence[index.value]!)
      index.value++
    }
    time = (sequence.at(-1)?.changeTime ?? 0) - (sequence[0]?.changeTime ?? 0)
    updateCursors(time)
  }
  function selectActor(id: string) {
    if (id === selectedActorId.value || !actors.value.some((actor) => actor.id === id)) return
    const resume = playing.value
    selectedActorId.value = id
    beginning()
    if (resume) play()
  }
  function close() {
    pause()
    log.value = null
    selectedActorId.value = null
    tracks.clear()
    cursorPositions.value = {}
  }
  onUnmounted(pause)
  return { log, playing, speed, index, actors, events, selectedActorId, cursorPositions,
    load, play, pause, beginning, next, seek, end, selectActor, close }
}
