import type { ComputedRef, Ref } from 'vue'
import type { StoredState, TreeNode, Version } from '../types/workspace'
import type { useVersionComparison } from './useVersionComparison'
import type { useGraphCamera } from './useGraphCamera'
import type { useTreemapViews } from './useTreemapViews'
import { findNode, flattenPaths } from '../utils/tree'
import { allocateVersionNumber, assignVersionSuffixes, displayVersionId, isLatestOnBranch, retireVersionNumbers, structureSignature } from '../utils/versions'
import { fitMapViewToLayout, positionsForData } from '../utils/treemap'

export function useVersionHistory(options: {
  clientId: string
  state: Ref<StoredState>
  versions: ComputedRef<Version[]>
  active: ComputedRef<Version>
  selectedNode: Ref<string | null>
  windowDimensions: ComputedRef<{ width: number; height: number }>
  comparison: ReturnType<typeof useVersionComparison>
  camera: ReturnType<typeof useGraphCamera>
  treemaps: ReturnType<typeof useTreemapViews>
  reflowLayout: () => void
  setSelectedNodes: (ids: string[]) => void
  notify: (message: string) => void
  logInteraction: (action: string, reference?: { versionId?: string; nodeId?: string; nodeLabel?: string; ping?: { x: number; y: number } }) => void
}) {
  const { clientId: CLIENT_ID, state, versions, active, selectedNode, windowDimensions, reflowLayout, setSelectedNodes, notify, logInteraction } = options
  const { compareMode, compareIds, mergeMode, mergeResult, showOverview, mergeDecisions, mergeParentOverrides, mergePositionOverrides } = options.comparison
  const { isVersionCentered, cardPosition, cardHeight, startVersionArrival, panToVersion } = options.camera
  const { mapViewport, mapViewFor, centerVersionTreemaps, compactVersionTreemaps, mapViewTimers, transientMapViews } = options.treemaps
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const numberingWriter = crypto.randomUUID()
  const continuedParents = new Set<string>()
  function numberVersion(version: Version, parent: Version, newBranch: boolean) {
    version.number = allocateVersionNumber(versions.value, parent, version.id, numberingWriter, newBranch)
    if (!newBranch && parent.id !== 'v0') {
      if (continuedParents.has(parent.id)) version.number.origin = version.id
      continuedParents.add(parent.id)
    }
  }
  function createVersion(data: TreeNode[], change: string, forceNew = false) {
    const parent = active.value
    const wasCentered = isVersionCentered(parent)
    const parentPosition = cardPosition(parent)
    const arrivalFrom = {
      x: parentPosition.x,
      y: parentPosition.y + (cardHeight(parent) - windowDimensions.value.height) / 2,
    }
    const siblings = versions.value.filter((version) => version.parentId === parent.id)
    if (structureSignature(data) === structureSignature(parent.data)) {
      notify('No change · version not created')
      return null
    }
    const signature = structureSignature(data)
    const duplicate = forceNew
      ? undefined
      : siblings.find((version) => structureSignature(version.data) === signature)
    if (duplicate) {
      state.value.activeId = duplicate.id
      selectedNode.value = null
      notify(`Reopened existing ${displayVersionId(duplicate)}`)
      panToVersion(duplicate, wasCentered)
      return duplicate
    }
    const lane = parent.lane
    const branchNumber = siblings.reduce((highest, version) => {
      if (parent.id === 'v0') {
        return Math.max(highest, Number(version.branch.match(/^B(\d+)$/)?.[1] ?? 0))
      }
      const prefix = `${parent.branch}.`
      if (!version.branch.startsWith(prefix)) return highest
      const branchPart = version.branch.slice(prefix.length).split('.')[0]
      return Math.max(highest, Number(branchPart) || 0)
    }, 0) + 1
    const branch = parent.id === 'v0'
      ? `B${branchNumber}`
      : siblings.length ? `${parent.branch}.${branchNumber}` : parent.branch
    const viewport = mapViewport(parent)
    const currentMapView = mapViewFor(parent)
    const positions = positionsForData(parent.data, data, parent.positions, currentMapView, viewport)
    const fittedMapView = fitMapViewToLayout(data, positions, currentMapView)
    const version: Version = {
      id: `v${state.value.nextVersion++}-${CLIENT_ID}-${crypto.randomUUID().replace(/-/g, '')}`, parentId: parent.id, step: parent.step + 1,
      lane, branch, change, data, createdBy: CLIENT_ID, positions,
      ...(currentMapView.manual ? { mapView: clone(fittedMapView) } : {}),
      createdAt: Date.now(),
    }
    numberVersion(version, parent, branch !== parent.branch)
    state.value.versions.push(version)
    assignVersionSuffixes(state.value.versions, state.value.retiredVersionNumbers)
    reflowLayout()
    startVersionArrival(version, arrivalFrom)
    state.value.activeId = version.id
    selectedNode.value = null
    compareMode.value = false
    if (!parent.data.length && data.length) centerVersionTreemaps(version.id, false)
    const previousNodes = flattenPaths(parent.data)
    const nextNodes = flattenPaths(version.data)
    const addedNodeId = [...nextNodes.keys()].find((nodeId) => !previousNodes.has(nodeId))
    const removedNodeId = [...previousNodes.keys()].find((nodeId) => !nextNodes.has(nodeId))
    const changedNodeId = [...nextNodes].find(([nodeId, item]) =>
      previousNodes.get(nodeId)?.value !== item.value)?.[0]
    const movedNodeId = [...nextNodes].find(([nodeId, item]) =>
      previousNodes.has(nodeId) && previousNodes.get(nodeId)?.parentId !== item.parentId)?.[0]
    const referenceNodeId = addedNodeId ?? removedNodeId ?? changedNodeId ?? movedNodeId
    logInteraction(`Created ${displayVersionId(version)} · ${change}`, {
      versionId: version.id,
      nodeId: referenceNodeId,
      nodeLabel: referenceNodeId
        ? findNode(version.data, referenceNodeId)?.value ?? findNode(parent.data, referenceNodeId)?.value
        : undefined,
    })
    notify(`Created ${displayVersionId(version)} · ${change}`)
    panToVersion(version, wasCentered)
    return version
  }

  function confirmMerge() {
    const result = mergeResult.value
    if (!result) return
    const sourceIsLatest = isLatestOnBranch(versions.value, result.source)
    const targetIsLatest = isLatestOnBranch(versions.value, result.target)
    const laneParent = targetIsLatest ? result.target : sourceIsLatest ? result.source : result.target
    const mergeSource = laneParent.id === result.source.id ? result.target : result.source
    const parentPosition = cardPosition(laneParent)
    const arrivalFrom = {
      x: parentPosition.x,
      y: parentPosition.y + (cardHeight(laneParent) - windowDimensions.value.height) / 2,
    }
    const nextVersionNumber = state.value.nextVersion++
    const needsMergeLane = !sourceIsLatest && !targetIsLatest
    const branch = needsMergeLane ? `${result.target.branch}.M${nextVersionNumber}` : laneParent.branch
    const version: Version = {
      id: `v${nextVersionNumber}-${CLIENT_ID}-${crypto.randomUUID().replace(/-/g, '')}`,
      parentId: laneParent.id,
      mergeSourceId: mergeSource.id,
      step: Math.max(result.source.step, result.target.step) + 1,
      lane: laneParent.lane,
      branch,
      change: `Merge ${displayVersionId(result.source)} into ${displayVersionId(result.target)}`,
      data: clone(result.data),
      positions: clone(result.positions),
      createdBy: CLIENT_ID,
      createdAt: Date.now(),
    }
    numberVersion(version, laneParent, needsMergeLane)
    const wasCentered = isVersionCentered(result.target)
    state.value.versions.push(version)
    assignVersionSuffixes(state.value.versions, state.value.retiredVersionNumbers)
    compactVersionTreemaps(version.id, false)
    reflowLayout()
    startVersionArrival(version, arrivalFrom)
    state.value.activeId = version.id
    setSelectedNodes([])
    mergeMode.value = false
    compareMode.value = false
    showOverview.value = false
    compareIds.value = []
    mergeDecisions.value = {}
    mergeParentOverrides.value = {}
    mergePositionOverrides.value = {}
    notify(`Created merge ${displayVersionId(version)}`)
    logInteraction(`Merged ${displayVersionId(result.source)} into ${displayVersionId(result.target)}`, { versionId: version.id })
    panToVersion(version, wasCentered)
  }

  function pruneVersion(id: string) {
    if (id === 'v0') return
    const removeIds = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const version of versions.value) {
        if (version.parentId && removeIds.has(version.parentId) && !removeIds.has(version.id)) {
          removeIds.add(version.id)
          changed = true
        }
      }
    }
    if (versions.value.some((version) => !removeIds.has(version.id)
      && version.mergeSourceId && removeIds.has(version.mergeSourceId))) {
      notify('Cannot prune a version referenced by a merge')
      return
    }
    const fallbackId = versions.value.find((version) => version.id === id)?.parentId ?? 'v0'
    const activeRemoved = removeIds.has(state.value.activeId)
    const wasCentered = activeRemoved && isVersionCentered(active.value)
    if (!window.confirm(`Prune ${removeIds.size} version${removeIds.size === 1 ? '' : 's'} from this branch?`)) return
    for (const versionId of removeIds) {
      const timer = mapViewTimers.get(versionId)
      if (timer !== undefined) window.clearTimeout(timer)
      mapViewTimers.delete(versionId)
      delete transientMapViews.value[versionId]
    }
    state.value.copyLinks = state.value.copyLinks.filter((link) =>
      !removeIds.has(link.sourceVersionId) && !removeIds.has(link.targetVersionId))
    retireVersionNumbers(state.value, versions.value.filter((version) => removeIds.has(version.id)))
    state.value.versions = versions.value.filter((version) => !removeIds.has(version.id))
    assignVersionSuffixes(state.value.versions, state.value.retiredVersionNumbers)
    reflowLayout()
    if (activeRemoved) {
      state.value.activeId = fallbackId
      setSelectedNodes([])
      const fallback = versions.value.find((version) => version.id === fallbackId)
      if (fallback) panToVersion(fallback, wasCentered)
    }
    compareIds.value = compareIds.value.filter((versionId) => !removeIds.has(versionId))
    notify('Branch pruned')
  }

  return { createVersion, confirmMerge, pruneVersion }
}
