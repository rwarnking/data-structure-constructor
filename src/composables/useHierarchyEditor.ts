import { nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { EditorState, EntryDraft, EntryOperation, MapView, SpatialPreview, SplitDraft, StoredState, TreeNode, Version, VersionSound } from '../types/workspace'
import { countNodes, descendants, findNode, findParent, flattenNodes, removeNode } from '../utils/tree'

export function useHierarchyEditor(options: {
  clientId: string
  state: Ref<StoredState>
  active: ComputedRef<Version>
  selectedNodes: Ref<string[]>
  isReadOnly: ComputedRef<boolean>
  createVersion: (data: TreeNode[], change: string, forceNew?: boolean, sound?: VersionSound) => Version | null
  canCreateFrom: (version: Version) => boolean
  setSelectedNodes: (ids: string[]) => void
  notify: (message: string, error?: boolean) => void
}) {
  const { clientId: CLIENT_ID, state, active, selectedNodes, isReadOnly, createVersion, setSelectedNodes, notify } = options
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const editor = ref<EditorState | null>(null)
  const entryValueInput = ref<HTMLInputElement | null>(null)
  function setEntryValueInput(element: unknown) {
    entryValueInput.value = element instanceof HTMLInputElement ? element : null
  }
  watch(editor, async (value) => {
    if (!value) return
    await nextTick()
    entryValueInput.value?.focus()
    const text = value.mode === 'create' ? value.entries[0]?.value ?? '' : value.value
    entryValueInput.value?.setSelectionRange(text.length, text.length)
  })
  const entryOperation = ref<EntryOperation | null>(null)
  const bulkDeleteMode = ref<'keep-children' | 'subtree' | 'detach-children'>('keep-children')
  const bulkDeleteDialog = ref(false)
  function makeNode(value: string, description = ''): TreeNode {
    return { id: `n${state.value.nextNode++}-${CLIENT_ID}`, value, ...(description ? { description } : {}), children: [] }
  }
  function addEntry(parentId: string | null = null) {
    editor.value = { mode: 'create', parentId, entries: [newEntryDraft()] }
  }

  function addChildren() {
    if (isReadOnly.value) return
    const ids = selectedNodes.value.filter((id) => !!findNode(active.value.data, id))
    if (!ids.length) return
    editor.value = { mode: 'create', parentId: ids[0]!, childOf: ids, entries: [newEntryDraft()] }
  }

  function addParent() {
    if (isReadOnly.value || !selectedNodes.value.length) return
    const ids = selectedNodes.value.filter((id) => !!findNode(active.value.data, id))
    if (!ids.length) return
    const parent = findParent(active.value.data, ids[0]!)
    if (parent && ids.some((id) => {
      const selected = findNode(active.value.data, id)
      return selected && descendants(selected).includes(parent.id)
    })) {
      notify('Cannot add a parent inside the selected entries', true)
      return
    }
    editor.value = { mode: 'create', parentId: parent?.id ?? null, parentOf: ids, entries: [newEntryDraft()] }
  }

  function commitEditor() {
    if (!editor.value || (isReadOnly.value && editor.value.mode === 'rename')) return
    if (!options.canCreateFrom(active.value)) {
      notify('Cannot create a version here while branching is disabled', true)
      return
    }
    const currentEditor = editor.value
    if (currentEditor.mode === 'create') {
      const entries = currentEditor.entries.map((entry) => ({
        value: entry.value.trim(),
        description: entry.description.trim(),
      }))
      if (!entries.length || entries.some((entry) => !entry.value)) return
      const data = clone(active.value.data)
      if (currentEditor.childOf) {
        const parents = currentEditor.childOf.map((id) => findNode(data, id))
        if (parents.some((parent) => !parent)) { notify('Selected entries are no longer available', true); return }
        for (const parent of parents) {
          parent!.children.push(...entries.map((entry) => makeNode(entry.value, entry.description)))
        }
        editor.value = null
        const count = parents.length * entries.length
        createVersion(data, count > 1 ? `Created ${count} items` : `Add ${entries[0]!.value}`, count > 1, 'entryAdded')
        return
      }
      if (currentEditor.parentOf) {
        const ids = currentEditor.parentOf
        const flat = flattenNodes(data)
        const original = ids.map((id) => flat.get(id)?.node)
        if (original.some((node) => !node)) { notify('Selected entries are no longer available', true); return }
        const siblings = currentEditor.parentId ? findNode(data, currentEditor.parentId)?.children : data
        if (!siblings) { notify('The original parent is no longer available', true); return }
        const insertionIndex = siblings.findIndex((node) => node.id === ids[0])
        const selectedBefore = siblings.slice(0, insertionIndex).filter((node) => ids.includes(node.id)).length
        if (insertionIndex < 0 || ids.some((id) => {
          const node = findNode(data, id)
          return !!node && !!currentEditor.parentId && descendants(node).includes(currentEditor.parentId)
        })) { notify('Cannot add a parent inside the selected entries', true); return }
        const depth = (id: string) => {
          let result = 0
          let parentId = flat.get(id)?.parentId
          while (parentId) { result++; parentId = flat.get(parentId)?.parentId }
          return result
        }
        for (const id of [...ids].sort((a, b) => depth(b) - depth(a))) removeNode(data, id)
        const parent = makeNode(entries[0]!.value, entries[0]!.description)
        parent.children = original.filter((node): node is TreeNode => !!node)
        siblings.splice(Math.min(insertionIndex - selectedBefore, siblings.length), 0, parent)
        editor.value = null
        const version = createVersion(data, `Add parent ${parent.value}`, true, 'entryAdded')
        if (version) setSelectedNodes([parent.id])
        return
      }
      const nodes = entries.map((entry) => makeNode(entry.value, entry.description))
      if (currentEditor.parentId) {
        const parent = findNode(data, currentEditor.parentId)
        if (!parent) return
        parent.children.push(...nodes)
      } else data.push(...nodes)
      editor.value = null
      const operation = currentEditor.parentId ? 'Add' : 'Create'
      const summary = nodes.length === 1
        ? `${operation} ${entries[0]!.value}`
        : `Created ${nodes.length} items`
      createVersion(data, summary, nodes.length > 1, 'entryAdded')
      return
    }
    const { nodeId, value: rawValue, description: rawDescription } = currentEditor
    const value = rawValue.trim()
    const description = rawDescription.trim()
    if (!value) return
    const data = clone(active.value.data)
    const node = nodeId ? findNode(data, nodeId) : undefined
    if (!node || (node.value === value && (node.description ?? '') === description)) { editor.value = null; return }
    node.value = value
    if (description) node.description = description
    else delete node.description
    editor.value = null
    createVersion(data, `Rename to ${value}`)
  }

  function renameEntry(id: string) {
    if (isReadOnly.value) return
    const node = findNode(active.value.data, id)
    if (!node) return
    editor.value = { mode: 'rename', parentId: null, nodeId: id, value: node.value, description: node.description ?? '' }
  }

  function newEntryDraft(): EntryDraft {
    return { id: `draft-${crypto.randomUUID()}`, value: '', description: '' }
  }

  function addEditorEntryRow() {
    if (editor.value?.mode === 'create') editor.value.entries.push(newEntryDraft())
  }

  function removeEditorEntryRow(id: string) {
    if (editor.value?.mode === 'create' && editor.value.entries.length > 1) {
      editor.value.entries = editor.value.entries.filter((entry) => entry.id !== id)
    }
  }

  function deleteEntry(id: string, mode: 'keep-children' | 'subtree' | 'detach-children') {
    if (isReadOnly.value) return
    const data = clone(active.value.data)
    const node = findNode(data, id)
    if (!node) return
    if (mode === 'subtree' && node.children.length
      && !window.confirm(`Delete ${node.value} and all ${countNodes(node.children)} descendant entries?`)) return
    const parent = findParent(data, id)
    const siblings = parent?.children ?? data
    const index = siblings.findIndex((entry) => entry.id === id)
    if (index < 0) return
    if (mode === 'keep-children') siblings.splice(index, 1, ...node.children)
    else if (mode === 'detach-children' && node.children.length) {
      const detached = node.children
      siblings.splice(index, 1)
      data.push(...detached)
    } else siblings.splice(index, 1)
    createVersion(data, `Delete ${node.value}`, false, 'moved')
  }

  function deleteSelectedEntries(mode: 'keep-children' | 'subtree' | 'detach-children') {
    if (isReadOnly.value || selectedNodes.value.length < 2) return
    const selected = new Set(selectedNodes.value.filter((id) => !!findNode(active.value.data, id)))
    if (selected.size < 2) return
    const selectedRoots = [...selected].filter((id) => {
      let parent = findParent(active.value.data, id)
      while (parent) {
        if (selected.has(parent.id)) return false
        parent = findParent(active.value.data, parent.id)
      }
      return true
    })
    if (mode === 'subtree') {
      const count = selectedRoots.reduce((sum, id) => {
        const node = findNode(active.value.data, id)
        return sum + (node ? countNodes([node]) : 0)
      }, 0)
      if (!window.confirm(`Delete ${count} entries in the selected subtrees?`)) return
    }
    const data = clone(active.value.data)
    const detachedRoots: TreeNode[] = []
    const removeSelected = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((node) => {
      if (!selected.has(node.id)) {
        return [{ ...node, children: removeSelected(node.children) }]
      }
      if (mode === 'subtree') return []
      if (mode === 'detach-children') {
        for (const child of node.children) {
          if (selected.has(child.id)) removeSelected([child])
          else detachedRoots.push({ ...child, children: removeSelected(child.children) })
        }
        return []
      }
      return removeSelected(node.children)
    })
    const nextData = removeSelected(data)
    if (mode === 'detach-children') nextData.push(...detachedRoots)
    const count = countNodes(active.value.data) - countNodes(nextData)
    const version = createVersion(nextData, `Deleted ${count} items`, true, 'moved')
    if (version) setSelectedNodes([])
    entryOperation.value = null
    bulkDeleteDialog.value = false
  }

  function openBulkDelete() {
    if (selectedNodes.value.length < 2) return
    bulkDeleteMode.value = 'keep-children'
    bulkDeleteDialog.value = true
  }

  function highestSelectedNode(nodeIds: string[], data: TreeNode[]) {
    const flat = flattenNodes(data)
    const selected = new Set(nodeIds)
    const depthOf = (id: string) => {
      let depth = 0
      let parentId = flat.get(id)?.parentId
      while (parentId) {
        depth += 1
        parentId = flat.get(parentId)?.parentId ?? null
      }
      return depth
    }
    const order = new Map([...flat.keys()].map((id, index) => [id, index]))
    return nodeIds.filter((id) => {
      let parentId = flat.get(id)?.parentId
      while (parentId) {
        if (selected.has(parentId)) return false
        parentId = flat.get(parentId)?.parentId ?? null
      }
      return true
    }).sort((left, right) => depthOf(left) - depthOf(right)
      || order.get(left)! - order.get(right)!)[0]
  }

  function openMergeEntries() {
    const nodeIds = selectedNodes.value.filter((id) => !!findNode(active.value.data, id))
    if (nodeIds.length < 2) return
    const highest = highestSelectedNode(nodeIds, active.value.data)
    if (!highest) return
    const original = findNode(active.value.data, highest)!
    entryOperation.value = {
      mode: 'merge',
      nodeIds,
      value: original.value,
      description: original.description ?? '',
    }
  }

  function openSplitEntry(nodeId: string) {
    const node = findNode(active.value.data, nodeId)
    if (!node) return
    const first = newSplitDraft()
    entryOperation.value = {
      mode: 'split',
      nodeId,
      entries: [first, newSplitDraft()],
      assignments: Object.fromEntries(node.children.map((child) => [child.id, first.id])),
    }
  }

  function newSplitDraft(): SplitDraft {
    return { id: `split-${crypto.randomUUID()}`, value: '', description: '' }
  }

  function addSplitEntry() {
    if (entryOperation.value?.mode === 'split') {
      entryOperation.value.entries.push(newSplitDraft())
    }
  }

  function removeSplitEntry(id: string) {
    const operation = entryOperation.value
    if (operation?.mode !== 'split' || operation.entries.length <= 2) return
    const removed = operation.entries.find((entry) => entry.id === id)
    if (!removed) return
    const replacement = operation.entries.find((entry) => entry.id !== id)!
    operation.entries = operation.entries.filter((entry) => entry.id !== id)
    for (const [childId, destination] of Object.entries(operation.assignments)) {
      if (destination === id) operation.assignments[childId] = replacement.id
    }
  }

  function commitEntryOperation() {
    if (isReadOnly.value || !entryOperation.value) return
    const operation = entryOperation.value
    const data = clone(active.value.data)
    if (operation.mode === 'merge') {
      const value = operation.value.trim()
      if (!value) return
      const selected = new Set(operation.nodeIds.filter((id) => !!findNode(data, id)))
      if (selected.size < 2) return
      const flat = flattenNodes(data)
      const highest = highestSelectedNode([...selected], data)
      if (!highest) return
      const parentId = flat.get(highest)!.parentId
      const targetSiblings = parentId ? findNode(data, parentId)?.children : data
      if (!targetSiblings) return
      const originalIndex = targetSiblings.findIndex((node) => node.id === highest)
      if (originalIndex < 0) return
      const removedBefore = targetSiblings.slice(0, originalIndex).filter((node) => selected.has(node.id)).length
      const children: TreeNode[] = []
      const appendSelectedChildren = (node: TreeNode) => {
        for (const child of node.children) {
          if (selected.has(child.id)) appendSelectedChildren(child)
          else children.push(stripSelectedDescendants(child))
        }
      }
      const stripSelectedDescendants = (node: TreeNode): TreeNode => ({
        ...node,
        children: node.children.flatMap((child) => {
          if (selected.has(child.id)) {
            appendSelectedChildren(child)
            return []
          }
          return [stripSelectedDescendants(child)]
        }),
      })
      for (const id of selected) {
        const selectedNode = findNode(data, id)
        if (selectedNode && ![...selected].some((otherId) => {
          if (otherId === id) return false
          let parentId = flat.get(id)?.parentId
          while (parentId) {
            if (parentId === otherId) return true
            parentId = flat.get(parentId)?.parentId ?? null
          }
          return false
        })) appendSelectedChildren(selectedNode)
      }
      const removeSelected = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((node) =>
        selected.has(node.id) ? [] : [{ ...node, children: removeSelected(node.children) }])
      const nextData = removeSelected(data)
      const siblings = parentId ? findNode(nextData, parentId)?.children : nextData
      if (!siblings) return
      const mergeNode = makeNode(value, operation.description.trim())
      mergeNode.children = children
      siblings.splice(Math.max(0, originalIndex - removedBefore), 0, mergeNode)
      entryOperation.value = null
      const version = createVersion(nextData, `Merge ${selected.size} entries into ${value}`, true, 'entryAdded')
      if (version) setSelectedNodes([mergeNode.id])
      return
    }

    const original = findNode(data, operation.nodeId)
    if (!original || operation.entries.length < 2) return
    const entries = operation.entries.map((entry) => ({
      ...entry,
      value: entry.value.trim(),
      description: entry.description.trim(),
    }))
    if (entries.some((entry) => !entry.value)) return
    const validIds = new Set(entries.map((entry) => entry.id))
    if (original.children.some((child) => !validIds.has(operation.assignments[child.id]))) return
    const parent = findParent(data, operation.nodeId)
    const siblings = parent?.children ?? data
    const index = siblings.findIndex((node) => node.id === operation.nodeId)
    if (index < 0) return
    const childrenByEntry = new Map(entries.map((entry) => [entry.id, [] as TreeNode[]]))
    for (const child of original.children) {
      childrenByEntry.get(operation.assignments[child.id])!.push(child)
    }
    const replacements = entries.map((entry) => {
      const node = makeNode(entry.value, entry.description)
      node.children = childrenByEntry.get(entry.id)!
      return node
    })
    const nextData = data
    siblings.splice(index, 1, ...replacements)
    entryOperation.value = null
    const version = createVersion(nextData, `Split ${original.value} into ${entries.length} entries`, true, 'entryAdded')
    if (version) setSelectedNodes(replacements.map((node) => node.id))
  }

  function detachEntry(id: string, preview?: SpatialPreview) {
    if (isReadOnly.value) return null
    const data = clone(active.value.data)
    const parent = findParent(data, id)
    if (!parent) return null
    const detached = removeNode(data, id)
    let version: Version | null = null
    if (detached) {
      data.push(detached)
      version = createVersion(data, `Detach ${detached.value}`, false, 'moved')
      if (version && preview) {
        version.positions = clone(preview.positions)
        version.mapView = clone(preview.view)
      }
    }
    return version
  }

  function canAttach(sourceId: string, targetId: string, data = active.value.data) {
    const source = findNode(data, sourceId)
    return sourceId !== targetId && !!source && !descendants(source).includes(targetId)
  }

  function attachEntry(sourceId: string, targetId: string, preview?: { data: TreeNode[]; positions: Record<string, { x: number; y: number }>; view: MapView }) {
    if (isReadOnly.value) return null
    if (!canAttach(sourceId, targetId)) return null
    const parent = findParent(active.value.data, sourceId)
    if (parent?.id === targetId) return null
    const data = clone(active.value.data)
    const source = removeNode(data, sourceId)
    const target = findNode(data, targetId)
    if (!source || !target) return null
    target.children.push(source)
    const version = createVersion(data, `Attach ${source.value} to ${target.value}`, false, 'moved')
    if (version && preview) {
      version.positions = clone(preview.positions)
      version.mapView = clone(preview.view)
    }
    return version
  }
  return { editor, setEntryValueInput, entryOperation, bulkDeleteMode, bulkDeleteDialog,
    addEntry, addChildren, addParent, commitEditor, renameEntry, addEditorEntryRow, removeEditorEntryRow, deleteEntry,
    deleteSelectedEntries, openBulkDelete, openMergeEntries, openSplitEntry, addSplitEntry,
    removeSplitEntry, commitEntryOperation, detachEntry, canAttach, attachEntry }
}
