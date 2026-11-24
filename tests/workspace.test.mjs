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
const { layoutTileLabel, tilesForForest, tilesFor, fitMapViewAfterDrag, outOfViewDirections, positionsAfterMove, positionsForData, defaultPositions, overlappingTreemapIds, resolveTreemapExpansion, positionsAfterAttachment, outerTreemapDimensions, CARD_WIDTH, CARD_HEIGHT, TREE_MAP_HEIGHT, MAP_PADDING
} = await vite.ssrLoadModule('/src/utils/treemap.ts')
const { duplicateLinks } = await vite.ssrLoadModule('/src/utils/duplicateLinks.ts')
const { nodeParentIds, flattenNodes, flattenPaths } = await vite.ssrLoadModule('/src/utils/tree.ts')
const { useGraphCamera } = await vite.ssrLoadModule('/src/composables/useGraphCamera.ts')
const { parseDataset } = await vite.ssrLoadModule('/src/services/dataset.ts')
const { isStoredState, isVersion } = await vite.ssrLoadModule('/src/utils/validation.ts')
const { shortcutAction, shortcuts } = await vite.ssrLoadModule('/src/config/hotkeys.ts')
const { actionIcons, actionSymbols } = await vite.ssrLoadModule('/src/config/icons.ts')
const { collaboratorColors } = await vite.ssrLoadModule('/src/utils/colors.ts')
const { interactionPatch, applyInteractionPatch, newInteractionRevisions, parseInteractionLog } = await vite.ssrLoadModule('/src/utils/interactionLog.ts')
const { useInteractionRecorder } = await vite.ssrLoadModule('/src/composables/useInteractionRecorder.ts')
const { useInteractionReplay } = await vite.ssrLoadModule('/src/composables/useInteractionReplay.ts')
const { analyzeInteractions, abstractInteractions, interactionVersionLabels } = await vite.ssrLoadModule('/src/utils/interactionAnalysis.ts')

function node(id, children = []) {
  return { id, value: id, children }
}

function version(id, data, parentId = null, step = 0) {
  return { id, data, parentId, step, lane: 0, branch: id, change: id, createdAt: step }
}

test('replay cursor interpolation ignores stale positions on derived events', () => {
  const previousRequest = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  let frame
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1 }
  globalThis.cancelAnimationFrame = () => {}
  const scope = effectScope()
  try {
    const actor = { id: 'alice', name: 'Alice', color: '#123456' }
    const event = (id, action, changeTime, x, extra = {}) => ({ id, actor, action, category: 'input',
      method: 'mouse', inputTime: changeTime, changeTime, cursor: { x, y: 0 }, ...extra })
    const replay = scope.run(() => useInteractionReplay({ reset: () => {}, initialize: () => {},
      apply: () => {}, setScreen: () => {} }))
    replay.load({ format: 'canopy-interaction-log', version: 1, room: 'Room',
      initialState: {}, initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [
        event('open', 'Open entry menu', 1000, 100),
        event('selection', 'Selection', 1200, 100, { category: 'selection', inputTime: 1000 }),
        event('derived', 'Committed change', 1300, 900, { category: 'state' }),
        event('dialog', 'Dialog state', 1400, 800, { dialog: {} }),
        event('click', 'Button: Delete entry', 2000, 300, { method: 'button' }),
      ] })
    replay.seek(2)
    assert.equal(replay.cursorPositions.value.alice.x, 100)
    replay.beginning()
    replay.play()
    frame(100)
    frame(600)
    assert.equal(replay.cursorPositions.value.alice.x, 175)
    replay.pause()
  } finally {
    scope.stop()
    globalThis.requestAnimationFrame = previousRequest
    globalThis.cancelAnimationFrame = previousCancel
  }
})

test('tree flatteners preserve depth-first order, paths, parents, and sibling indexes', () => {
  const tree = [
    { ...node('root', [
      node('first', [node('grandchild')]),
      node('second'),
    ]), value: 'Root' },
    { ...node('other'), value: 'Other' },
  ]

  const flat = flattenNodes(tree)
  assert.deepEqual([...flat.keys()], ['root', 'first', 'grandchild', 'second', 'other'])
  assert.deepEqual([...flat.values()].map(({ parentId, path, order }) => ({ parentId, path, order })), [
    { parentId: null, path: 'Root', order: 0 },
    { parentId: 'root', path: 'Root/first', order: 0 },
    { parentId: 'first', path: 'Root/first/grandchild', order: 0 },
    { parentId: 'root', path: 'Root/second', order: 1 },
    { parentId: null, path: 'Other', order: 1 },
  ])
  assert.deepEqual([...flattenPaths(tree)], [
    ['root', { value: 'Root', parentId: null, path: 'Root' }],
    ['first', { value: 'first', parentId: 'root', path: 'Root/first' }],
    ['grandchild', { value: 'grandchild', parentId: 'first', path: 'Root/first/grandchild' }],
    ['second', { value: 'second', parentId: 'root', path: 'Root/second' }],
    ['other', { value: 'Other', parentId: null, path: 'Other' }],
  ])
})

test('interaction patches reproduce room changes and reject invalid replay data', () => {
  const initial = { versions: [version('v0', [])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] }
  const changed = { ...initial, versions: [...initial.versions, version('v1', [node('n1')], 'v0', 1)],
    activeId: 'v1', nextNode: 2, nextVersion: 2 }
  const patch = interactionPatch(initial, changed)
  assert.deepEqual(applyInteractionPatch(initial, patch), changed)
  const log = { format: 'canopy-interaction-log', version: 1, room: 'Room', initialState: initial,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [{
      id: 'one', actor: { id: 'user', name: 'User', color: '#123456' }, action: 'Add',
      category: 'state', method: 'button', inputTime: 1, changeTime: 2, patch,
    }] }
  const parsed = parseInteractionLog(log)
  assert.equal(parsed.events.length, 1)
  assert.equal(parsed.sessions.length, 1)
  assert.equal(parsed.sessions[0].actor.id, 'user')
  assert.deepEqual(parsed.sessions[0].eventIds, ['one'])
  const alice = { id: 'alice', name: 'Alice', color: '#123456' }
  const bob = { id: 'bob', name: 'Bob', color: '#654321' }
  const boundaryEvent = (id, actor, sessionId, action, time, boundary) => ({
    id, actor, sessionId, action, category: 'input', method: 'system', inputTime: time, changeTime: time,
    parameters: { sessionBoundary: boundary },
  })
  const shared = parseInteractionLog({ ...log,
    events: [boundaryEvent('alice-in', alice, 'alice-1', 'Login', 1, 'login'),
      boundaryEvent('alice-out', alice, 'alice-1', 'Logout', 2, 'logout'),
      boundaryEvent('bob-in', bob, 'bob-1', 'Login', 3, 'login')],
    sessions: [
      { id: 'alice-1', actor: alice, startedAt: 1, endedAt: 2, initialState: initial,
        initialViewport: { zoom: 1, panX: 0, panY: 0 }, eventIds: [] },
      { id: 'bob-1', actor: bob, startedAt: 3, initialState: changed,
        initialViewport: { zoom: 2, panX: 5, panY: 6 }, eventIds: [] },
    ],
  })
  assert.equal(shared.sessions.find((session) => session.id === 'alice-1').endedAt, 2)
  assert.equal(shared.sessions.find((session) => session.id === 'bob-1').initialState.versions.length, 2)
  assert.deepEqual(shared.sessions.find((session) => session.id === 'alice-1').eventIds, ['alice-in', 'alice-out'])
  const dialog = { editor: { mode: 'create', parentId: null,
    entries: [{ id: 'draft', value: 'Example', description: '' }] },
    operation: null, deleteOpen: false, deleteMode: 'keep-children' }
  assert.deepEqual(parseInteractionLog({ ...log, events: [{ ...log.events[0], dialog }] }).events[0].dialog, dialog)
  assert.throws(() => parseInteractionLog({ ...log, events: [{ ...log.events[0],
    dialog: { ...dialog, editor: { ...dialog.editor, entries: [{ id: 'draft', value: 3 }] } } }] }), /Invalid/)
  assert.throws(() => parseInteractionLog({ ...log, events: [{ ...log.events[0],
    dialog: { ...dialog, operation: { mode: 'split', nodeId: 'n', entries: [], assignments: {} } } }] }), /Invalid/)
  const mergeDialog = { versionIds: ['v0', 'v1'], decisions: { n1: 'omit' },
    parentOverrides: { n2: 'n1' }, positionOverrides: { n1: { x: 0.3, y: 0.7 } } }
  assert.deepEqual(parseInteractionLog({ ...log, events: [{ ...log.events[0], mergeDialog }] }).events[0].mergeDialog, mergeDialog)
  assert.equal(parseInteractionLog({ ...log, events: [{ ...log.events[0], mergeDialog: null }] }).events[0].mergeDialog, null)
  for (const invalid of [
    { ...mergeDialog, versionIds: ['v1', 'v1'] },
    { ...mergeDialog, decisions: { n1: 'invalid' } },
    { ...mergeDialog, parentOverrides: { n1: null } },
    { ...mergeDialog, positionOverrides: { n1: { x: Infinity, y: 0 } } },
  ]) assert.throws(() => parseInteractionLog({ ...log, events: [{ ...log.events[0], mergeDialog: invalid }] }), /Invalid/)
  const tagDialog = { versionId: 'v1', title: 'Draft', description: 'Details' }
  assert.deepEqual(parseInteractionLog({ ...log, events: [{ ...log.events[0], tagDialog }] }).events[0].tagDialog, tagDialog)
  assert.equal(parseInteractionLog({ ...log, events: [{ ...log.events[0], tagDialog: null }] }).events[0].tagDialog, null)
  for (const invalid of [
    { ...tagDialog, versionId: '' }, { ...tagDialog, title: 1 }, { ...tagDialog, description: null },
  ]) assert.throws(() => parseInteractionLog({ ...log, events: [{ ...log.events[0], tagDialog: invalid }] }), /Invalid/)
  assert.throws(() => parseInteractionLog({ ...log, events: [log.events[0], log.events[0]] }), /Invalid/)
  assert.throws(() => parseInteractionLog({ ...log, events: [{ ...log.events[0], patch: { ...patch, removed: ['v0'] } }] }), /invalid room state/)
})

test('replay resolves concurrent version edits by collaboration revision rather than arrival order', () => {
  const root = version('v0', [])
  const base = version('v1', [node('n1')], 'v0', 1)
  const initial = { versions: [root, base], activeId: 'v1', nextNode: 2, nextVersion: 2, nextLane: 1, copyLinks: [] }
  const winner = { ...base, tag: { title: 'winner', description: '' } }
  const loser = { ...base, tag: { title: 'loser', description: '' } }
  const revisions = newInteractionRevisions()
  const makePatch = (item, actor) => ({ versions: [item], removed: [], activeId: 'v1', nextNode: 2, nextVersion: 2,
    nextLane: 1, versionRevisions: { v1: { clock: 10, actor } } })
  const afterWinner = applyInteractionPatch(initial, makePatch(winner, 'z'), revisions)
  const afterLoser = applyInteractionPatch(afterWinner, makePatch(loser, 'a'), revisions)
  assert.equal(afterLoser.versions.find((item) => item.id === 'v1').tag.title, 'winner')
})

test('tag dialog events retain independent drafts and are suppressed during replay', () => {
  const previousWindow = globalThis.window
  globalThis.window = { clearTimeout, setTimeout }
  const scope = effectScope()
  try {
    const initial = { versions: [version('v0', [])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] }
    const recorder = scope.run(() => useInteractionRecorder({
      state: ref(initial), room: ref('Room'), zoom: ref(1), pan: ref({ x: 0, y: 0 }), selectedNodes: ref([]),
      screen: () => ({ width: 1440, height: 900 }), actor: () => ({ id: 'alice', name: 'Alice', color: '#123456' }),
      send: () => {}, notify: () => {},
    }))
    recorder.startRoom('Room')
    const draft = { versionId: 'v0', title: '', description: '' }
    recorder.recordTagDialog(draft, 'Tag editor opened')
    draft.title = 'Release'
    draft.description = 'Details'
    recorder.recordTagDialog(draft, 'Tag editor draft')
    recorder.recordTagDialog(null, 'Tag editor confirmed')
    recorder.replaying.value = true
    recorder.recordTagDialog(draft, 'Should not record')
    const events = parseInteractionLog(JSON.parse(JSON.stringify(recorder.current.value))).events.filter((event) => event.tagDialog !== undefined)
    assert.deepEqual(events.map((event) => event.action), ['Tag editor opened', 'Tag editor draft', 'Tag editor confirmed'])
    assert.equal(events[0].tagDialog.title, '')
    assert.deepEqual(events[1].tagDialog, draft)
    assert.equal(events[2].tagDialog, null)
  } finally {
    scope.stop()
    globalThis.window = previousWindow
  }
})

test('recorded dependencies make out-of-order and participant-specific replay possible', () => {
  const previousWindow = globalThis.window
  globalThis.window = { clearTimeout, setTimeout }
  const scope = effectScope()
  try {
    const root = version('v0', [])
    const parent = version('v1', [node('n1')], 'v0', 1)
    const branch = version('v2', [node('n2')], 'v0', 1)
    const merged = { ...version('v3', [node('n1')], 'v1', 2), mergeSourceId: 'v2' }
    const before = { versions: [root, parent, branch], activeId: 'v1', nextNode: 3, nextVersion: 3, nextLane: 1, copyLinks: [] }
    const after = { ...before, versions: [...before.versions, merged], activeId: 'v3', nextVersion: 4 }
    const rootState = { ...before, versions: [root], activeId: 'v0' }
    const actor = { id: 'alice', name: 'Alice', color: '#123456' }
    const recorder = scope.run(() => useInteractionRecorder({
      state: ref(rootState), room: ref('Room'), zoom: ref(1), pan: ref({ x: 0, y: 0 }), selectedNodes: ref([]),
      screen: () => ({ width: 1440, height: 900 }), actor: () => actor, send: () => {}, notify: () => {},
    }))
    recorder.startRoom('Room')
    recorder.recordRemoteState(rootState, before)
    recorder.recordState(before, after)
    const event = recorder.current.value.events.find((item) => item.patch && !item.parameters?.localObservation)
    assert.ok(recorder.current.value.events.some((item) => item.parameters?.localObservation))
    assert.deepEqual(event.patch.dependencies.map((item) => item.id), ['v1', 'v2'])
    assert.deepEqual(recorder.current.value.sessions[0].initialScreen, { width: 1440, height: 900 })
    const parsed = parseInteractionLog({ ...recorder.current.value, initialState: rootState })
    assert.equal(applyInteractionPatch(rootState,
      parsed.events.find((item) => item.patch && !item.parameters?.localObservation).patch).versions.length, 4)
    const laterParent = { ...event, id: 'later-parent', actor: { id: 'bob', name: 'Bob', color: '#654321' },
      sessionId: 'bob-session', inputTime: event.changeTime + 10, changeTime: event.changeTime + 10,
      patch: interactionPatch(rootState, before) }
    const ordered = parseInteractionLog({ ...recorder.current.value, initialState: rootState,
      events: [...recorder.current.value.events, laterParent] })
    assert.equal(ordered.events.at(-1).id, 'later-parent')
    const updatedParent = { ...parent, tag: { title: 'newer', description: '' } }
    const existing = { ...before, versions: [root, updatedParent, branch] }
    assert.equal(applyInteractionPatch(existing, event.patch).versions.find((item) => item.id === 'v1').tag.title, 'newer')
  } finally {
    scope.stop()
    globalThis.window = previousWindow
  }
})

test('invalid replay data is exported intact with an explicit warning', async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const create = URL.createObjectURL
  const revoke = URL.revokeObjectURL
  let blob
  let downloaded
  const messages = []
  globalThis.window = { clearTimeout, setTimeout }
  globalThis.document = { createElement: () => ({ click() { downloaded = this.download } }) }
  URL.createObjectURL = (value) => { blob = value; return 'blob:test' }
  URL.revokeObjectURL = () => {}
  const scope = effectScope()
  try {
    const initial = { versions: [version('v0', [])], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1, copyLinks: [] }
    const recorder = scope.run(() => useInteractionRecorder({
      state: ref(initial), room: ref('Room'), zoom: ref(1), pan: ref({ x: 0, y: 0 }), selectedNodes: ref([]),
      screen: () => ({ width: 1440, height: 900 }), actor: () => ({ id: 'alice', name: 'Alice', color: '#123456' }),
      send: () => {}, notify: (message, error) => messages.push({ message, error }),
    }))
    recorder.startRoom('Room')
    const bad = structuredClone(recorder.current.value)
    bad.events.push({ ...bad.events[0], id: 'bad', category: 'state', action: 'Invalid',
      patch: { versions: [], removed: ['v0'], activeId: 'v0', nextNode: 1, nextVersion: 1, nextLane: 1 } })
    recorder.exportLog(bad)
    assert.match(downloaded, /-raw\.json$/)
    assert.deepEqual(JSON.parse(await blob.text()), bad)
    assert.match(messages[0].message, /validation failed.*invalid room state/i)
    assert.equal(messages[0].error, true)
  } finally {
    scope.stop()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
  }
})

test('replay merges concurrent copy links and keeps the newest branching setting', () => {
  const initial = { versions: [version('v0', []), version('v1', [node('n1'), node('n2'), node('n3')], 'v0', 1)],
    activeId: 'v1', nextNode: 4, nextVersion: 2, nextLane: 1, copyLinks: [] }
  const link = (targetNodeId) => ({ sourceVersionId: 'v1', sourceNodeId: 'n1', targetVersionId: 'v1', targetNodeId })
  const base = { versions: [], removed: [], activeId: 'v1', nextNode: 4, nextVersion: 2, nextLane: 1 }
  const first = applyInteractionPatch(initial, { ...base, copyLinks: [link('n2')],
    branching: { enabled: false, revision: { clock: 10, actor: 'z' } } })
  const second = applyInteractionPatch(first, { ...base, copyLinks: [link('n3')],
    branching: { enabled: true, revision: { clock: 10, actor: 'a' } } })
  assert.deepEqual(second.copyLinks, [link('n2'), link('n3')])
  assert.equal(second.branching.enabled, false)
})

test('interaction visualizations group users, same-user transitions, viewport time and versions', () => {
  const alice = { id: 'alice', name: 'Alice', color: '#123456' }
  const bob = { id: 'bob', name: 'Bob', color: '#654321' }
  const event = (id, actor, action, time, extra = {}) => ({
    id, actor, action, category: 'input', method: 'mouse', inputTime: time, changeTime: time, ...extra,
  })
  const log = { initialState: { versions: [version('v0', [])] }, events: [
    event('1', alice, 'Graph zoom', 1000, { category: 'viewport', viewport: { zoom: 1, panX: 0, panY: 0 } }),
    event('2', alice, 'Ping', 2000, { parameters: { versionId: 'v0' } }),
    event('3', bob, 'Graph zoom', 2500, { category: 'viewport', viewport: { zoom: 1, panX: 0, panY: 0 } }),
    event('4', alice, 'Graph pan', 3000, { category: 'viewport', viewport: { zoom: 1, panX: -600, panY: 0 } }),
    event('5', alice, 'Version zoom', 4000, { category: 'viewport', parameters: { scope: 'version' },
      viewport: { zoom: 1, panX: -9000, panY: 0 } }),
    event('bob-ping', bob, 'Ping', 4500),
    event('6', alice, 'Navigate', 5000, { category: 'selection', selection: { versionId: 'v0', nodeIds: [] } }),
    event('left', bob, 'Left room', 5500, { parameters: { meaningful: true } }),
    event('joined', bob, 'Joined room', 10000, { parameters: { meaningful: true } }),
  ] }
  const result = analyzeInteractions(log)
  assert.equal(result.users.find((user) => user.id === 'alice').actions.get('Ping').length, 1)
  assert.equal(result.users.find((user) => user.id === 'bob').actions.get('Ping').length, 1)
  assert.deepEqual(result.flows.map(({ from, to, count }) => [from, to, count]), [['Ping', 'Navigate', 1]])
  assert.deepEqual(result.heatmap.cells.map(({ x, duration }) => [x, duration]), [[0, 5000], [2, 2000]])
  assert.equal(result.versions.find((item) => item.id === 'v0').events.length, 2)
  const empty = analyzeInteractions({ ...log, events: [] })
  assert.equal(empty.heatmap.cells.length, 0)
  assert.equal(empty.flows.length, 0)
})

test('abstract analysis groups committed actions with legacy semantic duplicates without merging separate edits', () => {
  const alice = { id: 'alice', name: 'Alice', color: '#123456' }
  const event = (id, action, changeTime, extra = {}) => ({
    id, actor: alice, action, category: 'input', method: 'button', inputTime: changeTime, changeTime, ...extra,
  })
  const first = { ...version('v1-hash', [node('n1')], 'v0', 1), change: 'Created 4 items',
    number: { step: 1, branch: 1, subbranch: 1, origin: 'v1-hash', owner: 'alice' } }
  const second = { ...first, id: 'v2-hash', parentId: first.id, step: 2, change: 'Detach n1',
    number: { ...first.number, step: 2, origin: 'v2-hash' } }
  const patch = (item) => ({ versions: [item], removed: [], activeId: item.id, nextNode: 2, nextVersion: 3, nextLane: 1 })
  const log = { initialState: { versions: [version('v0', [])] }, events: [
    event('click', 'Button: Add 4 entries', 100),
    event('summary', 'Created 01.01.001 · Created 4 items', 101, { parameters: { meaningful: true, versionId: first.id } }),
    event('state', 'Button: Add 4 entries', 102, { category: 'state', inputTime: 100, patch: patch(first), parameters: { versionId: first.id } }),
    event('summary2', 'Created 02.01.001 · Detach n1', 105, { parameters: { meaningful: true, versionId: second.id } }),
    event('state2', 'Created 02.01.001 · Detach n1', 106, { category: 'state', patch: patch(second), parameters: { versionId: second.id } }),
    event('navigation', 'Navigate', 110, { category: 'selection', selection: { versionId: second.id, nodeIds: [] } }),
    event('typing1', 'Input: Search', 111, { parameters: { value: 'a' } }),
    event('typing2', 'Input: Search', 112, { parameters: { value: 'ab' } }),
  ] }
  const result = abstractInteractions(log)
  assert.deepEqual(result.events.map((item) => item.action), ['Create entries', 'Detach entries', 'Navigate', 'Input: Search'])
  assert.deepEqual(result.sources.get('state').map((item) => item.id), ['state', 'click', 'summary'])
  assert.deepEqual(result.sources.get('typing1').map((item) => item.id), ['typing1', 'typing2'])
  assert.equal(interactionVersionLabels(log).get('v1-hash'), '01.01.001')
  assert.equal(analyzeInteractions(log).versions.find((item) => item.id === 'v2-hash').label, '02.01.001')
  assert.equal(log.events.length, 8)
})

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
    ['+', false, true, 'zoomIn'], ['-', false, false, 'zoomOut'],
    ['ArrowLeft', false, false, 'previous'], ['ArrowRight', false, false, 'next'],
    ['ArrowUp', false, false, 'up'], ['ArrowDown', false, false, 'down'],
    ['PageUp', false, false, 'firstLane'], ['PageDown', false, false, 'lastLane'],
    ['Home', false, false, 'firstVersion'], ['End', false, false, 'lastVersion'],
  ]
  for (const [key, ctrlKey, shiftKey, expected] of cases) {
    assert.equal(shortcutAction({ key, ctrlKey, shiftKey, metaKey: false, altKey: false, repeat: false }), expected)
  }
  for (const [key, ctrlKey, shiftKey] of [['c', false, false], ['n', true, false], ['o', true, false],
    ['f', false, false], ['p', false, false]]) {
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
      setSelectedNodes: () => {}, notify: () => {}, canCreateFrom: () => true,
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
      canCreateFrom: () => true,
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
  for (const width of [0, 1.1, NaN]) {
    invalid.state.versions[1].windowScale = { width, height: 0.5 }
    assert.throws(() => parseDataset(invalid), /Invalid or unsupported/)
  }
  invalid.state.versions[1].windowScale = { width: 0.5, height: 0.5 }
  assert.deepEqual(parseDataset(invalid), invalid)
  delete invalid.state.versions[1].windowScale
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
      canCreateFrom: () => true,
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

test('unequal-step merges use the later version as source regardless of selection order', () => {
  for (const [ids, targetLatest] of [
    [['low', 'high'], false], [['high', 'low'], false], [['low', 'high'], true], [['high', 'low'], true],
  ]) {
    const scope = effectScope()
    scope.run(() => {
      const low = { ...version('low', [{ ...node('shared'), value: 'Low value' }], 'v0', 2), branch: 'B1' }
      const high = { ...version('high', [{ ...node('shared'), value: 'High value' }], 'v0', 4), branch: 'B2' }
      const continuation = { ...version('continuation', low.data, low.id, 3), branch: low.branch }
      const state = ref({ versions: [version('v0', []), low, high, ...(targetLatest ? [] : [continuation])], activeId: low.id,
        nextNode: 1, nextVersion: 10, nextLane: 1, copyLinks: [] })
      const versions = computed(() => state.value.versions)
      const comparison = useVersionComparison(versions, () => ({ zoom: 1, panX: 0, panY: 0, manual: false }),
        () => ({ width: 246, height: 213 }))
      comparison.startVersionSelection('merge', ids[0])
      comparison.chooseCompare(ids[1])
      assert.equal(comparison.mergeResult.value.source.id, 'high')
      assert.equal(comparison.mergeResult.value.target.id, 'low')
      assert.equal(comparison.mergeResult.value.data[0].value, 'Low value')
      assert.deepEqual(comparison.comparisonPanels.value.map((panel) => panel.id), ['high', 'low'])
      const history = useVersionHistory({
        clientId: 'test', state, currentRoomName: ref('test'), versions,
        active: computed(() => low), selectedNode: ref(null),
        windowDimensions: computed(() => ({ width: 200, height: 150 })), comparison,
        camera: { isVersionCentered: () => false, cardPosition: () => ({ x: 0, y: 0 }),
          cardHeight: () => 150, startVersionArrival: () => {}, panToVersion: () => {} },
        treemaps: { compactVersionTreemaps: () => {} },
        reflowLayout: () => reflowVersionLayout(state.value), setSelectedNodes: () => {}, notify: () => {}, logInteraction: () => {},
        canCreateFrom: () => true, playChange: () => {},
      })
      history.confirmMerge()
      const merged = state.value.versions.find((item) => item.id === state.value.activeId)
      assert.equal(merged.parentId, low.id)
      assert.equal(merged.mergeSourceId, high.id)
      if (targetLatest) assert.equal(merged.lane, low.lane)
      else assert.notEqual(merged.lane, low.lane)
      assert.equal(merged.data[0].value, 'Low value')
      assert.equal(merged.step, 5)
    })
    scope.stop()
  }
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
      canCreateFrom: () => true, playChange: () => {},
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
    canCreateFrom: () => true, playChange: () => {},
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

test('entry labels wrap at whitespace, hyphenate long words, and stay within width and height', () => {
  const tile = { id: 'a', label: 'Long labels wrap at spaces', x: 0, y: 0, width: 320, height: 150, depth: 0, hasChildren: false }
  const wrapped = layoutTileLabel(tile)
  assert.ok(wrapped.lines.length > 1)
  assert.equal(wrapped.lines.join(' '), tile.label)
  assert.ok(wrapped.lines.length * wrapped.fontSize * 1.15 <= tile.height - 6)
  const longWord = layoutTileLabel({ ...tile, label: 'interoperability' })
  assert.ok(longWord.lines.length > 1)
  assert.ok(longWord.lines.some((line) => line.endsWith('-')))
  assert.equal(longWord.lines.join('').replace(/-/g, ''), 'interoperability')
  const arbitrary = layoutTileLabel({ ...tile, label: 'bcdfghjklmnpqrstvwxz' })
  assert.ok(arbitrary.lines.length > 1)
  assert.equal(arbitrary.lines.join('').replace(/-/g, ''), 'bcdfghjklmnpqrstvwxz')
  for (const result of [longWord, arbitrary]) {
    assert.ok(result.lines.every((line) => line.length * result.fontSize * 0.65 <= tile.width - 10))
    assert.ok(result.lines.length * result.fontSize * 1.15 <= tile.height - 6)
  }
  const hyphenated = layoutTileLabel({ ...tile, label: 'alpha-beta' })
  assert.equal(hyphenated.lines.join(''), 'alpha-beta')
  const clipped = layoutTileLabel({ ...tile, width: 210, height: 100,
    label: 'A very long label that cannot fit in two lines' })
  assert.match(clipped.lines.at(-1), /\.\.\.$/)
  assert.ok(clipped.lines.every((line) => line.length * clipped.fontSize * 0.65 <= 200))
  assert.ok(clipped.lines.length * clipped.fontSize * 1.15 <= 94)
  const oneLine = layoutTileLabel({ ...tile, width: 120, height: 55,
    label: 'extraordinarily long entry name' })
  assert.equal(oneLine.lines.length, 1)
  assert.ok(oneLine.lines[0].length > 0)
  assert.doesNotMatch(oneLine.lines[0], /\.\.\.$/)
  assert.ok(oneLine.lines[0].length * oneLine.fontSize * 0.65 <= 110)
  const parent = layoutTileLabel({ ...tile, hasChildren: true, label: 'A very long parent label that cannot fit' })
  assert.equal(parent.lines.length, 1)
  assert.doesNotMatch(parent.lines[0], /\.\.\.$/)
  assert.equal(parent.fontSize, layoutTileLabel({ ...tile, hasChildren: true, height: 12 }).fontSize)
  assert.equal(wrapped.fontSize, layoutTileLabel({ ...tile, height: 12 }).fontSize)
  assert.equal(wrapped.fontSize, 36)
  assert.equal(parent.fontSize, 32)
})

test('drag layout preserves overlapping positions and keeps previously visible content in view', () => {
  const before = [node('parent', [node('child')]), node('other')]
  const after = [node('parent'), node('other'), node('child')]
  const oldPositions = { parent: { x: 0.1, y: 0.1 }, other: { x: 1.4, y: 0.1 } }
  const positions = positionsAfterMove(after, oldPositions, 'child', { x: 0.4, y: 0.1 })
  assert.deepEqual(positions.child, { x: 0.4, y: 0.1 })
  assert.deepEqual(positions.parent, oldPositions.parent)
  const view = { zoom: 0.35, panX: 24, panY: 28, manual: true }
  const viewport = { width: 400, height: 240 }
  const nextView = fitMapViewAfterDrag(before, oldPositions, after, positions, view, viewport)
  assert.ok(nextView.zoom <= view.zoom)
  for (const tile of tilesForForest(after, positions)) {
    assert.ok(tile.x * nextView.zoom + nextView.panX >= 11.99)
    assert.ok(tile.y * nextView.zoom + nextView.panY >= 11.99)
    assert.ok((tile.x + tile.width) * nextView.zoom + nextView.panX <= viewport.width - 11.99)
    assert.ok((tile.y + tile.height) * nextView.zoom + nextView.panY <= viewport.height - 11.99)
  }
  const unchanged = fitMapViewAfterDrag(before, oldPositions, before, oldPositions, view, viewport)
  assert.deepEqual(unchanged, view)
})

test('attachment expansion pushes only projected conflicts, preserving group positions in all directions', () => {
  const box = (id, left, top, right, bottom) => ({ id, left, top, right, bottom })
  const transform = (item, direction) => {
    const point = (x, y) => direction === 'right' ? [x, y] : direction === 'left' ? [-x, y]
      : direction === 'down' ? [y, x] : [y, -x]
    const points = [point(item.left, item.top), point(item.right, item.bottom)]
    return box(item.id, Math.min(points[0][0], points[1][0]), Math.min(points[0][1], points[1][1]),
      Math.max(points[0][0], points[1][0]), Math.max(points[0][1], points[1][1]))
  }
  const before = box('target', 0, 0, 100, 40)
  const after = box('target', 0, 0, 130, 40)
  const others = [
    box('first', 110, 0, 120, 20), box('parallel', 125, 25, 135, 35),
    box('second', 135, 0, 145, 20), box('third', 160, 0, 170, 20),
    box('unrelated', 110, 60, 120, 80),
    box('manual-a', 500, 60, 520, 80), box('manual-b', 510, 60, 530, 80),
    box('old-overlap', 10, 0, 50, 20),
  ]
  for (const direction of ['right', 'left', 'down', 'up']) {
    const moved = resolveTreemapExpansion(transform(before, direction), transform(after, direction),
      [after, ...others].map((item) => transform(item, direction)))
    const delta = direction === 'right' ? { x: 20, y: 0 } : direction === 'left' ? { x: -20, y: 0 }
      : direction === 'down' ? { x: 0, y: 20 } : { x: 0, y: -20 }
    assert.deepEqual([...moved.keys()].sort(), ['first', 'parallel', 'second', 'third'])
    for (const value of moved.values()) assert.deepEqual(value, delta)
  }
})

test('attachment expansion chooses a single minimum direction for diagonal conflicts', () => {
  const before = { id: 'target', left: 0, top: 0, right: 100, bottom: 100 }
  const after = { ...before, right: 120, bottom: 115 }
  const corner = { id: 'corner', left: 110, top: 105, right: 130, bottom: 125 }
  const below = { id: 'below', left: 10, top: 110, right: 20, bottom: 120 }
  const moved = resolveTreemapExpansion(before, after, [after, corner, below])
  assert.deepEqual(moved.get('corner'), { x: 10, y: 0 })
  assert.deepEqual(moved.get('below'), { x: 0, y: 5 })
  assert.equal(moved.size, 2)
})

test('attachment expansion terminates after moving each conflicting treemap once', () => {
  const before = { id: 'target', left: 0, top: 0, right: 100, bottom: 100 }
  const after = { ...before, right: 120, bottom: 120 }
  const right = { id: 'right', left: 118, top: 115, right: 135, bottom: 130 }
  const below = { id: 'below', left: 90, top: 105, right: 121, bottom: 115 }
  const moved = resolveTreemapExpansion(before, after, [after, right, below])
  assert.deepEqual([...moved], [['right', { x: 2, y: 0 }], ['below', { x: 0, y: 15 }]])
  assert.equal(resolveTreemapExpansion(before, before, [before, right, below]).size, 0)
})

test('attaching an entry preserves positions except for treemaps in the expanded area', () => {
  const target = node('target')
  const source = node('source')
  const blocker = node('blocker')
  const unrelated = node('unrelated')
  const previous = [target, source, blocker, unrelated]
  const next = [node('target', [node('source')]), blocker, unrelated]
  const oldSize = outerTreemapDimensions(target)
  const newSize = outerTreemapDimensions(next[0])
  const previousPositions = {
    target: { x: 0, y: 0 }, source: { x: -1, y: 0 },
    blocker: { x: (oldSize.width + newSize.width) / 2 / CARD_WIDTH, y: 0 },
    unrelated: { x: 0, y: 5 },
  }
  const positions = positionsAfterAttachment(previous, next, previousPositions, 'target')
  assert.deepEqual(positions.target, previousPositions.target)
  assert.deepEqual(positions.unrelated, previousPositions.unrelated)
  assert.ok(Math.abs(positions.blocker.x * CARD_WIDTH - newSize.width) < 1e-8)
  assert.equal(positions.blocker.y, previousPositions.blocker.y)
  assert.ok(newSize.height > oldSize.height)
})

test('adding or pasting subtrees pushes existing treemaps out of an expanded root', () => {
  const root = node('target')
  const added = node('copied', [node('child'), node('grandchild')])
  const grown = node('target', [added])
  const oldWidth = outerTreemapDimensions(root).width
  for (const count of [0, 1, 3]) {
    const blockers = Array.from({ length: count }, (_, index) => node(`blocker${index}`))
    const before = [root, ...blockers]
    const after = [grown, ...blockers]
    const initial = { target: { x: 0, y: 0 },
      ...Object.fromEntries(blockers.map((item, index) => [item.id, { x: (oldWidth + index * (oldWidth + 12)) / CARD_WIDTH, y: 0 }])) }
    const positions = positionsForData(before, after, initial, { zoom: 2, panX: -100, panY: 0, manual: true }, { width: 120, height: 100 })
    assert.deepEqual(positions.target, initial.target)
    if (count) assert.ok(positions.blocker0.x > initial.blocker0.x)
    assert.deepEqual([...overlappingTreemapIds(tilesForForest(after, positions))], [])
  }
})

test('new free pasted roots avoid existing treemaps even in a constrained viewport', () => {
  for (const count of [0, 1, 3]) {
    const before = Array.from({ length: count }, (_, index) => node(`existing${index}`))
    const after = [...before, node('pasted', [node('nested')])]
    const initial = Object.fromEntries(before.map((item, index) => [item.id, { x: index * 1.1, y: 0 }]))
    const positions = positionsForData(before, after, initial, { zoom: 3, panX: -80, panY: -10, manual: true }, { width: 80, height: 60 })
    assert.deepEqual([...overlappingTreemapIds(tilesForForest(after, positions))], [])
  }
})

test('treemap stacking outlines only roots above an overlapping root', () => {
  const data = [node('one', [node('child')]), node('two'), node('three'), node('separate')]
  const positions = { one: { x: 0, y: 0 }, two: { x: 0, y: 0 }, three: { x: 0, y: 0 }, separate: { x: 5, y: 0 } }
  const tiles = tilesForForest(data, positions, ['three', 'one', 'two'])
  assert.deepEqual(tiles.filter((tile) => tile.depth === 0).map((tile) => tile.id), ['three', 'one', 'two', 'separate'])
  assert.deepEqual([...overlappingTreemapIds(tiles)].sort(), ['one', 'two'])
  assert.deepEqual(data.map((item) => item.id), ['one', 'two', 'three', 'separate'])
  const touching = [
    { id: 'a', x: 0, y: 0, width: 10, height: 10, depth: 0 },
    { id: 'b', x: 10, y: 0, width: 10, height: 10, depth: 0 },
  ]
  assert.deepEqual([...overlappingTreemapIds(touching)], [])
})

test('out-of-view indicators combine entries by the eight actual directions', () => {
  const base = { id: '', label: '', width: 10, height: 10, depth: 0, hasChildren: false }
  const tile = (x, y) => ({ ...base, x, y })
  const view = { zoom: 1, panX: 0, panY: 0, manual: true }
  const viewport = { width: 100, height: 100 }
  assert.deepEqual(outOfViewDirections([tile(20, 20)], view, viewport), [])
  assert.deepEqual(outOfViewDirections([tile(120, 20), tile(150, 40), tile(-20, -20)], view, viewport), ['right', 'up-left'])
  assert.deepEqual(outOfViewDirections([
    tile(40, -20), tile(120, -20), tile(120, 40), tile(120, 120),
    tile(40, 120), tile(-20, 120), tile(-20, 40), tile(-20, -20),
  ], view, viewport), ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'])
  assert.deepEqual(outOfViewDirections([tile(90, 40)], view, viewport), [])
  assert.deepEqual(outOfViewDirections([tile(-5, 40), tile(95, 95), tile(40, -5), tile(40, 95)], view, viewport), [])
  assert.deepEqual(outOfViewDirections([tile(-10, 40), tile(100, 40), tile(40, -10), tile(40, 100)], view, viewport),
    ['up', 'right', 'down', 'left'])
  assert.deepEqual(outOfViewDirections([tile(95, 95), tile(110, 110)], view, viewport), ['down-right'])
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
  assert.ok(area / ((root.width - 16) * (root.height - 60)) > 0.95)
})

test('uniform wide sibling layouts choose the same best grid dimensions', () => {
  const count = 500
  const forest = [node('root', Array.from({ length: count }, (_, index) => node(`leaf-${index}`)))]
  const root = tilesForForest(forest).find((tile) => tile.id === 'root')
  const childWidth = 152
  const childHeight = 106
  const aspect = (CARD_WIDTH - 14) / (CARD_HEIGHT - 47)
  let best = null

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    const width = columns * childWidth + (columns + 1) * 8
    const height = rows * childHeight + (rows + 1) * 8 + 44
    const waste = Math.max(0, (width * height - count * childWidth * childHeight) / (count * childWidth * childHeight))
    const score = Math.abs(Math.log((width / height) / aspect)) + waste * 0.025
    if (!best || score < best.score) best = { score, columns, rows, width, height }
  }

  assert.equal(root.width, Math.max(best.width, best.height * aspect))
  assert.equal(root.height, Math.max(best.height, root.width / aspect))
})

test('default positions retain their grid for uneven treemap sizes', () => {
  const forest = [
    node('a'),
    node('b', [node('b1'), node('b2')]),
    node('c', [node('c1', [node('c2')])]),
    node('d'),
    node('e', [node('e1'), node('e2'), node('e3')]),
    node('f'),
    node('g', [node('g1')]),
  ]
  const positions = defaultPositions(forest)
  const columns = Math.ceil(Math.sqrt(forest.length))
  const sizes = forest.map((root) => outerTreemapDimensions(root))
  const columnWidths = Array(columns).fill(0)
  const rowHeights = Array(Math.ceil(forest.length / columns)).fill(0)
  for (let index = 0; index < forest.length; index += 1) {
    columnWidths[index % columns] = Math.max(columnWidths[index % columns], sizes[index].width)
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], sizes[index].height)
  }

  const columnOffsets = []
  const rowOffsets = []
  let offset = MAP_PADDING
  for (const width of columnWidths) {
    columnOffsets.push(offset)
    offset += width + MAP_PADDING
  }
  offset = MAP_PADDING
  for (const height of rowHeights) {
    rowOffsets.push(offset)
    offset += height + MAP_PADDING
  }
  assert.deepEqual(positions, Object.fromEntries(forest.map((root, index) => [
    root.id,
    { x: columnOffsets[index % columns] / CARD_WIDTH,
      y: rowOffsets[Math.floor(index / columns)] / TREE_MAP_HEIGHT },
  ])))
})

test('deep treemap nodes retain at least 30 by 30 layout dimensions', () => {
  const forest = [node('a', [
    node('b'),
    node('c', [node('d', [node('e')])]),
  ])]
  const tiles = tilesForForest(forest)
  for (const tile of tiles) {
    assert.ok(tile.width >= 30, `${tile.id} width was ${tile.width}`)
    assert.ok(tile.height >= 30, `${tile.id} height was ${tile.height}`)
  }
})

test('treemap entries have at least the width of a free-floating leaf', () => {
  const forest = [node('free'), node('root', [
    node('a'), node('b', [node('b1'), node('b2'), node('b3')]), node('c'), node('d'), node('e'),
  ])]
  const tiles = tilesForForest(forest)
  const freeWidth = tiles.find((tile) => tile.id === 'free').width
  for (const tile of tiles) assert.ok(tile.width >= freeWidth, `${tile.id} width was ${tile.width}`)
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

test('camera presets frame the exact neighborhood and complete branch height', () => {
      const scope = effectScope()
      scope.run(() => {
        const root = version('v0', [])
        const chain = Array.from({ length: 4 }, (_, index) =>
          version(`v${index + 1}`, [], index ? `v${index}` : 'v0', index + 1))
        const branch = { ...version('branch', [], 'v1', 2), lane: 2 }
        const state = ref({ versions: [root, ...chain, branch], activeId: 'v4', nextNode: 1, nextVersion: 5, nextLane: 3, copyLinks: [] })
        const zoom = ref(1)
        const pan = ref({ x: 0, y: 0 })
        const canvasSize = ref({ width: 900, height: 600 })
        const camera = useGraphCamera({
          versions: computed(() => state.value.versions),
          active: computed(() => state.value.versions.find((item) => item.id === state.value.activeId)),
          state, compareIds: ref([]), draggedVersionId: () => undefined, zoom, pan, canvasSize,
          windowDimensions: computed(() => ({ width: 200, height: 120 })), suppressClicks: () => {},
        })
        const assertFrame = (ids) => {
          for (const id of ids) assert.ok(camera.visibleVersions.value.some((item) => item.id === id))
          for (const id of ids.filter((id) => id !== 'v0')) {
            const item = state.value.versions.find((value) => value.id === id)
            const position = camera.cardPosition(item)
            assert.ok(position.x * zoom.value + pan.value.x >= -0.001)
            assert.ok((position.x + camera.cardWidth(item)) * zoom.value + pan.value.x <= canvasSize.value.width + 0.001)
            assert.ok(position.y * zoom.value + pan.value.y >= -0.001)
            assert.ok((position.y + camera.cardHeight(item)) * zoom.value + pan.value.y <= canvasSize.value.height + 0.001)
          }
        }
        camera.focusNeighborhood(chain[3], false)
        assertFrame(['v3', 'v4'])
        camera.focusNeighborhood(chain[1], false)
        assertFrame(['v1', 'v2', 'v3'])
        camera.focusNeighborhood(chain[0], false)
        assertFrame(['v0', 'v1', 'v2'])
        camera.focusNeighborhood(branch, false)
        assertFrame(['v1', 'branch'])
        state.value.versions = [root]
        state.value.activeId = 'v0'
        camera.focusNeighborhood(root, false)
        assertFrame(['v0'])

        state.value.versions = [root, ...chain, branch]
        for (const id of ['v1', 'v4', 'branch']) {
          state.value.activeId = id
          camera.fitHeight(false)
          const top = camera.cardPosition(chain[0]).y
          const bottom = camera.cardPosition(branch).y + camera.cardHeight(branch)
          assert.ok(Math.abs((bottom - top) * zoom.value - (canvasSize.value.height - 100)) < 0.001)
          assert.ok(Math.abs((top + bottom) / 2 * zoom.value + pan.value.y - canvasSize.value.height / 2) < 0.001)
          const item = state.value.versions.find((value) => value.id === id)
          assert.ok(Math.abs((camera.cardPosition(item).x + camera.cardWidth(item) / 2) * zoom.value + pan.value.x - canvasSize.value.width / 2) < 0.001)
        }
        state.value.activeId = 'v4'
        camera.focusVersion(chain[3], false)
        const limit = zoom.value
        camera.zoomAt(limit * 100)
        assert.equal(zoom.value, limit)
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
      isReadOnly: computed(() => false), setSelectedNodes: () => {}, canCreateFrom: () => true,
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
      isReadOnly: computed(() => false), setSelectedNodes: (ids) => { selected.value = ids }, canCreateFrom: () => true,
      createVersion: (data) => state.value.versions[0] = version('v1', data),
    })
    editor.deleteSelectedEntries('keep-children')
    assert.deepEqual(active.value.data, [node('c'), node('d')])
    assert.deepEqual(selected.value, [])
  })
  scope.stop()
})
