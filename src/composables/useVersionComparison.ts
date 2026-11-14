import { computed, ref, type ComputedRef } from 'vue'
import type { MapView, TreeNode, Version } from '../types/workspace'
import { descendants, findNode, flattenNodes, type FlatNode } from '../utils/tree'
import { CARD_WIDTH, TREE_MAP_HEIGHT, MAP_PADDING, positionsAfterMove, positionsForData, tilesFor } from '../utils/treemap'

export function useVersionComparison(
  versions: ComputedRef<Version[]>,
  mapViewFor: (version: Version) => MapView,
  mapViewport: (version: Version) => { width: number; height: number },
) {
  const compareMode = ref(false)
  const compareIds = ref<string[]>([])
  const showDifferenceColors = ref(true)
  const mergeMode = ref(false)
  const mergeDecisions = ref<Record<string, 'combine' | 'source' | 'target' | 'omit'>>({})
  const mergeParentOverrides = ref<Record<string, string>>({})
  const mergePositionOverrides = ref<Record<string, { x: number; y: number }>>({})
  const mergeDrag = ref<{ id: string; pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const mergeDropTarget = ref<string | null>(null)
  const comparisonSelectedNode = ref<string | null>(null)
  let suppressMergeClick = false

  function chooseCompare(id: string) {
    if (compareIds.value.includes(id)) compareIds.value = compareIds.value.filter((item) => item !== id)
    else compareIds.value = [...compareIds.value.slice(-1), id]
    mergeDecisions.value = {}
    mergeParentOverrides.value = {}
    mergePositionOverrides.value = {}
    mergeDrag.value = null
    mergeDropTarget.value = null
    comparisonSelectedNode.value = null
    if (compareIds.value.length === 2) showOverview.value = true
  }

  const showOverview = ref(false)
  function startVersionSelection(mode: 'compare' | 'merge') {
    compareMode.value = mode === 'compare'
    mergeMode.value = mode === 'merge'
    compareIds.value = []
    mergeDecisions.value = {}
    mergeParentOverrides.value = {}
    mergePositionOverrides.value = {}
    mergeDrag.value = null
    mergeDropTarget.value = null
    comparisonSelectedNode.value = null
    showOverview.value = false
  }
  function closeVersionSelection() {
    compareMode.value = false
    mergeMode.value = false
    showOverview.value = false
    compareIds.value = []
    mergeDecisions.value = {}
    mergeParentOverrides.value = {}
    mergePositionOverrides.value = {}
    mergeDrag.value = null
    mergeDropTarget.value = null
    comparisonSelectedNode.value = null
  }
  const comparison = computed(() => {
    if (compareIds.value.length !== 2) return []
    const left = versions.value.find((item) => item.id === compareIds.value[0])
    const right = versions.value.find((item) => item.id === compareIds.value[1])
    if (!left || !right) return []
    const a = flattenNodes(left.data)
    const b = flattenNodes(right.data)
    const changes: { id: string; kind: string; label: string }[] = []
    for (const [id, item] of a) {
      const other = b.get(id)
      if (!other) changes.push({ id, kind: 'Removed', label: item.path })
      else {
        if (item.parentId !== other.parentId || item.order !== other.order
        || (item.parentId === null && other.parentId === null
          && (Math.abs((left.positions?.[id]?.x ?? 0) - (right.positions?.[id]?.x ?? 0)) > 0.002
            || Math.abs((left.positions?.[id]?.y ?? 0) - (right.positions?.[id]?.y ?? 0)) > 0.002))) {
          changes.push({ id, kind: 'Relocated', label: item.path === other.path ? `${item.path} (position or parent changed)` : `${item.path} → ${other.path}` })
        }
        if (item.node.value !== other.node.value || item.node.description !== other.node.description) {
          changes.push({ id, kind: 'Modified', label: item.path === other.path ? item.path : `${item.path} → ${other.path}` })
        }
      }
    }
    for (const [id, item] of b) if (!a.has(id)) changes.push({ id, kind: 'Added', label: item.path })
    return changes
  })
  const differentEntryCount = computed(() => new Set(comparison.value.map((change) => change.id)).size)
  const comparisonStatus = computed(() => {
    const statuses = new Map<string, string[]>()
    for (const change of comparison.value) {
      const kinds = statuses.get(change.id) ?? []
      kinds.push(change.kind.toLowerCase())
      statuses.set(change.id, kinds)
    }
    return statuses
  })
  const mergeResult = computed(() => {
    if (!mergeMode.value || compareIds.value.length !== 2) return null
    const source = versions.value.find((item) => item.id === compareIds.value[0])
    const target = versions.value.find((item) => item.id === compareIds.value[1])
    if (!source || !target || source.id === target.id) return null
    const sourceNodes = flattenNodes(source.data)
    const targetNodes = flattenNodes(target.data)
    const values = new Map<string, { value: string; description?: string; parentId: string | null; order: number }>()
    const ids = [...new Set([...targetNodes.keys(), ...sourceNodes.keys()])]
    for (const id of ids) {
      const sourceEntry = sourceNodes.get(id)
      const targetEntry = targetNodes.get(id)
      const decision = mergeDecisions.value[id]
      if (decision === 'omit') continue
      const selected = decision === 'source' ? sourceEntry : decision === 'target' ? targetEntry : targetEntry ?? sourceEntry
      if (!selected) continue
      values.set(id, {
        value: selected.node.value,
        description: selected.node.description,
        parentId: selected.parentId,
        order: selected.order,
      })
    }

    const parentById = new Map([...values].map(([id, value]) => [id, value.parentId]))
    for (const [id, parentId] of Object.entries(mergeParentOverrides.value)) {
      if (!values.has(id) || (parentId && !values.has(parentId))) continue
      parentById.set(id, parentId || null)
    }
    for (const [id, parentId] of parentById) {
      if (parentId && !values.has(parentId)) parentById.set(id, null)
    }
    const checked = new Set<string>()
    for (const id of values.keys()) {
      if (checked.has(id)) continue
      const path: string[] = []
      const pathIndex = new Map<string, number>()
      let current: string | null | undefined = id
      while (current && values.has(current) && !checked.has(current)) {
        const cycleStart = pathIndex.get(current)
        if (cycleStart !== undefined) {
          for (const cycleId of path.slice(cycleStart)) parentById.set(cycleId, null)
          break
        }
        pathIndex.set(current, path.length)
        path.push(current)
        current = parentById.get(current)
      }
      path.forEach((item) => checked.add(item))
    }

    const nodes = new Map([...values].map(([id, value]) => [id, {
      id, value: value.value, ...(value.description ? { description: value.description } : {}), children: [] as TreeNode[],
    }]))
    const roots: TreeNode[] = []
    for (const id of [...values.keys()].sort((left, right) => values.get(left)!.order - values.get(right)!.order
      || ids.indexOf(left) - ids.indexOf(right))) {
      const node = nodes.get(id)
      if (!node) continue
      const parentId = parentById.get(id)
      const parent = parentId ? nodes.get(parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const positions = positionsForData(target.data, roots, target.positions, mapViewFor(target), mapViewport(target))
    for (const [id, position] of Object.entries(mergePositionOverrides.value)) {
      if (roots.some((node) => node.id === id)) {
        Object.assign(positions, positionsAfterMove(roots, positions, id, position))
      }
    }
    return { source, target, data: roots, positions }
  })
  const mergeRows = computed(() => {
    const merged = mergeResult.value
    if (!merged) return []
    const source = flattenNodes(merged.source.data)
    const target = flattenNodes(merged.target.data)
    const result = flattenNodes(merged.data)
    const depth = (id: string, entries: Map<string, FlatNode>) => {
      let value = 0
      let parentId = entries.get(id)?.parentId
      while (parentId && entries.has(parentId)) {
        value += 1
        parentId = entries.get(parentId)?.parentId ?? null
      }
      return value
    }
    const makeRow = (id: string) => {
      const sourceEntry = source.get(id)
      const targetEntry = target.get(id)
      return {
        id, sourceEntry, targetEntry, resultEntry: result.get(id),
        label: sourceEntry?.node.value ?? targetEntry!.node.value,
        shared: !!sourceEntry && !!targetEntry,
        depth: Math.max(sourceEntry ? depth(id, source) : 0, targetEntry ? depth(id, target) : 0),
      }
    }
    const sourceOnly = [...source.keys()].filter((id) => !target.has(id)).map(makeRow)
    const targetOnly = [...target.keys()].filter((id) => !source.has(id)).map(makeRow)
    const shared = [...source.keys()].filter((id) => target.has(id)).map(makeRow)
    return [...sourceOnly, ...targetOnly, ...shared]
  })
  function mergeParentOptions(nodeId: string) {
    const data = mergeResult.value?.data ?? []
    const entry = findNode(data, nodeId)
    const excluded = new Set(entry ? descendants(entry) : [nodeId])
    return [...flattenNodes(data)].filter(([id]) => !excluded.has(id))
  }
  function setMergeParent(nodeId: string, parentId: string) {
    const validParent = !parentId || mergeParentOptions(nodeId).some(([id]) => id === parentId)
    if (!validParent) return
    mergeParentOverrides.value = { ...mergeParentOverrides.value, [nodeId]: parentId }
  }
  function mergeDecisionFor(row: { id: string; sourceEntry?: FlatNode; targetEntry?: FlatNode }) {
    return mergeDecisions.value[row.id]
      ?? (row.sourceEntry && row.targetEntry ? 'combine' : row.sourceEntry ? 'source' : 'target')
  }
  function setMergeDecision(nodeId: string, decision: 'combine' | 'source' | 'target' | 'omit') {
    mergeDecisions.value = { ...mergeDecisions.value, [nodeId]: decision }
    const overrides = { ...mergeParentOverrides.value }
    delete overrides[nodeId]
    mergeParentOverrides.value = overrides
  }
  function setMergePicked(nodeId: string, picked: boolean) {
    const decisions = { ...mergeDecisions.value }
    if (picked) {
      if (decisions[nodeId] === 'omit') delete decisions[nodeId]
    } else decisions[nodeId] = 'omit'
    mergeDecisions.value = decisions
    if (!picked) {
      const overrides = { ...mergeParentOverrides.value }
      delete overrides[nodeId]
      mergeParentOverrides.value = overrides
    }
  }
  function toggleMergeEntry(nodeId: string) {
    const isIncluded = !!mergeResult.value?.data.some((node) =>
      !!findNode([node], nodeId))
    setMergePicked(nodeId, !isIncluded)
  }
  function onMergeTileClick(nodeId: string) {
    if (suppressMergeClick) {
      suppressMergeClick = false
      return
    }
    toggleMergeEntry(nodeId)
  }
  function onMergeParentChange(nodeId: string, event: Event) {
    setMergeParent(nodeId, (event.target as HTMLSelectElement).value)
  }
  function resetMerge() {
    mergeDecisions.value = {}
    mergeParentOverrides.value = {}
    mergePositionOverrides.value = {}
    mergeDrag.value = null
    mergeDropTarget.value = null
  }
  const comparisonPanels = computed(() => {
    if (compareIds.value.length !== 2) return []
    const source = versions.value.find((item) => item.id === compareIds.value[0])
    const target = versions.value.find((item) => item.id === compareIds.value[1])
    if (!source || !target) return []
    const panels = [
      { id: source.id, label: 'Source', version: source, data: source.data, positions: source.positions, role: 'source' },
      { id: target.id, label: 'Target', version: target, data: target.data, positions: target.positions, role: 'target' },
    ]
    return panels.map((panel) => ({
      ...panel,
      tiles: panel.data.flatMap((root, index) => tilesFor(root, panel.data, index, panel.positions)),
    }))
  })
  const comparisonViewBox = computed(() => {
    const tiles = comparisonPanels.value.flatMap((panel) => panel.tiles)
    if (!tiles.length) return '0 0 260 220'
    const left = Math.min(...tiles.map((tile) => tile.x))
    const top = Math.min(...tiles.map((tile) => tile.y))
    const right = Math.max(...tiles.map((tile) => tile.x + tile.width))
    const bottom = Math.max(...tiles.map((tile) => tile.y + tile.height))
    return `${left - MAP_PADDING} ${top - MAP_PADDING} ${Math.max(1, right - left) + MAP_PADDING * 2} ${Math.max(1, bottom - top) + MAP_PADDING * 2}`
  })
  function comparisonKinds(nodeId: string) {
    if (!showDifferenceColors.value) return ['unchanged']
    return comparisonStatus.value.get(nodeId) ?? ['unchanged']
  }
  function comparisonGhosts(panelIndex: number) {
    const counterpart = comparisonPanels.value[panelIndex === 0 ? 1 : 0]
    const panel = comparisonPanels.value[panelIndex]
    if (!panel || !counterpart) return []
    const present = new Set(panel.tiles.map((tile) => tile.id))
    return counterpart.tiles.filter((tile) => !present.has(tile.id))
  }
  function selectComparedNode(nodeId: string) {
    comparisonSelectedNode.value = comparisonSelectedNode.value === nodeId ? null : nodeId
  }
  const mergePreviewTiles = computed(() => {
    const result = mergeResult.value
    if (!result) return []
    return result.data.flatMap((root, index) => tilesFor(root, result.data, index, result.positions))
  })
  const mergePreviewViewBox = computed(() => {
    const tiles = mergePreviewTiles.value
    if (!tiles.length) return '0 0 260 220'
    const left = Math.min(...tiles.map((tile) => tile.x))
    const top = Math.min(...tiles.map((tile) => tile.y))
    const right = Math.max(...tiles.map((tile) => tile.x + tile.width))
    const bottom = Math.max(...tiles.map((tile) => tile.y + tile.height))
    return `${left - MAP_PADDING} ${top - MAP_PADDING} ${Math.max(1, right - left) + MAP_PADDING * 2} ${Math.max(1, bottom - top) + MAP_PADDING * 2}`
  })
  function startMergeDrag(event: PointerEvent, nodeId: string) {
    if (event.button !== 0) return
    event.preventDefault()
    mergeDrag.value = { id: nodeId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    ;(event.currentTarget as SVGRectElement).setPointerCapture(event.pointerId)
  }
  function moveMergeDrag(event: PointerEvent) {
    const drag = mergeDrag.value
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true
    if (!drag.moved) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGRectElement>('.merge-preview-tile')
    mergeDropTarget.value = hit?.dataset.node ?? null
  }
  function finishMergeDrag(event: PointerEvent) {
    const drag = mergeDrag.value
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      suppressMergeClick = true
      moveMergeDrag(event)
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const targetTile = hit?.closest<SVGRectElement>('.merge-preview-tile')
      if (targetTile && targetTile.dataset.node !== drag.id) {
        setMergeParent(drag.id, targetTile.dataset.node ?? '')
      } else if (!targetTile) {
        const svg = document.querySelector<SVGSVGElement>('.merge-preview-canvas')
        const rect = svg?.getBoundingClientRect()
        if (svg && rect && hit && svg.contains(hit)) {
          const { x: viewX, y: viewY, width: viewWidth, height: viewHeight } = svg.viewBox.baseVal
          const x = viewX + (event.clientX - rect.left) / rect.width * viewWidth
          const y = viewY + (event.clientY - rect.top) / rect.height * viewHeight
          setMergeParent(drag.id, '')
          mergePositionOverrides.value = {
            ...mergePositionOverrides.value,
            [drag.id]: { x: x / CARD_WIDTH, y: y / TREE_MAP_HEIGHT },
          }
        }
      }
    }
    mergeDrag.value = null
    mergeDropTarget.value = null
  }
  function cancelMergeDrag(event: PointerEvent) {
    if (mergeDrag.value?.pointerId !== event.pointerId) return
    mergeDrag.value = null
    mergeDropTarget.value = null
  }

  return {
    compareMode,
    compareIds,
    showDifferenceColors,
    mergeMode,
    mergeDecisions,
    mergeParentOverrides,
    mergePositionOverrides,
    mergeDrag,
    mergeDropTarget,
    comparisonSelectedNode,
    showOverview,
    chooseCompare,
    startVersionSelection,
    closeVersionSelection,
    comparison,
    differentEntryCount,
    mergeResult,
    mergeRows,
    mergeParentOptions,
    setMergeParent,
    mergeDecisionFor,
    setMergeDecision,
    setMergePicked,
    toggleMergeEntry,
    onMergeTileClick,
    onMergeParentChange,
    resetMerge,
    comparisonPanels,
    comparisonViewBox,
    comparisonKinds,
    comparisonGhosts,
    selectComparedNode,
    mergePreviewTiles,
    mergePreviewViewBox,
    startMergeDrag,
    moveMergeDrag,
    finishMergeDrag,
    cancelMergeDrag,
  }
}
