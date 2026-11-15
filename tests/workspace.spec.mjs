import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

async function openRoom(page, room = `test-${randomUUID()}`) {
  await page.goto(`/?room=${room}`)
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  await expect(page.locator('.version-card.active')).toBeVisible()
  return room
}

async function state(page, room) {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(`canopy-room-data-v1-${encodeURIComponent(name)}`)), room)
}

function findNode(nodes, name) {
  for (const node of nodes) {
    if (node.value === name) return node
    const child = findNode(node.children, name)
    if (child) return child
  }
}

async function activeData(page, room) {
  const saved = await state(page, room)
  return saved.versions.find((version) => version.id === saved.activeId).data
}

async function activeTile(page, room, name) {
  const entry = findNode(await activeData(page, room), name)
  expect(entry, `active entry ${name}`).toBeTruthy()
  return page.locator('.version-card.active').locator(`rect.tree-tile[data-node="${entry.id}"]`)
}

async function addEntries(page, names, shortcut = false) {
  if (shortcut) await page.keyboard.press('n')
  else await page.getByRole('button', { name: 'New free entry, N' }).click()
  await fillEntries(page, names)
}

async function fillEntries(page, names) {
  const inputs = page.getByPlaceholder('Entry name')
  for (let index = 0; index < names.length; index++) {
    if (index) await page.getByRole('button', { name: 'Add another entry' }).click()
    await inputs.nth(index).fill(names[index])
  }
  await page.getByRole('button', { name: `Add ${names.length} ${names.length === 1 ? 'entry' : 'entries'}` }).click()
  await expect(page.getByPlaceholder('Entry name')).toHaveCount(0)
  await expect(page.locator('.version-card.active')).toContainText(names[0])
}

async function focusActive(page) {
  await page.getByRole('button', { name: 'Focus active version, F' }).click()
  await expect(page.locator('.version-card.active')).toBeInViewport()
}

async function expectCentered(page, versionId) {
  await expect.poll(async () => page.locator(`.version-card[data-version="${versionId}"]`).evaluate((card) => {
    const canvas = card.closest('.graph-canvas').getBoundingClientRect()
    const bounds = card.getBoundingClientRect()
    return Math.max(
      Math.abs((bounds.left + bounds.right - canvas.left - canvas.right) / 2),
      Math.abs((bounds.top + bounds.bottom - canvas.top - canvas.bottom) / 2),
    )
  })).toBeLessThan(2)
}

async function emptyMapPoint(map) {
  const point = await map.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    for (let y = bounds.top + 6; y < bounds.bottom - 20; y += 12) {
      for (let x = bounds.left + 6; x < bounds.right - 20; x += 12) {
        const hit = document.elementFromPoint(x, y)
        if (hit && element.contains(hit) && !hit.closest('.tree-tile')) return { x, y }
      }
    }
    return null
  })
  expect(point).toBeTruthy()
  return point
}

async function contextAction(page, room, name, action) {
  await focusActive(page)
  const tile = await activeTile(page, room, name)
  await tile.click({ button: 'right', position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: action, exact: true }).click()
}

test('bulk creation, editing, copy connector, and deleting an entry create versions', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Alpha', 'Beta'], true)
  await expect.poll(async () => (await activeData(page, room)).map((item) => item.value)).toEqual(['Alpha', 'Beta'])

  await contextAction(page, room, 'Alpha', 'Change value')
  await page.getByLabel('New value').fill('Renamed')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(async () => !!findNode(await activeData(page, room), 'Renamed')).toBe(true)
  await expect(page.locator('.version-card.active')).toContainText('Renamed')

  await contextAction(page, room, 'Renamed', 'Copy entry and subtree')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await state(page, room)).copyLinks.length).toBe(1)
  await expect.poll(async () => (await activeData(page, room)).filter((item) => item.value === 'Renamed').length).toBe(2)
  await expect(page.locator('.copy-link-hit')).toHaveCount(1)
  const copy = (await state(page, room)).copyLinks[0]
  await expect(page.locator('.copy-link')).toHaveAttribute('d', /M /)
  await page.locator('.copy-link-hit').focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(copy.sourceVersionId)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(copy.targetVersionId)

  await contextAction(page, room, 'Beta', 'Delete entry')
  await expect.poll(async () => !!findNode(await activeData(page, room), 'Beta')).toBe(false)
  await expect(page.locator('.version-card.active .tile-label').filter({ hasText: 'Beta' })).toHaveCount(0)
})

test('split, merge and bulk delete operate on selected entries and preserve assigned children', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent'])
  await contextAction(page, room, 'Parent', 'Add child')
  await fillEntries(page, ['Child'])
  await contextAction(page, room, 'Parent', 'Split entry')
  await page.getByLabel('Entry name').nth(0).fill('Left')
  await page.getByLabel('Entry name').nth(1).fill('Right')
  await page.getByLabel('Assign Child to a result entry').selectOption({ label: 'Result 2 · Right' })
  await page.getByRole('button', { name: 'Split entry', exact: true }).click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Right')?.children.map((node) => node.value)).toEqual(['Child'])
  await expect.poll(async () => findNode(await activeData(page, room), 'Left')?.children.length).toBe(0)

  await focusActive(page)
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await (await activeTile(page, room, 'Left')).click({ button: 'right', position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: 'Merge selected entries' }).click()
  await page.getByLabel('Resulting entry name').fill('Combined')
  await page.getByRole('button', { name: 'Merge entries', exact: true }).click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Combined')?.children.map((node) => node.value)).toEqual(['Child'])

  await addEntries(page, ['Delete me'])
  await focusActive(page)
  await (await activeTile(page, room, 'Combined')).click({ position: { x: 8, y: 8 } })
  await expect(await activeTile(page, room, 'Combined')).toHaveClass(/is-selected/)
  await (await activeTile(page, room, 'Delete me')).click({ modifiers: ['Shift'], position: { x: 8, y: 8 } })
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await (await activeTile(page, room, 'Combined')).click({ button: 'right', position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: 'Delete selected entries' }).click()
  await page.getByRole('button', { name: 'Delete entries', exact: true }).click()
  await expect.poll(async () => (await activeData(page, room)).map((node) => node.value)).toEqual(['Child'])
})

test('branching, comparison and merge result controls update the graph', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Base'])
  const base = (await state(page, room)).activeId
  await addEntries(page, ['First branch'])
  const first = (await state(page, room)).activeId
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  await addEntries(page, ['Second branch'])
  const second = (await state(page, room)).activeId
  const saved = await state(page, room)
  const lanes = [...new Set(saved.versions.map((version) => version.lane))].sort((a, b) => a - b)
  expect(lanes).toEqual(lanes.map((_, index) => index))
  expect(saved.versions.find((version) => version.id === first).parentId).toBe(base)
  expect(saved.versions.find((version) => version.id === second).parentId).toBe(base)
  expect(saved.versions.find((version) => version.id === first).lane).not.toBe(saved.versions.find((version) => version.id === second).lane)
  const firstLane = saved.versions.find((version) => version.id === first).lane
  const secondLane = saved.versions.find((version) => version.id === second).lane
  await page.keyboard.press(firstLane < secondLane ? 'ArrowUp' : 'ArrowDown')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)

  await page.keyboard.press('Shift+a')
  await expect(page.locator(`[data-version-connectors~="${first}"]`)).toHaveAttribute('d', /M /)
  await page.keyboard.press('Shift+c')
  await page.locator(`.version-card[data-version="${first}"]`).click()
  await page.locator(`.version-card[data-version="${second}"]`).click()
  await expect(page.locator('.comparison-content')).toContainText('First branch')
  await expect(page.locator('.comparison-content')).toContainText('Second branch')
  await expect(page.locator('.comparison-content')).not.toContainText('These versions are structurally identical.')
  await page.getByRole('button', { name: 'Abort and close' }).click()

  await page.keyboard.press('m')
  await page.locator(`.version-card[data-version="${first}"]`).click()
  await page.locator(`.version-card[data-version="${second}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Branch merge' })
  const row = dialog.locator('.merge-view-row').filter({ has: page.locator('.merge-entry-cell strong').getByText('First branch', { exact: true }) })
  await row.getByLabel('Parent for First branch in merged result').selectOption({ label: 'Base' })
  await expect(dialog.locator('.merge-preview-tile.depth-1')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Reset' }).click()
  await expect(dialog.locator('.merge-preview-tile.depth-1')).toHaveCount(0)
  await row.getByRole('button', { name: 'Omit' }).click()
  await expect(dialog.locator('.merge-preview-label[aria-label="First branch"]')).toHaveCount(0)
  await row.getByRole('button', { name: 'Pick' }).click()
  await expect(dialog.locator('.merge-preview-label[aria-label="First branch"]')).toBeVisible()
  await row.getByLabel('Parent for First branch in merged result').selectOption({ label: 'Base' })
  await dialog.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => {
    const data = await activeData(page, room)
    return ['Base', 'First branch', 'Second branch'].every((name) => !!findNode(data, name))
  }).toBe(true)
  expect(findNode(await activeData(page, room), 'Base').children.map((node) => node.value)).toContain('First branch')
  const mergedState = await state(page, room)
  const mergedLanes = [...new Set(mergedState.versions.map((version) => version.lane))].sort((a, b) => a - b)
  expect(mergedLanes).toEqual(mergedLanes.map((_, index) => index))
  const merge = mergedState.versions.find((version) => version.id === mergedState.activeId)
  expect(new Set([merge.parentId, merge.mergeSourceId])).toEqual(new Set([first, second]))
  await expect(page.locator(`#merge-connector-${merge.id}`)).toHaveAttribute('d', /M /)
})

test('long version and copy connectors stay visible across offscreen endpoints and straight lanes are batched', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const entry = { id: 'n1', value: 'Shared', children: [] }
  const versions = [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 }]
  for (let step = 1; step <= 30; step++) {
    versions.push({
      id: `v${step}`, parentId: step === 20 ? 'v1' : `v${step - 1}`,
      ...(step === 20 ? { mergeSourceId: 'v19' } : step === 21 ? { mergeSourceId: 'v1' } : {}),
      step, lane: 0, branch: 'Branch 1', change: 'Edit', data: [entry], createdAt: step,
    })
  }
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v10', nextNode: 2, nextVersion: 31, nextLane: 1,
      copyLinks: [{ sourceVersionId: 'v1', sourceNodeId: 'n1', targetVersionId: 'v20', targetNodeId: 'n1' }],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await focusActive(page)
  await expect(page.locator('.version-card[data-version="v1"]')).toHaveCount(0)
  await expect(page.locator('.version-card[data-version="v20"]')).toHaveCount(0)
  await expect(page.locator('.version-card[data-version="v21"]')).toHaveCount(0)
  await expect(page.locator('[data-version-connectors~="v20"]')).toHaveAttribute('d', /M .* H /)
  await expect(page.locator('#merge-connector-v21')).toHaveAttribute('d', /M .* H /)
  await expect(page.locator('.copy-link-hit')).toHaveCount(1)
  await expect(page.locator('.copy-link')).toHaveAttribute('d', /M .* Q /)
  await page.locator('.copy-link-hit').focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state(page, room)).activeId).toBe('v1')
  await page.keyboard.press('Shift+a')
  await expect.poll(async () => page.locator('[data-version-connectors]').evaluateAll((paths) =>
    Math.max(...paths.map((path) => path.getAttribute('data-version-connectors').split(' ').length)))).toBeGreaterThan(1)
  const grouped = await page.locator('[data-version-connectors]').evaluateAll((paths) => {
    const path = paths.find((item) => item.getAttribute('data-version-connectors').includes(' '))
    return {
      count: path.getAttribute('data-version-connectors').split(' ').length,
      moves: (path.getAttribute('d').match(/M /g) ?? []).length,
      color: path.getAttribute('stroke'),
      width: Number(path.getAttribute('stroke-width')),
      opacity: Number(path.getAttribute('opacity')),
    }
  })
  expect(grouped.moves).toBe(grouped.count)
  expect(grouped.color).toBe('#176b68')
  expect(grouped.width).toBeGreaterThan(0)
  expect(grouped.opacity).toBe(0.76)
  await expect(page.locator('#merge-connector-v20')).toHaveAttribute('d', /M /)
})

test('dragging attaches a root, outside drops cancel, and shortcut detaches a child', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Source', 'Target'])
  await focusActive(page)
  const source = await activeTile(page, room, 'Source')
  const target = await activeTile(page, room, 'Target')
  await source.click({ trial: true, position: { x: 8, y: 8 } })
  let sourceBox = await source.boundingBox()
  let targetBox = await target.boundingBox()
  expect(sourceBox && targetBox).toBeTruthy()
  const saved = await state(page, room)
  await page.mouse.move(sourceBox.x + 12, sourceBox.y + 12)
  await page.mouse.down()
  await page.mouse.move(260, 20, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await state(page, room)).versions.length).toBe(saved.versions.length)
  expect((await activeData(page, room)).map((node) => node.value)).toEqual(['Source', 'Target'])

  await source.click({ trial: true, position: { x: 8, y: 8 } })
  sourceBox = await source.boundingBox()
  targetBox = await target.boundingBox()
  await page.mouse.move(sourceBox.x + 12, sourceBox.y + 12)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await expect(target).toHaveClass(/is-over/)
  await page.mouse.up()
  await expect.poll(async () => findNode(await activeData(page, room), 'Target')?.children.map((node) => node.value)).toEqual(['Source'])
  await focusActive(page)
  await expect(await activeTile(page, room, 'Source')).toHaveClass(/is-selected/)
  await page.keyboard.press('Shift+d')
  await expect.poll(async () => (await activeData(page, room)).map((node) => node.value).sort()).toEqual(['Source', 'Target'])
  expect(findNode(await activeData(page, room), 'Target').children).toHaveLength(0)
})

test('fit, focus, zoom, panning and keyboard navigation change the viewport and LOD', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 6; index++) await addEntries(page, [`Entry ${index}`])
  const lastId = (await state(page, room)).activeId
  await page.keyboard.press('Shift+a')
  await expect(page.locator('.version-card.active .overview-map')).toBeVisible()
  await page.locator('.version-card.active .overview-map').dblclick()
  await expect(page.locator('.version-card.active .mini-map')).toBeVisible()
  await page.keyboard.press('Shift+a')
  await expect(page.locator('.version-card.active .overview-map')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add child, Ctrl or Command+Enter' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'New free entry, N' })).toBeEnabled()
  await page.keyboard.press('n')
  await expect(page.getByPlaceholder('Entry name')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const world = page.locator('.graph-world')
  const beforePan = await world.getAttribute('style')
  const point = await page.locator('.graph-canvas').evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect()
    for (let y = bounds.top + 30; y < bounds.bottom - 90; y += 40) {
      for (let x = bounds.left + 30; x < bounds.right - 90; x += 40) {
        const hit = document.elementFromPoint(x, y)
        if (hit && canvas.contains(hit) && !hit.closest('button, .version-card, .tree-tile, .copy-link-hit, .canvas-controls')) return { x, y }
      }
    }
    return null
  })
  expect(point).toBeTruthy()
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 45, point.y + 35, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => world.getAttribute('style')).not.toBe(beforePan)
  const panned = await world.getAttribute('style')
  await page.keyboard.press('f')
  await expect(page.locator('.version-card.active .mini-map')).toBeVisible()
  await expect.poll(() => world.getAttribute('style')).not.toBe(panned)
  const focused = await world.getAttribute('style')
  await page.getByRole('button', { name: 'Zoom in, plus' }).click()
  await expect.poll(() => world.getAttribute('style')).not.toBe(focused)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).not.toBe(lastId)
})

test('focused and modifier wheel gestures zoom the map while unfocused wheel zooms the graph', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Map entry'])
  await focusActive(page)
  const map = page.locator('.version-card.active .mini-map')
  const world = page.locator('.graph-world')
  const content = map.locator('svg > g')
  await map.hover()
  const graphBefore = await world.getAttribute('style')
  const mapBefore = await content.getAttribute('transform')
  await (await activeTile(page, room, 'Map entry')).click({ position: { x: 8, y: 8 } })
  await page.mouse.wheel(0, -180)
  await expect.poll(() => content.getAttribute('transform')).not.toBe(mapBefore)
  expect(await world.getAttribute('style')).toBe(graphBefore)
  await page.waitForTimeout(300)
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(0)

  await map.hover()
  const graphAfter = await world.getAttribute('style')
  const firstZoom = await content.getAttribute('transform')
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, -180)
  await page.keyboard.up('Shift')
  await expect.poll(() => content.getAttribute('transform')).not.toBe(firstZoom)
  expect(await world.getAttribute('style')).toBe(graphAfter)
  await expect.poll(async () => {
    const saved = await state(page, room)
    return saved.versions.find((version) => version.id === saved.activeId)?.mapView?.manual
  }).toBe(true)

  const zoomed = await content.getAttribute('transform')
  const box = await map.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(() => content.getAttribute('transform')).not.toBe(zoomed)
  expect(await world.getAttribute('style')).toBe(graphAfter)
  await page.getByRole('button', { name: 'Zoom out, minus' }).click()
  await map.hover()
  const unfocusedGraph = await world.getAttribute('style')
  const unfocusedMap = await content.getAttribute('transform')
  await page.mouse.wheel(0, -120)
  await expect.poll(() => world.getAttribute('style')).not.toBe(unfocusedGraph)
  expect(await content.getAttribute('transform')).toBe(unfocusedMap)
})

test('double-click focuses versions and focused blank-space dragging pans without changing selection', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Selectable'])
  const versionId = (await state(page, room)).activeId
  await page.keyboard.press('Shift+a')
  const world = page.locator('.graph-world')
  const fitted = await world.getAttribute('style')
  await page.locator(`.version-card[data-version="${versionId}"] .version-card-head`).dblclick()
  await expect.poll(() => world.getAttribute('style')).not.toBe(fitted)
  const tile = await activeTile(page, room, 'Selectable')
  await tile.click({ position: { x: 8, y: 8 } })
  await expect(tile).toHaveClass(/is-selected/)
  const map = page.locator('.version-card.active .mini-map')
  const point = await map.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    for (let y = bounds.top + 6; y < bounds.bottom - 20; y += 12) {
      for (let x = bounds.left + 6; x < bounds.right - 20; x += 12) {
        const hit = document.elementFromPoint(x, y)
        if (hit && element.contains(hit) && !hit.closest('.tree-tile')) return { x, y }
      }
    }
    return null
  })
  expect(point).toBeTruthy()
  const before = await world.getAttribute('style')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 30, point.y + 20, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => world.getAttribute('style')).not.toBe(before)
  await expect(tile).toHaveClass(/is-selected/)
  expect((await state(page, room)).activeId).toBe(versionId)
  await tile.dblclick({ position: { x: 8, y: 8 } })
  await expect(page.getByLabel('New value')).toHaveValue('Selectable')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('version clicks activate without moving, while double-clicks activate and focus at low zoom', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 6; index++) await addEntries(page, [`Zoom ${index}`])
  const saved = await state(page, room)
  const first = saved.versions[1].id
  const second = saved.versions[2].id
  await page.keyboard.press('Shift+a')
  await expect(page.locator(`.version-card[data-version="${first}"] .overview-map`)).toBeVisible()
  await page.waitForTimeout(500)
  const world = page.locator('.graph-world')
  const fitted = await world.getAttribute('style')
  await page.locator(`.version-card[data-version="${first}"] .overview-map`).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  expect(await world.getAttribute('style')).toBe(fitted)
  await page.locator(`.version-card[data-version="${second}"] .overview-map`).dblclick()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(second)
  await expectCentered(page, second)
  await page.waitForTimeout(300)
  expect((await state(page, room)).activeId).toBe(second)
})

test('double-clicking a version at normal zoom focuses it, including empty map space', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['One'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Two'])
  const second = (await state(page, room)).activeId
  await page.keyboard.press('Shift+a')
  await expect(page.locator(`.version-card[data-version="${first}"] .mini-map`)).toBeVisible()
  await page.waitForTimeout(500)
  const world = page.locator('.graph-world')
  const fitted = await world.getAttribute('style')
  await page.locator(`.version-card[data-version="${first}"] .version-card-head`).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  expect(await world.getAttribute('style')).toBe(fitted)
  const map = page.locator(`.version-card[data-version="${second}"] .mini-map`)
  const inactivePoint = await emptyMapPoint(map)
  await page.mouse.dblclick(inactivePoint.x, inactivePoint.y)
  await expect.poll(async () => (await state(page, room)).activeId).toBe(second)
  await expectCentered(page, second)

  const point = await emptyMapPoint(map)
  await map.evaluate((element) => element.addEventListener('dblclick', () => { element.dataset.doubleClicked = 'true' }))
  await page.mouse.dblclick(point.x, point.y)
  await expect(map).toHaveAttribute('data-double-clicked', 'true')
  await expectCentered(page, second)
})

test('double-clicking in comparison selection activates and focuses without selecting twice', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const second = (await state(page, room)).activeId
  await page.keyboard.press('Shift+a')
  await page.waitForTimeout(500)
  await page.locator(`.version-card[data-version="${first}"] .version-card-head`).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  await page.keyboard.press('Shift+c')
  await page.locator(`.version-card[data-version="${first}"] .version-card-head`).click()
  await expect(page.locator(`.version-card[data-version="${first}"]`)).toHaveClass(/compared/)
  await page.locator(`.version-card[data-version="${second}"] .version-card-head`).dblclick()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(second)
  await expectCentered(page, second)
  await page.waitForTimeout(600)
  await expect(page.locator('.comparison-content')).toHaveCount(0)
  await expect(page.locator(`.version-card[data-version="${first}"]`)).toHaveClass(/compared/)
  await expect(page.locator(`.version-card[data-version="${second}"]`)).not.toHaveClass(/compared/)
})

test('multi-selection copy and cut preserve subtrees and create separate destination and source versions', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent', 'Other'])
  const destination = (await state(page, room)).activeId
  await contextAction(page, room, 'Parent', 'Add child')
  await fillEntries(page, ['Child'])
  const source = (await state(page, room)).activeId
  await focusActive(page)
  await page.keyboard.press('Control+a')
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(3)
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await activeData(page, room)).filter((item) => item.value === 'Parent').length).toBe(2)
  let saved = await state(page, room)
  expect(saved.copyLinks.filter((link) => link.sourceVersionId === source)).toHaveLength(2)
  expect((await activeData(page, room)).filter((item) => item.value === 'Parent').every((item) => item.children[0]?.value === 'Child')).toBe(true)

  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(source)
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+x')
  const before = (await state(page, room)).versions.length
  await page.keyboard.press('Control+v')
  await expect(page.getByText('Choose another version before pasting cut entries')).toBeVisible()
  expect((await state(page, room)).versions.length).toBe(before)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(destination)
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await state(page, room)).versions.length).toBe(before + 2)
  saved = await state(page, room)
  const pasted = saved.versions.find((item) => item.id === saved.activeId)
  const removed = saved.versions.find((item) => item.parentId === source && item.change.startsWith('Cut '))
  expect(pasted.parentId).toBe(destination)
  expect(pasted.data.filter((item) => item.value === 'Parent')).toHaveLength(2)
  expect(pasted.data.find((item) => item.value === 'Parent' && item.children.length).children[0].value).toBe('Child')
  expect(removed.data).toEqual([])
  expect(saved.versions.find((item) => item.id === source).data).toHaveLength(2)
  expect(saved.copyLinks.filter((link) => link.targetVersionId === pasted.id)).toHaveLength(2)
})

test('new shortcuts preserve editable text and focus the active version', async ({ page }) => {
  const room = await openRoom(page)
  await page.keyboard.press('Control+n')
  const input = page.getByPlaceholder('Entry name').first()
  await expect(input).toBeFocused()
  await input.fill('Editing text')
  await page.keyboard.press('Control+a')
  expect(await input.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('Editing text')
  const prevented = await input.evaluate((element) => !element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'n', ctrlKey: true, bubbles: true, cancelable: true,
  })))
  expect(prevented).toBe(false)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await addEntries(page, ['First'])
  const active = (await state(page, room)).activeId
  await page.keyboard.press('Shift+a')
  await page.waitForTimeout(500)
  await page.keyboard.press('Control+o')
  await expectCentered(page, active)
})

test('lane buttons stay attached to the viewport and navigate without changing the active version', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 4; index++) await addEntries(page, [`Lane ${index}`])
  const saved = await state(page, room)
  const laneVersions = saved.versions.filter((item) => item.id !== 'v0' && item.lane === 0).sort((a, b) => a.step - b.step)
  const active = saved.activeId
  await page.keyboard.press('Shift+a')
  await page.waitForTimeout(500)
  const left = page.locator('.lane-navigation-left[data-lane="0"]')
  const right = page.locator('.lane-navigation-right[data-lane="0"]')
  const before = await left.boundingBox()
  const canvas = await page.locator('.graph-canvas').boundingBox()
  expect(before.x).toBeCloseTo(canvas.x, 0)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect.poll(async () => Math.abs((await left.boundingBox()).x - (await page.locator('.graph-canvas').boundingBox()).x)).toBeLessThan(1)
  await page.waitForTimeout(300)
  await left.click()
  await expect.poll(async () => {
    const card = await page.locator(`.version-card[data-version="${laneVersions[0].id}"]`).boundingBox()
    const viewport = await page.locator('.graph-canvas').boundingBox()
    return Math.abs(card.x + card.width / 2 - viewport.x - viewport.width / 2)
  }).toBeLessThan(2)
  expect((await state(page, room)).activeId).toBe(active)
  await right.click()
  await expect.poll(async () => {
    const card = await page.locator(`.version-card[data-version="${laneVersions.at(-1).id}"]`).boundingBox()
    const viewport = await page.locator('.graph-canvas').boundingBox()
    return Math.abs(card.x + card.width / 2 - viewport.x - viewport.width / 2)
  }).toBeLessThan(2)
  await page.getByRole('button', { name: 'Zoom in, plus' }).click()
  const after = await left.boundingBox()
  expect(after.width).toBeCloseTo(before.width, 1)
  expect(after.height).toBeGreaterThan(before.height)
})

test('lane buttons navigate to both endpoints at a densely zoomed-out scale', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const versions = [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 }]
  for (let lane = 0; lane < 40; lane++) {
    for (let step = 1; step <= 6; step++) {
      versions.push({
        id: `v${lane}-${step}`, parentId: step === 1 ? 'v0' : `v${lane}-${step - 1}`,
        step, lane, branch: `B${lane + 1}`, change: `Version ${step}`, data: [], createdAt: lane * 10 + step,
      })
    }
  }
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v0', nextNode: 1, nextVersion: 241, nextLane: 40, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await page.keyboard.press('Shift+a')
  await page.waitForTimeout(500)
  const saved = await state(page, room)
  const lane = 10
  const laneVersions = saved.versions.filter((item) => item.id !== 'v0' && item.lane === lane).sort((a, b) => a.step - b.step)
  const left = page.locator(`.lane-navigation-left[data-lane="${lane}"]`)
  const right = page.locator(`.lane-navigation-right[data-lane="${lane}"]`)
  expect((await left.boundingBox()).height).toBeLessThan(28)
  const world = page.locator('.graph-world')
  const before = await world.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)
  for (const [button, target] of [[right, laneVersions.at(-1)], [left, laneVersions[0]]]) {
    await button.click()
    await expect.poll(async () => {
      const card = await page.locator(`.version-card[data-version="${target.id}"]`).boundingBox()
      const canvas = await page.locator('.graph-canvas').boundingBox()
      return Math.abs(card.x + card.width / 2 - canvas.x - canvas.width / 2)
    }).toBeLessThan(2)
  }
  const after = await world.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)
  expect(Math.abs(after - before)).toBeGreaterThan(5)
  expect((await state(page, room)).activeId).toBe(saved.activeId)
})

test('root covers the visible graph and keeps its label vertically centered while panning and resizing', async ({ page }) => {
  await openRoom(page)
  const root = page.locator('.root-version')
  const label = root.locator('.empty-set')
  async function checkRoot() {
    await expect.poll(async () => {
      const bounds = await root.boundingBox()
      const canvas = await page.locator('.graph-canvas').boundingBox()
      const text = await label.boundingBox()
      return Math.max(bounds.y - canvas.y, canvas.y + canvas.height - bounds.y - bounds.height,
        Math.abs(text.y + text.height / 2 - canvas.y - canvas.height / 2) - 2)
    }).toBeLessThan(1)
  }
  await checkRoot()
  await page.getByRole('button', { name: 'Focus active version, F' }).click()
  await page.waitForTimeout(500)
  const point = await emptyMapPoint(root.locator('.mini-map'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + 130, { steps: 5 })
  await page.mouse.up()
  await checkRoot()
  await page.keyboard.press('f')
  await page.waitForTimeout(500)
  const rootBounds = await root.boundingBox()
  const canvasBounds = await page.locator('.graph-canvas').boundingBox()
  const start = { x: rootBounds.x + rootBounds.width * 0.8, y: canvasBounds.y + canvasBounds.height * 0.25 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - (rootBounds.x - canvasBounds.x + rootBounds.width * 0.65), start.y, { steps: 10 })
  await page.mouse.up()
  await checkRoot()
  const shifted = await root.boundingBox()
  const shiftedLabel = await label.boundingBox()
  const visibleLeft = Math.max(canvasBounds.x, shifted.x)
  const visibleRight = Math.min(canvasBounds.x + canvasBounds.width, shifted.x + shifted.width)
  expect(Math.abs(shiftedLabel.x + shiftedLabel.width / 2 - (visibleLeft + visibleRight) / 2)).toBeLessThan(3)
  await page.setViewportSize({ width: 1200, height: 900 })
  await checkRoot()
  await page.getByRole('button', { name: 'Zoom out, minus' }).click()
  await page.waitForTimeout(500)
  await checkRoot()
})

test('dense lane controls follow visible lane bounds and colors without extra columns', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const versions = [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 }]
  for (let index = 1; index <= 40; index++) versions.push({
    id: `v${index}`, parentId: 'v0', step: 1, lane: index - 1, branch: `B${index}`, change: `Branch ${index}`, data: [], createdAt: index,
  })
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v0', nextNode: 1, nextVersion: 41, nextLane: 40, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await page.keyboard.press('Shift+a')
  await expect(page.locator('.root-overview-label')).toBeVisible()
  await page.waitForTimeout(500)
  const canvas = await page.locator('.graph-canvas').boundingBox()
  const label = await page.locator('.root-overview-label').boundingBox()
  expect(Math.abs(label.y + label.height / 2 - canvas.y - canvas.height / 2)).toBeLessThan(3)
  async function checkLanes() {
    const buttons = await page.locator('.lane-navigation').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      const canvas = element.closest('.graph-canvas').getBoundingClientRect()
      const card = document.querySelector(`.version-card[data-version="v${Number(element.dataset.lane) + 1}"]`)
      const lane = card.getBoundingClientRect()
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
        canvasLeft: canvas.left, canvasRight: canvas.right, expectedTop: Math.max(canvas.top, lane.top),
        expectedBottom: Math.min(canvas.bottom, lane.bottom),
        partial: lane.top < canvas.top || lane.bottom > canvas.bottom,
        side: element.classList.contains('lane-navigation-left') ? 'left' : 'right',
        color: getComputedStyle(element).backgroundColor,
        laneColor: getComputedStyle(card.querySelector('.branch-mark')).backgroundColor,
      }
    }))
    for (const button of buttons) {
      expect(button.width).toBeCloseTo(28, 1)
      expect(button.side === 'left' ? button.left - button.canvasLeft : button.right - button.canvasRight).toBeCloseTo(0, 1)
      expect(button.top - button.expectedTop).toBeCloseTo(0, 0)
      expect(button.bottom - button.expectedBottom).toBeCloseTo(0, 0)
      expect(button.color).toBe(button.laneColor)
    }
    return buttons
  }
  const fitted = await checkLanes()
  expect(fitted).toHaveLength(80)
  expect(fitted.some((button) => button.height < 28)).toBe(true)
  let partial = []
  for (let attempt = 0; attempt < 6 && !partial.some((button) => button.partial); attempt++) {
    await page.locator('.graph-canvas').dispatchEvent('wheel', { deltaY: -180, bubbles: true, cancelable: true })
    await page.waitForTimeout(100)
    partial = await checkLanes()
  }
  expect(partial.some((button) => button.partial)).toBe(true)
})

test('version numbers are shown consistently and remain stable on reload', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['One'])
  await addEntries(page, ['Two'])
  const saved = await state(page, room)
  const labels = await page.locator('.version-card:not(.root-version) .version-header-id').allTextContents()
  expect(labels).toHaveLength(2)
  expect(new Set(labels).size).toBe(2)
  expect(labels.every((label) => /^\d{2,}\.\d{2,}\.\d{3,}$/.test(label))).toBe(true)
  const currentLabel = await page.locator('.version-card.active .version-header-id').innerText()
  await expect(page.locator('.active-version-card')).toContainText(currentLabel)
  expect(saved.versions[2].number.step).toBe(saved.versions[1].number.step + 1)
  expect(saved.versions[1].number.subbranch).toBe(1)
  expect(saved.versions[2].number.subbranch).toBe(1)
  expect(saved.versions[2].number.origin).toBe(saved.versions[1].number.origin)
  expect(await page.locator('.version-card.active .version-header-id').evaluate((element) =>
    element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.parentElement.clientHeight)).toBe(true)
  await page.reload()
  await expect(page.locator('.version-card.active .version-header-id')).toHaveText(currentLabel)
  await addEntries(page, ['After reload'])
  const continued = await state(page, room)
  const next = continued.versions.find((item) => item.id === continued.activeId)
  expect(next.number.subbranch).toBe(1)
  expect(next.number.origin).not.toBe(saved.versions[2].number.origin)
})

test('a pruned continuation does not cause its displayed version number to be reused', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent'])
  const parent = (await state(page, room)).activeId
  await addEntries(page, ['Discarded'])
  let saved = await state(page, room)
  const before = saved.versions.find((item) => item.id === saved.activeId)
  const label = await page.locator('.version-card.active .version-header-id').innerText()
  await focusActive(page)
  await page.locator('.version-card.active .version-card-head').click({ button: 'right' })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete version and descendants' }).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(parent)
  await addEntries(page, ['Replacement'])
  saved = await state(page, room)
  const replacement = saved.versions.find((item) => item.id === saved.activeId)
  expect(replacement.number.origin).not.toBe(before.number.origin)
  expect(replacement.number.subbranch).toBe(before.number.subbranch)
  await expect(page.locator('.version-card.active .version-header-id')).not.toHaveText(label)
  await expect(page.locator('.version-card.active .version-header-id')).toHaveText(`${label}.1`)
  await page.reload()
  await expect(page.locator('.version-card.active .version-header-id')).toHaveText(`${label}.1`)
})

test('retired numbers synchronize to connected and newly joined peers', async ({ page, browser }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent'])
  const parent = (await state(page, room)).activeId
  await addEntries(page, ['Discarded'])
  const discarded = (await state(page, room)).activeId
  const oldLabel = await page.locator('.version-card.active .version-header-id').innerText()
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  try {
    const guest = await contexts[0].newPage()
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await expect.poll(async () => (await state(guest, room)).versions.some((item) => item.id === discarded)).toBe(true)
    await focusActive(page)
    await page.locator('.version-card.active .version-card-head').click({ button: 'right' })
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete version and descendants' }).click()
    await expect.poll(async () => (await state(guest, room)).retiredVersionNumbers?.some((item) => item.id === discarded)).toBe(true)
    await expect.poll(async () => (await state(page, room)).activeId).toBe(parent)
    await addEntries(page, ['Replacement'])
    const replacement = (await state(page, room)).activeId
    await expect(page.locator('.version-card.active .version-header-id')).toHaveText(`${oldLabel}.1`)
    await expect.poll(async () => (await state(guest, room)).versions.find((item) => item.id === replacement)?.numberSuffix).toBe(1)
    const laterGuest = await contexts[1].newPage()
    await laterGuest.goto(`/?room=${room}`)
    await expect(laterGuest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await expect.poll(async () => (await state(laterGuest, room)).versions.find((item) => item.id === replacement)?.numberSuffix).toBe(1)
    expect((await state(laterGuest, room)).retiredVersionNumbers.some((item) => item.id === discarded)).toBe(true)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('existing room numbering migrates once and synchronizes to peers', async ({ page, browser }) => {
  const room = `test-${randomUUID()}`
  const base = (id, parentId, step, branch, number) => ({
    id, parentId, step, lane: 0, branch, number, change: id, data: [], createdAt: step,
  })
  const old = (step, subbranch, origin, owner) => ({ step, branch: 1, subbranch, origin, owner })
  const versions = [
    base('v0', null, 0, 'ROOT'),
    base('v1', 'v0', 1, 'B1', old(1, 0, 'v1', 'a')),
    base('v2', 'v1', 2, 'B1', old(2, 1, 'v2', 'b')),
    base('v3', 'v1', 2, 'B1.1', old(2, 2, 'v3', 'a')),
  ]
  await page.addInitScript(({ room, versions }) => {
    const key = `canopy-room-data-v1-${encodeURIComponent(room)}`
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      versions, activeId: 'v2', nextNode: 1, nextVersion: 4, nextLane: 2, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  const migrated = (await state(page, room)).versions.filter((item) => item.id !== 'v0')
    .map(({ id, number }) => [id, number]).sort()
  expect(migrated.map(([, number]) => number.subbranch)).toEqual([1, 1, 2])
  expect(migrated.every(([, number]) => number.scheme === 2)).toBe(true)
  await expect(page.locator('.version-card[data-version="v2"] .version-header-id')).toHaveText('02.01.001')
  await page.reload()
  expect((await state(page, room)).versions.filter((item) => item.id !== 'v0')
    .map(({ id, number }) => [id, number]).sort()).toEqual(migrated)
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await expect.poll(async () => (await state(guest, room)).versions.filter((item) => item.id !== 'v0')
      .map(({ id, number }) => [id, number]).sort()).toEqual(migrated)
  } finally {
    await context.close()
  }
})

test('creator indicator tracks the card header and long entry labels wrap within the tile', async ({ page }) => {
  const room = await openRoom(page)
  const label = 'A long entry label that should wrap inside its available area'
  await addEntries(page, [label])
  await focusActive(page)
  const card = page.locator('.version-card.active')
  const title = card.locator('.tile-label')
  await expect(title.locator('tspan').nth(1)).toBeVisible()
  const geometry = await title.evaluate((text) => {
    const box = text.getBBox()
    const rect = text.parentElement.querySelector('.tree-tile').getBBox()
    return { text: { x: box.x, y: box.y, width: box.width, height: box.height }, tile: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  })
  expect(geometry.text.x + geometry.text.width).toBeLessThanOrEqual(geometry.tile.x + geometry.tile.width)
  expect(geometry.text.y + geometry.text.height).toBeLessThanOrEqual(geometry.tile.y + geometry.tile.height)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1050, height: 720 }]) {
    await page.setViewportSize(viewport)
    const alignment = await card.evaluate((element) => ({
      top: parseFloat(getComputedStyle(element, '::before').top),
      header: element.querySelector('.version-card-head').getBoundingClientRect().height / element.getBoundingClientRect().height * element.offsetHeight,
    }))
    expect(alignment.top).toBeCloseTo(alignment.header, 0)
  }
  expect(findNode(await activeData(page, room), label)).toBeTruthy()
})

test('room switching, persistence and deletion keep room data independent', async ({ page }) => {
  const first = await openRoom(page)
  await addEntries(page, ['First room'])
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByLabel('Create a new empty room').fill('Second room')
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page.getByTitle('Second room')).toBeVisible()
  await addEntries(page, ['Second entry'])
  await page.reload()
  await expect(page.locator('.version-card.active')).toContainText('Second entry')
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByRole('button', { name: first, exact: true }).click()
  await expect(page.locator('.version-card.active')).toContainText('First room')
  await expect(page.locator('.version-card.active')).not.toContainText('Second entry')
  await page.getByRole('button', { name: 'Change Room' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete locally saved room Second room' }).click()
  await expect(page.getByRole('button', { name: 'Second room', exact: true })).toHaveCount(0)
  expect(await state(page, 'Second room')).toBeNull()
})

test('peers follow new children only when viewing their parent', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await expect(host.locator('.collaborator-list button')).toHaveCount(2)
    await addEntries(host, ['Host edit'])
    await expect(guest.locator('.interaction-section')).toContainText('Host edit')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe((await state(host, room)).activeId)
    await expect(guest.locator('.version-card.active')).toBeInViewport()
    await addEntries(guest, ['Guest edit'])
    await expect(host.locator('.interaction-section')).toContainText('Guest edit')
    await expect.poll(async () => (await state(host, room)).versions.some((version) => !!findNode(version.data, 'Guest edit'))).toBe(true)
    await expect.poll(async () => (await state(guest, room)).versions.some((version) => !!findNode(version.data, 'Host edit'))).toBe(true)
    await expect.poll(async () => (await state(host, room)).activeId).toBe((await state(guest, room)).activeId)
    await guest.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await state(guest, room)).activeId).not.toBe((await state(host, room)).activeId)
    const guestVersion = (await state(guest, room)).activeId
    await addEntries(host, ['Host later edit'])
    await expect(guest.locator('.interaction-section')).toContainText('Host later edit')
    expect((await state(guest, room)).activeId).toBe(guestVersion)
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})

test('simultaneous peer edits keep distinct stable version numbers', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  for (const context of contexts) {
    await context.addInitScript(() => {
      const send = RTCDataChannel.prototype.send
      const pending = []
      RTCDataChannel.prototype.send = function (data) {
        if (window.holdPeerMessages) pending.push([this, data])
        else send.call(this, data)
      }
      window.releasePeerMessages = () => {
        window.holdPeerMessages = false
        for (const [channel, data] of pending.splice(0)) send.call(channel, data)
      }
    })
  }
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()))
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await addEntries(host, ['Base'])
    await expect.poll(async () => (await state(guest, room)).activeId).toBe((await state(host, room)).activeId)
    const parent = (await state(host, room)).activeId
    for (const [page, label] of [[host, 'Concurrent host'], [guest, 'Concurrent guest']]) {
      await page.getByRole('button', { name: 'New free entry, N' }).click()
      await page.getByPlaceholder('Entry name').fill(label)
      await page.evaluate(() => { window.holdPeerMessages = true })
    }
    await Promise.all([host, guest].map((page) => page.getByRole('button', { name: 'Add 1 entry' }).click()))
    for (const page of [host, guest]) await page.evaluate(() => window.releasePeerMessages())
    await expect.poll(async () => (await state(host, room)).versions.filter((item) => item.parentId === parent).length, { timeout: 20000 }).toBe(2)
    await expect.poll(async () => (await state(guest, room)).versions.filter((item) => item.parentId === parent).length, { timeout: 20000 }).toBe(2)
    const hostChildren = (await state(host, room)).versions.filter((item) => item.parentId === parent)
    const guestChildren = (await state(guest, room)).versions.filter((item) => item.parentId === parent)
    expect(new Set(hostChildren.map((item) => item.number.origin)).size).toBe(2)
    expect(hostChildren.map((item) => item.number.subbranch)).toEqual([1, 1])
    expect(hostChildren.map((item) => [item.id, item.number]).sort()).toEqual(guestChildren.map((item) => [item.id, item.number]).sort())
    await host.keyboard.press('Shift+a')
    await guest.keyboard.press('Shift+a')
    const labels = await host.locator('.version-card:not(.root-version) .version-header-id').allTextContents()
    expect(new Set(labels).size).toBe(labels.length)
    const labelsByVersion = async (page) => page.locator('.version-card:not(.root-version)').evaluateAll((cards) =>
      Object.fromEntries(cards.map((card) => [card.dataset.version, card.querySelector('.version-header-id').textContent])))
    await expect.poll(async () => labelsByVersion(guest)).toEqual(await labelsByVersion(host))
    const childLabels = hostChildren.map((item) => item.id)
    const displayed = await labelsByVersion(host)
    const pair = childLabels.map((id) => displayed[id]).sort()
    expect(pair[1]).toBe(`${pair[0]}.1`)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('simultaneous joiners receive unique stable names from the room host', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()))
  const pages = await Promise.all(contexts.map(async (context) => {
    await context.addInitScript(() => localStorage.setItem('canopy-user-name', 'Otter'))
    return context.newPage()
  }))
  try {
    const room = await openRoom(pages[0])
    await Promise.all(pages.slice(1, 4).map((page) => page.goto(`/?room=${room}`)))
    for (const page of pages.slice(0, 4)) {
      await expect(page.locator('.collaborator-list button')).toHaveCount(4, { timeout: 20000 })
      await expect.poll(async () => page.locator('.collaborator-list button').evaluateAll((buttons) =>
        buttons.map((button) => button.title.split(' · ')[0]).sort()), { timeout: 20000 })
        .toEqual(['Otter', 'Otter 2', 'Otter 3', 'Otter 4'])
    }
    await openRoom(pages[4])
    await expect(pages[4].locator('.collaborator-info strong')).toHaveText('Otter (you)')
    const leavingName = (await pages[1].locator('.collaborator-info strong').filter({ hasText: '(you)' }).innerText()).replace(' (you)', '')
    await pages[1].getByRole('button', { name: 'Change Room' }).click()
    await pages[1].getByLabel('Create a new empty room').fill(`other-${randomUUID()}`)
    await pages[1].getByRole('button', { name: 'Create room' }).click()
    await expect(pages[0].locator('.collaborator-list button')).toHaveCount(3)
    await expect.poll(async () => pages[0].locator('.collaborator-list button').evaluateAll((buttons) =>
      buttons.map((button) => button.title.split(' · ')[0]).sort()))
      .toEqual(['Otter', 'Otter 2', 'Otter 3', 'Otter 4'].filter((name) => name !== leavingName))
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
