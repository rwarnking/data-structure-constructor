import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createServer } from 'vite'
import { computed, effectScope, ref } from 'vue'

globalThis.crypto ??= webcrypto

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
after(() => vite.close())

const { useHierarchyEditor } = await vite.ssrLoadModule('/src/composables/useHierarchyEditor.ts')
const { useVersionComparison } = await vite.ssrLoadModule('/src/composables/useVersionComparison.ts')
const { reflowVersionLayout, allocateVersionNumber, assignMissingVersionNumbers, assignVersionSuffixes, displayVersionId, retireVersionNumbers } = await vite.ssrLoadModule('/src/utils/versions.ts')
const { layoutTileLabel, tilesForForest, tilesFor } = await vite.ssrLoadModule('/src/utils/treemap.ts')
const { useGraphCamera } = await vite.ssrLoadModule('/src/composables/useGraphCamera.ts')
const { parseDataset } = await vite.ssrLoadModule('/src/services/dataset.ts')

function node(id, children = []) {
  return { id, value: id, children }
}

function version(id, data, parentId = null, step = 0) {
  return { id, data, parentId, step, lane: 0, branch: id, change: id, createdAt: step }
}

test('adding one parent preserves selected entries and uses the first entry parent', () => {
  const scope = effectScope()
  scope.run(() => {
    const state = ref({ versions: [version('v0', [node('p', [node('a'), node('b'), node('c')]), node('q', [node('d')])])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] })
    const active = computed(() => state.value.versions[0])
    const selectedNodes = ref(['c', 'a', 'd'])
    const messages = []
    const editor = useHierarchyEditor({
      clientId: 'test', state, active, selectedNodes, isReadOnly: computed(() => false),
      setSelectedNodes: (ids) => { selectedNodes.value = ids },
      notify: (message) => messages.push(message),
      createVersion: (data) => { active.value.data = data; return active.value },
    })
    editor.addParent()
    editor.editor.value.entries[0].value = 'New parent'
    editor.commitEditor()
    assert.deepEqual(active.value.data[0].children.map((item) => item.value), ['b', 'New parent'])
    assert.deepEqual(active.value.data[0].children[1].children.map((item) => item.id), ['c', 'a', 'd'])
    assert.deepEqual(active.value.data[1].children, [])
    selectedNodes.value = ['c', 'p']
    editor.addParent()
    assert.equal(editor.editor.value, null)
    assert.match(messages.at(-1), /Cannot add a parent/)
  })
  scope.stop()
})

test('dataset validation rejects invalid root entries, views and connectors', () => {
  const root = version('v0', [node('a')])
  const dataset = { format: 'canopy-dataset', version: 1, room: 'Room', state: {
    versions: [root], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [],
  }, interactions: [] }
  assert.deepEqual(parseDataset(dataset), dataset)
  const invalid = structuredClone(dataset)
  invalid.state.versions[0].data.push(node('a'))
  assert.throws(() => parseDataset(invalid), /identifier/)
  invalid.state.versions[0].data.pop()
  invalid.state.versions[0].mapView = null
  assert.throws(() => parseDataset(invalid), /map view/)
  delete invalid.state.versions[0].mapView
  invalid.state.copyLinks.push({ sourceVersionId: 'v0', sourceNodeId: 'missing', targetVersionId: 'v0', targetNodeId: 'a' })
  assert.throws(() => parseDataset(invalid), /connector/)
})

test('splitting a parent preserves each child under its assigned result', () => {
  const scope = effectScope()
  scope.run(() => {
    const state = ref({ versions: [version('v0', [node('parent', [node('a'), node('b')])])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] })
    const active = computed(() => state.value.versions[0])
    const selectedNodes = ref([])
    const editor = useHierarchyEditor({
      clientId: 'test',
      state,
      active,
      selectedNodes,
      isReadOnly: computed(() => false),
      setSelectedNodes: (ids) => { selectedNodes.value = ids },
      createVersion: (data) => {
        const next = version('v1', data, 'v0', 1)
        state.value.versions[0] = next
        return next
      },
    })
    editor.openSplitEntry('parent')
    const operation = editor.entryOperation.value
    operation.entries[0].value = 'First'
    operation.entries[1].value = 'Second'
    operation.assignments.b = operation.entries[1].id
    editor.commitEntryOperation()
    assert.deepEqual(active.value.data.map((item) => [item.value, item.children.map((child) => child.id)]), [
      ['First', ['a']],
      ['Second', ['b']],
    ])
    assert.equal(selectedNodes.value.length, 2)
    assert.equal(editor.entryOperation.value, null)
  })
  scope.stop()
})

test('comparison and merge retain differences and prevent cyclic parents', () => {
  const scope = effectScope()
  scope.run(() => {
    const versions = computed(() => [
      version('source', [node('a', [node('b')])]),
      version('target', [node('a'), node('c')]),
    ])
    const comparison = useVersionComparison(versions, () => ({ zoom: 1, panX: 0, panY: 0, manual: false }), () => ({ width: 246, height: 213 }))
    comparison.startVersionSelection('merge')
    comparison.chooseCompare('source')
    comparison.chooseCompare('target')
    assert.deepEqual(comparison.comparison.value.map(({ id, kind }) => [id, kind]), [['b', 'Removed'], ['c', 'Added']])
    assert.deepEqual(comparison.mergeResult.value.data.map((item) => item.id), ['a', 'c'])
    comparison.setMergeParent('a', 'b')
    assert.equal(comparison.mergeResult.value.data.find((item) => item.id === 'a').children[0].id, 'b')
    comparison.setMergePicked('b', false)
    assert.equal(comparison.mergeResult.value.data.find((item) => item.id === 'a').children.length, 0)
  })
  scope.stop()
})

test('version layout keeps the main chain together and separates branches', () => {
  const root = version('v0', [])
  const first = version('v1', [], 'v0', 1)
  const main = version('v2', [], 'v1', 2)
  const side = version('v3', [], 'v1', 2)
  const leaf = version('v4', [], 'v2', 3)
  const state = { versions: [side, leaf, root, main, first], activeId: 'v4', nextNode: 1, nextVersion: 5, nextLane: 1, copyLinks: [] }
  reflowVersionLayout(state)
  assert.equal(first.lane, main.lane)
  assert.equal(main.lane, leaf.lane)
  assert.notEqual(side.lane, main.lane)
  assert.deepEqual(state.versions.map((item) => item.id), ['v0', 'v1', 'v2', 'v3', 'v4'])
})

test('merge reflow compacts unused lanes and remains stable on subsequent reflows', () => {
  const root = version('v0', [])
  const a = version('v1', [], 'v0', 1)
  const parent = version('v2', [], 'v1', 2)
  const main = version('v3', [], 'v2', 3)
  const leaf = version('v4', [], 'v3', 4)
  const merge = { ...version('v5', [], 'v2', 3), branch: parent.branch, mergeSourceId: a.id }
  const side = version('v6', [], 'v1', 2)
  const state = { versions: [root, a, parent, main, leaf, merge, side], activeId: 'v5', nextNode: 1, nextVersion: 7, nextLane: 42, copyLinks: [] }
  reflowVersionLayout(state)
  const lanes = [...new Set(state.versions.map((item) => item.lane))].sort((a, b) => a - b)
  assert.deepEqual(lanes, lanes.map((_, index) => index))
  assert.equal(merge.lane, parent.lane)
  assert.equal(state.nextLane, lanes.length)
  const firstLayout = state.versions.map(({ id, lane }) => [id, lane])
  reflowVersionLayout(state)
  assert.deepEqual(state.versions.map(({ id, lane }) => [id, lane]), firstLayout)
})

test('version numbering remains unique and stable across forks, concurrent writers, merges and reflow', () => {
  const root = version('v0', [])
  const graph = [root]
  function add(id, parent, owner, newBranch = false, mergeSource) {
    const item = { ...version(id, [], parent.id, Math.max(parent.step, mergeSource?.step ?? 0) + 1),
      branch: newBranch ? `${parent.branch}.${id}` : parent.branch, ...(mergeSource ? { mergeSourceId: mergeSource.id } : {}) }
    item.number = allocateVersionNumber(graph, parent, id, owner, newBranch)
    graph.push(item)
    return item
  }
  const a = add('v1-aaaaaaaaaaaa', root, 'writer-a')
  const a2 = add('v2-aaaaaaaaaaaa', a, 'writer-a')
  const fork = add('v3-aaaaaaaaaaaa', a, 'writer-a', true)
  const fork2 = add('v4-aaaaaaaaaaaa', fork, 'writer-a')
  const nested = add('v5-aaaaaaaaaaaa', fork, 'writer-a', true)
  const otherFork = add('v6-aaaaaaaaaaaa', a, 'writer-a', true)
  const merge = add('v7-aaaaaaaaaaaa', a2, 'writer-a', false, fork2)
  const laterFork = add('v8-aaaaaaaaaaaa', a2, 'writer-a', true, nested)
  const concurrentA = { ...version('v9-aaaaaaaaaaaa', [], merge.id, merge.step + 1), branch: merge.branch }
  const concurrentB = { ...version('v9-bbbbbbbbbbbb', [], merge.id, merge.step + 1), branch: merge.branch }
  concurrentA.number = allocateVersionNumber(graph, merge, concurrentA.id, 'writer-a', false)
  concurrentB.number = allocateVersionNumber(graph, merge, concurrentB.id, 'writer-b', false)
  graph.push(concurrentA, concurrentB)
  assert.equal(a2.number.step, a.number.step + 1)
  assert.equal(a.number.subbranch, 1)
  assert.equal(a2.number.subbranch, 1)
  assert.equal(fork.number.subbranch, 2)
  assert.equal(fork2.number.subbranch, 2)
  assert.equal(nested.number.subbranch, 3)
  assert.equal(otherFork.number.subbranch, 4)
  assert.equal(merge.number.subbranch, 1)
  assert.equal(concurrentB.number.subbranch, merge.number.subbranch)
  assert.equal(fork2.number.step, fork.number.step + 1)
  assert.equal(merge.number.step, a2.number.step + 1)
  assert.notEqual(fork.number.origin, otherFork.number.origin)
  assert.notEqual(concurrentA.number.origin, concurrentB.number.origin)
  assert.ok(laterFork.number.step > 0)
  assignVersionSuffixes(graph)
  const before = graph.map((item) => [item.id, displayVersionId(item)])
  assert.equal(new Set(before.map(([, label]) => label)).size, graph.length)
  assert.ok(before.every(([, label]) => /^\d{2,}\.\d{2,}\.\d{3,}(?:\.\d+)?$/.test(label)))
  reflowVersionLayout({ versions: graph, activeId: merge.id, nextNode: 1, nextVersion: 10, nextLane: 1, copyLinks: [] })
  assert.deepEqual(new Map(graph.map((item) => [item.id, displayVersionId(item)])), new Map(before))
  const saved = structuredClone(graph)
  assignMissingVersionNumbers(saved)
  assert.deepEqual(new Map(saved.map((item) => [item.id, displayVersionId(item)])), new Map(before))

  const legacy = [version('v0', []), { ...version('v1-aaaaaaaaaaaa', [], 'v0', 1), branch: 'B1', createdBy: 'aaaaaaaaaaaa' },
    { ...version('v2-aaaaaaaaaaaa', [], 'v1-aaaaaaaaaaaa', 2), branch: 'B1', createdBy: 'aaaaaaaaaaaa' }]
  assignMissingVersionNumbers(legacy)
  assert.equal(legacy[2].number.step, legacy[1].number.step + 1)
  assert.equal(legacy[2].number.origin, legacy[1].number.origin)
})

test('colliding numbers receive deterministic short suffixes and retired numbers stay reserved', () => {
  const number = { step: 2, branch: 1, subbranch: 1, origin: 'first', owner: 'writer', scheme: 2 }
  const first = { ...version('v1', [], 'v0', 2), createdAt: 1, number }
  const second = { ...version('v2', [], 'v0', 2), createdAt: 2, number: { ...number, origin: 'second' } }
  const third = { ...version('v3', [], 'v0', 2), createdAt: 3, number: { ...number, origin: 'third' } }
  const graph = [third, first, second]
  assignVersionSuffixes(graph)
  assert.deepEqual([first, second, third].map(displayVersionId), ['02.01.001', '02.01.001.1', '02.01.001.2'])
  const state = { versions: graph, activeId: first.id, nextNode: 1, nextVersion: 4, nextLane: 1, copyLinks: [] }
  retireVersionNumbers(state, [second])
  state.versions = [first, third]
  assignVersionSuffixes(state.versions, state.retiredVersionNumbers)
  assert.deepEqual([first, third].map(displayVersionId), ['02.01.001', '02.01.001.2'])
  retireVersionNumbers(state, [first])
  state.versions = [third]
  assignVersionSuffixes(state.versions, state.retiredVersionNumbers)
  assert.equal(displayVersionId(third), '02.01.001.2')
  const replacement = { ...version('v4', [], 'v0', 2), createdAt: 4, number: { ...number, origin: 'replacement' } }
  assignVersionSuffixes([replacement, third], state.retiredVersionNumbers)
  assert.equal(displayVersionId(replacement), '02.01.001.3')
  assert.equal(displayVersionId(third), '02.01.001.2')
  const peer = structuredClone([replacement, third])
  assignVersionSuffixes(peer.reverse(), [...state.retiredVersionNumbers].reverse())
  assert.deepEqual(new Map(peer.map((item) => [item.id, displayVersionId(item)])),
    new Map([third, replacement].map((item) => [item.id, displayVersionId(item)])))
})

test('legacy numbering migrates session changes without treating them as forks', () => {
  const root = version('v0', [])
  const oldNumber = (step, subbranch, origin, owner) => ({ step, branch: 3, subbranch, origin, owner })
  const first = { ...version('v1', [], 'v0', 1), branch: 'B3', number: oldNumber(1, 0, 'v1', 'a') }
  const second = { ...version('v2', [], 'v1', 2), branch: 'B3', number: oldNumber(2, 1, 'v2', 'b') }
  const fork = { ...version('v3', [], 'v1', 2), branch: 'B3.1', number: oldNumber(2, 2, 'v3', 'a') }
  const nested = { ...version('v4', [], 'v3', 3), branch: 'B3.1.1', number: oldNumber(3, 3, 'v4', 'a') }
  const graph = [root, first, second, fork, nested]
  assignMissingVersionNumbers(graph)
  assert.deepEqual(graph.slice(1).map((item) => item.number.subbranch), [1, 1, 2, 3])
  assert.deepEqual(graph.slice(1).map((item) => item.number.branch), [3, 3, 3, 3])
  assert.deepEqual(graph.slice(1).map((item) => item.number.origin), ['v1', 'v2', 'v3', 'v4'])
  const migrated = structuredClone(graph)
  assignMissingVersionNumbers(graph)
  assert.deepEqual(graph, migrated)
})

test('entry labels wrap within the available size, including long unbroken words', () => {
  const tile = { id: 'a', label: 'Long labels should use the available entry area', x: 0, y: 0, width: 100, height: 70, depth: 0, hasChildren: false }
  const wrapped = layoutTileLabel(tile)
  assert.ok(wrapped.lines.length > 1)
  assert.equal(wrapped.lines.join(' '), tile.label)
  assert.ok(wrapped.lines.length * wrapped.fontSize * 1.15 <= tile.height - 6)
  assert.ok(wrapped.lines.every((line) => line.length * wrapped.fontSize * 0.67 <= tile.width - 10))
  const unbroken = layoutTileLabel({ ...tile, label: 'abcdefghijklmnopqrstuvwxyz' })
  assert.equal(unbroken.lines.join(''), 'abcdefghijklmnopqrstuvwxyz')
  assert.ok(unbroken.lines.length > 1)
})

test('treemap layout reuses subtree geometry and reflects later edits', () => {
  let deep = node('leaf')
  for (let index = 0; index < 24; index++) deep = node(`parent-${index}`, [deep])
  const forest = [deep, node('other')]
  const tiles = tilesForForest(forest)
  assert.equal(tiles.length, 26)
  assert.deepEqual(tiles, forest.flatMap((root, index) => tilesFor(root, forest, index)))
  deep.children.push(node('new-child'))
  const updated = tilesForForest(forest)
  assert.equal(updated.length, 27)
  assert.ok(updated.some((tile) => tile.id === 'new-child'))
  assert.deepEqual(updated, forest.flatMap((root, index) => tilesFor(root, forest, index)))
})

test('connections crossing the viewport remain visible without either endpoint card', () => {
  const scope = effectScope()
  scope.run(() => {
    const root = version('v0', [])
    const source = version('source', [], 'v0', 1)
    const destination = { ...version('destination', [], 'source', 20), lane: 2, mergeSourceId: 'source' }
    const activeVersion = { ...version('active', [], 'v0', 50), lane: 5 }
    const graph = [root, source, destination, activeVersion]
    const state = ref({ versions: graph, activeId: 'active', nextNode: 1, nextVersion: 51, nextLane: 6, copyLinks: [] })
    const pan = ref({ x: -4150, y: -350 })
    const camera = useGraphCamera({
      versions: computed(() => state.value.versions), active: computed(() => state.value.versions[3]),
      state, compareIds: ref([]), draggedVersionId: () => undefined,
      zoom: ref(1), pan, canvasSize: ref({ width: 200, height: 600 }),
      windowDimensions: computed(() => ({ width: 100, height: 100 })), suppressClicks: () => {},
    })
    assert.ok(!camera.visibleVersions.value.some((item) => item.id === 'source' || item.id === 'destination'))
    assert.ok(camera.visibleConnectionVersions.value.some((item) => item.id === 'destination'))
    assert.ok(camera.visibleMergeConnectionVersions.value.some((item) => item.id === 'destination'))
    pan.value = { x: -12000, y: -350 }
    assert.ok(!camera.visibleConnectionVersions.value.some((item) => item.id === 'destination'))
    assert.ok(!camera.visibleMergeConnectionVersions.value.some((item) => item.id === 'destination'))
  })
  scope.stop()
})

test('attachment rejects cycles and moves a subtree without losing descendants', () => {
  const scope = effectScope()
  scope.run(() => {
    const state = ref({ versions: [version('v0', [node('a', [node('b')]), node('c')])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] })
    const active = computed(() => state.value.versions[0])
    let commits = 0
    const editor = useHierarchyEditor({
      clientId: 'test', state, active, selectedNodes: ref([]),
      isReadOnly: computed(() => false), setSelectedNodes: () => {},
      createVersion: (data) => {
        commits++
        return state.value.versions[0] = version('v1', data)
      },
    })
    assert.equal(editor.canAttach('a', 'b'), false)
    assert.equal(editor.attachEntry('a', 'b'), null)
    assert.equal(commits, 0)
    editor.attachEntry('a', 'c')
    assert.deepEqual(active.value.data, [node('c', [node('a', [node('b')])])])
    editor.attachEntry('b', 'c')
    assert.deepEqual(active.value.data, [node('c', [node('a'), node('b')])])
    editor.detachEntry('a')
    assert.deepEqual(active.value.data, [node('c', [node('b')]), node('a')])
  })
  scope.stop()
})

test('bulk deletion keeps unselected descendants even when selected nodes are nested', () => {
  const scope = effectScope()
  scope.run(() => {
    const state = ref({ versions: [version('v0', [node('a', [node('b', [node('c')]), node('d')])])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] })
    const active = computed(() => state.value.versions[0])
    const selected = ref(['a', 'b'])
    const editor = useHierarchyEditor({
      clientId: 'test', state, active, selectedNodes: selected,
      isReadOnly: computed(() => false), setSelectedNodes: (ids) => { selected.value = ids },
      createVersion: (data) => state.value.versions[0] = version('v1', data),
    })
    editor.deleteSelectedEntries('keep-children')
    assert.deepEqual(active.value.data, [node('c'), node('d')])
    assert.deepEqual(selected.value, [])
  })
  scope.stop()
})
