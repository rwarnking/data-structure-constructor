import type { StoredState } from '../types/workspace'
import { findNode } from '../utils/tree'
import { defaultPositions, MAP_ZOOM_MAX, MAP_ZOOM_MIN, positionsAfterMove } from '../utils/treemap'
import { assignMissingVersionNumbers, assignVersionSuffixes, compareCopyLinks } from '../utils/versions'
import { hasRootEntries, isStoredState, RootNotEmptyError } from '../utils/validation'

const STORAGE_KEY = 'canopy-data-structure-v1'
const ROOMS_KEY = 'canopy-local-rooms-v1'
export const LAST_ROOM_KEY = 'canopy-last-room-v1'
const LEGACY_MIGRATION_KEY = 'canopy-room-data-migrated-v1'

export function createRoomStorage() {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const seed: StoredState = {
    versions: [{
      id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure',
      data: [], createdAt: Date.now(),
    }],
    activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 3, copyLinks: [],
  }

  function readState(): StoredState {
    let value: Partial<StoredState> | undefined
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return structuredClone(seed)
      value = JSON.parse(saved) as Partial<StoredState>
    } catch { /* Start with a clean graph if saved data is unreadable. */ }
    if (!value) return structuredClone(seed)
    if (hasRootEntries(value)) throw new RootNotEmptyError()
    try { return normalizeState(value) }
    catch { return structuredClone(seed) }
  }

  function roomDataKey(room: string) {
    return `canopy-room-data-v1-${encodeURIComponent(room)}`
  }

  function readLocalRooms() {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? '[]')
      return Array.isArray(stored)
        ? [...new Set(stored.filter((room): room is string =>
          typeof room === 'string' && !!room.trim() && room.length <= 80))]
        : []
    } catch {
      return []
    }
  }

  function persistLocalRooms(rooms: string[]) {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms))
  }

  function createLocalRoomName() {
    return `Room ${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  }

  function initializeLocalRooms() {
    const rooms = readLocalRooms()
    const requestedRoom = new URLSearchParams(location.search).get('room')?.trim()
    const lastRoom = localStorage.getItem(LAST_ROOM_KEY)
    const canMigrateLegacy = !requestedRoom && rooms.length === 0
    const currentRoom = requestedRoom
      || (lastRoom && rooms.includes(lastRoom) ? lastRoom : '')
      || rooms[0]
      || createLocalRoomName()
    if (!rooms.includes(currentRoom)) rooms.push(currentRoom)
    persistLocalRooms(rooms)
    localStorage.setItem(LAST_ROOM_KEY, currentRoom)
    return { rooms, currentRoom, canMigrateLegacy }
  }

  function readRoomState(room: string, migrateLegacy = false): StoredState {
    const savedRoomState = localStorage.getItem(roomDataKey(room))
    if (savedRoomState) {
      let parsed: unknown
      try {
        parsed = JSON.parse(savedRoomState) as unknown
      } catch {
        console.warn(`Could not load saved data for room "${room}"`)
      }
      if (hasRootEntries(parsed)) throw new RootNotEmptyError()
      if (isStoredState(parsed)) {
        try { return normalizeState(parsed) }
        catch { console.warn(`Could not load saved data for room "${room}"`) }
      }
    }
    if (migrateLegacy && localStorage.getItem(LEGACY_MIGRATION_KEY) !== 'true') {
      const legacy = localStorage.getItem(STORAGE_KEY)
      if (legacy) {
        const migrated = readState()
        localStorage.setItem(roomDataKey(room), JSON.stringify(migrated))
        localStorage.setItem(LEGACY_MIGRATION_KEY, 'true')
        return migrated
      }
    }
    return structuredClone(seed)
  }

  function normalizeState(value: Partial<StoredState>): StoredState {
    const normalizedVersions = (value.versions ?? clone(seed.versions)).map((version) => {
      const positions = version.positions ?? {}
      const firstRoot = version.data[0]
      const savedView = version.mapView
      const validView = savedView && Number.isFinite(savedView.zoom) && savedView.zoom > 0
        && Number.isFinite(savedView.panX) && Number.isFinite(savedView.panY)
        && typeof savedView.manual === 'boolean'
      return {
        ...version,
        mapView: validView ? {
          ...savedView,
          zoom: Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, savedView.zoom)),
        } : undefined,
        positions: firstRoot
          ? positionsAfterMove(version.data, positions, firstRoot.id, positions[firstRoot.id] ?? defaultPositions(version.data, positions)[firstRoot.id]!)
          : positions,
      }
    })
    const versionsById = new Map(normalizedVersions.map((version) => [version.id, version]))
    assignMissingVersionNumbers(normalizedVersions)
    assignVersionSuffixes(normalizedVersions, value.retiredVersionNumbers)
    return {
      ...clone(seed), ...value,
      versions: normalizedVersions,
      copyLinks: (value.copyLinks ?? []).filter((link) => {
        const source = versionsById.get(link.sourceVersionId)
        const target = versionsById.get(link.targetVersionId)
        return !!source && !!target
          && !!findNode(source.data, link.sourceNodeId)
          && !!findNode(target.data, link.targetNodeId)
      }).sort(compareCopyLinks),
    }
  }

  return { seed, roomDataKey, persistLocalRooms, initializeLocalRooms, readRoomState, normalizeState }
}
