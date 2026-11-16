import { computed, nextTick, ref, toRaw, watch, type ComputedRef, type Ref } from 'vue'
import { PeerRoom, type RoomStatus } from '../collaboration'
import type { CollaborationMetadata, Revision, StoredState, Version } from '../types/workspace'
import type { InteractionEntry, Ping, RemoteUser, SyncDelta, SyncSnapshot, VersionChange, VersionRemoval } from '../types/collaboration'
import { hasValidVersionStep, isCollaborationMetadata, isCopyLink, isInteractionEntry, isRecord, isRetiredVersionNumber, isRevision, isStoredState, isVersion, revisionIsNewer } from '../utils/validation'
import { findNode } from '../utils/tree'
import { assignMissingVersionNumbers, assignVersionSuffixes, compareCopyLinks, retireVersionNumbers } from '../utils/versions'
import { collaboratorColors, userColor } from '../utils/colors'

export function useCollaboration(options: {
  clientId: string
  state: Ref<StoredState>
  active: ComputedRef<Version>
  selectedNodes: Ref<string[]>
  currentRoomName: Ref<string>
  graphCanvas: Ref<HTMLElement | null>
  pan: Ref<{ x: number; y: number }>
  zoom: Ref<number>
  normalizeState: (state: Partial<StoredState>) => StoredState
  roomDataKey: (room: string) => string
  reflowLayout: () => void
  fitGraph: () => void
  followVersion: (version: Version) => void
  notify: (message: string, error?: boolean) => void
  playPing: () => void
  onLocalChanges?: (before: StoredState, after: StoredState, delta?: SyncDelta) => void
  onLocalInteraction?: (entry: InteractionEntry) => void
  onRemoteDeparture?: (entry: InteractionEntry) => void
  onSessionMessage?: (message: unknown) => boolean
  onSyncRequest?: (reply: (message: unknown) => void) => void
}) {
  const { clientId: CLIENT_ID, state, active, selectedNodes, currentRoomName, graphCanvas, pan, zoom, normalizeState, roomDataKey, reflowLayout, fitGraph, followVersion, notify } = options
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const animalNames = [
    'Badger', 'Bison', 'Capybara', 'Dolphin', 'Falcon', 'Fox', 'Gecko', 'Hare',
    'Heron', 'Koala', 'Lynx', 'Marmot', 'Otter', 'Panda', 'Quokka', 'Raven',
    'Robin', 'Seal', 'Tiger', 'Wombat',
  ]

  const remoteUsers = ref<Record<string, RemoteUser>>({})
  const savedName = localStorage.getItem('canopy-user-name')?.trim()
  const userName = ref(savedName && animalNames.includes(savedName) ? savedName : animalForUser(CLIENT_ID))
  const localColor = ref(collaboratorColors[0]!)
  function colorForUser(id: string) {
    return id === CLIENT_ID ? localColor.value : remoteUsers.value[id]?.color ?? userColor(id)
  }
  localStorage.setItem('canopy-user-name', userName.value)
  const interactions = ref<InteractionEntry[]>([])
  const roomInteractions = new Map<string, InteractionEntry[]>()
  const pings = ref<Ping[]>([])
  const roomStatus = ref<RoomStatus>({ state: 'idle', peers: 0, message: 'Not connected' })
  const peerRoom = new PeerRoom()
  const connectedUsers = computed(() => {
    return [
      { id: CLIENT_ID, name: userName.value.trim() || animalForUser(CLIENT_ID), activeVersionId: active.value.id },
      ...(roomStatus.value.state === 'connected' || roomStatus.value.state === 'hosting'
        ? Object.entries(remoteUsers.value).map(([id, user]) => ({
        id, name: user.name, activeVersionId: user.activeVersionId,
        }))
        : []),
    ]
  })
  const recentInteractions = computed(() => [...interactions.value]
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
    .slice(0, 10))

  let pingSequence = 0
  let interactionSequence = 0
  let collaborationRoom = ''
  let collaborationMetadata: CollaborationMetadata | null = null
  let lastObservedState = JSON.stringify(toRaw(state.value))
  let applyingRemoteState = false

  watch([selectedNodes, () => active.value.id, userName], publishPresence, { deep: true })
  watch(userName, (name) => {
    localStorage.setItem('canopy-user-name', name.trim().slice(0, 32) || animalForUser(CLIENT_ID))
  })
  watch(state, (value) => {
    const snapshot = JSON.stringify(toRaw(value))
    localStorage.setItem(roomDataKey(currentRoomName.value), snapshot)
    if (!applyingRemoteState && snapshot !== lastObservedState) {
      const before = JSON.parse(lastObservedState) as StoredState
      const delta = publishLocalChanges(value)
      options.onLocalChanges?.(before, clone(value), delta)
    }
    lastObservedState = snapshot
  }, { deep: true })

  function metadataKey(room: string) {
    return `canopy-collaboration-${room}`
  }

  function interactionStorageKey(room: string) {
    return `canopy-interactions-${encodeURIComponent(room)}`
  }

  function animalForUser(userId: string) {
    let hash = 2166136261
    for (const character of userId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return animalNames[(hash >>> 0) % animalNames.length]!
  }

  function addInteraction(entry: InteractionEntry, broadcast = true) {
    if (interactions.value.some((item) => item.id === entry.id)) return
    if (collaborationRoom) setRoomInteractions(collaborationRoom, [...interactions.value, entry])
    else interactions.value = [...interactions.value, entry].slice(-10)
    if (broadcast && collaborationRoom) peerRoom.send({ type: 'interaction', entry })
  }

  function setRoomInteractions(room: string, entries: InteractionEntry[]) {
    const saved = clone(entries)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .slice(-10)
    roomInteractions.set(room, saved)
    if (collaborationRoom === room) interactions.value = saved
    try {
      localStorage.setItem(interactionStorageKey(room), JSON.stringify(saved))
      return true
    } catch {
      notify(`Could not save recent interactions for room "${room}"`, true)
      return false
    }
  }

  function removeRoomInteractions(room: string) {
    localStorage.removeItem(interactionStorageKey(room))
    roomInteractions.delete(room)
  }

  function logInteraction(
    action: string,
    reference: { versionId?: string; nodeId?: string; nodeLabel?: string; ping?: { x: number; y: number; coordinateSpace?: 'viewport' } } = {},
  ) {
    const entry: InteractionEntry = {
      id: `${CLIENT_ID}-${Date.now()}-${++interactionSequence}`,
      actorId: CLIENT_ID,
      actorName: userName.value.trim() || animalForUser(CLIENT_ID),
      actorColor: localColor.value,
      action,
      createdAt: Date.now(),
      ...reference,
    }
    options.onLocalInteraction?.(entry)
    addInteraction(entry)
  }

  function recordRemoteDeparture(id: string, user: RemoteUser) {
    if (interactions.value.some((entry) => entry.actorId === id && entry.action === 'Left room'
      && Date.now() - entry.createdAt < 5000)) return
    const entry: InteractionEntry = { id: `departure-${id}-${Date.now()}`, actorId: id,
      actorName: user.name, actorColor: user.color, action: 'Left room', createdAt: Date.now() }
    addInteraction(entry, false)
    options.onRemoteDeparture?.(entry)
  }

  function newRevision(clock: number): Revision {
    return { clock, actor: CLIENT_ID }
  }

  function initializeCollaborationMetadata(room: string) {
    collaborationRoom = room
    const cached = roomInteractions.get(room)
    if (cached) interactions.value = cached
    else {
      const saved = localStorage.getItem(interactionStorageKey(room))
      if (saved) {
        let entries: unknown
        try {
          entries = JSON.parse(saved) as unknown
        } catch {
          entries = null
        }
        if (Array.isArray(entries) && entries.every(isInteractionEntry)) setRoomInteractions(room, entries)
        else { interactions.value = []; notify(`Could not load recent interactions for room "${room}"`, true) }
      } else interactions.value = []
    }
    const raw = localStorage.getItem(metadataKey(room))
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw)
        if (isCollaborationMetadata(value)) {
          collaborationMetadata = value
        }
      } catch {
        collaborationMetadata = null
      }
    }
    if (!collaborationMetadata) {
      const baseline = newRevision(1)
      collaborationMetadata = {
        clock: 1,
        versions: Object.fromEntries(state.value.versions.map((version) => [version.id, baseline])),
        removed: {},
        active: baseline,
        copyLinks: baseline,
      }
    } else {
      for (const version of state.value.versions) {
        collaborationMetadata.versions[version.id] ??= newRevision(collaborationMetadata.clock)
      }
    }
    persistCollaborationMetadata()
  }

  function persistCollaborationMetadata() {
    if (collaborationMetadata && collaborationRoom) {
      localStorage.setItem(metadataKey(collaborationRoom), JSON.stringify(collaborationMetadata))
    }
  }

  function publishLocalChanges(value: StoredState) {
    const previous = JSON.parse(lastObservedState) as StoredState
    if (!collaborationMetadata || !collaborationRoom) return
    const clock = ++collaborationMetadata.clock
    const revision = newRevision(clock)
    const previousVersions = new Map(previous.versions.map((version) => [version.id, version]))
    const currentVersions = new Map(value.versions.map((version) => [version.id, version]))
    const changed: VersionChange[] = []
    const removed: VersionRemoval[] = []
    for (const version of value.versions) {
      const previousVersion = previousVersions.get(version.id)
      if (previousVersion && JSON.stringify({ ...previousVersion, numberSuffix: undefined })
        === JSON.stringify({ ...toRaw(version), numberSuffix: undefined })) continue
      collaborationMetadata.versions[version.id] = revision
      delete collaborationMetadata.removed[version.id]
      changed.push({ version, revision })
    }
    for (const version of previous.versions) {
      if (currentVersions.has(version.id)) continue
      collaborationMetadata.removed[version.id] = revision
      delete collaborationMetadata.versions[version.id]
      removed.push({ id: version.id, revision })
    }
    const copyLinks = JSON.stringify(previous.copyLinks) !== JSON.stringify(value.copyLinks)
      ? (collaborationMetadata.copyLinks = revision, { links: value.copyLinks, revision })
      : undefined
    const retiredKeys = new Set((previous.retiredVersionNumbers ?? []).map((item) => JSON.stringify([item.id, item.suffix ?? 0])))
    const retiredVersionNumbers = (value.retiredVersionNumbers ?? [])
      .filter((item) => !retiredKeys.has(JSON.stringify([item.id, item.suffix ?? 0])))
    const delta: SyncDelta = {
      type: 'sync-delta', versions: changed, removed, copyLinks, retiredVersionNumbers,
      ...(value.branching && JSON.stringify(previous.branching) !== JSON.stringify(value.branching)
        ? { branching: value.branching } : {}),
      nextNode: value.nextNode, nextVersion: value.nextVersion, nextLane: value.nextLane,
    }
    persistCollaborationMetadata()
    peerRoom.send(delta)
    return delta
  }

  function sendSyncSnapshot(reply: (message: unknown) => void) {
    if (!collaborationMetadata) return
    const snapshot: SyncSnapshot = {
      type: 'sync-snapshot',
      state: clone(state.value),
      versions: clone(collaborationMetadata.versions),
      removed: clone(collaborationMetadata.removed),
      active: clone(collaborationMetadata.active),
      copyLinks: clone(collaborationMetadata.copyLinks),
      interactions: clone(interactions.value),
      clock: collaborationMetadata.clock,
    }
    reply(snapshot)
  }

  function applySyncSnapshot(message: SyncSnapshot) {
    if (!isStoredState(message.state) || !isRevision(message.active) || !isRevision(message.copyLinks)
      || !Number.isFinite(message.clock) || !isRecord(message.versions) || !isRecord(message.removed)
      || !Object.values(message.versions).every(isRevision) || !Object.values(message.removed).every(isRevision)
      || (message.interactions !== undefined
        && (!Array.isArray(message.interactions) || !message.interactions.every(isInteractionEntry)))) {
      notify('Ignored an invalid shared-state snapshot', true)
      return
    }
    collaborationMetadata = {
      clock: Object.values(message.versions).reduce(
        (clock, revision) => Math.max(clock, revision.clock),
        Math.max(1, message.clock, message.active.clock),
      ),
      versions: message.versions,
      removed: message.removed,
      active: message.active,
      copyLinks: message.copyLinks,
    }
    const localActiveId = state.value.activeId
    state.value = normalizeState(message.state)
    const combined = new Map([...interactions.value, ...(message.interactions ?? [])].map((entry) => [entry.id, entry]))
    if (collaborationRoom) setRoomInteractions(collaborationRoom, [...combined.values()])
    else interactions.value = [...combined.values()].slice(-10)
    state.value.activeId = state.value.versions.some((version) => version.id === localActiveId)
      ? localActiveId
      : state.value.versions.find((version) => version.id === 'v0')!.id
    reflowLayout()
    lastObservedState = JSON.stringify(toRaw(state.value))
    applyingRemoteState = true
    persistCollaborationMetadata()
    localStorage.setItem(roomDataKey(currentRoomName.value), lastObservedState)
    requestAnimationFrame(fitGraph)
    void nextTick(() => { applyingRemoteState = false })
  }

  function applySyncDelta(message: SyncDelta) {
    if (!collaborationMetadata || !Array.isArray(message.versions) || !Array.isArray(message.removed)
      || (message.retiredVersionNumbers !== undefined && (!Array.isArray(message.retiredVersionNumbers)
        || !message.retiredVersionNumbers.every(isRetiredVersionNumber)))
      || !Number.isInteger(message.nextNode) || !Number.isInteger(message.nextVersion)
      || !Number.isInteger(message.nextLane)
      || (message.branching !== undefined && (!isRecord(message.branching)
        || typeof message.branching.enabled !== 'boolean' || !isRevision(message.branching.revision)))) {
      notify('Ignored an invalid shared-state update', true)
      return
    }
    const previousVersions = new Map(state.value.versions.map((version) => [version.id, version]))
    const versionsById = new Map(previousVersions)
    const newVersions: Version[] = []
    let changed = false
    if (message.branching) {
      collaborationMetadata.clock = Math.max(collaborationMetadata.clock, message.branching.revision.clock)
      if (revisionIsNewer(message.branching.revision, state.value.branching?.revision)) {
        state.value.branching = clone(message.branching)
        changed = true
      }
    }
    const retired = state.value.retiredVersionNumbers ?? []
    const retiredById = new Map(retired.map((item) => [item.id, item]))
    for (const item of message.retiredVersionNumbers ?? []) {
      const previous = retiredById.get(item.id)
      if (previous && (previous.createdAt !== item.createdAt
        || previous.number.step !== item.number.step || previous.number.branch !== item.number.branch
        || previous.number.subbranch !== item.number.subbranch || previous.number.origin !== item.number.origin
        || previous.number.owner !== item.number.owner || previous.number.scheme !== item.number.scheme)) {
        notify('Ignored a shared update with conflicting retired version numbers', true)
        return
      }
      retiredById.set(item.id, item)
    }
    const retiredKeys = new Set(retired.map((item) => JSON.stringify([item.id, item.suffix ?? 0])))
    for (const item of message.retiredVersionNumbers ?? []) {
      const key = JSON.stringify([item.id, item.suffix ?? 0])
      if (retiredKeys.has(key)) continue
      retired.push(item)
      retiredKeys.add(key)
      changed = true
    }
    if (retired.length) state.value.retiredVersionNumbers = retired
    const receivedRetiredKeys = new Set(retiredKeys)
    for (const change of message.versions) {
      if (change && isRevision(change.revision)) collaborationMetadata.clock = Math.max(collaborationMetadata.clock, change.revision.clock)
    }
    for (const removal of message.removed) {
      if (removal && isRevision(removal.revision)) collaborationMetadata.clock = Math.max(collaborationMetadata.clock, removal.revision.clock)
    }
    for (const removal of message.removed) {
      if (!removal || removal.id === 'v0' || typeof removal.id !== 'string' || !isRevision(removal.revision)
        || !revisionIsNewer(removal.revision, collaborationMetadata.removed[removal.id])) continue
      collaborationMetadata.removed[removal.id] = removal.revision
      const currentRevision = collaborationMetadata.versions[removal.id]
      if (revisionIsNewer(removal.revision, currentRevision)) {
        const version = versionsById.get(removal.id)
        if (version) retireVersionNumbers(state.value, [version])
        versionsById.delete(removal.id)
        delete collaborationMetadata.versions[removal.id]
        changed = true
      }
    }
    for (const change of message.versions) {
      if (!change || !isVersion(change.version) || !isRevision(change.revision)) {
        notify('Ignored an invalid shared version update', true)
        continue
      }
      const parent = change.version.parentId ? versionsById.get(change.version.parentId) : undefined
      const mergeSource = change.version.mergeSourceId
        ? versionsById.get(change.version.mergeSourceId)
        : undefined
      const validParent = change.version.id === 'v0'
        ? change.version.parentId === null && change.version.step === 0
        : !!parent && hasValidVersionStep(change.version, parent, mergeSource)
      if (!validParent) {
        notify('Ignored a shared version with a missing or invalid connection', true)
        continue
      }
      const currentRevision = collaborationMetadata.versions[change.version.id]
      const removedRevision = collaborationMetadata.removed[change.version.id]
      if (!revisionIsNewer(change.revision, currentRevision) || revisionIsNewer(removedRevision, change.revision)) continue
      const existing = versionsById.get(change.version.id)
      if (existing?.number) {
        if (change.version.number && JSON.stringify(change.version.number) !== JSON.stringify(existing.number)) {
          notify('Ignored a shared update that changed a version number', true)
          continue
        }
        change.version.number = existing.number
      } else if (change.version.id !== 'v0' && change.version.number?.scheme !== 2) {
        assignMissingVersionNumbers([...versionsById.values(), change.version])
      }
      if (change.version.number && [...versionsById.values()].some((version) =>
        version.id !== change.version.id && version.number?.origin === change.version.number!.origin
        && version.number.step === change.version.number!.step)) {
        notify('Ignored a shared version with a duplicate version number', true)
        continue
      }
      if (!versionsById.has(change.version.id) && change.revision.actor !== CLIENT_ID) newVersions.push(change.version)
      collaborationMetadata.versions[change.version.id] = change.revision
      delete collaborationMetadata.removed[change.version.id]
      versionsById.set(change.version.id, change.version)
      changed = true
    }
    let removedOrphan = true
    while (removedOrphan) {
      removedOrphan = false
      for (const [id, version] of versionsById) {
        if (id === 'v0' || !version.parentId || versionsById.has(version.parentId)) continue
        const currentRevision = collaborationMetadata.versions[id]
        const parentRemoval = collaborationMetadata.removed[version.parentId]
        const removalRevision = revisionIsNewer(currentRevision, parentRemoval) ? currentRevision : parentRemoval
        if (removalRevision) collaborationMetadata.removed[id] = removalRevision
        retireVersionNumbers(state.value, [version])
        delete collaborationMetadata.versions[id]
        versionsById.delete(id)
        changed = true
        removedOrphan = true
      }
    }
    if (message.copyLinks && Array.isArray(message.copyLinks.links)
      && message.copyLinks.links.every(isCopyLink) && isRevision(message.copyLinks.revision)) {
      collaborationMetadata.clock = Math.max(collaborationMetadata.clock, message.copyLinks.revision.clock)
      const merged = new Map(state.value.copyLinks.map((link) => [JSON.stringify(link), link]))
      for (const link of message.copyLinks.links) merged.set(JSON.stringify(link), link)
      const links = [...merged.values()].filter((link) => {
        const source = versionsById.get(link.sourceVersionId)
        const target = versionsById.get(link.targetVersionId)
        return !!source && !!target
          && !!findNode(source.data, link.sourceNodeId)
          && !!findNode(target.data, link.targetNodeId)
      }).sort(compareCopyLinks)
      if (JSON.stringify(links) !== JSON.stringify(state.value.copyLinks)) {
        state.value.copyLinks = links
        changed = true
      }
      if (revisionIsNewer(message.copyLinks.revision, collaborationMetadata.copyLinks)) {
        collaborationMetadata.copyLinks = message.copyLinks.revision
      }
    }
    const nextNode = Math.max(state.value.nextNode, message.nextNode || 1)
    const nextVersion = Math.max(state.value.nextVersion, message.nextVersion || 1)
    const nextLane = Math.max(state.value.nextLane, message.nextLane || 1)
    if (nextNode !== state.value.nextNode || nextVersion !== state.value.nextVersion || nextLane !== state.value.nextLane) changed = true
    state.value.nextNode = nextNode
    state.value.nextVersion = nextVersion
    state.value.nextLane = nextLane
    if (!versionsById.has(state.value.activeId)) {
      let ancestor = previousVersions.get(state.value.activeId)?.parentId
      while (ancestor && !versionsById.has(ancestor)) ancestor = previousVersions.get(ancestor)?.parentId
      const fallback = versionsById.get(ancestor ?? 'v0')
      if (fallback) followVersion(fallback)
      changed = true
    }
    if (!changed) {
      persistCollaborationMetadata()
      return
    }
    state.value.versions = [...versionsById.values()].sort((left, right) =>
      left.step - right.step || left.id.localeCompare(right.id))
    assignMissingVersionNumbers(state.value.versions)
    assignVersionSuffixes(state.value.versions, state.value.retiredVersionNumbers)
    reflowLayout()
    let followId = state.value.activeId
    while (true) {
      const next = newVersions.filter((version) => version.parentId === followId && versionsById.has(version.id))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0]
      if (!next) break
      followId = next.id
    }
    if (followId !== state.value.activeId) followVersion(versionsById.get(followId)!)
    lastObservedState = JSON.stringify(toRaw(state.value))
    applyingRemoteState = true
    persistCollaborationMetadata()
    localStorage.setItem(roomDataKey(currentRoomName.value), lastObservedState)
    const extraRetired = (state.value.retiredVersionNumbers ?? [])
      .filter((item) => !receivedRetiredKeys.has(JSON.stringify([item.id, item.suffix ?? 0])))
    // Another peer may have seen a different suffix before the same version was removed.
    if (extraRetired.length) peerRoom.send({
      type: 'sync-delta', versions: [], removed: [], retiredVersionNumbers: extraRetired,
      nextNode: state.value.nextNode, nextVersion: state.value.nextVersion, nextLane: state.value.nextLane,
    } satisfies SyncDelta)
    void nextTick(() => { applyingRemoteState = false })
  }

  function handleRoomMessage(message: unknown, reply: (message: unknown) => void) {
    if (!message || typeof message !== 'object') return
    const packet = message as { type?: string }
    if (packet.type === 'sync-request') {
      sendSyncSnapshot(reply)
      options.onSyncRequest?.(reply)
      reply(presenceMessage(CLIENT_ID, userName.value, localColor.value, active.value.id, selectedNodes.value))
      for (const [id, user] of Object.entries(remoteUsers.value)) {
        reply(presenceMessage(id, user.name, user.color, user.activeVersionId, user.selectedNodeIds))
      }
    } else if (packet.type === 'session-interaction' || packet.type === 'session-log') {
      if (!options.onSessionMessage?.(message)) return false
    } else if (packet.type === 'sync-snapshot') {
      applySyncSnapshot(packet as SyncSnapshot)
    } else if (packet.type === 'sync-delta') {
      applySyncDelta(packet as SyncDelta)
    } else if (packet.type === 'presence') {
      const presence = message as { userId?: unknown; name?: unknown; color?: unknown; activeVersionId?: unknown; selectedNodeIds?: unknown }
      if (typeof presence.userId !== 'string' || !presence.userId
        || !(typeof presence.activeVersionId === 'string' || presence.activeVersionId === null)
        || !Array.isArray(presence.selectedNodeIds)
        || !presence.selectedNodeIds.every((id) => typeof id === 'string')) return
      const requestedName = typeof presence.name === 'string' && presence.name.trim()
        ? presence.name.trim().slice(0, 32)
        : animalForUser(presence.userId)
      const requestedColor = typeof presence.color === 'string' && collaboratorColors.includes(presence.color)
        ? presence.color : collaboratorColors[0]!
      if (presence.userId === CLIENT_ID) {
        if (!peerRoom.isHosting()) {
          userName.value = requestedName
          localColor.value = requestedColor
        }
        return peerRoom.isHosting() ? false : undefined
      }
      const name = peerRoom.isHosting()
        ? remoteUsers.value[presence.userId]?.name ?? availableName(requestedName)
        : requestedName
      const color = peerRoom.isHosting()
        ? remoteUsers.value[presence.userId]?.color ?? availableColor()
        : requestedColor
      remoteUsers.value = {
        ...remoteUsers.value,
        [presence.userId]: {
          name,
          color,
          activeVersionId: presence.activeVersionId,
          selectedNodeIds: presence.selectedNodeIds,
          lastSeen: Date.now(),
        },
      }
      if (peerRoom.isHosting()) {
        peerRoom.send(presenceMessage(presence.userId, name, color, presence.activeVersionId, presence.selectedNodeIds))
        return false
      }
    } else if (packet.type === 'presence-leave') {
      const userId = (message as { userId?: unknown }).userId
      if (typeof userId === 'string' && userId !== CLIENT_ID) {
        const user = remoteUsers.value[userId]
        if (user) recordRemoteDeparture(userId, user)
        const { [userId]: _leaving, ...remainingUsers } = remoteUsers.value
        remoteUsers.value = remainingUsers
      }
    } else if (packet.type === 'ping') {
      const ping = message as { id?: unknown; userId?: unknown; x?: unknown; y?: unknown; coordinateSpace?: unknown }
      if (typeof ping.id !== 'string' || typeof ping.userId !== 'string' || ping.userId === CLIENT_ID
        || !Number.isFinite(ping.x) || !Number.isFinite(ping.y)
        || (ping.coordinateSpace !== undefined && ping.coordinateSpace !== 'viewport')) return
      const entry = { id: ping.id, userId: ping.userId, x: ping.x as number, y: ping.y as number,
        ...(ping.coordinateSpace === 'viewport' ? { coordinateSpace: 'viewport' as const } : {}), createdAt: Date.now() }
      showPing(entry)
    } else if (packet.type === 'interaction') {
      const entry = (message as { entry?: unknown }).entry
      if (isInteractionEntry(entry) && entry.actorId !== CLIENT_ID) addInteraction(entry, false)
    }
  }

  function availableName(requested: string) {
    const used = new Set([userName.value, ...Object.values(remoteUsers.value).map((user) => user.name)]
      .map((name) => name.toLocaleLowerCase()))
    if (animalNames.includes(requested) && !used.has(requested.toLocaleLowerCase())) return requested
    for (const animal of animalNames) if (!used.has(animal.toLocaleLowerCase())) return animal
    for (let index = 2; ; index++) {
      const suffix = ` ${index}`
      const candidate = `${requested.slice(0, 32 - suffix.length)}${suffix}`
      if (!used.has(candidate.toLocaleLowerCase())) return candidate
    }
  }

  function availableColor() {
    const used = new Set([localColor.value, ...Object.values(remoteUsers.value).map((user) => user.color)])
    return collaboratorColors.find((color) => !used.has(color))
      ?? collaboratorColors[(Object.keys(remoteUsers.value).length + 1) % collaboratorColors.length]!
  }
  function presenceMessage(userId: string, name: string, color: string, activeVersionId: string | null, selectedNodeIds: string[]) {
    return { type: 'presence', userId, name, color, activeVersionId, selectedNodeIds }
  }

  function publishPresence() {
    if (!collaborationRoom) return
    peerRoom.send(presenceMessage(CLIENT_ID, userName.value.trim() || animalForUser(CLIENT_ID), localColor.value, active.value.id, selectedNodes.value))
  }
  function setBranching(enabled: boolean) {
    const clock = Math.max(collaborationMetadata?.clock ?? 0, state.value.branching?.revision.clock ?? 0) + 1
    if (collaborationMetadata) collaborationMetadata.clock = clock
    state.value.branching = { enabled, revision: newRevision(clock) }
  }
  function showPing(ping: Ping) {
    pings.value = [...pings.value.filter((item) => item.id !== ping.id), ping]
    window.setTimeout(() => {
      pings.value = pings.value.filter((item) => item.id !== ping.id)
    }, 1600)
    options.playPing()
  }
  function sendPingAt(clientX: number, clientY: number) {
    const rect = graphCanvas.value?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const ping = {
      id: `${CLIENT_ID}-${Date.now()}-${++pingSequence}`,
      userId: CLIENT_ID,
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
      coordinateSpace: 'viewport' as const,
      createdAt: Date.now(),
    }
    showPing(ping)
    peerRoom.send({ type: 'ping', ...ping })
    logInteraction('Ping', { ping: { x: ping.x, y: ping.y, coordinateSpace: ping.coordinateSpace } })
  }

  function onRoomStatus(status: RoomStatus) {
    const wasOnline = roomStatus.value.state === 'connected' || roomStatus.value.state === 'hosting'
    roomStatus.value = status
    if (status.state === 'connected' || status.state === 'hosting') {
      if (!wasOnline) logInteraction('Joined room')
      publishPresence()
    }
    if (status.state === 'idle') remoteUsers.value = {}
  }
  function expireRemoteUsers() {
    const cutoff = Date.now() - 15000
    for (const [id, user] of Object.entries(remoteUsers.value)) if (user.lastSeen < cutoff) recordRemoteDeparture(id, user)
    remoteUsers.value = Object.fromEntries(Object.entries(remoteUsers.value)
      .filter(([, user]) => user.lastSeen >= cutoff))
    publishPresence()
  }

  async function connectAutomatically(room: string) {
    initializeCollaborationMetadata(room)
    try {
      await peerRoom.hostRoom(room, handleRoomMessage, onRoomStatus)
    } catch {
      try {
        await peerRoom.joinRoom(room, handleRoomMessage, onRoomStatus)
      } catch {
        notify(`Could not connect to room "${room}": ${roomStatus.value.message}`, true)
        return
      }
    }
    if (roomStatus.value.state === 'hosting' || roomStatus.value.state === 'connected') {
      publishPresence()
      const url = new URL(location.href)
      url.searchParams.set('room', currentRoomName.value)
      history.replaceState(null, '', url)
      requestAnimationFrame(fitGraph)
    }
  }

  function resetRoomTracking() { collaborationRoom = ''; collaborationMetadata = null; localColor.value = collaboratorColors[0]! }
  function setObservedState(value: StoredState) { lastObservedState = JSON.stringify(toRaw(value)) }
  function finishRoomSwitch() { applyingRemoteState = false }

  return { remoteUsers, interactions, pings, roomStatus, peerRoom, connectedUsers, recentInteractions, colorForUser, userName,
    addReplayInteraction: (entry: InteractionEntry) => addInteraction(entry, false), showPing,
    metadataKey, logInteraction, setRoomInteractions, removeRoomInteractions, initializeCollaborationMetadata, sendPingAt,
    expireRemoteUsers, connectAutomatically, resetRoomTracking, setObservedState, finishRoomSwitch, setBranching }
}
