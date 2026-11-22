import type { InteractionEvent, InteractionLog } from './interactionLog'
import { displayVersionId } from './versions'

type EventGroup = { events: InteractionEvent[] }

export function interactionVersionLabels(log: InteractionLog) {
  const labels = new Map<string, string>()
  for (const version of log.initialState.versions) {
    if (version.id === 'v0' || version.number) labels.set(version.id, displayVersionId(version))
  }
  const retired = [...(log.initialState.retiredVersionNumbers ?? []),
    ...log.events.flatMap((event) => event.patch?.retiredVersionNumbers ?? [])]
  for (const item of retired) {
    const { step, branch, subbranch } = item.number
    const label = `${String(step).padStart(2, '0')}.${String(branch).padStart(2, '0')}.${String(subbranch).padStart(3, '0')}`
    labels.set(item.id, item.suffix ? `${label}.${item.suffix}` : label)
  }
  for (const event of log.events) {
    for (const version of event.patch?.versions ?? []) {
      if (version.id === 'v0' || version.number) labels.set(version.id, displayVersionId(version))
    }
    const id = typeof event.parameters?.versionId === 'string' ? event.parameters.versionId : undefined
    const number = event.action.match(/^Created (\d+\.\d+\.\d+(?:\.\d+)?)/)?.[1]
    if (id && number && !labels.has(id)) labels.set(id, number)
  }
  return labels
}

function versionForEvent(event: InteractionEvent) {
  return event.selection?.versionId
    ?? (typeof event.parameters?.versionId === 'string' ? event.parameters.versionId : event.patch?.activeId)
}

function abstractAction(event: InteractionEvent) {
  let action = event.action.replace(/^Created \S+ · /, '')
  if ((action === 'Committed change' || action === 'Change' || action.startsWith('Button: ')) && event.patch) {
    action = event.patch.versions.find((version) => version.id === event.patch?.activeId)?.change ?? action
  }
  if (/^(undo|undid)\b/i.test(action)) return 'Undo'
  if (/^(redo|redid)\b/i.test(action)) return 'Redo'
  if (/^detach\b/i.test(action)) return 'Detach entries'
  if (/^attach\b/i.test(action)) return 'Attach entries'
  if (/^merge\b/i.test(action)) return / into \d+\.\d+\.\d+/i.test(action) ? 'Merge versions' : 'Merge entries'
  if (/^merged\b/i.test(action)) return 'Merge versions'
  if (/^split\b/i.test(action)) return 'Split entries'
  if (/^(delete|deleted)\b/i.test(action)) return 'Delete entries'
  if (/^(add|create|created)\b/i.test(action)) return 'Create entries'
  if (/^(rename|edit)\b/i.test(action)) return 'Edit entries'
  if (/^move\b/i.test(action)) return 'Move entries'
  if (/^(navigate|select version)/i.test(action)) return 'Navigate'
  if (/^selection|select entry/i.test(action)) return 'Select entries'
  if (/^(search|button:.*search)/i.test(action)) return 'Search'
  if (/^(ping|joined room|left room|copied|cut|tagged|removed tag)/i.test(action)) return action
  if (event.category === 'viewport') return event.parameters?.scope === 'version' ? 'Version viewport' : 'Graph viewport'
  return event.category === 'state' ? action : event.action
}

export function abstractInteractions(log: InteractionLog) {
  const ordered = [...log.events].sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id))
  const stateEvents = ordered.filter((event) => event.category === 'state')
  const statesByActor = new Map<string, InteractionEvent[]>()
  for (const event of stateEvents) {
    const states = statesByActor.get(event.actor.id) ?? []
    states.push(event)
    statesByActor.set(event.actor.id, states)
  }
  function findState(event: InteractionEvent, before: number, after: number, predicate: (state: InteractionEvent) => boolean) {
    const states = statesByActor.get(event.actor.id) ?? []
    let low = 0
    let high = states.length
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (states[mid]!.changeTime < event.changeTime - before) low = mid + 1
      else high = mid
    }
    for (let index = low; index < states.length && states[index]!.changeTime <= event.changeTime + after; index++) {
      if (predicate(states[index]!)) return states[index]
    }
  }
  const sources = new Map(stateEvents.map((event) => [event.id, [event]]))
  const suppressed = new Set<string>()
  for (const event of ordered) {
    if (event.category !== 'input') continue
    const semantic = event.parameters?.meaningful === true
    const shortcut = event.method === 'hotkey' && /^(undo|redo)$/i.test(event.action)
    if (!semantic && !shortcut) {
      if (!event.action.startsWith('Button: ')) continue
      const label = event.action.slice(8)
      const match = findState(event, 0, 5000, (state) => {
        const kind = abstractAction(state)
        const related = /add|creat|new entr/i.test(label) && kind === 'Create entries'
          || /delet/i.test(label) && kind === 'Delete entries'
          || /merge/i.test(label) && kind.startsWith('Merge ')
          || /split/i.test(label) && kind === 'Split entries'
          || /detach/i.test(label) && kind === 'Detach entries'
          || /attach/i.test(label) && kind === 'Attach entries'
          || /undo/i.test(label) && kind === 'Undo'
          || /redo/i.test(label) && kind === 'Redo'
        return related && event.changeTime >= state.inputTime
      })
      if (match) {
        sources.get(match.id)!.push(event)
        suppressed.add(event.id)
      }
      continue
    }
    const kind = abstractAction(event)
    const id = versionForEvent(event)
    const match = findState(event, 2000, 2000, (state) => (!id || id === versionForEvent(state))
      && abstractAction(state) === kind
      && !sources.get(state.id)!.some((source) => source.category === 'input'
        && (source.parameters?.meaningful === true) === semantic))
    if (match) {
      sources.get(match.id)!.push(event)
      suppressed.add(event.id)
    }
  }
  const events: InteractionEvent[] = []
  for (const event of ordered) {
    if (suppressed.has(event.id)) continue
    const previous = events.at(-1)
    if (event.category === 'input' && event.action.startsWith('Input: ') && previous
      && previous.action === event.action && previous.actor.id === event.actor.id
      && event.changeTime - previous.changeTime <= 1000) {
      sources.get(previous.id)!.push(event)
      events[events.length - 1] = { ...event, id: previous.id, inputTime: previous.inputTime }
      continue
    }
    sources.set(event.id, sources.get(event.id) ?? [event])
    events.push({ ...event, action: abstractAction(event) })
  }
  return { events, sources }
}

export function analyzeInteractions(log: InteractionLog, labels = interactionVersionLabels(log)) {
  const events = [...log.events].sort((a, b) => a.changeTime - b.changeTime || a.id.localeCompare(b.id))
  const actions = [...new Set(events.map((event) => event.action))].sort((a, b) => a.localeCompare(b))
  const users = new Map<string, { id: string; name: string; color: string; actions: Map<string, InteractionEvent[]> }>()
  const versionEvents = new Map<string, InteractionEvent[]>()
  const flows = new Map<string, EventGroup & { from: string; to: string; count: number }>()
  const lastAction = new Map<string, InteractionEvent>()
  const lastViewport = new Map<string, { x: number; y: number; time: number; event: InteractionEvent }>()
  const samples: { x: number; y: number; duration: number; events: InteractionEvent[] }[] = []

  for (const event of events) {
    const user = users.get(event.actor.id) ?? { ...event.actor, actions: new Map<string, InteractionEvent[]>() }
    const actionEvents = user.actions.get(event.action) ?? []
    actionEvents.push(event)
    user.actions.set(event.action, actionEvents)
    users.set(event.actor.id, user)
    const versionId = versionForEvent(event)
    if (versionId) {
      const entries = versionEvents.get(versionId) ?? []
      entries.push(event)
      versionEvents.set(versionId, entries)
    }

    if (event.parameters?.localObservation !== true
      && (event.category === 'state' || /^(undo|redo|ping|navigate)/i.test(event.action))) {
      const previous = lastAction.get(event.actor.id)
      if (previous) {
        const key = JSON.stringify([previous.action, event.action])
        const flow = flows.get(key) ?? { from: previous.action, to: event.action, count: 0, events: [] }
        flow.count++
        flow.events.push(previous, event)
        flows.set(key, flow)
      }
      lastAction.set(event.actor.id, event)
    }

    const previousView = lastViewport.get(event.actor.id)
    if (previousView && event.changeTime > previousView.time) {
      samples.push({ x: previousView.x, y: previousView.y, duration: event.changeTime - previousView.time,
        events: [previousView.event, event] })
      previousView.time = event.changeTime
    }
    if (event.viewport && event.parameters?.scope !== 'version') {
      const x = -event.viewport.panX / event.viewport.zoom
      const y = -event.viewport.panY / event.viewport.zoom
      if (Number.isFinite(x) && Number.isFinite(y)) lastViewport.set(event.actor.id, { x, y, time: event.changeTime, event })
    }
    if (event.action === 'Left room' && event.parameters?.meaningful === true) lastViewport.delete(event.actor.id)
  }

  const bounds = samples.reduce((result, sample) => ({
    minX: Math.min(result.minX, sample.x), maxX: Math.max(result.maxX, sample.x),
    minY: Math.min(result.minY, sample.y), maxY: Math.max(result.maxY, sample.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
  const { minX, minY } = bounds
  const cellSize = samples.length ? Math.max(300, (bounds.maxX - minX) / 10, (bounds.maxY - minY) / 7) : 300
  const cells = new Map<string, EventGroup & { x: number; y: number; duration: number }>()
  for (const sample of samples) {
    const x = Math.floor((sample.x - minX) / cellSize)
    const y = Math.floor((sample.y - minY) / cellSize)
    const key = `${x},${y}`
    const cell = cells.get(key) ?? { x, y, duration: 0, events: [] }
    cell.duration += sample.duration
    cell.events.push(...sample.events)
    cells.set(key, cell)
  }
  const heatCells = [...cells.values()]
  return {
    actions,
    users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    flows: [...flows.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)).slice(0, 12),
    heatmap: { cells: heatCells, minX, minY, cellSize,
      columns: Math.max(1, ...heatCells.map((cell) => cell.x + 1)),
      rows: Math.max(1, ...heatCells.map((cell) => cell.y + 1)) },
    versions: [...versionEvents].map(([id, entries]) => ({
      id, label: labels.get(id) ?? 'Unknown version', events: entries,
    })).sort((a, b) => b.events.length - a.events.length || a.id.localeCompare(b.id)),
  }
}
