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
const { useVersionHistory } = await vite.ssrLoadModule('/src/composables/useVersionHistory.ts')
const { changedEntryIds } = await vite.ssrLoadModule('/src/utils/versionDifferences.ts')
const { reflowVersionLayout, allocateVersionNumber, assignMissingVersionNumbers, assignVersionSuffixes, displayVersionId, isLatestOnBranch, retireVersionNumbers } = await vite.ssrLoadModule('/src/utils/versions.ts')
const { layoutTileLabel, tilesForForest, tilesFor } = await vite.ssrLoadModule('/src/utils/treemap.ts')
const { duplicateLinks } = await vite.ssrLoadModule('/src/utils/duplicateLinks.ts')
const { nodeParentIds } = await vite.ssrLoadModule('/src/utils/tree.ts')
const { useGraphCamera } = await vite.ssrLoadModule('/src/composables/useGraphCamera.ts')
const { parseDataset } = await vite.ssrLoadModule('/src/services/dataset.ts')
const { isStoredState, isVersion } = await vite.ssrLoadModule('/src/utils/validation.ts')
const { shortcutAction, shortcuts } = await vite.ssrLoadModule('/src/config/hotkeys.ts')
const { actionIcons, actionSymbols } = await vite.ssrLoadModule('/src/config/icons.ts')
const { collaboratorColors } = await vite.ssrLoadModule('/src/utils/colors.ts')

function node(id, children = []) {
  return { id, value: id, children }
}

function version(id, data, parentId = null, step = 0) {
  return { id, data, parentId, step, lane: 0, branch: id, change: id, createdAt: step }
}

test('action configuration resolves editable shortcut mappings and icons', () => {
  const event = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false }
  assert.equal(shortcutAction(event), 'search')
  assert.equal(shortcutAction(event, { search: [{ key: 'k', mod: true }] }), undefined)
  assert.equal(shortcutAction({ ...event, key: 'k', metaKey: true, ctrlKey: false }, { search: [{ key: 'k', mod: true }] }), 'search')
  assert.ok(shortcuts.addChild.length)
  assert.ok(actionIcons.add)
  assert.equal(actionSymbols.merge, '⋈')
})

test('requested shortcuts resolve without collisions or obsolete alternatives', () => {
  const cases = [
    ['n', false, false, 'newEntry'], ['Delete', false, false, 'deleteNode'],
    ['a', false, false, 'addChild'], ['g', false, false, 'group'], ['e', false, false, 'edit'],
    ['d', false, false, 'detach'], ['t', false, false, 'tag'], ['m', false, false, 'mergeEntries'],
    ['s', false, false, 'split'], ['c', true, false, 'copy'], ['x', true, false, 'cut'],
    ['v', true, false, 'paste'], ['c', false, true, 'compare'], ['m', false, true, 'merge'],
    ['l', false, true, 'compact'], ['a', false, true, 'center'], ['1', false, false, 'focus'],
    ['2', false, false, 'neighborhood'], ['3', false, false, 'fitHeight'], ['4', false, false, 'fitAll'],
    ['ArrowLeft', false, false, 'previous'], ['ArrowRight', false, false, 'next'],
    ['ArrowUp', false, false, 'up'], ['ArrowDown', false, false, 'down'],
    ['PageUp', false, false, 'firstLane'], ['PageDown', false, false, 'lastLane'],
    ['Home', false, false, 'firstVersion'], ['End', false, false, 'lastVersion'],
  ]
  for (const [key, ctrlKey, shiftKey, expected] of cases) {
    assert.equal(shortcutAction({ key, ctrlKey, shiftKey, metaKey: false, altKey: false, repeat: false }), expected)
  }
  for (const [key, ctrlKey, shiftKey] of [['c', false, false], ['n', true, false], ['o', true, false],
    ['f', false, false], ['p', false, false], ['+', false, true], ['-', false, false]]) {
    assert.equal(shortcutAction({ key, ctrlKey, shiftKey, metaKey: false, altKey: false, repeat: false }), undefined)
  }
})

test('collaborator palette stays distinct and visible on light and dark surfaces', () => {
  const luminance = (hex) => {
    const [r, g, b] = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const light = luminance('#fcfdfb')
  const dark = luminance('#1d2722')
  assert.equal(new Set(collaboratorColors).size, collaboratorColors.length)
  for (const color of collaboratorColors) {
    const value = luminance(color)
    assert.ok((light + 0.05) / (value + 0.05) >= 3, `${color} on light`)
    assert.ok((value + 0.05) / (dark + 0.05) >= 3, `${color} on dark`)
  }
})

test('adding children applies one independent entry per selected parent', () => {
  const scope = effectScope()
  scope.run(() => {
    const state = ref({ versions: [version('v0', [node('a', [node('nested')]), node('b')])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] })
    const active = computed(() => state.value.versions[0])
    const selectedNodes = ref(['a', 'nested', 'b'])
    let commits = 0
    const editor = useHierarchyEditor({
      clientId: 'test', state, active, selectedNodes, isReadOnly: computed(() => false),
      setSelectedNodes: () => {}, notify: () => {},
      createVersion: (data) => { commits++; active.value.data = data; return active.value },
    })
    editor.addChildren()
    editor.editor.value.entries[0].value = 'Child'
    editor.commitEditor()
    const a = active.value.data[0]
    const children = [a.children[1], a.children[0].children[0], active.value.data[1].children[0]]
    assert.deepEqual(children.map((child) => child.value), ['Child', 'Child', 'Child'])
    assert.equal(new Set(children.map((child) => child.id)).size, 3)
    assert.equal(commits, 1)
  })
  scope.stop()
})

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
  const root = version('v0', [])
  const child = version('v1', [node('a')], 'v0', 1)
  const dataset = { format: 'canopy-dataset', version: 1, room: 'Room', state: {
    versions: [root, child], activeId: 'v1', nextNode: 1, nextVersion: 2, nextLane: 1, copyLinks: [],
  }, interactions: [] }
  assert.deepEqual(parseDataset(dataset), dataset)
  const invalid = structuredClone(dataset)
  invalid.state.versions[0].data.push(node('a'))
  assert.throws(() => parseDataset(invalid), /root version must be empty/i)
  assert.equal(isVersion(invalid.state.versions[0]), false)
  assert.equal(isStoredState(invalid.state), false)
  invalid.state.versions[0].data.pop()
  invalid.state.versions[1].data.push(node('a'))
  assert.throws(() => parseDataset(invalid), /Invalid or unsupported|identifier/)
  invalid.state.versions[1].data.pop()
  invalid.state.versions[1].mapView = null
  assert.throws(() => parseDataset(invalid), /map view/)
  delete invalid.state.versions[1].mapView
  invalid.state.copyLinks.push({ sourceVersionId: 'v1', sourceNodeId: 'missing', targetVersionId: 'v1', targetNodeId: 'a' })
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
      { ...version('target', [node('a'), node('c')]), positions: { a: { x: 0, y: 0 }, c: { x: 100, y: 100 } } },
    ])
    const comparison = useVersionComparison(versions, () => ({ zoom: 1, panX: 0, panY: 0, manual: false }), () => ({ width: 246, height: 213 }))
    comparison.startVersionSelection('merge', 'source')
    comparison.chooseCompare('target')
    assert.deepEqual(comparison.comparison.value.map(({ id, kind }) => [id, kind]), [['b', 'Removed'], ['c', 'Added']])
    assert.deepEqual(comparison.mergeResult.value.data.map((item) => item.id), ['a', 'c'])
    assert.ok(comparison.mergeResult.value.positions.c.x < 5)
    assert.ok(comparison.mergeResult.value.positions.c.y < 5)
    comparison.setMergeParent('a', 'b')
    assert.equal(comparison.mergeResult.value.data.find((item) => item.id === 'a').children[0].id, 'b')
    comparison.setMergePicked('b', false)
    assert.equal(comparison.mergeResult.value.data.find((item) => item.id === 'a').children.length, 0)
  })
  scope.stop()
})

test('parent-relative differences identify added, modified, relocated and replacement entries', () => {
  const parent = version('parent', [node('a', [node('child')]), node('b'), node('removed')])
  parent.positions = { a: { x: 0.1, y: 0.1 }, b: { x: 0.5, y: 0.1 } }
  const next = version('next', [
    { ...node('a'), description: 'Edited' },
    node('b', [node('child')]), node('merge-result'), node('split-one'), node('split-two'),
  ], parent.id, 1)
  next.positions = { a: { x: 0.1, y: 0.1 }, b: { x: 0.7, y: 0.1 } }
  assert.deepEqual([...changedEntryIds(next, parent)], ['a', 'child', 'merge-result', 'split-one', 'split-two'])
  assert.deepEqual([...changedEntryIds(parent)], [])

  const insertion = version('insertion', [node('new'), node('a'), node('b')])
  assert.deepEqual([...changedEntryIds(insertion, version('old', [node('a'), node('b')]))], ['new'])
  const reordered = version('reordered', [node('b'), node('a')])
  assert.deepEqual(new Set(changedEntryIds(reordered, version('old', [node('a'), node('b')]))), new Set(['a', 'b']))
})

test('parent-relative differences ignore treemap layout changes', () => {
  const parent = version('parent', [node('a', [node('child')]), node('b')])
  parent.positions = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
  const next = version('next', [node('a', [node('child')]), node('b'), node('added')], parent.id, 1)
  next.positions = { a: { x: 0.4, y: 0.1 }, b: { x: 1.5, y: 0.4 }, added: { x: 0, y: 2 } }
  assert.deepEqual([...changedEntryIds(next, parent)], ['added'])
  next.data.pop()
  assert.deepEqual([...changedEntryIds(next, parent)], [])
})

test('merges continue the latest target, otherwise the latest source, otherwise a new lane', () => {
  for (const [sourceLatest, targetLatest] of [[true, true], [true, false], [false, true], [false, false]]) {
    const root = version('v0', [])
    const source = { ...version('source', [node('s')], 'v0', 2), branch: 'B1' }
    const target = { ...version('target', [node('t')], 'v0', 2), branch: 'B2' }
    const graph = [root, source, target]
    if (!sourceLatest) graph.push({ ...version('source-next', source.data, source.id, 3), branch: source.branch })
    if (!targetLatest) graph.push({ ...version('target-next', target.data, target.id, 3), branch: target.branch })
    if (sourceLatest && targetLatest) {
      graph.push({ ...version('target-fork', target.data, target.id, 3), branch: 'B2.1' })
      graph.push({ ...version('target-fork-next', target.data, 'target-fork', 4), branch: 'B2.1' })
    }
    const state = ref({ versions: graph, activeId: target.id, nextNode: 1, nextVersion: 10, nextLane: 1, copyLinks: [] })
    const versions = computed(() => state.value.versions)
    const comparison = {
      mergeResult: ref({ source, target, data: [node('s'), node('t')], positions: {} }),
      compareMode: ref(false), compareIds: ref([]), mergeMode: ref(true), showOverview: ref(true),
      mergeDecisions: ref({}), mergeParentOverrides: ref({}), mergePositionOverrides: ref({}),
    }
    const history = useVersionHistory({
      clientId: 'test', state, currentRoomName: ref('test'), versions, active: computed(() => target), selectedNode: ref(null),
      windowDimensions: computed(() => ({ width: 200, height: 150 })), comparison,
      camera: { isVersionCentered: () => false, cardPosition: () => ({ x: 0, y: 0 }),
        cardHeight: () => 150, startVersionArrival: () => {}, panToVersion: () => {} },
      treemaps: { compactVersionTreemaps: () => {} },
      reflowLayout: () => reflowVersionLayout(state.value), setSelectedNodes: () => {}, notify: () => {}, logInteraction: () => {},
    })
    history.confirmMerge()
    const merged = state.value.versions.find((item) => item.id === state.value.activeId)
    const expectedParent = targetLatest ? target : sourceLatest ? source : target
    assert.equal(merged.parentId, expectedParent.id)
    assert.equal(merged.branch === expectedParent.branch, sourceLatest || targetLatest)
    const savedParent = state.value.versions.find((item) => item.id === expectedParent.id)
    if (sourceLatest || targetLatest) assert.equal(merged.lane, savedParent.lane)
    else assert.notEqual(merged.lane, savedParent.lane)
    const lanes = [...new Set(state.value.versions.map((item) => item.lane))].sort((a, b) => a - b)
    assert.deepEqual(lanes, lanes.map((_, index) => index))
    assert.equal(new Set(state.value.versions.map((item) => `${item.step}:${item.lane}`)).size, state.value.versions.length)
    const layout = state.value.versions.map(({ id, lane }) => [id, lane])
    reflowVersionLayout(state.value)
    assert.deepEqual(state.value.versions.map(({ id, lane }) => [id, lane]), layout)
  }
})

test('merge continuation ignores unrelated histories sharing a legacy branch name', () => {
  const numbered = (id, parentId, step, branch, subbranch) => ({
    ...version(id, [node(id)], parentId, step), branch,
    number: { step, branch: 1, subbranch, origin: id, owner: 'writer', scheme: 2 },
  })
  const root = version('v0', [])
  const target = numbered('target', 'v0', 15, 'B1.2', 5)
  const other = numbered('other', 'v0', 16, 'B1.2', 8)
  const source = numbered('source', 'v0', 15, 'B1.2.1', 9)
  const sourceNext = numbered('source-next', 'source', 16, 'B1.2.1', 9)
  const state = ref({ versions: [root, target, other, source, sourceNext], activeId: target.id,
    nextNode: 1, nextVersion: 152, nextLane: 1, copyLinks: [] })
  reflowVersionLayout(state.value)
  const comparison = {
    mergeResult: ref({ source, target, data: [node('merged')], positions: {} }),
    compareMode: ref(false), compareIds: ref([]), mergeMode: ref(true), showOverview: ref(true),
    mergeDecisions: ref({}), mergeParentOverrides: ref({}), mergePositionOverrides: ref({}),
  }
  const history = useVersionHistory({
    clientId: 'test', state, currentRoomName: ref('test'), versions: computed(() => state.value.versions),
    active: computed(() => state.value.versions.find((item) => item.id === state.value.activeId)),
    selectedNode: ref(null), windowDimensions: computed(() => ({ width: 200, height: 150 })), comparison,
    camera: { isVersionCentered: () => false, cardPosition: () => ({ x: 0, y: 0 }),
      cardHeight: () => 150, startVersionArrival: () => {}, panToVersion: () => {} },
    treemaps: { compactVersionTreemaps: () => {} },
    reflowLayout: () => reflowVersionLayout(state.value), setSelectedNodes: () => {}, notify: () => {}, logInteraction: () => {},
  })
  history.confirmMerge()
  const result = state.value.versions.find((item) => item.id === state.value.activeId)
  const savedTarget = state.value.versions.find((item) => item.id === target.id)
  assert.equal(result.parentId, target.id)
  assert.equal(result.lane, savedTarget.lane)
  assert.equal(result.number.subbranch, 5)
  assert.equal(result.number.step, 16)
})

test('reflow repairs an existing incorrectly split merge lane without renumbering history', () => {
  const number = (step, subbranch) => ({ step, branch: 1, subbranch, origin: `origin-${subbranch}`, owner: 'writer', scheme: 2 })
  const root = version('v0', [])
  const target = { ...version('target', [], 'v0', 15), branch: 'B1.2', number: number(15, 5) }
  const other = { ...version('other', [], 'v0', 16), branch: 'B1.2', number: number(16, 8) }
  const source = { ...version('source', [], 'v0', 15), branch: 'B1.2.1', number: number(15, 9) }
  const sourceNext = { ...version('source-next', [], 'source', 16), branch: source.branch, number: number(16, 9) }
  const merge = { ...version('merge', [], 'target', 16), branch: 'B1.2.M152', mergeSourceId: 'source',
    number: number(16, 20), numberSuffix: 1 }
  const state = { versions: [root, target, other, source, sourceNext, merge], activeId: merge.id,
    nextNode: 1, nextVersion: 153, nextLane: 1, copyLinks: [] }
  const savedNumber = structuredClone(merge.number)
  reflowVersionLayout(state)
  assert.equal(merge.lane, target.lane)
  assert.notEqual(merge.lane, sourceNext.lane)
  assert.deepEqual(merge.number, savedNumber)
  assert.equal(merge.numberSuffix, 1)
  assert.equal(new Set(state.versions.map((item) => `${item.step}:${item.lane}`)).size, state.versions.length)
  assert.equal(isLatestOnBranch(state.versions, target), false)
  const layout = state.versions.map(({ id, lane }) => [id, lane])
  reflowVersionLayout(state)
  assert.deepEqual(state.versions.map(({ id, lane }) => [id, lane]), layout)

  const continuation = { ...version('target-next', [], 'target', 16), branch: target.branch, number: number(16, 5) }
  state.versions.push(continuation)
  reflowVersionLayout(state)
  assert.notEqual(merge.lane, target.lane)
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

test('entry labels wrap at word boundaries and truncate without breaking words across lines', () => {
  const tile = { id: 'a', label: 'Long labels wrap at spaces', x: 0, y: 0, width: 100, height: 90, depth: 0, hasChildren: false }
  const wrapped = layoutTileLabel(tile)
  assert.ok(wrapped.lines.length > 1)
  assert.equal(wrapped.lines.join(' '), tile.label)
  assert.ok(wrapped.lines.length * wrapped.fontSize * 1.15 <= tile.height - 6)
  const unbroken = layoutTileLabel({ ...tile, label: 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz' })
  assert.equal(unbroken.lines.length, 1)
  assert.match(unbroken.lines[0], /^[a-z]+\.\.\.$/)
  const hyphenated = layoutTileLabel({ ...tile, label: 'alpha-beta' })
  assert.equal(hyphenated.lines.join(''), 'alpha-beta')
  assert.ok(hyphenated.lines.length === 1 || hyphenated.lines[0].endsWith('-'))
  assert.match(layoutTileLabel({ ...tile, height: 30, label: 'An entry with a much longer label that cannot fit' }).lines[0], /\.\.\.$/)
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

test('squarified sibling subtrees fill their parent without overlapping', () => {
  const forest = [node('root', [
    node('a'), node('b', [node('b1'), node('b2')]), node('c'),
    node('d', [node('d1'), node('d2'), node('d3')]), node('e'),
  ])]
  const tiles = tilesForForest(forest)
  const root = tiles.find((tile) => tile.id === 'root')
  const children = tiles.filter((tile) => tile.depth === 1)
  assert.equal(children.length, 5)
  for (const [index, child] of children.entries()) {
    assert.ok(child.x >= root.x && child.y >= root.y)
    assert.ok(child.x + child.width <= root.x + root.width + 0.001)
    assert.ok(child.y + child.height <= root.y + root.height + 0.001)
    for (const other of children.slice(index + 1)) {
      assert.ok(child.x + child.width <= other.x + 0.001 || other.x + other.width <= child.x + 0.001
        || child.y + child.height <= other.y + 0.001 || other.y + other.height <= child.y + 0.001)
    }
  }
  const area = children.reduce((sum, tile) => sum + tile.width * tile.height, 0)
  assert.ok(area / ((root.width - 16) * (root.height - 44)) > 0.95)
})

test('duplicate connectors retain the original choices across ties and nested duplicate groups', () => {
  function originalChoices(data, tiles) {
    const parents = nodeParentIds(data)
    const groups = new Map()
    for (const tile of tiles) {
      if (!groups.has(tile.label)) groups.set(tile.label, [])
      groups.get(tile.label).push(tile)
    }
    const connected = new Map(tiles.map((tile) => [tile.id, tile.id]))
    function rootOf(id) {
      const parent = connected.get(id)
      if (parent === id) return id
      const root = rootOf(parent)
      connected.set(id, root)
      return root
    }
    const choices = []
    const ordered = [...groups].sort((a, b) => Math.min(...a[1].map((tile) => tile.depth))
      - Math.min(...b[1].map((tile) => tile.depth)) || a[0].localeCompare(b[0]))
    for (const [label, group] of ordered) {
      const edges = group.flatMap((first, index) => group.slice(index + 1).map((second) => ({
        first, second, parentChild: parents.get(first.id) === second.id || parents.get(second.id) === first.id,
        distance: (first.x + first.width / 2 - second.x - second.width / 2) ** 2
          + (first.y + first.height / 2 - second.y - second.height / 2) ** 2,
      }))).sort((a, b) => Number(b.parentChild) - Number(a.parentChild) || a.distance - b.distance
        || a.first.id.localeCompare(b.first.id) || a.second.id.localeCompare(b.second.id))
      for (const { first, second } of edges) {
        const firstRoot = rootOf(first.id)
        const secondRoot = rootOf(second.id)
        if (firstRoot === secondRoot) continue
        const firstParent = parents.get(first.id)
        const secondParent = parents.get(second.id)
        const suppressed = firstParent && secondParent && firstParent !== secondParent && rootOf(firstParent) === rootOf(secondParent)
        connected.set(firstRoot, secondRoot)
        if (!suppressed) choices.push(`${first.id}:${second.id}:${label}`)
      }
    }
    return choices
  }
  let seed = 543298
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (let run = 0; run < 200; run++) {
    let id = 0
    function make(depth) {
      return { id: String(id++), value: ['same', 'also', 'other'][Math.floor(random() * 3)],
        children: depth ? Array.from({ length: Math.floor(random() * 4) }, () => make(depth - 1)) : [] }
    }
    const forest = Array.from({ length: 1 + Math.floor(random() * 5) }, () => make(3))
    let tiles = tilesForForest(forest)
    if (run % 2 === 0) tiles = tiles.map((tile) => ({ ...tile, x: Math.round(tile.x / 500) * 500, y: Math.round(tile.y / 500) * 500 }))
    if (run % 3 === 0) tiles.reverse()
    assert.deepEqual(duplicateLinks(forest, tiles).map((link) => link.id), originalChoices(forest, tiles), `forest ${run}`)
  }
  const nested = [
    { id: 'p1', value: 'parent', children: [{ id: 'c1', value: 'child', children: [] }] },
    { id: 'p2', value: 'parent', children: [{ id: 'c2', value: 'child', children: [] }] },
  ]
  assert.deepEqual(duplicateLinks(nested, tilesForForest(nested)).map((link) => link.id), ['p1:p2:parent'])
  const ids = ['é', 'e\u0301', 'x']
  const tied = ids.map((id) => ({ id, value: 'same', children: [] }))
  const tiedTiles = ids.map((id) => ({ id, label: 'same', x: 0, y: 0, width: 10, height: 10, depth: 0, hasChildren: false }))
  assert.deepEqual(duplicateLinks(tied, tiedTiles).map((link) => link.id), originalChoices(tied, tiedTiles))
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
