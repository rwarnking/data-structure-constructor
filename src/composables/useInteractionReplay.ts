import { onUnmounted, ref, shallowRef } from 'vue'
import type { InteractionEvent, InteractionLog } from '../utils/interactionLog'

export function useInteractionReplay(options: {
  reset: () => void
  initialize: (log: InteractionLog) => void
  apply: (event: InteractionEvent) => void
}) {
  const log = shallowRef<InteractionLog | null>(null)
  const playing = ref(false)
  const speed = ref(1)
  const index = ref(0)
  const cursorPositions = ref<Record<string, { x: number; y: number; name: string; color: string }>>({})
  let frame = 0
  let time = 0
  let lastFrame = 0
  let initialized = false
  let tracks = new Map<string, InteractionEvent[]>()

  function pause() {
    playing.value = false
    cancelAnimationFrame(frame)
    frame = 0
    lastFrame = 0
  }
  function beginning() {
    pause()
    options.reset()
    index.value = 0
    time = 0
    initialized = false
    cursorPositions.value = {}
  }
  function load(value: InteractionLog) {
    log.value = value
    tracks = new Map()
    for (const event of value.events) {
      if (!event.cursor) continue
      const track = tracks.get(event.actor.id) ?? []
      track.push(event)
      tracks.set(event.actor.id, track)
    }
    beginning()
  }
  function startBaseline() {
    if (!log.value || initialized) return
    options.initialize(log.value)
    initialized = true
  }
  function updateCursors(position: number) {
    const events = log.value?.events ?? []
    const first = events[0]?.changeTime ?? 0
    const at = first + position
    const result: typeof cursorPositions.value = {}
    for (const [id, positions] of tracks) {
      let low = 0
      let high = positions.length
      while (low < high) {
        const mid = Math.floor((low + high) / 2)
        if (positions[mid]!.changeTime <= at) low = mid + 1
        else high = mid
      }
      const previous = positions[low - 1]
      if (!previous?.cursor) continue
      const next = positions[low]
      const amount = next && next.changeTime > previous.changeTime
        ? Math.min(1, (at - previous.changeTime) / (next.changeTime - previous.changeTime)) : 0
      result[id] = { x: previous.cursor.x + ((next?.cursor?.x ?? previous.cursor.x) - previous.cursor.x) * amount,
        y: previous.cursor.y + ((next?.cursor?.y ?? previous.cursor.y) - previous.cursor.y) * amount,
        name: previous.actor.name, color: previous.actor.color }
    }
    cursorPositions.value = result
  }
  function tick(now: number) {
    if (!playing.value || !log.value) return
    if (lastFrame) time += (now - lastFrame) * speed.value
    lastFrame = now
    const events = log.value.events
    const first = events[0]?.changeTime ?? 0
    while (index.value < events.length && events[index.value]!.changeTime - first <= time) {
      options.apply(events[index.value]!)
      index.value++
    }
    updateCursors(time)
    if (index.value >= events.length) { pause(); return }
    frame = requestAnimationFrame(tick)
  }
  function play() {
    if (!log.value || playing.value) return
    if (initialized && index.value >= log.value.events.length) beginning()
    startBaseline()
    playing.value = true
    frame = requestAnimationFrame(tick)
  }
  function next() {
    if (!log.value || index.value >= log.value.events.length) return
    startBaseline()
    const event = log.value.events[index.value]!
    const first = log.value.events[0]!.changeTime
    time = Math.max(time, event.changeTime - first)
    options.apply(event)
    index.value++
    updateCursors(time)
    lastFrame = 0
    if (index.value >= log.value.events.length) pause()
  }
  function end() {
    if (!log.value) return
    pause()
    startBaseline()
    while (index.value < log.value.events.length) {
      options.apply(log.value.events[index.value]!)
      index.value++
    }
    const events = log.value.events
    time = (events.at(-1)?.changeTime ?? 0) - (events[0]?.changeTime ?? 0)
    updateCursors(time)
  }
  function close() { pause(); log.value = null; cursorPositions.value = {} }
  onUnmounted(pause)
  return { log, playing, speed, index, cursorPositions, load, play, pause, beginning, next, end, close }
}
