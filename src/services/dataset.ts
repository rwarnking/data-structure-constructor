import type { InteractionEntry } from '../types/collaboration'
import type { StoredState } from '../types/workspace'
import { findNode } from '../utils/tree'
import { hasRootEntries, isInteractionEntry, isRecord, isStoredState, RootNotEmptyError } from '../utils/validation'

export type Dataset = { format: 'canopy-dataset'; version: 1; room: string; state: StoredState; interactions: InteractionEntry[] }

export function parseDataset(value: unknown): Dataset {
  if (isRecord(value) && hasRootEntries(value.state)) throw new RootNotEmptyError()
  if (!isRecord(value) || value.format !== 'canopy-dataset' || value.version !== 1
    || typeof value.room !== 'string' || !value.room.trim() || value.room.length > 80
    || !isStoredState(value.state) || !Array.isArray(value.interactions)
    || !value.interactions.every(isInteractionEntry)) throw new Error('Invalid or unsupported Canopy dataset')
  const state = value.state
  if (![state.nextNode, state.nextVersion, state.nextLane].every((item) => Number.isSafeInteger(item) && item > 0)) {
    throw new Error('Invalid dataset counters')
  }
  const versions = new Map(state.versions.map((item) => [item.id, item]))
  for (const link of state.copyLinks) {
    const source = versions.get(link.sourceVersionId)
    const target = versions.get(link.targetVersionId)
    if (!source || !target || !findNode(source.data, link.sourceNodeId) || !findNode(target.data, link.targetNodeId)) {
      throw new Error('Invalid copy connector in dataset')
    }
  }
  for (const version of state.versions) {
    const view = version.mapView
    if (view !== undefined && (!isRecord(view) || !Number.isFinite(view.zoom) || view.zoom <= 0 || !Number.isFinite(view.panX)
      || !Number.isFinite(view.panY) || typeof view.manual !== 'boolean')) throw new Error('Invalid map view in dataset')
    if (!Number.isSafeInteger(version.step) || version.step < 0 || !Number.isSafeInteger(version.lane) || version.lane < 0) {
      throw new Error('Invalid graph layout in dataset')
    }
    const ids = new Set<string>()
    const pending = [...version.data]
    while (pending.length) {
      const node = pending.pop()!
      if (!node.id || ids.has(node.id)) throw new Error('Duplicate or empty entry identifier in dataset')
      ids.add(node.id)
      pending.push(...node.children)
    }
  }
  return { format: 'canopy-dataset', version: 1, room: value.room, state, interactions: value.interactions }
}
