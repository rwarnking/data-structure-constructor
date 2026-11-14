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
  await expect(page.locator(`#version-connector-${first}`)).toHaveAttribute('d', /M /)
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
