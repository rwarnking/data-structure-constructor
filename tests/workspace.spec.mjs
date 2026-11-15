import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

async function openRoom(page, room = `test-${randomUUID()}`) {
  await page.goto(`/?room=${room}`)
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  await expect(page.locator('.version-card.active')).toBeVisible()
  return room
}

async function openTreemapRoom(page, data) {
  const room = `test-${randomUUID()}`
  await page.addInitScript(({ room, data }) => {
    const versions = [
      { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Root', data: [], createdAt: 0 },
      { id: 'v1', parentId: 'v0', step: 1, lane: 0, branch: 'B1', change: 'Edit', data, createdAt: 1 },
    ]
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v1', nextNode: 100, nextVersion: 2, nextLane: 1, copyLinks: [],
    }))
  }, { room, data })
  await openRoom(page, room)
  await focusActive(page)
  await expectCentered(page, 'v1')
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
  const label = names[0].split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
  await expect(page.locator('.version-card.active')).toContainText(new RegExp(label))
}

async function focusActive(page) {
  await page.getByRole('button', { name: 'Focus active version, 1' }).click()
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

test('tutorial navigates content, highlights actions, completes and restarts', async ({ page }) => {
  await openRoom(page)
  await page.getByRole('button', { name: 'Open tutorial' }).click()
  const guide = page.getByRole('dialog', { name: 'Welcome to Canopy' })
  await expect(guide.getByRole('img', { name: 'Three connected version windows' })).toBeVisible()
  await expect(guide.locator('ul li')).toHaveCount(3)
  await guide.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('.story-highlight')).toBeVisible()
  await expect(guide.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByRole('button', { name: 'New free entry, N' }).click()
  await expect(guide.getByRole('button', { name: 'Next' })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await guide.getByRole('button', { name: 'Next' }).click()
  await expect(guide.locator('ol li')).toHaveCount(3)
  await guide.getByRole('button', { name: 'Previous' }).click()
  await guide.getByRole('button', { name: 'Restart' }).click()
  await expect(guide).toContainText('Explore the version graph')
  await guide.getByRole('button', { name: 'Skip' }).click()
  await expect(guide).toHaveCount(0)
  await page.getByRole('button', { name: 'Open tutorial' }).click()
  await expect(guide).toContainText('1 / 4')
})

test('tags can be edited, searched, listed, exported and removed', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Tagged data'])
  const versionId = (await state(page, room)).activeId
  await focusActive(page)
  await page.locator('.version-card.active .card-menu').click()
  await expect(page.getByRole('button', { name: 'Add tag', exact: true }).locator('svg')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add tag', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Milestone')
  await page.getByLabel('Description', { exact: true }).fill('Important release')
  await page.getByRole('button', { name: 'Save tag' }).click()
  const indicator = page.locator(`.version-card[data-version="${versionId}"] .version-tag-indicator`)
  await expect(indicator).toHaveAttribute('title', 'Milestone\nImportant release')
  await expect(indicator).toHaveCount(1)
  expect(await indicator.evaluate((element) => element.previousElementSibling?.classList.contains('version-header-id')
    && element.nextElementSibling?.classList.contains('version-action-symbol')
    && element.nextElementSibling?.nextElementSibling?.classList.contains('version-action'))).toBe(true)
  const numberBounds = await page.locator('.version-card.active .version-header-id').boundingBox()
  const indicatorBounds = await indicator.boundingBox()
  const changeBounds = await page.locator('.version-card.active .version-action').boundingBox()
  expect(indicatorBounds.x).toBeGreaterThanOrEqual(numberBounds.x + numberBounds.width - 1)
  expect(indicatorBounds.x + indicatorBounds.width).toBeLessThanOrEqual(changeBounds.x + 1)
  await page.reload()
  await expect(indicator).toBeVisible()
  await page.keyboard.press('Control+f')
  await page.getByLabel('Tag text').fill('important')
  const search = page.getByRole('dialog', { name: 'Search versions' })
  await expect(search).toContainText('Tag description')
  await search.getByRole('button', { name: /Milestone/ }).click()
  await page.keyboard.press('Control+f')
  await page.getByLabel('Tag text').fill('milestone')
  await expect(search).toContainText('Tag title')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'All tags' }).click()
  const tags = page.getByRole('dialog', { name: 'All tags' })
  await expect(tags).toContainText('Important release')
  await tags.getByRole('button', { name: /Milestone/ }).click()
  await expectCentered(page, versionId)
  await page.getByRole('button', { name: 'Settings' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export data' }).click()
  const exported = JSON.parse((await readFile(await (await downloadPromise).path())).toString())
  expect(exported.state.versions.find((item) => item.id === versionId).tag).toEqual({ title: 'Milestone', description: 'Important release' })
  const map = page.locator('.version-card.active .mini-map')
  const point = await emptyMapPoint(map)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(page.getByRole('button', { name: 'Edit tag' }).locator('svg')).toHaveCount(1)
  await page.getByRole('button', { name: 'Edit tag' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Updated')
  await page.getByRole('button', { name: 'Save tag' }).click()
  await expect(indicator).toHaveAttribute('title', 'Updated\nImportant release')
  await page.locator('.version-card.active .card-menu').click()
  await page.getByRole('button', { name: 'Edit tag' }).click()
  await page.getByRole('button', { name: 'Remove tag' }).click()
  await expect(indicator).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'tagged.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
  await expect(page.getByRole('status').first()).toHaveText('Local only')
  await expect.poll(async () => (await state(page, `${room}_1`))?.versions.find((item) => item.id === versionId)?.tag?.title).toBe('Milestone')
})

test('version tags synchronize between collaborators and stay in their room', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await addEntries(host, ['Collaborative'])
    const id = (await state(host, room)).activeId
    await expect.poll(async () => (await state(guest, room)).versions.some((item) => item.id === id)).toBe(true)
    await focusActive(host)
    await host.locator('.version-card.active .card-menu').click()
    await host.getByRole('button', { name: 'Add tag', exact: true }).click()
    await host.getByLabel('Title', { exact: true }).fill('Shared')
    await host.getByLabel('Description', { exact: true }).fill('Peer tag')
    await host.getByRole('button', { name: 'Save tag' }).click()
    await expect.poll(async () => (await state(guest, room)).versions.find((item) => item.id === id)?.tag)
      .toEqual({ title: 'Shared', description: 'Peer tag' })
    const previousView = (await state(host, room)).versions.find((item) => item.id === id).mapView
    await host.locator('.version-card.active .mini-map').hover()
    await host.keyboard.down('Shift')
    await host.mouse.wheel(0, -180)
    await host.keyboard.up('Shift')
    await expect.poll(async () => (await state(host, room)).versions.find((item) => item.id === id).mapView.zoom)
      .not.toBe(previousView.zoom)
    const updatedView = (await state(host, room)).versions.find((item) => item.id === id).mapView
    await expect.poll(async () => (await state(guest, room)).versions.find((item) => item.id === id)?.mapView)
      .toEqual(updatedView)
    const separateRoom = `other-${randomUUID()}`
    await guest.goto(`/?room=${separateRoom}`)
    await expect(guest.getByRole('status').first()).toHaveText('Hosting')
    await guest.getByRole('button', { name: 'Settings' }).click()
    await guest.getByRole('button', { name: 'All tags' }).click()
    await expect(guest.getByRole('dialog', { name: 'All tags' })).toContainText('No tags in this room')
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})

test('adding children applies to the complete selection', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First parent', 'Second parent'])
  await focusActive(page)
  await (await activeTile(page, room, 'First parent')).click({ position: { x: 8, y: 8 } })
  await expect(await activeTile(page, room, 'First parent')).toHaveClass(/is-selected/)
  await (await activeTile(page, room, 'Second parent')).click({ modifiers: ['Shift'], position: { x: 8, y: 8 } })
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await page.keyboard.press('a')
  await fillEntries(page, ['Child'])
  await expect.poll(async () => (await activeData(page, room)).map((item) => item.children[0]?.value))
    .toEqual(['Child', 'Child'])
  const parents = await activeData(page, room)
  expect(parents[0].children[0].id).not.toBe(parents[1].children[0].id)
})

test('action symbols appear in destination headers, not on connectors', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Connector'])
  const id = (await state(page, room)).activeId
  for (const size of [{ width: 1280, height: 720 }, { width: 900, height: 900 }]) {
    await page.setViewportSize(size)
    await page.getByRole('button', { name: 'Fit all versions, 4' }).click()
    await expect(page.locator(`[data-version-connectors~="${id}"]`)).toHaveAttribute('d', /M /)
    await expect(page.locator('.connection-layer text, [data-connector-symbol]')).toHaveCount(0)
    await expect(page.locator(`.version-card[data-version="${id}"] .version-action-symbol`)).toHaveText('+')
  }
})

test('a new version reaches its destination before its terminal arrow appears', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent'])
  await focusActive(page)
  await page.getByRole('button', { name: 'New free entry, N' }).click()
  await page.getByPlaceholder('Entry name').fill('Animated')
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    const callbacks = new Map()
    const clock = performance.now()
    let next = -1
    window.requestAnimationFrame = (callback) => { const id = next--; callbacks.set(id, callback); return id }
    window.cancelAnimationFrame = (id) => { if (id < 0) callbacks.delete(id); else cancel(id) }
    window.stepHeldFrames = (elapsed, release = false) => {
      if (release) { window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel }
      const current = [...callbacks.values()]
      callbacks.clear()
      for (const callback of current) callback(clock + elapsed)
    }
    document.querySelector('button[type="submit"]')?.click()
  })
  await expect(page.getByPlaceholder('Entry name')).toHaveCount(0)
  const id = (await state(page, room)).activeId
  const card = page.locator(`.version-card[data-version="${id}"]`)
  const initial = parseFloat(await card.evaluate((element) => element.style.left))
  await expect(page.locator(`[data-version-tail="${id}"]`)).toHaveCount(0)
  await page.evaluate(() => window.stepHeldFrames(230))
  await expect.poll(async () => parseFloat(await card.evaluate((element) => element.style.left))).toBeGreaterThan(initial)
  const middle = parseFloat(await card.evaluate((element) => element.style.left))
  await page.locator('.graph-canvas').dispatchEvent('wheel', { deltaY: 100, clientX: 650, clientY: 400 })
  await expect(page.locator(`[data-version-tail="${id}"]`)).toHaveCount(0)
  const point = await page.locator('.graph-canvas').evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect()
    for (let y = bounds.top + 30; y < bounds.bottom - 90; y += 40) {
      for (let x = bounds.left + 30; x < bounds.right - 90; x += 40) {
        const hit = document.elementFromPoint(x, y)
        if (hit && canvas.contains(hit) && !hit.closest('button, .version-card, .canvas-controls')) return { x, y }
      }
    }
    return null
  })
  expect(point).toBeTruthy()
  const world = page.locator('.graph-world')
  const beforePan = await world.getAttribute('style')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 45, point.y + 35)
  await page.mouse.up()
  await expect.poll(() => world.getAttribute('style')).not.toBe(beforePan)
  await expect(page.locator(`[data-version-tail="${id}"]`)).toHaveCount(0)
  await page.evaluate(() => window.stepHeldFrames(1000, true))
  await expect(page.locator(`[data-version-tail="${id}"]`)).toBeAttached()
  expect(parseFloat(await card.evaluate((element) => element.style.left))).toBeGreaterThan(middle)
})

test('difference outlines coexist with hover and selection fills in both themes', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Unchanged'])
  await addEntries(page, ['Added'])
  await focusActive(page)
  const added = await activeTile(page, room, 'Added')
  const unchanged = await activeTile(page, room, 'Unchanged')
  await expect(added).toHaveClass(/is-different/)
  await expect(unchanged).not.toHaveClass(/is-different/)
  await page.mouse.move(0, 0)
  const styles = (tile) => tile.evaluate((element) => {
    const style = getComputedStyle(element)
    return { fill: style.fill, stroke: style.stroke }
  })
  const plain = await styles(added)
  expect((await styles(unchanged)).stroke).toBe('rgb(255, 255, 255)')
  await added.hover({ position: { x: 8, y: 8 } })
  await expect.poll(async () => (await styles(added)).fill).not.toBe(plain.fill)
  expect((await styles(added)).stroke).toBe(plain.stroke)
  await added.click({ position: { x: 8, y: 8 } })
  await expect(added).toHaveClass(/is-selected/)
  await page.mouse.move(0, 0)
  await expect.poll(async () => (await styles(added)).fill).not.toBe(plain.fill)
  expect((await styles(added)).stroke).toBe(plain.stroke)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/dark/)
  const dark = await styles(added)
  expect(dark.stroke).not.toBe(plain.stroke)
  expect(dark.fill).not.toBe(plain.fill)
  expect((await styles(unchanged)).stroke).toBe('rgb(255, 255, 255)')
  await page.locator('.app-shell').evaluate((element) => element.style.setProperty('--theme-difference-outline', 'rgb(12, 34, 56)'))
  await expect.poll(async () => (await styles(added)).stroke).toBe('rgb(12, 34, 56)')
  await page.locator('.app-shell').evaluate((element) => element.style.setProperty('--theme-card', 'rgb(21, 43, 65)'))
  await expect(page.locator('.version-card.active')).toHaveCSS('background-color', 'rgb(21, 43, 65)')
  await expect(added).toHaveClass(/is-selected/)
})

test('repositioned unchanged treemaps retain their default outline after an entry is added', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const entry = (id, children = []) => ({ id, value: id, children })
  const original = [entry('parent', [entry('child')]), entry('other')]
  const versions = [
    { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 },
    { id: 'v1', parentId: 'v0', step: 1, lane: 0, branch: 'B1', change: 'Original', data: original, createdAt: 1,
      positions: { parent: { x: 0, y: 0 }, other: { x: 2, y: 0 } } },
    { id: 'v2', parentId: 'v1', step: 2, lane: 0, branch: 'B1', change: 'Create added', data: [...original, entry('added')], createdAt: 2,
      positions: { parent: { x: 0.4, y: 0.1 }, other: { x: 2.5, y: 0.4 }, added: { x: 0, y: 2 } } },
  ]
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v2', nextNode: 1, nextVersion: 3, nextLane: 1, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await focusActive(page)
  const card = page.locator('.version-card.active')
  await expect(card.locator('.tree-tile.is-different')).toHaveCount(1)
  await expect(card.locator('[data-node="added"]')).toHaveClass(/is-different/)
  for (const id of ['parent', 'child', 'other']) {
    await expect(card.locator(`[data-node="${id}"]`)).not.toHaveClass(/is-different/)
    await expect(card.locator(`[data-node="${id}"]`)).toHaveCSS('stroke', 'rgb(255, 255, 255)')
  }
})

test('low zoom summaries place action and tag above large entry and treemap counts', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 6; index++) await addEntries(page, [`Entry ${index}`])
  const id = (await state(page, room)).activeId
  await focusActive(page)
  await page.locator('.version-card.active .card-menu').click()
  await page.getByRole('button', { name: 'Add tag', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Milestone')
  await page.getByLabel('Description', { exact: true }).fill('Important release')
  await page.getByRole('button', { name: 'Save tag' }).click()
  await page.keyboard.press('4')
  await expect(page.locator('.root-version .overview-action-detail')).toHaveText('Root: Empty')
  const summary = page.locator(`.version-card[data-version="${id}"] .overview-map`)
  await expect(summary).toBeVisible()
  await expect(summary.locator('.overview-action-symbol')).toHaveText('+')
  await expect(summary.locator('.overview-action-detail')).toContainText('Entry 5')
  await expect(summary.locator('.overview-tag')).toBeVisible()
  await expect(summary.locator('.overview-tag')).toHaveAttribute('title', 'Milestone\nImportant release')
  await summary.locator('.overview-tag').hover()
  await expect(page.locator('.overview-preview')).toContainText((await page.locator(`.version-card[data-version="${id}"] .version-header-id`).getAttribute('title')))
  await expect(page.locator('.overview-preview svg')).toBeVisible()
  const head = page.locator(`.version-card[data-version="${id}"] .version-card-head`)
  await expect(head.locator(':scope > *')).toHaveCount(2)
  expect(await head.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(await head.evaluate((element) => {
      const color = element.closest('.version-card').style.getPropertyValue('--author-color')
      const probe = document.createElement('span')
      probe.style.color = color
      element.append(probe)
      const result = getComputedStyle(probe).color
      probe.remove()
      return result
    }))
  await page.mouse.move(10, 10)
  await expect(page.locator('.overview-preview')).toHaveCount(0)
  await expect(summary.locator('.overview-stats b')).toHaveText(['6', '6'])
  const layout = await summary.evaluate((element) => {
    const rect = (selector) => element.querySelector(selector).getBoundingClientRect()
    const symbol = rect('.overview-action-symbol')
    const text = rect('.overview-action-detail')
    const tag = rect('.overview-tag')
    const stats = rect('.overview-stats')
    return { symbol: { right: symbol.right, bottom: symbol.bottom, width: symbol.width },
      text: { left: text.left, right: text.right, bottom: text.bottom },
      tag: { left: tag.left, bottom: tag.bottom, width: tag.width }, stats: { top: stats.top } }
  })
  expect(layout.symbol.right).toBeLessThanOrEqual(layout.text.left + 1)
  expect(layout.text.right).toBeLessThanOrEqual(layout.tag.left + 1)
  expect(Math.max(layout.symbol.bottom, layout.text.bottom, layout.tag.bottom)).toBeLessThanOrEqual(layout.stats.top + 1)
  expect(layout.tag.width).toBeGreaterThan(3)
})

test('box selection moves selected roots together and cancels outside drops', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['One', 'Two', 'Target'])
  await focusActive(page)
  await expectCentered(page, (await state(page, room)).activeId)
  const map = page.locator('.version-card.active .mini-map')
  const one = await activeTile(page, room, 'One')
  const two = await activeTile(page, room, 'Two')
  const target = await activeTile(page, room, 'Target')
  await map.hover({ trial: true })
  const box = await map.boundingBox()
  const start = await emptyMapPoint(map)
  await page.keyboard.down('Control')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, { steps: 4 })
  await expect(page.locator('.selection-box')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(3)
  await target.click({ modifiers: ['Shift'], position: { x: 8, y: 8 } })
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  const original = await state(page, room)
  let a = await one.boundingBox()
  await page.mouse.move(a.x + 8, a.y + 8)
  await page.mouse.down()
  await page.mouse.move(260, 20, { steps: 5 })
  await page.mouse.up()
  expect((await state(page, room)).versions.length).toBe(original.versions.length)
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  a = await one.boundingBox()
  const b = await target.boundingBox()
  await page.mouse.move(a.x + 8, a.y + 8)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  const movedTarget = await target.boundingBox()
  await page.mouse.move(movedTarget.x + movedTarget.width / 2, movedTarget.y + movedTarget.height / 2)
  await expect(target).toHaveClass(/is-over/)
  await page.mouse.up()
  await expect.poll(async () => findNode(await activeData(page, room), 'Target')?.children.map((item) => item.value)).toEqual(['One', 'Two'])
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await expect(two).toBeVisible()
})

test('version search persists recent queries and focuses a result', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  const identifier = await page.locator('.version-card.active .version-header-id').innerText()
  await addEntries(page, ['Second'])
  await page.keyboard.press('Control+f')
  const dialog = page.getByRole('dialog', { name: 'Search versions' })
  await expect(dialog).toBeVisible()
  const parts = identifier.split('.')
  await page.getByLabel('Version step').fill(parts[0])
  await page.getByLabel('Version branch').fill(parts[1])
  await page.getByLabel('Version subbranch').fill(parts.slice(2).join('.'))
  await dialog.getByRole('button', { name: new RegExp(identifier.replaceAll('.', '\\.')) }).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  await expectCentered(page, first)
  await page.reload()
  await page.keyboard.press('Control+f')
  await expect(dialog.getByRole('button', { name: identifier, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('search filters all entity types and remembers combined searches', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'parent', value: 'Parent', children: [{ id: 'child', value: 'Nested needle', description: 'Hidden description', children: [] }] },
  ])
  await page.keyboard.press('t')
  await page.getByLabel('Title', { exact: true }).fill('Release tag')
  await page.getByLabel('Description', { exact: true }).fill('Milestone description')
  await page.getByRole('button', { name: 'Save tag' }).click()
  await page.keyboard.press('Control+f')
  const dialog = page.getByRole('dialog', { name: 'Search versions' })
  await expect(dialog).toContainText('Search through')
  const result = dialog.locator('.version-search-results button')
  const all = dialog.getByLabel('All', { exact: true })
  for (const text of ['nested needle', 'HIDDEN DESCRIPTION', 'release tag', 'milestone description', 'edit', 'add', '01.01']) {
    await all.fill(text)
    await expect(result).toHaveCount(1)
  }
  await all.fill('no matching entity')
  await expect(result).toHaveCount(0)
  await all.clear()
  await dialog.getByLabel('Entries and description').fill('hidden description')
  await expect(result).toHaveCount(1)
  await dialog.getByLabel('Actions', { exact: true }).fill('edit')
  await dialog.getByLabel('Tag text').fill('milestone')
  await expect(result).toHaveCount(1)
  await dialog.getByLabel('Actions', { exact: true }).fill('add')
  await expect(result).toHaveCount(1)
  await dialog.getByLabel('Actions', { exact: true }).fill('nonexistent')
  await expect(result).toHaveCount(0)
  await dialog.getByLabel('Actions', { exact: true }).fill('edit')
  await dialog.getByRole('button', { name: 'Search', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+f')
  await dialog.getByRole('button', { name: /Actions: edit.*Entries: hidden description/ }).click()
  await expect(dialog.getByLabel('Actions', { exact: true })).toHaveValue('edit')
  await expect(result).toHaveCount(1)
  await result.click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe('v1')
  await page.reload()
  await page.keyboard.press('Control+f')
  await expect(dialog.getByRole('button', { name: /Actions: edit.*Entries: hidden description/ })).toBeVisible()
})

test('search retains recent searches saved in the previous format', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('canopy-recent-version-searches-v1', JSON.stringify([['01', '02', '003', 'old tag']])))
  await openRoom(page)
  await page.keyboard.press('Control+f')
  const dialog = page.getByRole('dialog', { name: 'Search versions' })
  await dialog.getByRole('button', { name: '01.02.003 · Tag: old tag' }).click()
  await expect(dialog.getByLabel('Version step')).toHaveValue('01')
  await expect(dialog.getByLabel('Tag text')).toHaveValue('old tag')
})

test('search remains usable in a short narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 360 })
  await openRoom(page)
  await page.keyboard.press('Control+f')
  const dialog = page.getByRole('dialog', { name: 'Search versions' })
  const bounds = await dialog.boundingBox()
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(360)
  await dialog.getByLabel('Entries and description').fill('missing')
  await expect(dialog.getByText('No matching versions')).toBeVisible()
})

test('camera presets fit the available canvas and refocus after resizing', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Base'])
  const base = (await state(page, room)).activeId
  await addEntries(page, ['Main'])
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  await addEntries(page, ['Branch'])
  const active = (await state(page, room)).activeId
  for (const size of [{ width: 1280, height: 720 }, { width: 900, height: 900 }, { width: 1500, height: 600 }]) {
    await page.setViewportSize(size)
    await focusActive(page)
    await expectCentered(page, active)
    for (const [button, horizontal] of [['Fit height', false], ['Fit all versions, 4', true]]) {
      await page.getByRole('button', { name: button }).click()
      await expect.poll(() => page.locator('.graph-canvas').evaluate((canvas, checkX) => {
        const area = canvas.getBoundingClientRect()
        return [...canvas.querySelectorAll('.version-card:not(.root-version)')].every((card) => {
          const rect = card.getBoundingClientRect()
          return rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1
            && (!checkX || (rect.left >= area.left - 1 && rect.right <= area.right + 1))
        })

      }, horizontal)).toBe(true)
    }
    await page.getByRole('button', { name: 'Focus neighborhood' }).click()
    await expect(page.locator(`.version-card[data-version="${active}"]`)).toBeInViewport()
  }
  await focusActive(page)
  await expectCentered(page, active)
  await page.setViewportSize({ width: 1100, height: 800 })
  await expectCentered(page, active)
})

test('resizing keeps the manually panned active version in place at different zoom levels', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 6; index++) await addEntries(page, [`Resize ${index}`])
  const id = (await state(page, room)).activeId
  for (const zoomOut of [false, true]) {
    if (zoomOut) await page.keyboard.press('4')
    else await focusActive(page)
    await page.waitForTimeout(600)
    const canvas = page.locator('.graph-canvas')
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + 30, bounds.y + 30)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 65, bounds.y + 65, { steps: 4 })
    await page.mouse.up()
    const position = () => page.locator(`.version-card[data-version="${id}"]`).evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.left, y: bounds.top }
    })
    const before = await position()
    for (const width of [1200, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(async () => {
        const after = await position()
        return Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y))
      }).toBeLessThan(2)
    }
  }
})

test('settings export and import create an isolated local room without overwriting the source', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Exported'])
  const source = await state(page, room)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/dark/)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export data' }).click()
  const download = await downloadPromise
  const buffer = await readFile(await download.path())
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'dataset.json', mimeType: 'application/json', buffer })
  await expect(page.getByRole('status').first()).toHaveText('Local only')
  await expect.poll(async () => !!(await state(page, `${room}_1`))).toBe(true)
  expect(await state(page, room)).toEqual(source)
  expect((await state(page, `${room}_1`)).versions.map(({ id, parentId, data, number }) => ({ id, parentId, data, number })))
    .toEqual(source.versions.map(({ id, parentId, data, number }) => ({ id, parentId, data, number })))
  await page.reload()
  await expect(page.getByRole('status').first()).toHaveText('Local only')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByText(/Import failed/)).toBeVisible()
  expect(await state(page, room)).toEqual(source)
})

test('rooms and imports with root entries are rejected without overwriting saved data', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const invalidRoom = `${room}-invalid`
  const invalid = {
    versions: [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure',
      data: [{ id: 'n1', value: 'Preserve me', children: [] }], createdAt: 0 }],
    activeId: 'v0', nextNode: 2, nextVersion: 1, nextLane: 1, copyLinks: [],
  }
  await page.addInitScript(({ invalidRoom, invalid }) => {
    const key = `canopy-room-data-v1-${encodeURIComponent(invalidRoom)}`
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(invalid))
    localStorage.setItem('canopy-local-rooms-v1', JSON.stringify([invalidRoom]))
  }, { invalidRoom, invalid })
  await openRoom(page, room)
  const saved = await state(page, room)
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByRole('button', { name: invalidRoom, exact: true }).click()
  await expect(page.getByText(/Cannot open room.*root version must be empty/i)).toBeVisible()
  expect(await state(page, invalidRoom)).toEqual(invalid)
  expect(await state(page, room)).toEqual(saved)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const dataset = { format: 'canopy-dataset', version: 1, room: invalidRoom, state: invalid, interactions: [] }
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid-root.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dataset)),
  })
  await expect(page.getByText(/Import failed:.*root version must be empty/i)).toBeVisible()
  expect(await state(page, invalidRoom)).toEqual(invalid)
  expect(await state(page, room)).toEqual(saved)

  await page.goto(`/?room=${invalidRoom}`)
  await expect(page.getByRole('alert')).toContainText('The root version must be empty')
  expect(await state(page, invalidRoom)).toEqual(invalid)
  await page.getByRole('button', { name: 'Choose another room' }).click()
  await page.getByLabel('Create a new empty room').fill(`${room}-recovery`)
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  await expect(page.locator('.root-version .overview-action-detail')).toHaveText('Root: Empty')
  expect(await state(page, invalidRoom)).toEqual(invalid)
})

test('legacy saved data with root entries is blocked without migration or data loss', async ({ page }) => {
  const invalid = {
    versions: [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure',
      data: [{ id: 'n1', value: 'Preserve legacy', children: [] }], createdAt: 0 }],
    activeId: 'v0', nextNode: 2, nextVersion: 1, nextLane: 1, copyLinks: [],
  }
  await page.addInitScript((value) => localStorage.setItem('canopy-data-structure-v1', JSON.stringify(value)), invalid)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('The root version must be empty')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('canopy-data-structure-v1')))).toEqual(invalid)
  expect(await page.evaluate(() => localStorage.getItem('canopy-room-data-migrated-v1'))).toBeNull()
})

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
  await expect(page.locator('.entry-editor .entry-draft-table')).toBeVisible()
  await page.getByLabel('Result 1 name').fill('Left')
  await page.getByLabel('Result 2 name').fill('Right')
  await page.getByLabel('Assign Child to a result entry').selectOption({ label: 'Result 2 · Right' })
  await page.getByRole('button', { name: 'Split entry', exact: true }).click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Right')?.children.map((node) => node.value)).toEqual(['Child'])
  await expect.poll(async () => findNode(await activeData(page, room), 'Left')?.children.length).toBe(0)
  await expect(await activeTile(page, room, 'Left')).toHaveClass(/is-different/)
  await expect(await activeTile(page, room, 'Right')).toHaveClass(/is-different/)
  await expect(await activeTile(page, room, 'Child')).toHaveClass(/is-different/)
  await expect(page.locator('.version-card.active .version-action-symbol')).toHaveText('Y')

  await focusActive(page)
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await (await activeTile(page, room, 'Left')).click({ button: 'right', position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: 'Merge selected entries' }).click()
  await page.getByLabel('Resulting entry name').fill('Combined')
  await page.getByRole('button', { name: 'Merge entries', exact: true }).click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Combined')?.children.map((node) => node.value)).toEqual(['Child'])
  await expect(await activeTile(page, room, 'Combined')).toHaveClass(/is-different/)
  await expect(page.locator('.version-card.active .version-action-symbol')).toHaveText('⋈')

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

test('comparison and merge preselect the active version and allow replacing it', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const second = (await state(page, room)).activeId
  await page.keyboard.press('4')
  const firstLabel = await page.locator(`.version-card[data-version="${first}"] .version-header-id`).getAttribute('title')
  const secondLabel = await page.locator(`.version-card[data-version="${second}"] .version-header-id`).getAttribute('title')
  const drawer = page.locator('.compare-drawer')

  for (const [shortcut, label] of [['Shift+c', 'First version'], ['Shift+m', 'Source']]) {
    await page.keyboard.press(shortcut)
    await expect(drawer.locator('.drawer-first-version')).toContainText(`${label}: ${secondLabel}`)
    await expect(page.locator(`.version-card[data-version="${second}"]`)).toHaveClass(/compared/)
    await drawer.getByRole('button', { name: `Deselect first version ${secondLabel}` }).click()
    await expect(drawer).toContainText('Select the first version, then the second.')
    await expect(page.locator(`.version-card[data-version="${second}"]`)).not.toHaveClass(/compared/)
    await page.locator(`.version-card[data-version="${first}"]`).click()
    await expect(drawer.locator('.drawer-first-version')).toContainText(`${label}: ${firstLabel}`)
    await page.locator(`.version-card[data-version="${second}"]`).click()
    await expect(drawer.locator('.comparison-content')).toBeVisible()
    await expect(drawer.locator('.drawer-head strong')).toContainText(`${firstLabel} ${shortcut === 'Shift+m' ? '→' : '↔'} ${secondLabel}`)
    await drawer.getByRole('button', { name: 'Abort and close' }).click()
    await expect(drawer).toHaveCount(0)
  }
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

  await page.keyboard.press('4')
  await expect(page.locator(`[data-version-connectors~="${first}"]`)).toHaveAttribute('d', /M /)
  await page.keyboard.press('Shift+c')
  await page.locator(`.version-card[data-version="${second}"] .tree-tile`).first().click({ position: { x: 8, y: 8 } })
  await expect(page.locator('.comparison-content')).toContainText('First branch')
  await expect(page.locator('.comparison-content')).toContainText('Second branch')
  await expect(page.locator('.comparison-content')).not.toContainText('These versions are structurally identical.')
  await expect(page.locator('.drawer-head .compare-summary')).toContainText('entries differ')
  await expect(page.locator('.drawer-head .difference-toggle')).toBeVisible()
  await expect(page.locator('.canvas-hotbar')).toHaveCount(0)
  const compareMargins = await page.locator('.comparison-overlay').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const actions = document.querySelector('.action-sidebar').getBoundingClientRect()
    return [bounds.left - sidebar.right, actions.left - bounds.right, bounds.top, innerHeight - bounds.bottom]
  })
  expect(compareMargins).toEqual([12, 12, 12, 12])
  expect((await state(page, room)).activeId).toBe(first)
  await page.getByRole('button', { name: 'Abort and close' }).click()

  await page.keyboard.press('Shift+m')
  await page.locator(`.version-card[data-version="${second}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Branch merge' })
  await expect(page.locator('.canvas-hotbar')).toHaveCount(0)
  const mergeMargins = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const actions = document.querySelector('.action-sidebar').getBoundingClientRect()
    return [bounds.left - sidebar.right, actions.left - bounds.right, bounds.top, innerHeight - bounds.bottom]
  })
  expect(mergeMargins).toEqual(compareMargins)
  const columnOffsets = await dialog.locator('.merge-list-scroll').evaluate((element) => {
    const positions = (selector) => [...element.querySelector(selector).children].map((cell) => cell.getBoundingClientRect().right)
    return [positions('.merge-list-head'), positions('.merge-view-row')]
  })
  for (let index = 0; index < 3; index++) expect(Math.abs(columnOffsets[0][index] - columnOffsets[1][index])).toBeLessThan(1)
  const sourceTile = dialog.locator('.merge-preview-label[aria-label="First branch"]').locator('..').locator('rect')
  const targetTile = dialog.locator('.merge-preview-label[aria-label="Base"]').locator('..').locator('rect')
  const normalFill = await sourceTile.evaluate((element) => getComputedStyle(element).fill)
  await sourceTile.hover()
  await expect.poll(() => sourceTile.evaluate((element) => getComputedStyle(element).fill)).not.toBe(normalFill)
  const sourceBounds = await sourceTile.boundingBox()
  const targetBounds = await targetTile.boundingBox()
  await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height / 2, { steps: 6 })
  await expect(dialog.locator('.dragged-overlay')).toHaveCount(1)
  await expect(targetTile).toHaveClass(/is-over/)
  await page.mouse.up()
  await expect(dialog.locator('.merge-preview-tile.depth-1')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Reset' }).click()
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
  expect(merge.parentId).toBe(second)
  expect(merge.lane).toBe(mergedState.versions.find((version) => version.id === second).lane)
  expect(mergedLanes).toHaveLength(lanes.length)
  await expect(page.locator(`#merge-connector-${merge.id}`)).toHaveAttribute('d', /M /)
  await expect(page.locator(`.version-card[data-version="${merge.id}"] .version-action-symbol`)).toHaveText('⋈')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await state(page, room)).versions.some((version) => version.id === merge.id)).toBe(false)
  await expect.poll(async () => (await state(page, room)).activeId).toBe(merge.parentId)
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await state(page, room)).versions.find((version) => version.id === merge.id)?.mergeSourceId).toBe(merge.mergeSourceId)
})

test('curved branch and merge connectors render above straight connectors and terminal arrows', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const make = (id, parentId, step, branch, extra = {}) => ({
    id, parentId, step, lane: 0, branch, change: 'Edit', data: [], createdAt: step, ...extra,
  })
  const versions = [
    make('v0', null, 0, 'ROOT'),
    make('target', 'v0', 1, 'B5'),
    make('source', 'v0', 1, 'B6'),
    make('merge', 'target', 2, 'B5', { mergeSourceId: 'source' }),
    make('fork', 'target', 2, 'B5.1'),
    make('chain', 'v0', 1, 'B3'),
    make('chain-next', 'chain', 2, 'B3'),
    make('straight-merge', 'chain-next', 3, 'B3', { mergeSourceId: 'chain' }),
  ]
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'merge', nextNode: 1, nextVersion: 10, nextLane: 1, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await page.keyboard.press('4')
  const merge = page.locator('#merge-connector-merge')
  await expect(merge).toHaveAttribute('d', / Q /)
  await expect(page.locator('#merge-connector-straight-merge')).not.toHaveAttribute('d', / Q /)
  await expect(page.locator('[data-version-connectors="fork"]')).toHaveAttribute('d', / Q /)
  await expect(page.locator('[data-version-tail="source"]')).toBeAttached()
  await expect.poll(() => page.evaluate(() => {
    const svg = document.querySelector('.connection-layer')
    const paths = [...svg.querySelectorAll(':scope > path')]
    const straight = paths.filter((path) => !path.getAttribute('d').includes(' Q '))
    const curved = paths.filter((path) => path.getAttribute('d').includes(' Q '))
    return Math.max(...straight.map((path) => paths.indexOf(path))) < Math.min(...curved.map((path) => paths.indexOf(path)))
  })).toBe(true)
  await expect.poll(() => page.evaluate(() => {
    const svg = document.querySelector('.connection-layer')
    const bend = svg.querySelector('#merge-connector-merge')
    const tail = svg.querySelector('[data-version-tail="source"]')
    const oldSvgPointerEvents = svg.style.pointerEvents
    const oldBendPointerEvents = bend.style.pointerEvents
    const oldTailPointerEvents = tail.style.pointerEvents
    try {
      svg.style.pointerEvents = 'auto'
      bend.style.pointerEvents = 'stroke'
      tail.style.pointerEvents = 'stroke'
      const start = bend.getPointAtLength(0)
      const matrix = bend.getScreenCTM()
      for (let distance = 1; distance < bend.getTotalLength(); distance += 1) {
        const point = bend.getPointAtLength(distance)
        if (Math.abs(point.y - start.y) < 1 || !tail.isPointInStroke(point)) continue
        const screen = point.matrixTransform(matrix)
        const hits = document.elementsFromPoint(screen.x, screen.y)
        if (hits.includes(bend) && hits.includes(tail)) return hits.indexOf(bend) < hits.indexOf(tail)
      }
      return false
    } finally {
      svg.style.pointerEvents = oldSvgPointerEvents
      bend.style.pointerEvents = oldBendPointerEvents
      tail.style.pointerEvents = oldTailPointerEvents
    }
  })).toBe(true)
})

test('a saved legacy merge continues its available parent lane after reload without renumbering', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const number = (step, subbranch, origin) => ({ step, branch: 1, subbranch, origin, owner: 'writer', scheme: 2 })
  const make = (id, parentId, step, branch, subbranch) => ({
    id, parentId, step, lane: 0, branch, change: 'Edit', data: [], createdAt: step,
    ...(id === 'v0' ? {} : { number: number(step, subbranch, id) }),
  })
  const versions = [
    make('v0', null, 0, 'ROOT', 0),
    ...Array.from({ length: 14 }, (_, index) => make(`stem-${index + 1}`, index ? `stem-${index}` : 'v0', index + 1, 'B1', 1)),
    make('target', 'stem-14', 15, 'B1.2', 5),
    make('other-parent', 'stem-14', 15, 'B1.2', 8),
    make('other', 'other-parent', 16, 'B1.2', 8),
    make('source', 'stem-14', 15, 'B1.2.1', 9),
    make('source-next', 'source', 16, 'B1.2.1', 9),
    { ...make('reserved', 'other-parent', 16, 'B2', 20), createdAt: 1 },
    { ...make('merge', 'target', 16, 'B1.2.M152', 20), mergeSourceId: 'source', numberSuffix: 1 },
  ]
  await page.addInitScript(({ room, versions }) => {
    const key = `canopy-room-data-v1-${encodeURIComponent(room)}`
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      versions, activeId: 'merge', nextNode: 1, nextVersion: 153, nextLane: 7, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  const check = async () => {
    const saved = await state(page, room)
    const target = saved.versions.find((item) => item.id === 'target')
    const merge = saved.versions.find((item) => item.id === 'merge')
    return { targetLane: target.lane, mergeLane: merge.lane, number: merge.number, suffix: merge.numberSuffix }
  }
  await expect.poll(async () => { const result = await check(); return result.mergeLane === result.targetLane }).toBe(true)
  expect((await check()).number).toEqual(number(16, 20, 'merge'))
  expect((await check()).suffix).toBe(1)
  await page.reload()
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  await expect.poll(async () => { const result = await check(); return result.mergeLane === result.targetLane }).toBe(true)
  expect((await check()).suffix).toBe(1)
})

test('large treemaps cull offscreen tiles while keeping selection and duplicate connectors working', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const children = Array.from({ length: 400 }, (_, index) => ({
    id: `child-${index}`, value: index === 0 || index === 399 ? 'Duplicate' : `Entry ${index}`, children: [],
  }))
  const versions = [
    { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 },
    { id: 'v1', parentId: 'v0', step: 1, lane: 0, branch: 'Branch 1', change: 'Edit', createdAt: 1,
      data: [{ id: 'parent', value: 'Parent', children }],
      positions: { parent: { x: 12 / 260, y: 12 / 220 } }, mapView: { zoom: 1, panX: 0, panY: 0, manual: true } },
  ]
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v1', nextNode: 402, nextVersion: 2, nextLane: 1, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await focusActive(page)
  const card = page.locator('.version-card.active')
  const tiles = card.locator('.tree-tile')
  await expect.poll(() => tiles.count()).toBeLessThan(20)
  await expect(card.locator('[data-node="child-0"]')).toBeVisible()
  await expect(card.locator('[data-node="child-399"]')).toHaveCount(0)
  await expect(card.locator('path[stroke="var(--theme-duplicate-connector)"]')).toHaveCount(1)
  await card.locator('[data-node="child-0"]').click()
  await expect(card.locator('[data-node="child-0"]')).toHaveClass(/is-selected/)
  const map = card.locator('.mini-map')
  const bounds = await map.boundingBox()
  await page.keyboard.down('Shift')
  for (let index = 0; index < 2; index++) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 - 550, bounds.y + bounds.height / 2, { steps: 5 })
    await page.mouse.up()
  }
  await page.keyboard.up('Shift')
  await expect(card.locator('[data-node="child-0"]')).toHaveCount(0)
  const visibleChildren = await card.locator('.tree-tile[data-node^="child-"]').evaluateAll((elements) => {
    const map = elements[0].closest('.mini-map').getBoundingClientRect()
    return elements.filter((element) => {
      const rect = element.getBoundingClientRect()
      return Math.min(rect.right, map.right) - Math.max(rect.left, map.left) > 20
        && Math.min(rect.bottom, map.bottom) - Math.max(rect.top, map.top) > 20
    }).map((element) => element.dataset.node)
  })
  expect(visibleChildren.length).toBeGreaterThanOrEqual(2)
  const [sourceId, targetId] = visibleChildren
  const sourceTile = card.locator(`[data-node="${sourceId}"]`)
  const targetTile = card.locator(`[data-node="${targetId}"]`)
  await sourceTile.click()
  await expect(sourceTile).toHaveClass(/is-selected/)
  const visibleCenter = (tile) => tile.evaluate((element) => {
    const tile = element.getBoundingClientRect()
    const map = element.closest('.mini-map').getBoundingClientRect()
    return { x: (Math.max(tile.left, map.left) + Math.min(tile.right, map.right)) / 2,
      y: (Math.max(tile.top, map.top) + Math.min(tile.bottom, map.bottom)) / 2 }
  })
  const source = await visibleCenter(sourceTile)
  const target = await visibleCenter(targetTile)
  await page.mouse.move(source.x, source.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  const dropTarget = card.locator('.tree-tile.is-over')
  await expect(dropTarget).toHaveCount(1)
  const actualTargetId = await dropTarget.getAttribute('data-node')
  await page.mouse.up()
  await expect.poll(async () => (await activeData(page, room))[0].children.find((node) => node.id === actualTargetId)
    ?.children.some((node) => node.id === sourceId)).toBe(true)
})

test('long version and copy connectors stay visible across offscreen endpoints and straight lanes are batched', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const entry = { id: 'n1', value: 'Shared', children: [] }
  const secondEntry = { id: 'n2', value: 'Second', children: [] }
  const versions = [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 }]
  for (let step = 1; step <= 30; step++) {
    versions.push({
      id: `v${step}`, parentId: step === 20 ? 'v1' : `v${step - 1}`,
      ...(step === 20 ? { mergeSourceId: 'v19' } : step === 21 ? { mergeSourceId: 'v1' } : {}),
      step, lane: 0, branch: 'Branch 1', change: 'Edit', data: [entry, secondEntry], createdAt: step,
    })
  }
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v10', nextNode: 3, nextVersion: 31, nextLane: 1,
      copyLinks: [
        { sourceVersionId: 'v1', sourceNodeId: 'n1', targetVersionId: 'v20', targetNodeId: 'n1' },
        { sourceVersionId: 'v1', sourceNodeId: 'n2', targetVersionId: 'v20', targetNodeId: 'n2' },
      ],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await focusActive(page)
  await expect(page.locator('.version-card[data-version="v1"]')).toHaveCount(0)
  await expect(page.locator('.version-card[data-version="v20"]')).toHaveCount(0)
  await expect(page.locator('.version-card[data-version="v21"]')).toHaveCount(0)
  await expect(page.locator('[data-version-connectors~="v20"]')).toHaveAttribute('d', /M .* H /)
  await expect(page.locator('#merge-connector-v21')).toHaveAttribute('d', /M .* H /)
  await expect(page.locator('.copy-link-hit')).toHaveCount(2)
  await expect(page.locator('.copy-link').first()).toHaveAttribute('d', /M .* Q /)
  await page.locator('.copy-link-hit').first().focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state(page, room)).activeId).toBe('v1')
  const pathBeforeZoom = await page.locator('.copy-link').first().getAttribute('d')
  const sourceMap = page.locator('.version-card.active .mini-map')
  await sourceMap.hover()
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, -180)
  await page.keyboard.up('Shift')
  await expect.poll(() => page.locator('.copy-link').first().getAttribute('d')).not.toBe(pathBeforeZoom)
  await page.keyboard.press('4')
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
  expect(grouped.color).toBe('var(--theme-branch-1)')
  expect(grouped.width).toBeGreaterThan(0)
  expect(grouped.opacity).toBe(0.76)
  await expect(page.locator('#merge-connector-v20')).toHaveAttribute('d', /M /)
})

test('dragging attaches a root, outside drops cancel, and shortcut detaches a child', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Source', 'Target'])
  await focusActive(page)
  await page.waitForTimeout(500)
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
  const transform = await page.locator('.version-card.active .mini-map svg > g').getAttribute('transform')
  await page.mouse.move(sourceBox.x + 12, sourceBox.y + 12)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await expect(target).toHaveClass(/is-over/)
  expect(await target.boundingBox()).toEqual(targetBox)
  expect(await page.locator('.version-card.active .mini-map svg > g').getAttribute('transform')).toBe(transform)
  await page.mouse.up()
  await expect.poll(async () => findNode(await activeData(page, room), 'Target')?.children.map((node) => node.value)).toEqual(['Source'])
  await focusActive(page)
  await expect(await activeTile(page, room, 'Source')).toHaveClass(/is-selected/)
  await page.keyboard.press('d')
  await expect.poll(async () => (await activeData(page, room)).map((node) => node.value).sort()).toEqual(['Source', 'Target'])
  expect(findNode(await activeData(page, room), 'Target').children).toHaveLength(0)
})

for (const steps of [1, 12]) {
  test(`dragging onto the deepest child works with a selected parent at ${steps === 1 ? 'high' : 'low'} pointer speed`, async ({ page }) => {
    const room = await openTreemapRoom(page, [
      { id: 'source', value: 'Source', children: [] },
      { id: 'parent', value: 'Parent', children: [
        { id: 'child', value: 'Child', children: [{ id: 'grandchild', value: 'Grandchild', children: [] }] },
      ] },
    ])
    const card = page.locator('.version-card.active')
    const source = card.locator('[data-node="source"]')
    const parent = card.locator('[data-node="parent"]')
    const child = card.locator('[data-node="child"]')
    const grandchild = card.locator('[data-node="grandchild"]')
    await parent.click({ position: { x: 12, y: 12 } })
    await expect(parent).toHaveClass(/is-selected/)
    const from = await source.boundingBox()
    const parentBox = await parent.boundingBox()
    const childBox = await child.boundingBox()
    const targetBox = await grandchild.boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(parentBox.x + 12, parentBox.y + 12, { steps })
    await expect(parent).toHaveClass(/is-over/)
    await page.mouse.move(childBox.x + 12, childBox.y + 12, { steps })
    await expect(child).toHaveClass(/is-over/)
    await expect(parent).not.toHaveClass(/is-over/)
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps })
    await expect(grandchild).toHaveClass(/is-over/)
    await expect(child).not.toHaveClass(/is-over/)
    await page.mouse.up()
    await expect.poll(async () => findNode(await activeData(page, room), 'Grandchild')?.children.map((node) => node.value)).toEqual(['Source'])
    expect(findNode(await activeData(page, room), 'Parent').children.map((node) => node.value)).toEqual(['Child'])
    expect(findNode(await activeData(page, room), 'Child').children.map((node) => node.value)).toEqual(['Grandchild'])
    const map = page.locator('.version-card.active .mini-map')
    for (const id of ['source', 'parent', 'child', 'grandchild']) {
      const bounds = await map.locator(`[data-node="${id}"]`).evaluate((element) => {
        const tile = element.getBoundingClientRect()
        const viewport = element.closest('.mini-map').getBoundingClientRect()
        return { left: tile.left - viewport.left, top: tile.top - viewport.top,
          right: viewport.right - tile.right, bottom: viewport.bottom - tile.bottom }
      })
      expect(Math.min(...Object.values(bounds))).toBeGreaterThan(-2)
    }
  })
}

test('detaching into nearby empty space finds a free position and an outside drop cancels', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'parent', value: 'Parent', children: [
      { id: 'a', value: 'a', children: [] }, { id: 'b', value: 'b', children: [] },
    ] },
  ])
  const card = page.locator('.version-card.active')
  const map = card.locator('.mini-map')
  const child = card.locator('[data-node="a"]')
  const before = await state(page, room)
  let from = await child.boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(10, 10, { steps: 1 })
  await page.mouse.up()
  expect((await state(page, room)).versions.length).toBe(before.versions.length)
  expect(findNode(await activeData(page, room), 'Parent').children.map((node) => node.value)).toEqual(['a', 'b'])
  const mapBox = await map.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)
  await page.mouse.wheel(0, 500)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(250)
  from = await child.boundingBox()
  const parent = await card.locator('[data-node="parent"]').boundingBox()
  const drop = { x: parent.x + parent.width + 3, y: from.y + from.height / 2 }
  expect(drop.x).toBeLessThan(mapBox.x + mapBox.width)
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.tree-tile'), drop)).toBe(false)
  const original = await state(page, room)
  const oldParentPosition = original.versions.find((version) => version.id === original.activeId).positions.parent
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(drop.x, drop.y, { steps: 1 })
  await page.mouse.up()
  await expect.poll(async () => (await activeData(page, room)).map((node) => node.value).sort()).toEqual(['Parent', 'a'])
  const saved = await state(page, room)
  const version = saved.versions.find((item) => item.id === saved.activeId)
  expect(version.positions.parent).toEqual(oldParentPosition)
  expect(findNode(version.data, 'Parent').children.map((node) => node.value)).toEqual(['b'])
  const visible = page.locator('.version-card.active .mini-map')
  for (const id of ['parent', 'a', 'b']) {
    const outside = await visible.locator(`[data-node="${id}"]`).evaluate((element) => {
      const tile = element.getBoundingClientRect()
      const map = element.closest('.mini-map').getBoundingClientRect()
      return Math.min(tile.left - map.left, tile.top - map.top, map.right - tile.right, map.bottom - tile.bottom)
    })
    expect(outside).toBeGreaterThan(-2)
  }
})

test('version view combines directional indicators after panning and removes them when fitted', async ({ page }) => {
  await openTreemapRoom(page, [
    { id: 'one', value: 'One', children: [] },
    { id: 'two', value: 'Two', children: [] },
    { id: 'three', value: 'Three', children: [] },
  ])
  const map = page.locator('.version-card.active .mini-map')
  await expect(map.locator('.map-direction-indicator')).toHaveCount(0)
  const bounds = await map.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 - 800, bounds.y + bounds.height / 2 - 800, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(map.getByRole('img', { name: 'Entries outside view: up-left' })).toHaveCount(1)
  const indicatorStyle = await map.locator('.map-direction-indicator').first().evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderWidth,
    arrows: element.querySelectorAll('svg path').length,
  }))
  expect(indicatorStyle).toEqual({ color: 'rgb(0, 0, 0)', background: 'rgba(0, 0, 0, 0)', border: '0px', arrows: 1 })
  const directions = await map.locator('.map-direction-indicator').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label')))
  expect(new Set(directions).size).toBe(directions.length)
  expect(directions.every((direction) => ['Entries outside view: up', 'Entries outside view: left', 'Entries outside view: up-left'].includes(direction))).toBe(true)
  await page.keyboard.press('Shift+a')
  await expect(map.locator('.map-direction-indicator')).toHaveCount(0)
})

test('partially visible entries do not produce out-of-view indicators', async ({ page }) => {
  await openTreemapRoom(page, [{ id: 'entry', value: 'Entry', children: [] }])
  const map = page.locator('.version-card.active .mini-map')
  const tile = map.locator('[data-node="entry"]')
  const bounds = await map.boundingBox()
  const entry = await tile.boundingBox()
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const pan = async (delta) => {
    await page.keyboard.down('Shift')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + delta, start.y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
  }
  await pan(bounds.x - entry.x - entry.width / 2)
  await expect.poll(async () => {
    const box = await tile.boundingBox()
    return box.x < bounds.x && box.x + box.width > bounds.x
  }).toBe(true)
  await expect(map.locator('.map-direction-indicator')).toHaveCount(0)
  await pan(-entry.width)
  await expect(map.getByRole('img', { name: 'Entries outside view: left' })).toHaveCount(1)
  await expect(map.locator('.map-direction-indicator')).toHaveCount(1)
})

test('treemap labels use uniform font sizes and parent labels stay on one line', async ({ page }) => {
  const parentName = 'A very long parent label that must be truncated because it is far longer than the available width of this treemap'
  await openTreemapRoom(page, [
    { id: 'parent', value: parentName, children: [
      { id: 'nested', value: 'Nested parent', children: [{ id: 'leaf1', value: 'Leaf one', children: [] }] },
      { id: 'leaf2', value: 'Leaf two', children: [] },
    ] },
  ])
  const card = page.locator('.version-card.active')
  const parent = card.locator(`.tile-label[aria-label="${parentName}"]`)
  await expect(parent).toHaveAttribute('aria-label', parentName)
  await expect(parent.locator('tspan')).toHaveCount(1)
  await expect(parent).toContainText('...')
  const font = async (label) => card.locator(`.tile-label[aria-label="${label}"]`).evaluate((element) => getComputedStyle(element).fontSize)
  expect(await font(parentName)).toBe(await font('Nested parent'))
  expect(await font('Leaf one')).toBe(await font('Leaf two'))
  expect(parseFloat(await font('Leaf one'))).toBeGreaterThan(parseFloat(await font(parentName)))
})

test('number shortcuts select the four camera presets directly', async ({ page }) => {
  await openRoom(page)
  for (let index = 0; index < 6; index++) await addEntries(page, [`Entry ${index}`])
  const world = page.locator('.graph-world')
  const readCamera = () => world.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { zoom: matrix.a, x: matrix.e, y: matrix.f }
  })
  const presets = []
  for (const name of ['Fit all versions, 4', 'Fit height', 'Focus neighborhood', 'Focus active version, 1']) {
    await page.getByRole('button', { name }).click()
    await page.waitForTimeout(500)
    presets.push(await readCamera())
  }
  async function expectPreset(index) {
    await page.waitForTimeout(500)
    const actual = await readCamera()
    expect(actual.zoom).toBeCloseTo(presets[index].zoom, 3)
    expect(actual.y).toBeCloseTo(presets[index].y, 0)
    if (index !== 1) expect(actual.x).toBeCloseTo(presets[index].x, 0)
  }
  await expect(page.getByRole('button', { name: 'Zoom in, plus' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Zoom out, minus' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Fit all versions, 4' }).click()
  await expectPreset(0)
  for (const [key, index] of [['3', 1], ['2', 2], ['1', 3], ['4', 0]]) {
    await page.keyboard.press(key)
    await expectPreset(index)
  }
  await page.keyboard.press('3')
  await expectPreset(1)
  await page.locator('.graph-canvas').hover({ position: { x: 30, y: 30 } })
  await page.mouse.wheel(0, -80)
  await page.keyboard.press('2')
  await expectPreset(2)
  await page.getByRole('button', { name: 'Fit all versions, 4' }).click()
  await page.keyboard.press('1')
  await expectPreset(3)
})

test('action sidebar expands without changing data and keeps the canvas and cards proportional', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Sidebar entry'])
  const before = await state(page, room)
  const sidebar = page.getByLabel('Actions and shortcuts')
  const canvas = page.locator('.graph-canvas')
  const collapsedWidth = (await canvas.boundingBox()).width
  await expect(sidebar).toHaveClass(/collapsed/)
  await page.getByRole('button', { name: 'Expand action sidebar' }).click()
  await expect(sidebar.getByRole('heading', { name: 'Local version actions' })).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: 'Global version actions' })).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: 'Local viewport actions' })).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: 'Global viewport actions' })).toBeVisible()
  await expect(sidebar.getByRole('heading', { name: 'Communication actions' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Compare versions, Shift+C' })).toHaveCount(1)
  expect((await canvas.boundingBox()).width).toBeLessThan(collapsedWidth - 200)
  await expect.poll(async () => page.locator('.version-card.active').evaluate((card) => {
    const canvas = card.closest('.graph-canvas').getBoundingClientRect()
    const bounds = card.getBoundingClientRect()
    return Math.abs(bounds.width / bounds.height - canvas.width / canvas.height)
  })).toBeLessThan(0.02)
  await expect.poll(async () => page.locator('.version-card.active .treemap-svg').evaluate((svg) => {
    const matrix = svg.getScreenCTM()
    return Math.abs(Math.hypot(matrix.a, matrix.b) - Math.hypot(matrix.c, matrix.d))
  })).toBeLessThan(0.01)
  const icons = await sidebar.locator('.action-sidebar-item svg').evaluateAll((elements) =>
    elements.map((element) => element.innerHTML))
  expect(new Set(icons).size).toBe(icons.length)
  await page.getByRole('button', { name: 'Collapse action sidebar' }).click()
  await expect.poll(async () => (await canvas.boundingBox()).width).toBeCloseTo(collapsedWidth, 0)
  expect((await state(page, room)).versions.map((version) => version.data)).toEqual(before.versions.map((version) => version.data))
})

test('expanded sidebar exposes additional actions and search while collapsed shortcuts still work', async ({ page }) => {
  await openRoom(page)
  const sidebar = page.getByLabel('Actions and shortcuts')
  const expandedOnly = ['Copy entry', 'Cut entry', 'Paste entry', 'Box select', 'Zoom version', 'Pan version',
    'Zoom graph', 'Pan graph', 'Previous version', 'Next version', 'Timeline above', 'Timeline below',
    'First timeline', 'Last timeline', 'First version in timeline', 'Last version in timeline',
    'Undo', 'Redo', 'Select entry', 'Select multiple entries', 'Activate version', 'Focus version']
  for (const name of expandedOnly) await expect(sidebar.locator(`[title^="${name} ·"]`)).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: 'Search versions, Ctrl or Command+F' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Zoom in preset, +' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Zoom out preset, -' })).toBeVisible()
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('dialog', { name: 'Search versions' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Expand action sidebar' }).click()
  await expect(sidebar.getByRole('button', { name: 'Zoom in preset, +' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Zoom out preset, -' })).toBeVisible()
  await expect(sidebar.locator('section').first()).toHaveAttribute('aria-label', 'Communication actions')
  for (const name of expandedOnly) await expect(sidebar.locator(`[title^="${name} ·"]`)).toHaveCount(1)
  for (const [name, gesture, group] of [
    ['Select entry', 'Click entry', 'Local version actions'],
    ['Select multiple entries', 'Shift + click entry', 'Local version actions'],
    ['Activate version', 'Click version', 'Global version actions'],
    ['Focus version', 'Double-click version', 'Global viewport actions'],
  ]) {
    const item = sidebar.getByRole('region', { name: group }).locator(`[title="${name} · ${gesture}"]`)
    await expect(item.locator('span')).toHaveText(name)
    await expect(item.locator('kbd')).toHaveText(gesture)
  }
  await page.getByRole('button', { name: 'Collapse action sidebar' }).click()
  for (const name of expandedOnly) await expect(sidebar.locator(`[title^="${name} ·"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand action sidebar' }).click()
  await sidebar.getByRole('button', { name: 'Search versions, Ctrl or Command+F' }).click()
  await expect(page.getByRole('dialog', { name: 'Search versions' })).toBeVisible()
})

test('collapsed sidebar retains room, user and interaction navigation', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Compact log entry'])
  const version = (await state(page, room)).activeId
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  const sidebar = page.locator('.sidebar')
  await expect(sidebar.getByRole('button', { name: 'Change Room', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /Focus .+ \(you\)/ })).toBeVisible()
  const interaction = sidebar.locator('.compact-interaction').first()
  await expect(interaction).toBeEnabled()
  const savedLog = await page.evaluate((name) =>
    JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`)), room)
  expect(await interaction.evaluate((element) => getComputedStyle(element).color)).toBe(
    await page.evaluate((color) => {
      const element = document.createElement('span')
      element.style.color = color
      document.body.appendChild(element)
      const value = getComputedStyle(element).color
      element.remove()
      return value
    }, savedLog.at(-1).actorColor))
  await interaction.click()
  await expectCentered(page, version)
  await sidebar.getByRole('button', { name: 'Change Room', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /room/i })).toBeVisible()
})

test('branching setting prevents edits from non-tip versions and persists', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Base'])
  const base = (await state(page, room)).activeId
  await addEntries(page, ['Tip'])
  const before = (await state(page, room)).versions.length
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Branching on' }).click()
  await expect.poll(async () => (await state(page, room)).branching?.enabled).toBe(false)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  await page.keyboard.press('n')
  await page.getByPlaceholder('Entry name').fill('Blocked')
  await page.getByRole('button', { name: 'Add 1 entry' }).click()
  await expect(page.getByText('Cannot create a version here while branching is disabled')).toBeVisible()
  await expect(page.getByPlaceholder('Entry name')).toHaveValue('Blocked')
  expect((await state(page, room)).versions).toHaveLength(before)
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Branching off' })).toBeVisible()
})

test('branching setting synchronizes between room participants', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected')
    await host.getByRole('button', { name: 'Settings' }).click()
    await host.getByRole('button', { name: 'Branching on' }).click()
    await expect.poll(async () => (await state(guest, room)).branching?.enabled).toBe(false)
    await guest.getByRole('button', { name: 'Settings' }).click()
    await guest.getByRole('button', { name: 'Branching off' }).click()
    await expect.poll(async () => (await state(host, room)).branching?.enabled).toBe(true)
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})

test('a branch tip with only fork children can still be continued when branching is off', async ({ page }) => {
  const room = `test-${randomUUID()}`
  await page.addInitScript((name) => {
    const number = (step, subbranch, origin) => ({ step, branch: 1, subbranch, origin, owner: 'fixture', scheme: 2 })
    const versions = [
      { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Root', data: [], createdAt: 0 },
      { id: 'base', parentId: 'v0', step: 1, lane: 0, branch: 'B1', change: 'Base',
        data: [{ id: 'base-node', value: 'Base', children: [] }], createdAt: 1, number: number(1, 1, 'base') },
      { id: 'fork', parentId: 'base', step: 2, lane: 1, branch: 'B1.1', change: 'Fork',
        data: [{ id: 'base-node', value: 'Base', children: [] }, { id: 'fork-node', value: 'Fork', children: [] }],
        createdAt: 2, number: number(2, 2, 'fork') },
    ]
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(name)}`, JSON.stringify({
      versions, activeId: 'base', nextNode: 100, nextVersion: 3, nextLane: 2, copyLinks: [],
      branching: { enabled: false, revision: { clock: 1, actor: 'fixture' } },
    }))
  }, room)
  await openRoom(page, room)
  await addEntries(page, ['Continuation'])
  const saved = await state(page, room)
  const continuation = saved.versions.find((version) => version.id === saved.activeId)
  expect(continuation.parentId).toBe('base')
  expect(continuation.branch).toBe('B1')
})

test('sounds use the shared volume and branch sounds replace entry sounds', async ({ page }) => {
  await page.addInitScript(() => {
    window.recordedSounds = []
    window.Audio = class {
      constructor(url) { this.url = url; this.volume = 1 }
      play() { window.recordedSounds.push({ url: this.url, volume: this.volume }); return Promise.resolve() }
    }
  })
  const room = await openRoom(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('slider', { name: 'Volume' }).fill('0.4')
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const sounds = await page.evaluate(() => window.recordedSounds)
  expect(sounds.map((sound) => sound.url.split('/').pop())).toEqual(['bing-298405.mp3', 'happy-pop-2-185287.mp3', 'bing-298405.mp3'])
  expect(sounds.map((sound) => sound.volume)).toEqual([0.4, 0.4, 0.4])
  await page.keyboard.press('4')
  await page.keyboard.press('Shift+c')
  await page.locator(`.version-card[data-version="${first}"]`).click()
  await page.getByRole('img', { name: 'Source treemap comparison' }).locator('.comparison-tile').first().click()
  expect((await page.evaluate(() => window.recordedSounds)).map((sound) => sound.url.split('/').pop()))
    .toEqual(['bing-298405.mp3', 'happy-pop-2-185287.mp3', 'bing-298405.mp3', 'click-with-big-reverb-28848-01.mp3'])
  await page.getByRole('button', { name: 'Abort and close' }).click()
  await focusActive(page)
  await page.getByRole('button', { name: 'Mute sound' }).click()
  await addEntries(page, ['Silent'])
  expect((await page.evaluate(() => window.recordedSounds)).map((sound) => sound.url.split('/').pop()))
    .toEqual(['bing-298405.mp3', 'happy-pop-2-185287.mp3', 'bing-298405.mp3', 'click-with-big-reverb-28848-01.mp3', 'ui-sound-off-270300.mp3'])
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await expect.poll(async () => (await page.evaluate(() => window.recordedSounds)).at(-1).url)
    .toContain('ui-sound-on-270295.mp3')
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByRole('button', { name: 'Join room' }).click()
  await expect(page.getByText('Enter a room name of 1–80 characters.')).toBeVisible()
  await expect.poll(async () => (await page.evaluate(() => window.recordedSounds)).at(-1).url).toContain('obacht.mp3')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('0.4')
})

test('settings, version navigation and interaction log play their assigned sounds', async ({ page }) => {
  await page.addInitScript(() => {
    window.recordedSounds = []
    window.Audio = class {
      constructor(url) { this.url = url; this.volume = 1 }
      play() { window.recordedSounds.push(this.url.split('/').pop()); return Promise.resolve() }
    }
  })
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const second = (await state(page, room)).activeId
  const takeSounds = () => page.evaluate(() => window.recordedSounds.splice(0))
  await takeSounds()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  expect(await takeSounds()).toEqual(['tick-single.mp3'])
  await page.keyboard.press('4')
  await page.locator(`.version-card[data-version="${second}"] .version-card-head`).dblclick()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(second)
  expect(await takeSounds()).toEqual(['intro-sound-1-269293.mp3'])
  await page.keyboard.press('4')
  await page.locator(`.version-card[data-version="${first}"] .version-card-head`).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  expect(await takeSounds()).toEqual(['tick-single.mp3'])
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await page.getByRole('button', { name: 'Light mode' }).click()
  await page.getByRole('button', { name: 'Branching on' }).click()
  await page.getByRole('button', { name: 'Branching off' }).click()
  expect(await takeSounds()).toEqual(['ui-sound-off-270300.mp3', 'ui-sound-on-270295.mp3',
    'ui-sound-off-270300.mp3', 'ui-sound-on-270295.mp3'])
  await page.locator('.collaborator-list .collaborator').first().click()
  expect(await takeSounds()).toEqual(['intro-sound-1-269293.mp3'])
  await page.locator('.interaction-reference').first().click()
  expect(await takeSounds()).toEqual(['tick-single.mp3'])
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.locator('.compact-user').first().click()
  await page.locator('.compact-interaction').first().click()
  expect(await takeSounds()).toEqual(['intro-sound-1-269293.mp3', 'tick-single.mp3'])
  await page.getByRole('button', { name: /Go to end of lane/ }).first().click()
  expect(await takeSounds()).toEqual(['tick-single.mp3'])
})

test('merge choices, branch deletion and changing rooms play their assigned sounds', async ({ page }) => {
  await page.addInitScript(() => {
    window.recordedSounds = []
    window.Audio = class {
      constructor(url) { this.url = url; this.volume = 1 }
      play() { window.recordedSounds.push(this.url.split('/').pop()); return Promise.resolve() }
    }
  })
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const second = (await state(page, room)).activeId
  const takeSounds = () => page.evaluate(() => window.recordedSounds.splice(0))
  await takeSounds()
  await page.keyboard.press('4')
  await page.keyboard.press('Shift+m')
  await page.locator(`.version-card[data-version="${first}"]`).click()
  const row = page.locator('.merge-view-row').first()
  await row.getByRole('button', { name: 'Omit' }).click()
  await row.getByRole('button', { name: 'Pick' }).click()
  expect(await takeSounds()).toEqual(['click-with-big-reverb-28848-01.mp3', 'bing-298405.mp3'])
  await page.getByRole('button', { name: 'Abort and close' }).click()
  await page.keyboard.press('1')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator(`.version-card[data-version="${second}"] .card-menu`).click()
  await page.getByRole('button', { name: 'Delete version and descendants' }).click()
  expect(await takeSounds()).toEqual(['droplets-in-a-cave-6785-01.mp3'])
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByPlaceholder('Room name', { exact: true }).fill(`new-${randomUUID()}`)
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect.poll(async () => (await takeSounds())).toEqual(['intro-sound-2-269294.mp3'])
})

test('opening an invite for an existing room plays the joining sound', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const room = await openRoom(host)
    await guestContext.addInitScript(() => {
      window.recordedSounds = []
      window.Audio = class {
        constructor(url) { this.url = url; this.volume = 1 }
        play() { window.recordedSounds.push(this.url.split('/').pop()); return Promise.resolve() }
      }
    })
    const guest = await guestContext.newPage()
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected')
    await expect.poll(() => guest.evaluate(() => window.recordedSounds)).toEqual(['intro-sound-2-269294.mp3'])
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})

test('comparison treemaps zoom, pan and reset without changing source versions', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const before = (await state(page, room)).versions
  await page.keyboard.press('4')
  await page.keyboard.press('Shift+c')
  await page.locator(`.version-card[data-version="${first}"]`).click()
  const svg = page.getByRole('img', { name: 'Source treemap comparison' })
  await expect(svg).toBeVisible()
  const initial = await svg.getAttribute('viewBox')
  await svg.hover()
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, -250)
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(initial)
  const zoomed = await svg.getAttribute('viewBox')
  const box = await svg.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20)
  await page.mouse.up()
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(zoomed)
  await page.keyboard.press('a')
  await page.keyboard.up('Shift')
  await expect(svg).toHaveAttribute('viewBox', initial)
  expect((await state(page, room)).versions).toEqual(before)
})

test('merge treemap supports shift zoom, pan and reset without editing the preview', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  await page.keyboard.press('4')
  await page.keyboard.press('Shift+m')
  await page.locator(`.version-card[data-version="${first}"]`).click()
  const svg = page.getByRole('img', { name: 'Interactive resulting hierarchy preview' })
  await expect(svg).toBeVisible()
  const initial = await svg.getAttribute('viewBox')
  const tileCount = await svg.locator('.merge-preview-tile').count()
  await svg.hover()
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, -250)
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(initial)
  const zoomed = await svg.getAttribute('viewBox')
  const box = await svg.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20)
  await page.mouse.up()
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(zoomed)
  await page.keyboard.press('a')
  await page.keyboard.up('Shift')
  await expect(svg).toHaveAttribute('viewBox', initial)
  await expect(svg.locator('.merge-preview-tile')).toHaveCount(tileCount)
})

test('plus and minus and collapsed controls step through camera presets', async ({ page }) => {
  await openRoom(page)
  await addEntries(page, ['One'])
  await addEntries(page, ['Two'])
  const scale = () => page.locator('.graph-world').evaluate((element) =>
    Number(element.style.transform.match(/scale\(([^)]+)\)/)[1]))
  const presets = []
  for (const key of ['4', '3', '2', '1']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(600)
    presets.push(await scale())
  }
  await page.keyboard.press('4')
  await page.waitForTimeout(600)
  await page.keyboard.press('+')
  await page.waitForTimeout(600)
  expect(await scale()).toBeCloseTo(presets[1], 2)
  await page.getByRole('button', { name: 'Zoom in preset, +' }).click()
  await page.waitForTimeout(600)
  expect(await scale()).toBeCloseTo(presets[2], 2)
  await page.keyboard.press('+')
  await page.waitForTimeout(600)
  expect(await scale()).toBeCloseTo(presets[3], 2)
  await page.getByRole('button', { name: 'Zoom out preset, -' }).click()
  await page.waitForTimeout(600)
  expect(await scale()).toBeCloseTo(presets[2], 2)
  await page.keyboard.press('-')
  await page.waitForTimeout(600)
  expect(await scale()).toBeCloseTo(presets[1], 2)
})

test('undo and redo operate on one version, restore copy links and clear redo after a new version', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Base'])
  const base = (await state(page, room)).activeId
  await (await activeTile(page, room, 'Base')).click()
  await expect(await activeTile(page, room, 'Base')).toHaveClass(/is-selected/)
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await state(page, room)).copyLinks.length).toBe(1)
  const before = await state(page, room)
  const copied = before.activeId
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  expect((await state(page, room)).versions.some((version) => version.id === copied)).toBe(false)
  expect((await state(page, room)).copyLinks).toEqual([])
  await page.keyboard.press('Control+z')
  expect((await state(page, room)).versions.map((version) => version.id)).toContain(base)
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(copied)
  expect((await state(page, room)).copyLinks).toEqual(before.copyLinks)
  expect((await state(page, room)).versions.find((version) => version.id === copied).data)
    .toEqual(before.versions.find((version) => version.id === copied).data)
  await page.keyboard.press('Control+y')
  expect((await state(page, room)).versions.filter((version) => version.id === copied)).toHaveLength(1)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  await addEntries(page, ['New branch'])
  const afterNew = await state(page, room)
  await page.keyboard.press('Control+y')
  expect((await state(page, room)).versions.map((version) => version.id)).toEqual(afterNew.versions.map((version) => version.id))
  await page.getByRole('button', { name: 'Expand action sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Redo, Ctrl or Command+Y' })).toBeDisabled()
  await page.getByRole('button', { name: 'Undo, Ctrl or Command+Z' }).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(base)
  await page.getByRole('button', { name: 'Redo, Ctrl or Command+Y' }).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(afterNew.activeId)
})

test('redo does not carry across rooms', async ({ page }) => {
  const first = await openRoom(page)
  await addEntries(page, ['First room'])
  const firstVersion = (await state(page, first)).activeId
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await state(page, first)).activeId).toBe('v0')
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByLabel('Create a new empty room').fill('Undo second room')
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page.getByTitle('Undo second room')).toBeVisible()
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByRole('button', { name: first, exact: true }).click()
  await expect(page.locator('.version-card.active')).toHaveAttribute('data-version', 'v0')
  await page.keyboard.press('Control+y')
  expect((await state(page, first)).versions.some((version) => version.id === firstVersion)).toBe(false)
})

test('undo and redo synchronize versions and copy connectors with peers', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()))
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await addEntries(host, ['Shared'])
    const parent = (await state(host, room)).activeId
    await (await activeTile(host, room, 'Shared')).click()
    await expect(await activeTile(host, room, 'Shared')).toHaveClass(/is-selected/)
    await host.keyboard.press('Control+c')
    await host.keyboard.press('Control+v')
    await expect.poll(async () => (await state(guest, room)).copyLinks.length).toBe(1)
    const target = (await state(host, room)).activeId
    await host.keyboard.press('Control+z')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(parent)
    await expect.poll(async () => (await state(guest, room)).copyLinks.length).toBe(0)
    expect((await state(guest, room)).versions.some((version) => version.id === target)).toBe(false)
    await host.keyboard.press('Control+y')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(target)
    await expect.poll(async () => (await state(guest, room)).copyLinks.length).toBe(1)
    await host.keyboard.press('Control+z')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(parent)
    await addEntries(guest, ['Peer edit'])
    await expect.poll(async () => (await state(host, room)).versions.some((version) => !!findNode(version.data, 'Peer edit'))).toBe(true)
    await host.keyboard.press('Control+y')
    expect((await state(host, room)).versions.some((version) => version.id === target)).toBe(false)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('local editing shortcuts and version merge use their assigned scopes', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First', 'Second'])
  await focusActive(page)
  await (await activeTile(page, room, 'First')).click()
  await expect(await activeTile(page, room, 'First')).toHaveClass(/is-selected/)
  await page.keyboard.press('e')
  await expect(page.getByLabel('New value')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('s')
  await expect(page.locator('.operation-editor')).toContainText('SPLIT ENTRY')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await (await activeTile(page, room, 'Second')).click({ modifiers: ['Shift'] })
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await page.keyboard.press('m')
  await expect(page.locator('.operation-editor')).toContainText('MERGE ENTRIES')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('Shift+m')
  await expect(page.locator('.compare-drawer')).toContainText('Choose source')
  await page.keyboard.press('Escape')
  await page.keyboard.press('c')
  await expect(page.locator('.compare-drawer')).toHaveCount(0)
  await page.keyboard.press('Shift+c')
  await expect(page.locator('.compare-drawer')).toContainText('Choose two versions')
})

test('timeline boundary shortcuts navigate to the requested versions', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Base'])
  await addEntries(page, ['Next'])
  await addEntries(page, ['Last'])
  await page.keyboard.press('ArrowLeft')
  await addEntries(page, ['Branch'])
  const saved = await state(page, room)
  const versions = saved.versions.filter((version) => version.id !== 'v0')
  const active = versions.find((version) => version.id === saved.activeId)
  const currentLane = versions.filter((version) => version.lane === active.lane).sort((a, b) => a.step - b.step)
  await page.keyboard.press('Home')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(currentLane[0].id)
  await page.keyboard.press('End')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(currentLane.at(-1).id)
  await page.keyboard.press('PageUp')
  await expect.poll(async () => {
    const current = await state(page, room)
    return current.versions.find((version) => version.id === current.activeId).lane
  }).toBe(Math.min(...versions.map((version) => version.lane)))
  await page.keyboard.press('PageDown')
  await expect.poll(async () => {
    const current = await state(page, room)
    return current.versions.find((version) => version.id === current.activeId).lane
  }).toBe(Math.max(...versions.map((version) => version.lane)))
})

test('fit, focus, zoom, panning and keyboard navigation change the viewport and LOD', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 6; index++) await addEntries(page, [`Entry ${index}`])
  const lastId = (await state(page, room)).activeId
  await page.keyboard.press('4')
  await expect(page.locator('.version-card.active .overview-map')).toBeVisible()
  await page.locator('.version-card.active .overview-map').dblclick()
  await expect(page.locator('.version-card.active .mini-map')).toBeVisible()
  await page.keyboard.press('4')
  await expect(page.locator('.version-card.active .overview-map')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add child, A' })).toBeDisabled()
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
  await page.keyboard.press('1')
  await expect(page.locator('.version-card.active .mini-map')).toBeVisible()
  await expect.poll(() => world.getAttribute('style')).not.toBe(panned)
  const focused = await world.getAttribute('style')
  await page.keyboard.press('2')
  await expect.poll(() => world.getAttribute('style')).not.toBe(focused)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).not.toBe(lastId)
})

test('regular wheel zooms the graph while shift wheel zooms the version map', async ({ page }) => {
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
  await expect.poll(() => world.getAttribute('style')).not.toBe(graphBefore)
  expect(await content.getAttribute('transform')).toBe(mapBefore)
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
  await page.keyboard.press('2')
  await page.waitForTimeout(500)
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
  await page.keyboard.press('4')
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
  await page.keyboard.press('4')
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
  await page.keyboard.press('4')
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
  await page.keyboard.press('4')
  await page.waitForTimeout(500)
  await page.locator(`.version-card[data-version="${first}"] .version-card-head`).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  await page.keyboard.press('Shift+c')
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
  await page.keyboard.press('n')
  const input = page.getByPlaceholder('Entry name').first()
  await expect(input).toBeFocused()
  await input.fill('Editing text')
  await page.keyboard.press('Control+a')
  expect(await input.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('Editing text')
  const prevented = await input.evaluate((element) => !element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'n', ctrlKey: true, bubbles: true, cancelable: true,
  })))
  expect(prevented).toBe(false)
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('n')
  await expect(input).toHaveValue('Editing text')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await addEntries(page, ['First'])
  const active = (await state(page, room)).activeId
  await page.keyboard.press('4')
  await page.waitForTimeout(500)
  await page.keyboard.press('1')
  await expectCentered(page, active)
})

test('lane buttons stay attached to the viewport and navigate without changing the active version', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 4; index++) await addEntries(page, [`Lane ${index}`])
  const saved = await state(page, room)
  const laneVersions = saved.versions.filter((item) => item.id !== 'v0' && item.lane === 0).sort((a, b) => a.step - b.step)
  const active = saved.activeId
  await page.keyboard.press('4')
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
  await page.keyboard.press('3')
  await expect.poll(async () => (await left.boundingBox()).height).toBeGreaterThan(before.height)
  const after = await left.boundingBox()
  expect(after.width).toBeCloseTo(before.width, 1)
  expect(after.height).toBeGreaterThan(before.height)
})

test('active version remains outlined and its lane buttons are wider when zoomed out', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const versions = [{ id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Empty structure', data: [], createdAt: 0 }]
  for (let lane = 0; lane < 24; lane++) versions.push({
    id: `v${lane + 1}`, parentId: 'v0', step: 1, lane, branch: `B${lane + 1}`, change: `Branch ${lane}`, data: [], createdAt: lane + 1,
  })
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'v10', nextNode: 1, nextVersion: 25, nextLane: 24, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await expect(page.getByRole('button', { name: 'Open tutorial' })).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.keyboard.press('4')
  const card = page.locator('.version-card.active')
  await expect.poll(async () => card.evaluate((element) => {
    const zoom = new DOMMatrix(getComputedStyle(element.closest('.graph-world')).transform).a
    return zoom
  })).toBeLessThan(0.35)
  await expect.poll(async () => card.evaluate((element) => {
    const zoom = new DOMMatrix(getComputedStyle(element.closest('.graph-world')).transform).a
    return parseFloat(getComputedStyle(element.querySelector('.version-user-outline')).borderWidth) * zoom
  })).toBeGreaterThan(1.7)
  const saved = await state(page, room)
  const lane = saved.versions.find((item) => item.id === saved.activeId).lane
  await expect(page.locator('.lane-navigation.active-lane')).toHaveCount(2)
  await expect(page.locator(`.lane-navigation.active-lane[data-lane="${lane}"]`)).toHaveCount(2)
  const other = saved.versions.find((item) => item.id !== 'v0' && item.lane !== lane)
  async function checkWidths(activeLane, inactiveLane) {
    for (const side of ['left', 'right']) {
      const activeButton = page.locator(`.lane-navigation-${side}[data-lane="${activeLane}"]`)
      const otherButton = page.locator(`.lane-navigation-${side}[data-lane="${inactiveLane}"]`)
      await expect(activeButton).toHaveCSS('width', '42px')
      await expect(otherButton).toHaveCSS('width', '28px')
      await expect(activeButton).toHaveCSS('box-shadow', 'none')
      const activeBounds = await activeButton.boundingBox()
      const canvas = await page.locator('.graph-canvas').boundingBox()
      expect(side === 'left' ? activeBounds.x - canvas.x : activeBounds.x + activeBounds.width - canvas.x - canvas.width).toBeCloseTo(0, 1)
    }
  }
  await checkWidths(lane, other.lane)
  await page.locator(`.version-card[data-version="${other.id}"]`).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(other.id)
  await expect(page.locator(`.lane-navigation.active-lane[data-lane="${other.lane}"]`)).toHaveCount(2)
  await expect(page.locator(`.lane-navigation.active-lane[data-lane="${lane}"]`)).toHaveCount(0)
  await checkWidths(other.lane, lane)
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
  await page.keyboard.press('4')
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
  const label = root.locator('.root-overview-label')
  await expect(root.locator('.overview-action-detail')).toHaveText('Root: Empty')
  await expect(root.locator('.overview-stats b')).toHaveText(['0', '0'])
  await expect(page.locator('.active-version-card')).toContainText('Root: Empty')
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
  await page.getByRole('button', { name: 'Focus active version, 1' }).click()
  await page.waitForTimeout(500)
  const point = await emptyMapPoint(root.locator('.overview-map'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + 130, { steps: 5 })
  await page.mouse.up()
  await checkRoot()
  await page.keyboard.press('1')
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
  await page.keyboard.press('4')
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
  await page.keyboard.press('4')
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
      const sample = document.createElement('span')
      sample.style.color = card.style.getPropertyValue('--branch-color')
      card.appendChild(sample)
      const laneColor = getComputedStyle(sample).color
      sample.remove()
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
        canvasLeft: canvas.left, canvasRight: canvas.right, expectedTop: Math.max(canvas.top, lane.top),
        expectedBottom: Math.min(canvas.bottom, lane.bottom),
        partial: lane.top < canvas.top || lane.bottom > canvas.bottom,
        side: element.classList.contains('lane-navigation-left') ? 'left' : 'right',
        color: getComputedStyle(element).backgroundColor,
        laneColor,
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

test('long unbroken labels truncate and expose their complete text on hover', async ({ page }) => {
  const room = await openRoom(page)
  const label = 'Averylongunbrokenentrynamewhichmustnotwrapintoseparatefragments'
  await addEntries(page, [label])
  await focusActive(page)
  const tile = await activeTile(page, room, label)
  const text = page.locator('.version-card.active .tile-label')
  await expect(text).toHaveAttribute('aria-label', label)
  await expect(text.locator('tspan')).toHaveCount(1)
  await expect(text).toContainText('...')
  await tile.hover()
  await expect(page.getByRole('tooltip')).toContainText(label)
  expect(await text.evaluate((element) => getComputedStyle(element).fontFamily)).not.toMatch(/mono/i)
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

test('room joining accepts invite URLs and names and rejects invalid input', async ({ page }) => {
  await openRoom(page)
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByRole('button', { name: 'Join room' }).click()
  await expect(page.getByRole('alert')).toContainText('room name')
  await page.getByLabel('Join a room').fill('https://example.test/no-room')
  await page.getByRole('button', { name: 'Join room' }).click()
  await expect(page.getByRole('alert')).toContainText('room name')
  const first = `joined-${randomUUID()}`
  await page.getByLabel('Join a room').fill(`http://127.0.0.1:5173/?room=${encodeURIComponent(first)}`)
  await page.getByRole('button', { name: 'Join room' }).click()
  await expect(page.getByTitle(first)).toBeVisible()
  const second = `joined-${randomUUID()}`
  await page.getByRole('button', { name: 'Change Room' }).click()
  await page.getByLabel('Join a room').fill(second)
  await page.getByRole('button', { name: 'Join room' }).click()
  await expect(page.getByTitle(second)).toBeVisible()
})

test('bulk titles are concise and entry descriptions appear promptly', async ({ page }) => {
  const room = await openRoom(page)
  await page.getByRole('button', { name: 'New free entry, N' }).click()
  await page.getByPlaceholder('Entry name').first().fill('First')
  await page.getByPlaceholder('Optional description').first().fill('A helpful description')
  await page.getByRole('button', { name: 'Add another entry' }).click()
  await page.getByPlaceholder('Entry name').nth(1).fill('Second')
  await page.getByRole('button', { name: 'Add 2 entries' }).click()
  await expect.poll(async () => (await state(page, room)).versions.at(-1).change).toBe('Created 2 items')
  await focusActive(page)
  await (await activeTile(page, room, 'First')).hover()
  await expect(page.locator('.entry-tooltip')).toContainText('A helpful description', { timeout: 1500 })
  await page.keyboard.press('Control+a')
  await page.locator('.version-card.active .tree-tile').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete selected entries' }).click()
  await page.getByRole('button', { name: 'Delete entries', exact: true }).click()
  await expect.poll(async () => (await state(page, room)).versions.at(-1).change).toBe('Deleted 2 items')
})

test('pruning a section moves local and remote active versions to its surviving parent', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()))
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await addEntries(host, ['Base'])
    const base = (await state(host, room)).activeId
    await addEntries(host, ['Branch'])
    const branch = (await state(host, room)).activeId
    await addEntries(host, ['Nested'])
    const nested = (await state(host, room)).activeId
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(nested)
    await host.keyboard.press('4')
    host.once('dialog', (dialog) => dialog.accept())
    await host.locator(`.version-card[data-version="${branch}"]`).click({ button: 'right' })
    await host.getByRole('button', { name: 'Delete version and descendants' }).click()
    await expect.poll(async () => (await state(host, room)).activeId).toBe(base)
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(base)
    host.once('dialog', (dialog) => dialog.accept())
    await host.locator(`.version-card[data-version="${base}"] .version-header-id`).click({ button: 'right' })
    await host.getByRole('button', { name: 'Delete version and descendants' }).click()
    await expect.poll(async () => (await state(host, room)).activeId).toBe('v0')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe('v0')
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
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
    await host.keyboard.press('4')
    await guest.keyboard.press('4')
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

test('simultaneous edits to one version converge and persist', async ({ browser }) => {
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
    const id = (await state(host, room)).activeId
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(id)
    for (const [page, title] of [[host, 'Host tag'], [guest, 'Guest tag']]) {
      await focusActive(page)
      await page.locator('.version-card.active .card-menu').click()
      await page.getByRole('button', { name: 'Add tag', exact: true }).click()
      await page.getByLabel('Title', { exact: true }).fill(title)
      await page.evaluate(() => { window.holdPeerMessages = true })
    }
    await Promise.all([host, guest].map((page) => page.getByRole('button', { name: 'Save tag' }).click()))
    const tag = async (page) => (await state(page, room)).versions.find((version) => version.id === id)?.tag
    await expect.poll(async () => (await tag(host))?.title).toBe('Host tag')
    await expect.poll(async () => (await tag(guest))?.title).toBe('Guest tag')
    for (const page of [host, guest]) await page.evaluate(() => window.releasePeerMessages())
    await expect.poll(async () => JSON.stringify(await tag(guest)) === JSON.stringify(await tag(host)), { timeout: 20000 })
      .toBe(true)
    expect(['Host tag', 'Guest tag']).toContain((await tag(host)).title)
    const winner = await tag(host)
    await guest.reload()
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await expect.poll(() => tag(guest)).toEqual(winner)
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
    let identities
    for (const page of pages.slice(0, 4)) {
      await expect(page.locator('.collaborator-list button')).toHaveCount(4, { timeout: 20000 })
      await expect.poll(async () => page.locator('.collaborator-list button').evaluateAll((buttons) =>
        new Set(buttons.map((button) => button.title.split(' · ')[0])).size), { timeout: 20000 }).toBe(4)
      const current = await page.locator('.collaborator-list button').evaluateAll((buttons) =>
        buttons.map((button) => [button.title.split(' · ')[0], button.querySelector('.collaborator-avatar').style.getPropertyValue('--collaborator-color')]).sort())
      expect(current.every(([name]) => !/\d/.test(name))).toBe(true)
      expect(new Set(current.map(([, color]) => color)).size).toBe(4)
      if (identities) expect(current).toEqual(identities)
      else identities = current
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
      .toEqual(identities.map(([name]) => name).filter((name) => name !== leavingName).sort())
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
