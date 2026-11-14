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
const { reflowVersionLayout } = await vite.ssrLoadModule('/src/utils/versions.ts')
const { layoutTileLabel } = await vite.ssrLoadModule('/src/utils/treemap.ts')

function node(id, children = []) {
  return { id, value: id, children }
}

function version(id, data, parentId = null, step = 0) {
  return { id, data, parentId, step, lane: 0, branch: id, change: id, createdAt: step }
}

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
