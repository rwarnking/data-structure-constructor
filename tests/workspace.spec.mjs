import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

async function openRoom(page, room = `test-${randomUUID()}`) {
  await page.goto(`/?room=${room}`)
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  await expect(page.locator('.version-card.active')).toBeVisible()
  return room
}

async function openTreemapRoom(page, data, versionOptions = {}) {
  const room = `test-${randomUUID()}`
  await page.addInitScript(({ room, data, versionOptions }) => {
    const key = `canopy-room-data-v1-${encodeURIComponent(room)}`
    if (localStorage.getItem(key)) return
    const versions = [
      { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Root', data: [], createdAt: 0 },
      { id: 'v1', parentId: 'v0', step: 1, lane: 0, branch: 'B1', change: 'Edit', data, createdAt: 1, ...versionOptions },
    ]
    localStorage.setItem(key, JSON.stringify({
      versions, activeId: 'v1', nextNode: 100, nextVersion: 2, nextLane: 1, copyLinks: [],
    }))
  }, { room, data, versionOptions })
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

async function clearEntrySelection(page) {
  const point = await page.locator('.graph-canvas').evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect()
    for (let y = bounds.top + 8; y < bounds.bottom - 8; y += 16) {
      for (let x = bounds.left + 8; x < bounds.right - 8; x += 16) {
        const hit = document.elementFromPoint(x, y)
        if (hit && canvas.contains(hit) && !hit.closest('.version-card, button, .copy-link-hit, .canvas-controls')) return { x, y }
      }
    }
    return null
  })
  expect(point).toBeTruthy()
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(0)
}

test('large room imports can be repeated and survive reload', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Large imported entry'])
  const saved = await state(page, room)
  saved.versions.find((version) => version.id === saved.activeId).data[0].description = 'large room data '.repeat(190000)
  const buffer = Buffer.from(JSON.stringify({ format: 'canopy-dataset', version: 1, room: 'large-import',
    state: saved, interactions: [] }))
  expect(buffer.length).toBeGreaterThan(2_500_000)
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import data' }).click()
  await (await chooser).setFiles({ name: 'large.json', mimeType: 'application/json', buffer })
  await expect(page.getByRole('status').first()).toHaveText('Local only', { timeout: 60000 })
  await page.getByRole('button', { name: 'Settings' }).click()
  const secondChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import data' }).click()
  await (await secondChooser).setFiles({ name: 'large.json', mimeType: 'application/json', buffer })
  await expect(page.locator('.current-room-name')).toHaveText('large-import_1', { timeout: 60000 })
  await page.reload()
  await expect(page.getByRole('status').first()).toHaveText('Local only', { timeout: 60000 })
  await expect(page.locator('.version-card.active')).toContainText('Large imported entry')
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export data' }).click()
  const exported = JSON.parse((await readFile(await (await download).path())).toString())
  expect(exported.state.versions.find((version) => version.id === saved.activeId).data[0].description)
    .toBe(saved.versions.find((version) => version.id === saved.activeId).data[0].description)
})

test('corrupt compressed room data is not overwritten on startup', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const saved = 'canopy-gzip-v1:invalid'
  await page.addInitScript(({ room, saved }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, saved)
  }, { room, saved })
  await page.goto(`/?room=${room}`)
  await expect(page.getByRole('alert')).toContainText('Could not load saved data')
  expect(await page.evaluate((name) => localStorage.getItem(`canopy-room-data-v1-${encodeURIComponent(name)}`), room))
    .toBe(saved)
})

test('exported room data imports through the file chooser', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Exported entry'])
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export data' }).click()
  const buffer = await readFile(await (await download).path())
  const exported = JSON.parse(buffer.toString())
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import data' }).click()
  await (await chooser).setFiles({ name: 'export.json', mimeType: 'application/json', buffer })
  await expect(page.getByRole('status').first()).toHaveText('Local only')
  await expect.poll(async () => (await state(page, `${room}_1`))?.versions
    .some((version) => findNode(version.data, 'Exported entry'))).toBe(true)
  const imported = await state(page, `${room}_1`)
  expect(imported.versions.map(({ id, data }) => ({ id, data })))
    .toEqual(exported.state.versions.map(({ id, data }) => ({ id, data })))
})

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

test('tag editor drafts, cancellation, save and removal round-trip through replay', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Tagged data'])
  const versionId = (await state(page, room)).activeId
  await focusActive(page)
  const openTag = async (label) => {
    await page.locator('.version-card.active .card-menu').click()
    await page.getByRole('button', { name: label, exact: true }).click()
  }
  await openTag('Add tag')
  await page.getByLabel('Title', { exact: true }).fill('Release')
  await page.getByLabel('Description', { exact: true }).fill('First description')
  await page.getByRole('button', { name: 'Save tag' }).click()
  await expect.poll(async () => (await state(page, room)).versions.find((version) => version.id === versionId)?.tag)
    .toEqual({ title: 'Release', description: 'First description' })
  await openTag('Edit tag')
  await page.getByLabel('Title', { exact: true }).fill('Discarded')
  await page.getByLabel('Description', { exact: true }).fill('Discarded description')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await openTag('Edit tag')
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Release')
  await page.getByRole('button', { name: 'Remove tag' }).click()
  await expect.poll(async () => (await state(page, room)).versions.find((version) => version.id === versionId)?.tag).toBeUndefined()
  const original = await state(page, room)
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  const open = log.events.findIndex((event) => event.action === 'Tag editor opened')
  const draft = log.events.findIndex((event) => event.tagDialog?.title === 'Release'
    && event.tagDialog.description === 'First description')
  const saved = log.events.findIndex((event) => event.patch?.versions.some((version) => version.id === versionId && version.tag?.title === 'Release'))
  const cancelledDraft = log.events.findIndex((event) => event.tagDialog?.title === 'Discarded'
    && event.tagDialog.description === 'Discarded description')
  const closed = log.events.findIndex((event, index) => index > cancelledDraft && event.action === 'Tag editor closed')
  const reopened = log.events.findIndex((event, index) => index > closed && event.action === 'Tag editor opened')
  const removed = log.events.findIndex((event) => event.action === 'Tag editor removed')
  expect(open).toBeGreaterThanOrEqual(0)
  expect(draft).toBeGreaterThan(open)
  expect(log.events.some((event) => event.action === 'Tag editor confirmed' && event.tagDialog === null)).toBe(true)
  expect(saved).toBeGreaterThan(draft)
  expect(cancelledDraft).toBeGreaterThan(saved)
  expect(closed).toBeGreaterThan(cancelledDraft)
  expect(reopened).toBeGreaterThan(closed)
  expect(removed).toBeGreaterThan(reopened)
  if (await page.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded') === 'false') {
    await page.getByRole('button', { name: 'Settings' }).click()
  }
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'tags.json', mimeType: 'application/json', buffer })
  const dialog = page.getByRole('dialog', { name: 'Version tag' })
  const seek = async (index) => page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value + 1)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, index)
  await seek(open)
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('')
  await seek(draft)
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Release')
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('First description')
  await expect(dialog.locator('..')).toHaveAttribute('inert', '')
  await seek(saved)
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.find((version) => version.id === versionId)?.tag)
    .toEqual({ title: 'Release', description: 'First description' })
  await seek(cancelledDraft)
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Discarded')
  await seek(closed)
  await expect(dialog).toHaveCount(0)
  await seek(reopened)
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Release')
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('First description')
  await seek(cancelledDraft)
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Discarded description')
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.find((version) => version.id === versionId)?.tag).toBeUndefined()
  expect(await state(page, room)).toEqual(original)

  const legacy = { ...log, events: log.events.filter((event) => event.tagDialog === undefined) }
  await page.getByRole('button', { name: 'Settings' }).click()
  const legacyChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await legacyChooser).setFiles({ name: 'legacy-tags.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) })
  await expect(page.getByLabel('Replay timeline')).toHaveAttribute('max', String(legacy.events.length))
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.find((version) => version.id === versionId)?.tag).toBeUndefined()
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
  await page.getByRole('button', { name: 'Show tagged versions' }).click()
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
    await guest.getByRole('button', { name: 'Show tagged versions' }).click()
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
  await clearEntrySelection(page)
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
  const previewGeometry = await page.locator('.overview-preview').evaluate((element, versionId) => {
    const preview = element.getBoundingClientRect()
    const card = document.querySelector(`.version-card[data-version="${versionId}"]`).getBoundingClientRect()
    return {
      preview: { left: preview.left, top: preview.top, right: preview.right, bottom: preview.bottom },
      card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  }, id)
  expect(previewGeometry.preview.left).toBeGreaterThanOrEqual(0)
  expect(previewGeometry.preview.top).toBeGreaterThanOrEqual(0)
  expect(previewGeometry.preview.right).toBeLessThanOrEqual(previewGeometry.viewport.width)
  expect(previewGeometry.preview.bottom).toBeLessThanOrEqual(previewGeometry.viewport.height)
  expect(previewGeometry.preview.right <= previewGeometry.card.left
    || previewGeometry.preview.left >= previewGeometry.card.right
    || previewGeometry.preview.bottom <= previewGeometry.card.top
    || previewGeometry.preview.top >= previewGeometry.card.bottom).toBe(true)
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
  await expect(dialog.getByRole('button', { name: new RegExp(identifier.replaceAll('.', '\\.')) })).toBeVisible()
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
  await expect(dialog.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+f')
  await expect(dialog.getByText('No recent searches')).toBeVisible()
  await dialog.getByLabel('Entries and description').fill('hidden description')
  await dialog.getByLabel('Actions', { exact: true }).fill('edit')
  await dialog.getByLabel('Tag text').fill('milestone')
  await result.click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe('v1')
  await page.reload()
  await page.keyboard.press('Control+f')
  const recent = dialog.getByRole('button', { name: /Actions: edit.*Entries: hidden description.*Nested needle/ })
  await expect(recent).toBeVisible()
  await recent.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await state(page, room)).activeId).toBe('v1')
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

test('recent searches distinguish the results selected for the same query', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Common'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Other'])
  const second = (await state(page, room)).activeId
  const dialog = page.getByRole('dialog', { name: 'Search versions' })
  for (const id of [first, second]) {
    await page.keyboard.press('Control+f')
    await dialog.getByLabel('All', { exact: true }).fill('Common')
    const number = await page.locator(`.version-card[data-version="${id}"] .version-header-id`).innerText()
    await dialog.getByRole('button', { name: new RegExp(number.replaceAll('.', '\\.')) }).click()
  }
  await page.reload()
  await page.keyboard.press('Control+f')
  const recent = dialog.locator('.version-search-results button')
  await expect(recent).toHaveCount(2)
  await recent.nth(1).click()
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
})

test('recent search results from another room restore the query rather than opening a matching id', async ({ page }) => {
  await openTreemapRoom(page, [{ id: 'one', value: 'Shared text', children: [] }])
  await page.keyboard.press('Control+f')
  let dialog = page.getByRole('dialog', { name: 'Search versions' })
  await dialog.getByLabel('All', { exact: true }).fill('Shared text')
  await dialog.locator('.version-search-results button').click()
  await openTreemapRoom(page, [{ id: 'two', value: 'Different text', children: [] }])
  await page.keyboard.press('Control+f')
  dialog = page.getByRole('dialog', { name: 'Search versions' })
  await dialog.getByRole('button', { name: /All: Shared text/ }).click()
  await expect(dialog.getByLabel('All', { exact: true })).toHaveValue('Shared text')
  await expect(dialog.getByText('No matching versions')).toBeVisible()
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
    await page.getByRole('button', { name: 'Fit all versions, 4' }).click()
    await page.getByRole('button', { name: 'Fit height' }).click()
    await expect.poll(async () => page.locator(`.version-card[data-version="${active}"]`).evaluate((card) => {
      const canvas = card.closest('.graph-canvas').getBoundingClientRect()
      const bounds = card.getBoundingClientRect()
      return Math.abs((bounds.left + bounds.right - canvas.left - canvas.right) / 2)
    })).toBeLessThan(2)
    await page.getByRole('button', { name: 'Focus neighborhood' }).click()
    await expect(page.locator(`.version-card[data-version="${active}"]`)).toBeInViewport()
  }
  await focusActive(page)
  await expectCentered(page, active)
  await page.setViewportSize({ width: 1100, height: 800 })
  await expectCentered(page, active)
})

test('focus zoom is the wheel limit and focused cards show later versions', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['One'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Two'])
  await addEntries(page, ['Three'])
  await focusActive(page)
  const indicator = () => page.locator('.version-card.active .version-position-indicator')
  await expect(indicator()).toHaveText('Latest version')
  const world = page.locator('.graph-world')
  const scale = () => world.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
  await expect.poll(scale).toBeGreaterThan(1)
  await page.waitForTimeout(500)
  const focusedScale = await scale()
  await page.locator('.graph-canvas').hover({ position: { x: 20, y: 20 } })
  await page.mouse.wheel(0, -4000)
  await expect.poll(scale).toBeCloseTo(focusedScale, 3)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  await focusActive(page)
  await expect(indicator()).toHaveText('2 later versions')
  await expect(page.locator('.active-version-card')).not.toContainText('Later versions')
  await page.keyboard.press('ArrowRight')
  await focusActive(page)
  await expect(indicator()).toHaveText('1 later version')
})

test('neighborhood focus frames the adjacent versions at each end', async ({ page }) => {
  const room = await openRoom(page)
  const ids = []
  for (const value of ['A', 'B', 'C', 'D']) {
    await addEntries(page, [value])
    ids.push((await state(page, room)).activeId)
  }
  async function check(expected) {
    await page.keyboard.press('2')
    await expect.poll(() => page.locator('.version-card').evaluateAll((cards) => cards.map((card) => card.dataset.version)))
      .toEqual(expect.arrayContaining(expected))
    await expect.poll(() => page.locator('.version-card:not(.root-version)').evaluateAll((cards, ids) => cards.filter((card) => ids.includes(card.dataset.version)).every((card) => {
      const bounds = card.getBoundingClientRect()
      const canvas = card.closest('.graph-canvas').getBoundingClientRect()
      return bounds.left >= canvas.left - 1 && bounds.right <= canvas.right + 1
        && bounds.top >= canvas.top - 1 && bounds.bottom <= canvas.bottom + 1
    }), expected)).toBe(true)
  }
  await check(ids.slice(2))
  await page.keyboard.press('ArrowLeft')
  await check(ids.slice(1, 4))
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(ids[0])
  await check(['v0', ids[0], ids[1]])
})

test('neighborhood focus keeps nearby versions on other timelines visible', async ({ page }) => {
  const room = `test-${randomUUID()}`
  const versions = [
    { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT' },
    { id: 'a1', parentId: 'v0', step: 1, lane: 0, branch: 'A' },
    { id: 'a2', parentId: 'a1', step: 2, lane: 0, branch: 'A' },
    { id: 'a3', parentId: 'a2', step: 3, lane: 0, branch: 'A' },
    { id: 'b1', parentId: 'a1', step: 2, lane: 1, branch: 'B' },
    { id: 'b2', parentId: 'b1', step: 3, lane: 1, branch: 'B' },
    { id: 'b3', parentId: 'b2', step: 4, lane: 1, branch: 'B' },
    { id: 'c1', parentId: 'a1', step: 2, lane: 2, branch: 'C' },
    { id: 'c2', parentId: 'c1', step: 3, lane: 2, branch: 'C' },
  ].map((item, index) => ({ ...item, change: 'Edit', data: [], createdAt: index }))
  await page.addInitScript(({ room, versions }) => {
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(room)}`, JSON.stringify({
      versions, activeId: 'b2', nextNode: 1, nextVersion: 9, nextLane: 3, copyLinks: [],
    }))
  }, { room, versions })
  await openRoom(page, room)
  await page.keyboard.press('2')
  await page.waitForTimeout(500)
  const ids = ['a2', 'a3', 'b1', 'b2', 'b3', 'c2']
  await expect.poll(() => page.locator('.graph-canvas').evaluate((canvas, expected) => {
    const area = canvas.getBoundingClientRect()
    return expected.every((id) => {
      const card = canvas.querySelector(`.version-card[data-version="${id}"]`)
      if (!card) return false
      const rect = card.getBoundingClientRect()
      return rect.right > area.left && rect.left < area.right && rect.bottom > area.top && rect.top < area.bottom
    })
  }, ids)).toBe(true)
  expect((await state(page, room)).activeId).toBe('b2')
})

test('focused version indicator updates when a peer adds and removes later versions', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()))
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected')
    await addEntries(host, ['First'])
    const first = (await state(host, room)).activeId
    await addEntries(host, ['Second'])
    await addEntries(host, ['Third'])
    const third = (await state(host, room)).activeId
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(third)
    await host.keyboard.press('ArrowLeft')
    await host.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await state(host, room)).activeId).toBe(first)
    await focusActive(host)
    const indicator = host.locator(`.version-card[data-version="${first}"] .version-position-indicator`)
    await expect(indicator).toHaveText('2 later versions')
    await guest.keyboard.press('Control+z')
    await expect(indicator).toHaveText('1 later version')
    await addEntries(guest, ['Replacement'])
    await expect(indicator).toHaveText('2 later versions')
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('lane navigation symbols fit short buttons at low zoom', async ({ page }) => {
  const room = `test-${randomUUID()}`
  await page.addInitScript((name) => {
    const root = { id: 'v0', parentId: null, step: 0, lane: 0, branch: 'ROOT', change: 'Root', data: [], createdAt: 0 }
    const versions = [root, ...Array.from({ length: 80 }, (_, index) => ({
      id: `v${index + 1}`, parentId: 'v0', step: 1, lane: index, branch: `B${index + 1}`,
      change: 'Edit', data: [{ id: `n${index}`, value: `${index}`, children: [] }], createdAt: index + 1,
    }))]
    localStorage.setItem(`canopy-room-data-v1-${encodeURIComponent(name)}`, JSON.stringify({
      versions, activeId: 'v1', nextNode: 81, nextVersion: 81, nextLane: 80, copyLinks: [],
    }))
  }, room)
  await openRoom(page, room)
  await page.keyboard.press('4')
  await expect.poll(async () => page.locator('.lane-navigation').count()).toBeGreaterThan(10)
  await page.waitForTimeout(500)
  const bounds = await page.locator('.lane-navigation').evaluateAll((buttons) => buttons.map((button) => {
    const area = button.getBoundingClientRect()
    const icon = button.querySelector('svg').getBoundingClientRect()
    return { height: area.height, iconHeight: icon.height, width: area.width, iconWidth: icon.width }
  }))
  expect(bounds.some((item) => item.height < 18)).toBe(true)
  for (const item of bounds) {
    expect(item.iconHeight).toBeLessThanOrEqual(item.height + 0.1)
    expect(item.iconWidth).toBeLessThanOrEqual(item.width + 0.1)
  }
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
  await expect(page.locator('.interaction-section')).toContainText('Exported')
  expect(await page.evaluate((name) => JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`))
    .some((entry) => entry.action.includes('Exported')), `${room}_1`)).toBe(true)
  expect(await state(page, room)).toEqual(source)
  expect((await state(page, `${room}_1`)).versions.map(({ id, parentId, data, number }) => ({ id, parentId, data, number })))
    .toEqual(source.versions.map(({ id, parentId, data, number }) => ({ id, parentId, data, number })))
  await page.reload()
  await expect(page.getByRole('status').first()).toHaveText('Local only')
  await expect(page.locator('.interaction-section')).toContainText('Exported')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByText(/Import failed/)).toBeVisible()
  expect(await state(page, room)).toEqual(source)
})

test('interaction logs export, replay, reset, and show analysis without changing the source room', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Recorded entry'], true)
  await focusActive(page)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await activeData(page, room)).some((entry) => entry.value === 'Recorded entry')).toBe(true)
  await page.keyboard.press('4')
  await page.waitForTimeout(500)
  const original = await state(page, room)
  await page.getByRole('button', { name: 'Settings' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await downloadPromise).path())
  const log = JSON.parse(buffer.toString())
  expect(log.format).toBe('canopy-interaction-log')
  expect(log.events.some((event) => event.category === 'state' && event.patch.versions.some((version) =>
    findNode(version.data, 'Recorded entry')))).toBe(true)
  expect(log.events.some((event) => event.method === 'hotkey' && event.action === 'undo')).toBe(true)
  expect(log.events.some((event) => event.method === 'hotkey' && event.action === 'redo')).toBe(true)
  expect(log.events.some((event) => event.category === 'viewport')).toBe(true)
  expect(log.events.every((event) => event.actor.id && event.actor.name && event.inputTime <= event.changeTime)).toBe(true)
  expect(log.events[0].action).toBe('Login')
  expect(log.sessions).toHaveLength(1)
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.includes('session-interaction')))).toBe(false)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooserPromise).setFiles({ name: 'interaction.json', mimeType: 'application/json', buffer })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  await expect(page.getByRole('toolbar', { name: 'Interaction log replay controls' })).toBeVisible()
  const creationIndex = log.events.findIndex((event) => event.category === 'state' && event.patch.versions.some((version) =>
    findNode(version.data, 'Recorded entry')))
  const seek = async (position) => page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, position)
  await seek(creationIndex)
  await expect.poll(async () => (await activeData(page, 'Interaction Log Replay')).some((entry) => entry.value === 'Recorded entry')).toBe(false)
  await seek(creationIndex + 1)
  await expect.poll(async () => (await activeData(page, 'Interaction Log Replay')).some((entry) => entry.value === 'Recorded entry')).toBe(true)
  await seek(creationIndex)
  await expect.poll(async () => (await activeData(page, 'Interaction Log Replay')).some((entry) => entry.value === 'Recorded entry')).toBe(false)
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect.poll(async () => (await activeData(page, 'Interaction Log Replay')).some((entry) => entry.value === 'Recorded entry')).toBe(true)
  await expect(page.locator('.interaction-section')).toContainText('Recorded entry')
  expect((await state(page, 'Interaction Log Replay')).versions.map((version) => version.id)).toEqual(original.versions.map((version) => version.id))
  await page.getByRole('button', { name: 'Analyze Interaction Log' }).click()
  const analysis = page.getByRole('dialog', { name: 'Interaction log analysis' })
  await expect(analysis).toContainText('Session overview')
  await expect(analysis).toContainText('User contributions')
  await expect(analysis).toContainText('Navigation and viewport')
  await analysis.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Jump to beginning' }).click()
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.length).toBe(1)
  await expect(page.locator('.interaction-section')).not.toContainText('Recorded entry')
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.length).toBe(original.versions.length)
  expect(await state(page, room)).toEqual(original)
  await page.getByRole('button', { name: 'Exit replay' }).click()
  await expect(page.locator('.current-room-name')).toHaveText(room)
  expect((await state(page, room)).versions.map(({ id, data }) => ({ id, data })))
    .toEqual(original.versions.map(({ id, data }) => ({ id, data })))
})

test('replay scales the recorded screen and keeps cursor and graph aligned after a resize', async ({ page }) => {
  await openRoom(page)
  await addEntries(page, ['Existing'])
  await focusActive(page)
  await page.getByRole('button', { name: 'New free entry, N' }).click()
  await page.getByPlaceholder('Entry name').fill('Replay target')
  await page.getByPlaceholder('Entry name').press('m')
  const addButton = page.getByRole('button', { name: 'Add 1 entry' })
  const originalButton = await addButton.boundingBox()
  await page.evaluate(() => window.addEventListener('pointerdown', () => {
    const rect = document.querySelector('.version-card.active').getBoundingClientRect()
    window.recordedCardBounds = { x: rect.x, y: rect.y }
  }, { once: true }))
  await addButton.click()
  const originalCard = await page.evaluate(() => window.recordedCardBounds)
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  expect(log.events.some((event) => event.action === 'mergeEntries' && event.parameters?.key === 'm')).toBe(false)
  const index = log.events.findLastIndex((event) => event.action === 'Button: Add 1 entry')
  expect(log.events[index].screen).toMatchObject({ width: 1440, height: 900 })
  await page.setViewportSize({ width: 1000, height: 700 })
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'recording.json', mimeType: 'application/json', buffer })
  await expect(page.getByRole('toolbar', { name: 'Interaction log replay controls' })).toBeVisible()
  await page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, index + 1)
  await expect(page.getByRole('button', { name: 'Add 1 entry' })).toBeVisible()
  await page.waitForTimeout(300)
  const replayButton = await page.getByRole('button', { name: 'Add 1 entry' }).boundingBox()
  const replayCard = await page.locator('.version-card.active').boundingBox()
  const cursor = await page.locator('.replay-cursor').boundingBox()
  const toolbar = await page.getByRole('toolbar', { name: 'Interaction log replay controls' }).boundingBox()
  expect(toolbar.width).toBe(940)
  expect(toolbar.x).toBe(30)
  expect(toolbar.y + toolbar.height).toBe(688)
  const scale = 1000 / 1440
  const top = (700 - 900 * scale) / 2
  expect(Math.abs(cursor.x - (log.events[index].cursor.x * scale))).toBeLessThan(2)
  expect(Math.abs(cursor.y - (top + log.events[index].cursor.y * scale))).toBeLessThan(2)
  expect(Math.abs(replayButton.x + replayButton.width / 2 - cursor.x)).toBeLessThan(3)
  expect(Math.abs(replayButton.y + replayButton.height / 2 - cursor.y)).toBeLessThan(3)
  expect(Math.abs(replayCard.x - originalCard.x * scale)).toBeLessThan(3)
  expect(Math.abs(replayCard.y - (top + originalCard.y * scale))).toBeLessThan(3)
  expect(Math.abs(replayButton.width - originalButton.width * scale)).toBeLessThan(3)
})

test('older recordings can use a manually supplied screen size', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  const room = await openRoom(page)
  const initialState = await state(page, room)
  const actor = { id: 'alice', name: 'Alice', color: '#123456' }
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [{
      id: 'click', actor, action: 'Mouse interaction', category: 'input', method: 'mouse',
      inputTime: 1, changeTime: 1, cursor: { x: 1200, y: 600 },
    }] }
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  const replayToolbar = page.getByRole('toolbar', { name: 'Interaction log replay controls' })
  const primaryRow = replayToolbar.locator('.replay-toolbar-primary')
  const secondaryRow = replayToolbar.locator('.replay-toolbar-secondary')
  await expect(primaryRow.getByLabel('Replay user')).toBeVisible()
  await expect(primaryRow.getByLabel('Recording width')).toBeVisible()
  await expect(primaryRow.getByRole('button', { name: 'Export Interaction Log' })).toBeVisible()
  await expect(primaryRow.getByRole('button', { name: 'Analyze Interaction Log' })).toBeVisible()
  await expect(primaryRow.getByRole('button', { name: 'Exit replay' })).toBeVisible()
  await expect(primaryRow.getByLabel('Left collapsed')).toBeVisible()
  await expect(primaryRow.getByLabel('Right collapsed')).toBeVisible()
  await expect(primaryRow.locator('.replay-current-action')).toBeVisible()
  await expect(secondaryRow.locator('.replay-current-action')).toHaveCount(0)
  await expect(secondaryRow.getByRole('button', { name: 'Jump to beginning' })).toBeVisible()
  await expect(secondaryRow.getByLabel('Left collapsed')).toHaveCount(0)
  const [primaryTop, secondaryTop] = await Promise.all([
    primaryRow.evaluate((row) => row.getBoundingClientRect().top),
    secondaryRow.evaluate((row) => row.getBoundingClientRect().top),
  ])
  expect(secondaryTop).toBeGreaterThan(primaryTop)
  await page.keyboard.press('ArrowRight')
  await expect(replayToolbar.locator('.replay-current-action')).toHaveText('Action: Mouse interaction')
  await expect(page.getByLabel('Replay timeline')).toHaveValue('1')
  await page.keyboard.press('ArrowLeft')
  await expect(replayToolbar.locator('.replay-current-action')).toHaveText('Action: No action yet')
  await expect(page.getByLabel('Replay timeline')).toHaveValue('0')
  await page.getByLabel('Recording width').fill('1800')
  await page.getByLabel('Recording width').press('ArrowRight')
  await expect(page.getByLabel('Replay timeline')).toHaveValue('0')
  await page.getByLabel('Recording height').fill('1000')
  await page.getByRole('button', { name: 'Apply recording size' }).click()
  await expect(page.locator('.app-shell')).toHaveCSS('width', '1800px')
  await page.getByRole('button', { name: 'Jump to end' }).click()
  const cursor = await page.locator('.replay-cursor').boundingBox()
  expect(Math.abs(cursor.x - 1200 * (1000 / 1800))).toBeLessThan(2)
  await page.getByRole('button', { name: 'Jump to beginning' }).click()
  await expect(page.locator('.app-shell')).toHaveCSS('width', '1800px')
})

test('recorded sidebar layout changes replay in order and on backward seeks', async ({ page }) => {
  await openRoom(page)
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Expand action sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse action sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  const layouts = [
    { sidebarCollapsed: true, actionSidebarCollapsed: true },
    { sidebarCollapsed: true, actionSidebarCollapsed: false },
    { sidebarCollapsed: false, actionSidebarCollapsed: false },
    { sidebarCollapsed: false, actionSidebarCollapsed: true },
  ]
  const indexes = layouts.map((layout) => log.events.findIndex((event) => event.action === 'Window layout'
    && event.screen?.sidebarCollapsed === layout.sidebarCollapsed
    && event.screen?.actionSidebarCollapsed === layout.actionSidebarCollapsed))
  expect(indexes.every((index, i) => index >= 0 && (i === 0 || index > indexes[i - 1]))).toBe(true)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'layout.json', mimeType: 'application/json', buffer })
  const slider = page.getByLabel('Replay timeline')
  const seek = async (position) => slider.evaluate((element, value) => {
    element.value = String(value + 1)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, position)
  for (const i of [0, 1, 2, 3, 1, 0]) {
    await seek(indexes[i])
    await expect(page.locator('.sidebar')).toHaveClass(layouts[i].sidebarCollapsed ? /collapsed/ : /^(?!.*collapsed)/)
    await expect(page.locator('.action-sidebar')).toHaveClass(layouts[i].actionSidebarCollapsed ? /collapsed/ : /^(?!.*collapsed)/)
  }
})

test('legacy replay reconstructs merge selection and lane navigation', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const initialState = await state(page, room)
  const lane = initialState.versions.find((version) => version.id === first).lane
  const firstInLane = initialState.versions.filter((version) => version.id !== 'v0' && version.lane === lane)
    .sort((a, b) => a.step - b.step || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
  const actor = { id: 'alice', name: 'Alice', color: '#123456' }
  const actions = [
    { action: 'merge', method: 'hotkey', parameters: { key: 'M', shift: true, control: false, alt: false } },
    { action: 'Select version', method: 'mouse', parameters: { versionId: first, button: 0 } },
    { action: 'Button: Confirm merge', method: 'button' },
    { action: 'Button: Abort merge', method: 'button' },
    { action: `Button: Go to beginning of lane ${lane + 1}`, method: 'button' },
  ]
  const events = actions.map((action, index) => ({ ...action, id: `step-${index}`, actor, category: 'input',
    inputTime: 1000 + index * 1000, changeTime: 1000 + index * 1000 }))
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState,
    initialViewport: { zoom: 1, panX: -20000, panY: 0 }, events }
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'legacy-merge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  const slider = page.getByLabel('Replay timeline')
  const seek = async (position) => slider.evaluate((element, value) => {
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, position)
  await seek(2)
  const dialog = page.getByRole('dialog', { name: 'Branch merge' })
  await expect(dialog).toBeVisible()
  await seek(3)
  await expect(dialog).toBeVisible()
  await seek(4)
  await expect(dialog).toHaveCount(0)
  await seek(5)
  await expect.poll(async () => page.locator(`.version-card[data-version="${firstInLane.id}"]`).evaluate((card) => {
    const canvas = card.closest('.graph-canvas').getBoundingClientRect()
    const bounds = card.getBoundingClientRect()
    return Math.abs((bounds.left + bounds.right - canvas.left - canvas.right) / 2)
  })).toBeLessThan(2)
  await seek(2)
  await expect(dialog).toBeVisible()
})

test('interaction analysis visualizes and inspects user, flow, viewport and version activity', async ({ page }) => {
  const room = await openRoom(page)
  const initialState = await state(page, room)
  const alice = { id: 'alice', name: 'Alice', color: '#123456' }
  const bob = { id: 'bob', name: 'Bob', color: '#654321' }
  const event = (id, actor, action, time, extra = {}) => ({
    id, actor, action, category: 'input', method: 'mouse', inputTime: time, changeTime: time, ...extra,
  })
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [
      event('1', alice, 'Graph zoom', 1000, { category: 'viewport', viewport: { zoom: 1, panX: 0, panY: 0 } }),
      event('2', alice, 'Ping', 2000, { parameters: { versionId: 'v0' } }),
      event('3', bob, 'Ping', 2500),
      event('4', alice, 'Navigate', 3000, { category: 'selection', selection: { versionId: 'v0', nodeIds: [] } }),
      event('5', alice, 'Redo', 5000),
    ] }
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'analysis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  await page.getByRole('button', { name: 'Analyze Interaction Log' }).click()
  const analysis = page.getByRole('dialog', { name: 'Interaction log analysis' })
  await expect(analysis.getByRole('heading', { name: 'User × action matrix' })).toBeVisible()
  await analysis.getByRole('button', { name: 'Alice: Ping, 1 events' }).click()
  await expect(analysis).toContainText('Showing 1 events: Alice · Ping')
  await analysis.getByRole('button', { name: /Ping → Navigate/ }).click()
  await expect(analysis).toContainText('Showing 2 events: Ping → Navigate')
  await analysis.getByRole('button', { name: 'Graph area 1, 1: 4.0s' }).click()
  await expect(analysis).toContainText('Viewport area 1, 1')
  await analysis.getByRole('button', { name: 'Version 00.00.000: 2 events' }).click()
  await expect(analysis).toContainText('Showing 2 events: Version 00.00.000')
  await analysis.getByRole('button', { name: 'Show all' }).click()
  await expect(analysis.locator('.analysis-raw li')).toHaveCount(5)
})

test('new recordings combine committed sidebar actions and abstract their triggering button', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['One', 'Two', 'Three', 'Four'])
  await clearEntrySelection(page)
  await contextAction(page, room, 'Two', 'Add child')
  await fillEntries(page, ['Child'])
  await contextAction(page, room, 'Two', 'Delete selected entry, keep children')
  await expect.poll(async () => !!findNode(await activeData(page, room), 'Two')).toBe(false)
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  expect(log.events.filter((event) => event.action === 'Button: Add 4 entries')).toHaveLength(1)
  const created = log.events.filter((event) => /Created .* · Created 4 items/.test(event.action))
  expect(created).toHaveLength(1)
  expect(created[0].category).toBe('state')
  expect(created[0].parameters.meaningful).toBe(true)
  expect(log.events.filter((event) => event.action === 'Button: Delete selected entry, keep children')).toHaveLength(1)
  expect(log.events.some((event) => event.action === 'Open entry menu')).toBe(true)
  expect(log.events.some((event) => event.parameters?.menuAction === 'Add child')).toBe(true)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'recording.json', mimeType: 'application/json', buffer })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  const menuOpenIndex = log.events.findIndex((event) => event.action === 'Open entry menu')
  await page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, menuOpenIndex + 1)
  await expect(page.locator('.context-menu')).toContainText('ENTRY ACTIONS')
  const menuActionIndex = log.events.findIndex((event) => event.parameters?.menuAction === 'Add child')
  await page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, menuActionIndex + 2)
  await expect(page.locator('.context-menu')).toHaveCount(0)
  await page.getByRole('button', { name: 'Analyze Interaction Log' }).click()
  const analysis = page.getByRole('dialog', { name: 'Interaction log analysis' })
  await analysis.getByLabel('Abstract interactions').check()
  await expect(analysis.locator('.analysis-raw')).not.toContainText('Button: Add 4 entries')
  await expect(analysis.locator('.analysis-raw')).not.toContainText('Button: Delete selected entry, keep children')
  await expect(analysis.locator('.analysis-raw')).toContainText('Create entries')
  await expect(analysis.locator('.analysis-raw')).toContainText('Delete entries')
  await analysis.locator('.analysis-raw').getByRole('button', { name: /Create entries/ }).first().click()
  await expect(analysis.locator('.analysis-raw pre')).toContainText('Created 4 items')
  await analysis.getByLabel('Abstract interactions').uncheck()
  await expect(analysis.locator('.analysis-raw')).toContainText('Button: Add 4 entries')
})

test('replay restores entry dialogs, drafts and cancellations while seeking', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent'])
  await contextAction(page, room, 'Parent', 'Add child')
  await fillEntries(page, ['Child'])
  await contextAction(page, room, 'Parent', 'Split entry')
  await page.getByLabel('Result 1 name').fill('First result')
  await page.getByLabel('Result 2 name').fill('Second result')
  await page.getByLabel('Assign Child to a result entry').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Cancel' }).click()
  await contextAction(page, room, 'Parent', 'Change value')
  await page.getByPlaceholder('e.g. Research notes').fill('Renamed draft')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Delete entry, Delete' }).click()
  await page.locator('#bulk-delete-mode').selectOption('detach-children')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const log = JSON.parse((await readFile(await (await download).path())).toString())
  const openIndex = log.events.findIndex((event) => event.dialog?.editor?.mode === 'create'
    && event.dialog.editor.entries[0].value === '')
  const draftIndex = log.events.findIndex((event) => event.dialog?.editor?.entries?.[0]?.value === 'Parent')
  const splitIndex = log.events.findIndex((event) => event.dialog?.operation?.mode === 'split'
    && event.dialog.operation.entries[1].value === 'Second result'
    && Object.values(event.dialog.operation.assignments)[0] === event.dialog.operation.entries[1].id)
  const closedIndex = log.events.findIndex((event, index) => index > splitIndex && event.dialog
    && !event.dialog.editor && !event.dialog.operation && !event.dialog.deleteOpen)
  const renameIndex = log.events.findIndex((event) => event.dialog?.editor?.mode === 'rename'
    && event.dialog.editor.value === 'Renamed draft')
  const deleteIndex = log.events.findIndex((event) => event.dialog?.deleteOpen
    && event.dialog.deleteMode === 'detach-children')
  expect(openIndex).toBeGreaterThanOrEqual(0)
  expect(draftIndex).toBeGreaterThan(openIndex)
  expect(splitIndex).toBeGreaterThan(draftIndex)
  expect(closedIndex).toBeGreaterThan(splitIndex)
  expect(renameIndex).toBeGreaterThan(closedIndex)
  expect(deleteIndex).toBeGreaterThan(renameIndex)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'dialogs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  const timeline = page.getByLabel('Replay timeline')
  const seek = async (index) => timeline.evaluate((slider, value) => {
    slider.value = String(value + 1)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, index)
  await seek(openIndex)
  await expect(page.getByPlaceholder('Entry name')).toHaveValue('')
  await seek(draftIndex)
  await expect(page.getByPlaceholder('Entry name')).toHaveValue('Parent')
  await seek(splitIndex)
  await expect(page.getByLabel('Result 1 name')).toHaveValue('First result')
  await expect(page.getByLabel('Result 2 name')).toHaveValue('Second result')
  await expect(page.getByLabel('Assign Child to a result entry')).toHaveValue(log.events[splitIndex].dialog.operation.entries[1].id)
  await expect(page.locator('.operation-editor').locator('..')).toHaveAttribute('inert', '')
  await seek(closedIndex)
  await expect(page.getByLabel('Result 1 name')).toHaveCount(0)
  await seek(renameIndex)
  await expect(page.getByPlaceholder('e.g. Research notes')).toHaveValue('Renamed draft')
  await seek(deleteIndex)
  await expect(page.locator('#bulk-delete-mode')).toHaveValue('detach-children')
  await seek(splitIndex)
  await expect(page.getByLabel('Result 2 name')).toHaveValue('Second result')
  await page.getByRole('button', { name: 'Jump to beginning' }).click()
  await expect(page.locator('.operation-editor')).toHaveCount(0)

  const legacy = { ...log, events: log.events.filter((event) => !event.dialog) }
  const legacyOpen = legacy.events.findIndex((event) => event.action.startsWith('Button: New free entry'))
  const legacyDraft = legacy.events.findIndex((event) => event.action === 'Input: Entry name' && event.parameters?.value === 'Parent')
  const legacySplit = legacy.events.findIndex((event) => event.parameters?.menuAction === 'Split entry')
  const legacyResult = legacy.events.findIndex((event) => event.action === 'Input: Result 2 name')
  const legacyClose = legacy.events.findIndex((event, index) => index > legacyResult && event.action === 'Button: Cancel')
  expect(legacyOpen).toBeGreaterThanOrEqual(0)
  expect(legacySplit).toBeGreaterThan(legacyDraft)
  expect(legacyClose).toBeGreaterThan(legacyResult)
  await page.getByRole('button', { name: 'Settings' }).click()
  const legacyChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await legacyChooser).setFiles({ name: 'legacy-dialogs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  await seek(legacyOpen)
  await expect(page.getByPlaceholder('Entry name')).toHaveValue('')
  await seek(legacyDraft)
  await expect(page.getByPlaceholder('Entry name')).toHaveValue('Parent')
  await seek(legacySplit)
  await expect(page.getByLabel('Result 1 name')).toBeVisible()
  await seek(legacyResult)
  await expect(page.getByLabel('Result 2 name')).toHaveValue('Second result')
  await seek(legacyClose)
  await expect(page.getByLabel('Result 1 name')).toHaveCount(0)
})

test('analysis starts at the first event, shows numbered versions and displays three-digit steps', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Version reference'])
  const initialState = await state(page, room)
  const version = initialState.versions.find((item) => item.id === initialState.activeId)
  const label = `${String(version.number.step).padStart(2, '0')}.${String(version.number.branch).padStart(2, '0')}.${String(version.number.subbranch).padStart(3, '0')}`
  const actor = { id: 'alice', name: 'Alice', color: '#123456' }
  const events = Array.from({ length: 120 }, (_, index) => ({
    id: `step-${index}`, actor, action: 'Navigate', category: 'selection', method: 'mouse',
    inputTime: index ? 240000 + index * 1000 : 1000, changeTime: 240000 + index * 1000,
    selection: { versionId: version.id, nodeIds: [] },
  }))
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events }
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'steps.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  const toolbar = page.getByRole('toolbar', { name: 'Interaction log replay controls' })
  await expect(toolbar.getByLabel('Replay timeline')).toHaveAttribute('max', '120')
  await expect(toolbar.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(toolbar.getByLabel('Replay user')).toHaveValue('alice')
  await page.getByRole('button', { name: 'Analyze Interaction Log' }).click()
  const analysis = page.getByRole('dialog', { name: 'Interaction log analysis' })
  await expect(analysis.locator('.analysis-header')).toContainText('119s')
  const navigation = analysis.locator('section').filter({ has: page.getByRole('heading', { name: 'Navigation and viewport' }) })
  await expect(navigation).toContainText(`${label} (120)`)
  await expect(navigation).not.toContainText(version.id)
  await expect(analysis.getByRole('button', { name: `Version ${label}: 120 events` })).toBeVisible()
  await expect(analysis.locator('.analysis-version-map')).not.toContainText(version.id)
  const last = analysis.locator('.analysis-raw li').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last.locator('.analysis-step')).toHaveText('120.')
  const inspector = analysis.locator('section').filter({ has: page.getByRole('heading', { name: 'Inspect interactions' }) })
  const contributions = analysis.locator('section').filter({ has: page.getByRole('heading', { name: 'User contributions' }) })
  const [navigationBox, inspectorBox, contributionsBox] = await Promise.all([navigation.boundingBox(), inspector.boundingBox(), contributions.boundingBox()])
  expect(inspectorBox.y).toBe(navigationBox.y)
  expect(inspectorBox.x).toBeGreaterThan(navigationBox.x)
  expect(inspectorBox.y).toBeGreaterThan(contributionsBox.y)
})

test('replay pause, speed, and cursor interpolation follow recorded time', async ({ page }) => {
  const room = await openRoom(page)
  const initialState = await state(page, room)
  const actor = { id: 'recorded-user', name: 'Recorded user', color: '#0075b8' }
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [
      { id: 'first', actor, action: 'Start', category: 'input', method: 'mouse',
        inputTime: 1000, changeTime: 1000, cursor: { x: 100, y: 120 } },
      { id: 'second', actor, action: 'Zoom', category: 'input', method: 'mouse',
        inputTime: 3000, changeTime: 3000, cursor: { x: 300, y: 120 },
        viewport: { zoom: 1.5, panX: 20, panY: 30 } },
    ] }
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'timed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('.replay-timeline span')).toHaveText('1 / 2')
  await expect(page.locator('.replay-clock')).toHaveText('00:00:00/00:00:02')
  const paused = await page.locator('.replay-cursor').getAttribute('style')
  await page.waitForTimeout(300)
  expect(await page.locator('.replay-cursor').getAttribute('style')).toBe(paused)
  await page.getByLabel('Playback speed').selectOption('4')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number.parseFloat(await page.locator('.replay-cursor').evaluate((element) => element.style.left)))
    .toBeGreaterThan(110)
  await expect.poll(() => page.locator('.replay-timeline span').textContent()).toBe('2 / 2')
  await expect(page.locator('.graph-world')).toHaveAttribute('style', /translate\(20px, 30px\) scale\(1.5\)/)
})

test('skip to next step crosses idle gaps without changing playback or pause timing', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Existing baseline'])
  const initialState = await state(page, room)
  const actor = { id: 'recorded-user', name: 'Recorded user', color: '#0075b8' }
  const event = (id, time, extra = {}) => ({ id, actor, action: id, category: 'input', method: 'mouse',
    inputTime: time, changeTime: time, ...extra })
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [
      event('one', 1000), event('two', 1001), event('three', 1002),
      event('four', 355000, { viewport: { zoom: 1.5, panX: 20, panY: 30 }, cursor: { x: 120, y: 120 } }),
      event('five', 365000), event('six', 375000),
    ] }
  await page.getByRole('button', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'idle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  const counter = page.locator('.replay-timeline span')
  await expect(counter).toHaveText('3 / 6')
  await page.getByRole('button', { name: 'Skip to next step' }).click()
  await expect(counter).toHaveText('4 / 6')
  await expect(page.locator('.graph-world')).toHaveAttribute('style', /translate\(20px, 30px\) scale\(1.5\)/)
  await expect(page.locator('.replay-cursor')).toHaveCSS('left', '120px')
  await expect(page.locator('.replay-cursor')).toHaveCSS('top', '120px')
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: 'Skip to next step' }).click()
  await expect(counter).toHaveText('5 / 6')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(300)
  await expect(counter).toHaveText('5 / 6')
  await page.getByRole('button', { name: 'Jump to beginning' }).click()
  await expect(counter).toHaveText('0 / 6')
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.length).toBe(initialState.versions.length)
  await page.getByRole('button', { name: 'Skip to next step' }).click()
  await expect(counter).toHaveText('1 / 6')
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions.length).toBe(initialState.versions.length)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Skip to next step' }).click()
  await expect(counter).toHaveText('2 / 6')
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect(page.getByRole('button', { name: 'Skip to next step' })).toBeDisabled()
})

test('interaction exports remain isolated across room switches and recreation', async ({ page }) => {
  const first = await openRoom(page)
  const second = `test-${randomUUID()}`
  const exportLog = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Interaction Log' }).click()
    return JSON.parse((await readFile(await (await download).path())).toString())
  }
  await addEntries(page, ['First room entry'])
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByLabel('Create a new empty room').fill(second)
  await page.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(page.locator('.current-room-name')).toHaveText(second)
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  await addEntries(page, ['Second room entry'])
  const secondLog = await exportLog()
  expect(secondLog.room).toBe(second)
  expect(JSON.stringify(secondLog)).toContain('Second room entry')
  expect(JSON.stringify(secondLog)).not.toContain('First room entry')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByRole('button', { name: first, exact: true }).click()
  await expect(page.locator('.current-room-name')).toHaveText(first)
  const firstLog = await exportLog()
  expect(firstLog.room).toBe(first)
  expect(JSON.stringify(firstLog)).toContain('First room entry')
  expect(JSON.stringify(firstLog)).not.toContain('Second room entry')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: `Delete locally saved room ${second}` }).click()
  await page.getByLabel('Create a new empty room').fill(second)
  await page.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(page.locator('.current-room-name')).toHaveText(second)
  await expect(page.getByRole('status').first()).toHaveText('Hosting')
  const recreatedLog = await exportLog()
  expect(recreatedLog.room).toBe(second)
  expect(JSON.stringify(recreatedLog)).not.toContain('Second room entry')
  expect(JSON.stringify(recreatedLog)).not.toContain('First room entry')
})

test('export flushes and replays a pending version viewport change', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Zoomed entry'])
  await focusActive(page)
  const map = page.locator('.version-card.active .mini-map')
  await map.hover()
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, -180)
  await page.keyboard.up('Shift')
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  expect(log.events.some((event) => event.category === 'viewport' && event.parameters?.scope === 'version' && event.patch)).toBe(true)
  const source = await state(page, room)
  const sourceVersion = source.versions.find((version) => version.id === source.activeId)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'viewport.json', mimeType: 'application/json', buffer })
  await expect(page.locator('.current-room-name')).toHaveText('Interaction Log Replay')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect.poll(async () => (await state(page, 'Interaction Log Replay')).versions
    .find((version) => version.id === sourceVersion.id)?.mapView).toEqual(sourceVersion.mapView)
})

test('invalid replay files leave rooms untouched and valid uploads replace the active replay room', async ({ page }) => {
  const room = 'Interaction Log Replay'
  await openRoom(page, room)
  await addEntries(page, ['Keep this room'])
  const original = await state(page, room)
  await page.getByRole('button', { name: 'Settings' }).click()
  let chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByText(/Replay failed/)).toBeVisible()
  expect(await state(page, room)).toEqual(original)
  const empty = { ...original, versions: original.versions.filter((version) => version.id === 'v0'), activeId: 'v0', copyLinks: [] }
  const log = { format: 'canopy-interaction-log', version: 1, room, initialState: empty,
    initialViewport: { zoom: 1, panX: 0, panY: 0 }, events: [1000, 21000].map((time, index) => ({
      id: `step-${index}`, actor: { id: 'user', name: 'User', color: '#0075b8' },
      category: 'input', method: 'mouse', action: 'Wait', inputTime: time, changeTime: time,
    })) }
  await page.getByRole('button', { name: 'Settings' }).click()
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(log)) })
  await expect(page.locator('.current-room-name')).toHaveText(room)
  await expect.poll(async () => (await state(page, room)).versions.length).toBe(1)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'replacement.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...log, initialState: original })) })
  await expect(page.locator('.current-room-name')).toHaveText(room)
  await expect.poll(async () => (await state(page, room)).versions.length).toBe(original.versions.length)
  expect((await activeData(page, room)).some((entry) => entry.value === 'Keep this room')).toBe(true)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Exit replay' }).click()
  await expect(page.getByRole('status').first()).toHaveText('Local only')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const freshLog = JSON.parse((await readFile(await (await download).path())).toString())
  expect(freshLog.initialState.versions.length).toBe(original.versions.length)
  expect(freshLog.events.some((event) => event.action.startsWith('Created '))).toBe(false)
})

test('shared interaction logs preserve each participant and replay their edits', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    const room = await openRoom(host)
    await addEntries(host, ['Host record'])
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await expect.poll(async () => (await state(guest, room)).versions.some((version) => findNode(version.data, 'Host record'))).toBe(true)
    await guest.keyboard.press('ArrowRight')
    await expect.poll(async () => (await activeData(guest, room)).some((entry) => entry.value === 'Host record')).toBe(true)
    await addEntries(guest, ['Guest record'])
    await expect.poll(async () => (await state(host, room)).versions.some((version) => findNode(version.data, 'Guest record'))).toBe(true)
    await host.getByRole('button', { name: 'Settings' }).click()
    const download = host.waitForEvent('download')
    await host.getByRole('button', { name: 'Export Interaction Log' }).click()
    const buffer = await readFile(await (await download).path())
    const log = JSON.parse(buffer.toString())
    expect(log.events.some((event) => event.parameters?.localObservation === true)).toBe(true)
    expect(new Set(log.events.filter((event) => event.category === 'state').map((event) => event.actor.id)).size).toBe(2)
    const hostActorId = log.events.find((event) => event.category === 'state' && event.patch.versions.some((version) =>
      findNode(version.data, 'Host record'))).actor.id
    const guestActorId = log.events.find((event) => event.category === 'state' && event.patch.versions.some((version) =>
      findNode(version.data, 'Guest record'))).actor.id
    expect(log.sessions.find((session) => session.actor.id === hostActorId).initialState.versions
      .some((version) => findNode(version.data, 'Host record'))).toBe(false)
    expect(log.sessions.find((session) => session.actor.id === guestActorId).initialState.versions
      .some((version) => findNode(version.data, 'Host record'))).toBe(true)
    const chooser = host.waitForEvent('filechooser')
    await host.getByRole('button', { name: 'Replay Interaction Log' }).click()
    await (await chooser).setFiles({ name: 'shared.json', mimeType: 'application/json', buffer })
    await expect(host.locator('.current-room-name')).toHaveText('Interaction Log Replay')
    await expect(host.getByLabel('Replay user')).toHaveValue(hostActorId)
    await host.getByRole('button', { name: 'Jump to end' }).click()
    await expect.poll(async () => (await state(host, 'Interaction Log Replay')).versions
      .some((version) => findNode(version.data, 'Host record'))).toBe(true)
    expect((await state(host, 'Interaction Log Replay')).versions
      .some((version) => findNode(version.data, 'Guest record'))).toBe(true)
    await host.getByLabel('Replay user').selectOption(guestActorId)
    await host.getByRole('button', { name: 'Jump to end' }).click()
    await expect.poll(async () => (await state(host, 'Interaction Log Replay')).versions
      .some((version) => findNode(version.data, 'Guest record'))).toBe(true)
    expect((await state(host, 'Interaction Log Replay')).versions
      .some((version) => findNode(version.data, 'Host record'))).toBe(true)
    await expect(host.locator('.collaborator-list .collaborator')).toHaveCount(1)
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
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
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)

  await contextAction(page, room, 'Alpha', 'Change value')
  await page.getByLabel('New value').fill('Renamed')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(async () => !!findNode(await activeData(page, room), 'Renamed')).toBe(true)
  await expect(page.locator('.version-card.active')).toContainText('Renamed')
  await expect(await activeTile(page, room, 'Renamed')).toHaveClass(/is-selected/)

  await contextAction(page, room, 'Renamed', 'Copy entry and children')
  await (await page.locator('.version-card.active')).click({ button: 'right', position: { x: 8, y: 8 } })
  await expect(page.getByRole('button', { name: 'Add copied entry', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await state(page, room)).copyLinks.length).toBe(1)
  await expect.poll(async () => findNode(await activeData(page, room), 'Renamed')?.children.map((item) => item.value)).toEqual(['Renamed'])
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

test('pasting copied entries appends a copy to every selected target', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Source', 'First target', 'Second target'])
  await contextAction(page, room, 'Source', 'Copy entry and children')
  await page.keyboard.press('Control+a')
  await (await activeTile(page, room, 'Source')).click({ force: true })
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(2)
  await expect(await activeTile(page, room, 'First target')).toHaveClass(/is-selected/)
  await expect(await activeTile(page, room, 'Second target')).toHaveClass(/is-selected/)
  await page.keyboard.press('Control+v')
  await expect.poll(async () => findNode(await activeData(page, room), 'First target')?.children.map((node) => node.value)).toEqual(['Source'])
  await expect.poll(async () => findNode(await activeData(page, room), 'Second target')?.children.map((node) => node.value)).toEqual(['Source'])
  await expect.poll(async () => (await state(page, room)).copyLinks.length).toBe(2)
})

test('sidebar deletion opens a child-choice dialog for a single parent and removes a leaf immediately', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Parent'])
  await contextAction(page, room, 'Parent', 'Add child')
  await fillEntries(page, ['Child'])
  await (await activeTile(page, room, 'Parent')).click({ position: { x: 4, y: 4 } })
  await expect(await activeTile(page, room, 'Parent')).toHaveClass(/is-selected/)
  await page.locator('.action-sidebar-item[title^="Delete entry ·"]').click()
  await expect(page.locator('.editor-scrim')).toBeVisible()
  await page.getByLabel('How should children be handled?').selectOption('subtree')
  await page.getByRole('button', { name: 'Delete entry', exact: true }).click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Parent')).toBeUndefined()
  await expect(page.locator('.editor-scrim')).toHaveCount(0)

  await addEntries(page, ['Leaf'])
  await focusActive(page)
  await expect(await activeTile(page, room, 'Leaf')).toHaveClass(/is-selected/)
  await page.locator('.action-sidebar-item[title^="Delete entry ·"]').click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Leaf')).toBeUndefined()
  await expect(page.locator('.editor-scrim')).toHaveCount(0)

  await addEntries(page, ['First leaf', 'Second leaf'])
  await page.keyboard.press('Control+a')
  await page.locator('.action-sidebar-item[title^="Delete entry ·"]').click()
  await expect.poll(async () => (await activeData(page, room)).length).toBe(0)
  await expect(page.locator('.editor-scrim')).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Delete entries', exact: true }).click()
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

  for (const shortcut of ['Shift+c', 'Shift+m']) {
    await page.keyboard.press(shortcut)
    await page.getByRole('button', { name: shortcut === 'Shift+c' ? 'Expand action sidebar' : 'Collapse action sidebar' }).click()
    const drawerBounds = await drawer.boundingBox()
    const toolSidebarBounds = await page.getByLabel('Actions and shortcuts').boundingBox()
    expect(drawerBounds.x + drawerBounds.width).toBeLessThanOrEqual(toolSidebarBounds.x)
    await expect(drawer.locator('.drawer-first-version')).toContainText(`First version: ${secondLabel}`)
    await expect(page.locator(`.version-card[data-version="${second}"]`)).toHaveClass(/compared/)
    await drawer.getByRole('button', { name: `Deselect first version ${secondLabel}` }).click()
    await expect(drawer).toContainText('Select the first version, then the second.')
    await expect(page.locator(`.version-card[data-version="${second}"]`)).not.toHaveClass(/compared/)
    await page.locator(`.version-card[data-version="${first}"]`).click()
    await expect(drawer.locator('.drawer-first-version')).toContainText(`First version: ${firstLabel}`)
    await page.locator(`.version-card[data-version="${second}"]`).click()
    await expect(drawer.locator('.comparison-content')).toBeVisible()
    const comparisonBounds = await drawer.boundingBox()
    const visibleToolSidebarBounds = await page.getByLabel('Actions and shortcuts').boundingBox()
    expect(comparisonBounds.x + comparisonBounds.width).toBeLessThanOrEqual(visibleToolSidebarBounds.x)
    await expect(drawer.locator('.drawer-head strong')).toContainText(shortcut === 'Shift+m'
      ? `${secondLabel} → ${firstLabel}` : `${firstLabel} ↔ ${secondLabel}`)
    await drawer.getByRole('button', { name: 'Abort and close' }).click()
    await expect(drawer).toHaveCount(0)
  }
})

test('rapid version and treemap clicks are applied before starting comparison or merge', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const first = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const second = (await state(page, room)).activeId
  await page.keyboard.press('4')
  const firstCard = page.locator(`.version-card[data-version="${first}"]`)
  const firstLabel = await firstCard.locator('.version-header-id').getAttribute('title')
  const drawer = page.locator('.compare-drawer')

  for (const [target, shortcut] of [['', 'C'], [' .tree-tile', 'M']]) {
    await expect(firstCard.locator(target || '.version-header-id').first()).toBeAttached()
    await page.evaluate(({ first, target, shortcut }) => {
      const element = document.querySelector(`.version-card[data-version="${first}"]${target}`)
      if (!element) throw new Error('Version click target is missing')
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: shortcut, shiftKey: true, bubbles: true }))
    }, { first, target, shortcut })
    await expect(drawer.locator('.drawer-first-version')).toContainText(`First version: ${firstLabel}`)
    await expect(firstCard).toHaveClass(/active/)
    await drawer.getByRole('button', { name: 'Abort and close' }).click()
    await expect(drawer).toHaveCount(0)
    await page.locator(`.version-card[data-version="${second}"]`).dispatchEvent('click')
    await expect(page.locator(`.version-card[data-version="${second}"]`)).toHaveClass(/active/)
  }
})

test('a pending treemap click cannot reactivate an old version after a merge', async ({ page }) => {
  await page.clock.install()
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const low = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const high = (await state(page, room)).activeId
  await page.keyboard.press('4')
  const lowCard = page.locator(`.version-card[data-version="${low}"]`)
  const highCard = page.locator(`.version-card[data-version="${high}"]`)
  await expect(lowCard.locator('.tree-tile').first()).toBeAttached()
  await expect(highCard.locator('.tree-tile').first()).toBeAttached()
  await lowCard.dispatchEvent('click')
  await expect(lowCard).toHaveClass(/active/)

  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await lowCard.locator('.tree-tile').first().dispatchEvent('click')
  await page.keyboard.press('Shift+m')
  await highCard.locator('.tree-tile').first().dispatchEvent('click')
  const dialog = page.getByRole('dialog', { name: 'Branch merge' })
  await expect(dialog).toBeVisible()
  const previousCount = (await state(page, room)).versions.length
  await page.clock.fastForward(10)
  await dialog.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(dialog).toHaveCount(0)
  await page.clock.fastForward(250)
  await expect.poll(async () => {
    const saved = await state(page, room)
    const merge = saved.versions.find((item) => item.id === saved.activeId)
    return { count: saved.versions.length, parentId: merge?.parentId, mergeSourceId: merge?.mergeSourceId }
  }).toEqual({ count: previousCount + 1, parentId: low, mergeSourceId: high })
})

test('merge dialog and committed history put the higher step into the lower step in either selection order', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First'])
  const low = (await state(page, room)).activeId
  await addEntries(page, ['Second'])
  const high = (await state(page, room)).activeId
  await page.keyboard.press('4')
  const lowLabel = await page.locator(`.version-card[data-version="${low}"] .version-header-id`).getAttribute('title')
  const highLabel = await page.locator(`.version-card[data-version="${high}"] .version-header-id`).getAttribute('title')
  for (const [first, second] of [[low, high], [high, low]]) {
    await page.keyboard.press('4')
    await page.locator(`.version-card[data-version="${first}"]`).click()
    await expect(page.locator(`.version-card[data-version="${first}"]`)).toHaveClass(/active/)
    await page.keyboard.press('Shift+m')
    await expect(page.locator('.drawer-first-version')).toContainText(`First version: ${first === low ? lowLabel : highLabel}`)
    await page.locator(`.version-card[data-version="${second}"]`).click()
    const dialog = page.getByRole('dialog', { name: 'Branch merge' })
    await expect(dialog.locator('.drawer-head strong')).toHaveText(`${highLabel} → ${lowLabel}`)
    await expect(dialog.locator('.merge-list-head')).toContainText(`${highLabel} source`)
    await expect(dialog.locator('.merge-list-head')).toContainText(`${lowLabel} target`)
    const previousCount = (await state(page, room)).versions.length
    await dialog.getByRole('button', { name: 'Confirm merge' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await state(page, room)).versions.length).toBe(previousCount + 1)
    await expect.poll(async () => {
      const saved = await state(page, room)
      const merge = saved.versions.find((item) => item.id === saved.activeId)
      return { parentId: merge?.parentId, mergeSourceId: merge?.mergeSourceId, change: merge?.change }
    }).toEqual({ parentId: low, mergeSourceId: high, change: `Merge ${highLabel} into ${lowLabel}` })
  }
})

test('entry merge dialog drafts and confirmation round-trip through replay', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Alpha', 'Beta'])
  await focusActive(page)
  await page.keyboard.press('Control+a')
  await (await activeTile(page, room, 'Alpha')).click({ button: 'right', position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: 'Merge selected entries' }).click()
  await page.getByLabel('Resulting entry name').fill('Combined')
  await page.locator('#merge-entry-description').fill('Merge description')
  await page.getByRole('button', { name: 'Merge entries', exact: true }).click()
  await expect.poll(async () => findNode(await activeData(page, room), 'Combined')?.description).toBe('Merge description')
  const original = await state(page, room)
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  const draft = log.events.findIndex((event) => event.dialog?.operation?.mode === 'merge'
    && event.dialog.operation.value === 'Combined' && event.dialog.operation.description === 'Merge description')
  expect(draft).toBeGreaterThanOrEqual(0)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'entry-merge.json', mimeType: 'application/json', buffer })
  await page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value + 1)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, draft)
  await expect(page.getByLabel('Resulting entry name')).toHaveValue('Combined')
  await expect(page.locator('#merge-entry-description')).toHaveValue('Merge description')
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect.poll(async () => findNode(await activeData(page, 'Interaction Log Replay'), 'Combined')?.description).toBe('Merge description')
  expect((await state(page, 'Interaction Log Replay')).versions.map(({ id, data }) => ({ id, data })))
    .toEqual(original.versions.map(({ id, data }) => ({ id, data })))
})

test('branch merge dialog choices and committed result round-trip through replay', async ({ page }) => {
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
  const firstLane = saved.versions.find((version) => version.id === first).lane
  const secondLane = saved.versions.find((version) => version.id === second).lane
  await page.keyboard.press(firstLane < secondLane ? 'ArrowUp' : 'ArrowDown')
  await expect.poll(async () => (await state(page, room)).activeId).toBe(first)
  await page.keyboard.press('4')

  const openMerge = async () => {
    await page.keyboard.press('Shift+m')
    await page.locator(`.version-card[data-version="${second}"]`).click()
    await expect(page.getByRole('dialog', { name: 'Branch merge' })).toBeVisible()
  }
  await openMerge()
  const dialog = page.getByRole('dialog', { name: 'Branch merge' })
  const row = dialog.locator('.merge-view-row').filter({ has: page.locator('.merge-entry-cell strong').getByText('First branch', { exact: true }) })
  await row.getByRole('button', { name: 'Omit' }).click()
  await row.getByRole('button', { name: 'Pick' }).click()
  await row.getByLabel('Parent for First branch in merged result').selectOption({ label: 'Base' })
  await dialog.getByRole('button', { name: 'Reset' }).click()
  await dialog.getByRole('button', { name: 'Abort merge' }).click()
  await openMerge()
  await row.getByLabel('Parent for First branch in merged result').selectOption({ label: 'Base' })
  await dialog.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => findNode(await activeData(page, room), 'Base')?.children.map((node) => node.value)).toContain('First branch')
  const original = await state(page, room)
  expect(new Set([original.versions.at(-1).parentId, original.versions.at(-1).mergeSourceId])).toEqual(new Set([first, second]))

  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const buffer = await readFile(await (await download).path())
  const log = JSON.parse(buffer.toString())
  const open = log.events.findIndex((event) => event.mergeDialog?.versionIds.length === 2)
  const omitted = log.events.findIndex((event) => Object.values(event.mergeDialog?.decisions ?? {}).includes('omit'))
  const parent = log.events.findIndex((event) => Object.values(event.mergeDialog?.parentOverrides ?? {}).some(Boolean))
  const reset = log.events.findIndex((event, index) => index > parent && event.mergeDialog
    && !Object.keys(event.mergeDialog.parentOverrides).length)
  const aborted = log.events.findIndex((event, index) => index > reset && event.mergeDialog === null)
  expect(open).toBeGreaterThanOrEqual(0)
  expect(omitted).toBeGreaterThan(open)
  expect(parent).toBeGreaterThan(omitted)
  expect(reset).toBeGreaterThan(parent)
  expect(aborted).toBeGreaterThan(reset)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Replay Interaction Log' }).click()
  await (await chooser).setFiles({ name: 'merge.json', mimeType: 'application/json', buffer })
  const seek = async (index) => page.getByLabel('Replay timeline').evaluate((slider, value) => {
    slider.value = String(value + 1)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, index)
  await seek(omitted)
  await expect(dialog.locator('.merge-preview-label[aria-label="First branch"]')).toHaveCount(0)
  await expect(dialog).toHaveAttribute('inert', '')
  await seek(parent)
  await expect(dialog.locator('.merge-preview-tile.depth-1')).toHaveCount(1)
  await seek(reset)
  await expect(dialog.locator('.merge-preview-tile.depth-1')).toHaveCount(0)
  await seek(aborted)
  await expect(dialog).toHaveCount(0)
  await seek(parent)
  await expect(dialog.locator('.merge-preview-tile.depth-1')).toHaveCount(1)
  await page.getByRole('button', { name: 'Jump to end' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => findNode(await activeData(page, 'Interaction Log Replay'), 'Base')?.children.map((node) => node.value)).toContain('First branch')
  const replayed = await state(page, 'Interaction Log Replay')
  expect(replayed.versions.map(({ id, data, parentId, mergeSourceId }) => ({ id, data, parentId, mergeSourceId })))
    .toEqual(original.versions.map(({ id, data, parentId, mergeSourceId }) => ({ id, data, parentId, mergeSourceId })))
  expect(await state(page, room)).toEqual(original)
  await seek(parent)
  await page.getByRole('button', { name: 'Exit replay' }).click()
  await expect(page.locator('.current-room-name')).toHaveText(room)
  await expect(dialog).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Settings' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Interaction Log' }).click()
  const log = JSON.parse((await readFile(await (await download).path())).toString())
  expect(log.events.filter((event) => event.action === 'Button: Confirm merge')).toHaveLength(1)
  const merged = log.events.filter((event) => event.action.startsWith('Merged '))
  expect(merged).toHaveLength(1)
  expect(merged[0].category).toBe('state')
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
  const visibleCenter = (tile) => tile.evaluate((element) => {
    const tile = element.getBoundingClientRect()
    const map = element.closest('.mini-map').getBoundingClientRect()
    return { x: (Math.max(tile.left, map.left) + Math.min(tile.right, map.right)) / 2,
      y: (Math.max(tile.top, map.top) + Math.min(tile.bottom, map.bottom)) / 2 }
  })
  const source = await visibleCenter(sourceTile)
  const target = await visibleCenter(targetTile)
  await page.mouse.click(source.x, source.y)
  await expect(sourceTile).toHaveClass(/is-selected/)
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
  await clearEntrySelection(page)
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

for (const count of [1, 2]) {
  test(`attaching ${count} ${count === 1 ? 'entry' : 'entries'} pushes conflicting roots only after drop`, async ({ page }) => {
    const sources = Array.from({ length: count }, (_, index) => ({
      id: `source${index}`, value: `Source ${index}`, children: [],
    }))
    const room = await openTreemapRoom(page, [
      ...sources, { id: 'target', value: 'Target', children: [] },
      { id: 'blocker', value: 'Blocker', children: [] },
      { id: 'manual-a', value: 'Manual A', children: [] },
      { id: 'manual-b', value: 'Manual B', children: [] },
    ], {
      positions: {
        source0: { x: -0.75, y: 0 }, source1: { x: -1.5, y: 0 },
        target: { x: 0, y: 0 }, blocker: { x: 0.62, y: 0 },
        'manual-a': { x: 1.8, y: 1.6 }, 'manual-b': { x: 2, y: 1.6 },
      },
      mapView: { zoom: 0.17, panX: 80, panY: 20, manual: true },
    })
    const card = page.locator('.version-card.active')
    if (count === 2) {
      await card.locator('[data-node="source0"]').click()
      await expect(card.locator('[data-node="source0"]')).toHaveClass(/is-selected/)
      await card.locator('[data-node="source1"]').click({ modifiers: ['Shift'] })
      await expect(card.locator('.tree-tile.is-selected')).toHaveCount(2)
    }
    const source = card.locator('[data-node="source0"]')
    const target = card.locator('[data-node="target"]')
    const blocker = card.locator('[data-node="blocker"]')
    const from = await source.boundingBox()
    const to = await target.boundingBox()
    const blockerBefore = await blocker.boundingBox()
    const before = await state(page, room)
    const transform = await card.locator('.treemap-svg > g').getAttribute('transform')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await expect(target).toHaveClass(/is-over/)
    expect(await blocker.boundingBox()).toEqual(blockerBefore)
    expect(await card.locator('.treemap-svg > g').getAttribute('transform')).toBe(transform)
    expect((await state(page, room)).versions.length).toBe(before.versions.length)
    await page.mouse.up()
    await expect.poll(async () => findNode(await activeData(page, room), 'Target')?.children.length).toBe(count)
    const saved = await state(page, room)
    const version = saved.versions.find((item) => item.id === saved.activeId)
    const original = before.versions.find((item) => item.id === before.activeId)
    expect(version.positions.blocker.x).toBeGreaterThan(original.positions.blocker.x)
    expect(version.positions.blocker.y).toBe(original.positions.blocker.y)
    expect(version.positions.target).toEqual(original.positions.target)
    expect(version.positions['manual-a']).toEqual(original.positions['manual-a'])
    expect(version.positions['manual-b']).toEqual(original.positions['manual-b'])
    const targetWidth = Number(await page.locator('.version-card.active [data-node="target"]').getAttribute('width'))
    expect(version.positions.blocker.x * 260).toBeCloseTo(targetWidth, 5)
    for (const id of ['target', 'blocker', 'manual-a', 'manual-b', ...sources.map((source) => source.id)]) {
      const margins = await page.locator(`.version-card.active [data-node="${id}"]`).evaluate((element) => {
        const tile = element.getBoundingClientRect()
        const viewport = element.closest('.mini-map').getBoundingClientRect()
        return [tile.left - viewport.left, tile.top - viewport.top, viewport.right - tile.right, viewport.bottom - tile.bottom]
      })
      expect(Math.min(...margins)).toBeGreaterThan(-2)
    }
    await page.reload()
    const reloaded = await state(page, room)
    expect(reloaded.versions.find((item) => item.id === reloaded.activeId).positions).toEqual(version.positions)
  })
}

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

test('detaching into empty space and canceling an outside drop', async ({ page }) => {
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

for (const target of ['parent', 'child']) {
  test(`dragging a treemap onto its ${target === 'parent' ? 'own header' : 'descendant'} moves it and zooms only after release`, async ({ page }) => {
    const room = await openTreemapRoom(page, [
      { id: 'parent', value: 'Parent', children: [{ id: 'child', value: 'Child', children: [] }] },
    ], { positions: { parent: { x: 0.05, y: 0.05 } }, mapView: { zoom: 0.35, panX: 24, panY: 24, manual: true } })
    await page.waitForTimeout(500)
    const card = page.locator('.version-card.active')
    const parent = card.locator('[data-node="parent"]')
    const destination = card.locator(`[data-node="${target}"]`)
    const before = await state(page, room)
    const sizeBefore = await card.evaluate((element) => [element.style.width, element.style.height])
    const transformBefore = await card.locator('.treemap-svg > g').getAttribute('transform')
    const from = await parent.boundingBox()
    const to = await destination.boundingBox()
    const start = { x: from.x + 5, y: from.y + 5 }
    const end = target === 'parent' ? { x: from.x + 25, y: from.y + 12 }
      : { x: to.x + to.width / 2, y: to.y + to.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await expect(card.locator('.dragged-overlay')).not.toHaveCount(0)
    await expect(card.locator('.tree-tile.is-over')).toHaveCount(0)
    expect(await card.evaluate((element) => [element.style.width, element.style.height])).toEqual(sizeBefore)
    expect(await card.locator('.treemap-svg > g').getAttribute('transform')).toBe(transformBefore)
    await page.mouse.up()
    await expect.poll(async () => (await state(page, room)).versions.find((item) => item.id === 'v1').positions.parent)
      .not.toEqual(before.versions.find((item) => item.id === 'v1').positions.parent)
    const saved = await state(page, room)
    expect(saved.versions.length).toBe(before.versions.length)
    expect(findNode(saved.versions.find((item) => item.id === 'v1').data, 'Parent').children[0].value).toBe('Child')
    expect(await card.evaluate((element) => [element.style.width, element.style.height])).toEqual(sizeBefore)
    const view = saved.versions.find((item) => item.id === 'v1').mapView
    const expectedZoom = await parent.evaluate((tile) => {
      const viewport = tile.ownerSVGElement.viewBox.baseVal
      return Math.min(8, (viewport.width - 24) / Number(tile.getAttribute('width')),
        (viewport.height - 24) / Number(tile.getAttribute('height')))
    })
    expect(view.zoom).toBeGreaterThan(before.versions.find((item) => item.id === 'v1').mapView.zoom)
    expect(view.zoom).toBeCloseTo(expectedZoom, 6)
    const bounds = await parent.evaluate((element) => {
      const tile = element.getBoundingClientRect()
      const map = element.closest('.mini-map').getBoundingClientRect()
      return [tile.left - map.left, tile.top - map.top, map.right - tile.right, map.bottom - tile.bottom]
    })
    expect(Math.min(...bounds)).toBeGreaterThan(0)
    await page.reload()
    expect((await state(page, room)).versions.find((item) => item.id === 'v1').mapView).toEqual(view)
  })
}

test('moving a treemap can overlap another without displacing it', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'source', value: 'Source', children: [] }, { id: 'other', value: 'Other', children: [] },
  ], {
    positions: { source: { x: 0, y: 0 }, other: { x: 0.7, y: 0 } },
    mapView: { zoom: 0.35, panX: 24, panY: 24, manual: true },
  })
  await page.waitForTimeout(500)
  const card = page.locator('.version-card.active')
  const source = card.locator('[data-node="source"]')
  const box = await source.boundingBox()
  const beforeSize = await card.evaluate((element) => parseFloat(element.style.width))
  const start = { x: box.x + 5, y: box.y + 5 }
  const end = { x: box.x + box.width * 0.6, y: box.y + 5 }
  const initial = await state(page, room)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await expect(card.locator('.tree-tile.is-over')).toHaveCount(0)
  await page.mouse.up()
  await expect.poll(async () => (await state(page, room)).versions.find((item) => item.id === 'v1').positions.source.x).toBeGreaterThan(0.1)
  const version = (await state(page, room)).versions.find((item) => item.id === 'v1')
  expect(version.positions.other).toEqual(initial.versions.find((item) => item.id === 'v1').positions.other)
  expect(version.positions.source.x * 260 + 152).toBeGreaterThan(version.positions.other.x * 260)
  expect(await card.evaluate((element) => parseFloat(element.style.width))).toBe(beforeSize)
  expect(version.treemapOrder).toEqual(['other', 'source'])
  await expect(card.locator('[data-overlap-root="source"]')).toHaveCount(1)
  await expect(card.locator('[data-overlap-root="other"]')).toHaveCount(0)
  const hit = await card.evaluate((element) => {
    const source = element.querySelector('[data-node="source"]').getBoundingClientRect()
    const other = element.querySelector('[data-node="other"]').getBoundingClientRect()
    return { x: (Math.max(source.left, other.left) + Math.min(source.right, other.right)) / 2,
      y: (Math.max(source.top, other.top) + Math.min(source.bottom, other.bottom)) / 2 }
  })
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-node'), hit)).toBe('source')
  for (const id of ['other', 'source']) {
    const margins = await card.locator(`[data-node="${id}"]`).evaluate((element) => {
      const tile = element.getBoundingClientRect()
      const map = element.closest('.mini-map').getBoundingClientRect()
      return [tile.left - map.left, tile.top - map.top, map.right - tile.right, map.bottom - tile.bottom]
    })
    expect(Math.min(...margins)).toBeGreaterThan(0)
  }
  await page.reload()
  const reloaded = (await state(page, room)).versions.find((item) => item.id === 'v1')
  expect(reloaded.positions).toEqual(version.positions)
  expect(reloaded.treemapOrder).toEqual(['other', 'source'])
  await page.keyboard.press('1')
  await addEntries(page, ['New entry'])
  const next = await state(page, room)
  expect(next.versions.find((item) => item.id === next.activeId).treemapOrder).toEqual(['other', 'source'])
})

test('moving an offscreen treemap does not zoom in when all content cannot fit', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'parent', value: 'Parent', children: [{ id: 'child', value: 'Child', children: [] }] },
  ], { positions: { parent: { x: 0, y: 0 } }, mapView: { zoom: 2, panX: 12, panY: 12, manual: true } })
  await page.waitForTimeout(500)
  const card = page.locator('.version-card.active')
  const parent = card.locator('[data-node="parent"]')
  const box = await parent.boundingBox()
  const size = await card.evaluate((element) => [element.style.width, element.style.height])
  await page.mouse.move(box.x + 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 24, box.y + 8, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await state(page, room)).versions.find((item) => item.id === 'v1').positions.parent.x).toBeGreaterThan(0)
  expect(await card.evaluate((element) => [element.style.width, element.style.height])).toEqual(size)
  expect((await state(page, room)).versions.find((item) => item.id === 'v1').mapView.zoom).toBeLessThanOrEqual(2)
})

test('legacy resized versions use the standard window size', async ({ page }) => {
  const room = await openTreemapRoom(page, [{ id: 'parent', value: 'Parent', children: [] }], {
    windowScale: { width: 0.5, height: 0.5 }, mapView: { zoom: 0.35, panX: 24, panY: 24, manual: true },
  })
  const card = page.locator('.version-card.active')
  const root = page.locator('.version-card.root-version')
  expect(await card.evaluate((element) => element.style.width)).toBe(await root.evaluate((element) => element.style.width))
  expect((await state(page, room)).versions.find((item) => item.id === 'v1').windowScale).toEqual({ width: 0.5, height: 0.5 })
})

test('treemap moves, stacking and view zoom synchronize to collaborators', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    const room = await openTreemapRoom(host, [
      { id: 'parent', value: 'Parent', children: [] }, { id: 'other', value: 'Other', children: [] },
    ], {
      positions: { parent: { x: 0, y: 0 }, other: { x: 0.7, y: 0 } },
      mapView: { zoom: 0.35, panX: 24, panY: 24, manual: true },
    })
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected')
    await expect.poll(async () => (await state(guest, room)).versions.some((version) => version.id === 'v1')).toBe(true)
    await host.waitForTimeout(500)
    const box = await host.locator('.version-card.active [data-node="parent"]').boundingBox()
    await host.mouse.move(box.x + 5, box.y + 5)
    await host.mouse.down()
    await host.mouse.move(box.x + box.width * 0.6, box.y + 5, { steps: 4 })
    await host.mouse.up()
    await expect.poll(async () => (await state(host, room)).versions.find((version) => version.id === 'v1').mapView.zoom).toBeGreaterThan(0.35)
    const hostVersion = (await state(host, room)).versions.find((version) => version.id === 'v1')
    expect(hostVersion.treemapOrder).toEqual(['other', 'parent'])
    await expect.poll(async () => {
      const version = (await state(guest, room)).versions.find((item) => item.id === 'v1')
      return { positions: version.positions, treemapOrder: version.treemapOrder, mapView: version.mapView }
    }).toEqual({ positions: hostVersion.positions, treemapOrder: hostVersion.treemapOrder, mapView: hostVersion.mapView })
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})

test('drop targeting follows the persisted treemap stacking order', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'front', value: 'Front', children: [] }, { id: 'back', value: 'Back', children: [] },
    { id: 'source', value: 'Source', children: [] },
  ], {
    positions: { front: { x: 0, y: 0 }, back: { x: 0, y: 0 }, source: { x: 1.6, y: 0 } },
    treemapOrder: ['back', 'front', 'source'],
    mapView: { zoom: 0.35, panX: 20, panY: 20, manual: true },
  })
  await page.waitForTimeout(500)
  const card = page.locator('.version-card.active')
  const front = card.locator('[data-node="front"]')
  const back = card.locator('[data-node="back"]')
  const source = card.locator('[data-node="source"]')
  const from = await source.boundingBox()
  const to = await front.boundingBox()
  await page.mouse.move(from.x + 5, from.y + 5)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 })
  await expect(front).toHaveClass(/is-over/)
  await expect(back).not.toHaveClass(/is-over/)
  await page.mouse.up()
  await expect.poll(async () => findNode(await activeData(page, room), 'Front')?.children.map((node) => node.value)).toEqual(['Source'])
  const saved = await state(page, room)
  expect(saved.versions.find((item) => item.id === saved.activeId).treemapOrder.at(-1)).toBe('front')
})

test('overlapping treemaps remain opaque and hit testing selects the topmost target', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'lower', value: 'Lower', children: [{ id: 'lower-child', value: 'Lower child', children: [] }] },
    { id: 'upper', value: 'Upper', children: [] },
    { id: 'source', value: 'Source', children: [] },
  ], {
    positions: { lower: { x: 0, y: 0 }, upper: { x: 0, y: 0 }, source: { x: 1.6, y: 0 } },
    mapView: { zoom: 0.35, panX: 20, panY: 20, manual: true },
  })
  const card = page.locator('.version-card.active')
  const upper = card.locator('[data-node="upper"]')
  const lower = card.locator('[data-node="lower"]')
  const source = card.locator('[data-node="source"]')
  const initial = await state(page, room)
  const upperBox = await upper.boundingBox()
  const lowerBox = await lower.boundingBox()
  expect(lowerBox.y + lowerBox.height).toBeGreaterThan(upperBox.y + upperBox.height)
  const lowerChildBox = await card.locator('[data-node="lower-child"]').boundingBox()
  const hit = { x: lowerChildBox.x + 8, y: lowerChildBox.y + 8 }
  expect(hit.x).toBeLessThan(upperBox.x + upperBox.width)
  expect(hit.y).toBeLessThan(upperBox.y + upperBox.height)
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-node'), hit)).toBe('upper')
  await upper.click({ position: { x: 5, y: 5 } })
  await expect(card.locator('.treemap-overlap-outline')).toHaveCount(1)
  await expect(card.locator('[data-overlap-root="upper"]')).toHaveCount(1)
  await expect(card.locator('[data-overlap-root="lower"]')).toHaveCount(0)
  expect(await card.locator('[data-overlap-root="upper"]').evaluate((element) => {
    const style = getComputedStyle(element)
    return [style.stroke, style.strokeDasharray, style.strokeLinecap]
  })).toEqual(['rgb(0, 0, 0)', '1px, 4px', 'round'])
  await source.click({ position: { x: 5, y: 5 } })
  await expect(card.locator('[data-overlap-root="source"]')).toHaveCount(0)
  expect(await upper.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  expect(await lower.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  const sourceBox = await source.boundingBox()
  await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5)
  await page.mouse.down()
  await page.mouse.move(hit.x, hit.y, { steps: 8 })
  await expect(upper).toHaveClass(/is-over/)
  await expect(card.locator('.treemap-drop-outline')).toHaveCount(1)
  await expect(card.locator('[data-node="lower-child"]')).not.toHaveClass(/is-over/)
  await page.mouse.up()
  await expect.poll(async () => findNode(await activeData(page, room), 'Upper')?.children.map((node) => node.value)).toEqual(['Source'])
  const saved = await state(page, room)
  const version = saved.versions.find((item) => item.id === saved.activeId)
  const previous = initial.versions.find((item) => item.id === 'v1')
  expect(version.positions.lower.x).toBe(previous.positions.lower.x)
  expect(version.positions.lower.y).toBeGreaterThan(previous.positions.lower.y)
  expect(version.positions.upper).toEqual(initial.versions.find((item) => item.id === 'v1').positions.upper)
  const gap = await card.evaluate((element) => {
    const upper = element.querySelector('[data-node="upper"]').getBoundingClientRect()
    const lower = element.querySelector('[data-node="lower"]').getBoundingClientRect()
    return lower.top - upper.bottom
  })
  expect(Math.abs(gap)).toBeLessThan(1)
  await page.reload()
  expect((await state(page, room)).versions.find((item) => item.id === saved.activeId).positions).toEqual(version.positions)
})

test('dragging a nested entry onto its descendant detaches at the requested position', async ({ page }) => {
  const room = await openTreemapRoom(page, [
    { id: 'parent', value: 'Parent', children: [
      { id: 'source', value: 'Source', children: [{ id: 'child', value: 'Child', children: [] }] },
    ] },
  ], { positions: { parent: { x: 0.05, y: 0.05 } }, mapView: { zoom: 0.35, panX: 24, panY: 24, manual: true } })
  await page.waitForTimeout(500)
  const card = page.locator('.version-card.active')
  const source = card.locator('[data-node="source"]')
  const child = card.locator('[data-node="child"]')
  const from = await source.boundingBox()
  const to = await child.boundingBox()
  const start = { x: from.x + 5, y: from.y + 5 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const expected = await source.evaluate((element, { start, end }) => {
    const matrix = element.getScreenCTM().inverse()
    const a = new DOMPoint(start.x, start.y).matrixTransform(matrix)
    const b = new DOMPoint(end.x, end.y).matrixTransform(matrix)
    return { x: (Number(element.getAttribute('x')) + b.x - a.x) / 260,
      y: (Number(element.getAttribute('y')) + b.y - a.y) / 220 }
  }, { start, end })
  const before = await state(page, room)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await expect(card.locator('.tree-tile.is-over')).toHaveCount(0)
  await page.mouse.up()
  await expect.poll(async () => (await activeData(page, room)).map((node) => node.value).sort()).toEqual(['Parent', 'Source'])
  const saved = await state(page, room)
  const version = saved.versions.find((item) => item.id === saved.activeId)
  expect(version.positions.parent).toEqual(before.versions.find((item) => item.id === 'v1').positions.parent)
  expect(version.positions.source.x).toBeCloseTo(expected.x, 3)
  expect(version.positions.source.y).toBeCloseTo(expected.y, 3)
  expect(findNode(version.data, 'Source').children[0].value).toBe('Child')
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
  await expect(parent).not.toContainText('...')
  const renderedParent = (await parent.textContent()).trim()
  expect(renderedParent.length).toBeGreaterThan(0)
  expect(parentName.startsWith(renderedParent)).toBe(true)
  const font = async (label) => card.locator(`.tile-label[aria-label="${label}"]`).evaluate((element) => getComputedStyle(element).fontSize)
  expect(await font(parentName)).toBe(await font('Nested parent'))
  expect(await font('Leaf one')).toBe(await font('Leaf two'))
  expect(parseFloat(await font(parentName))).toBe(32)
  expect(parseFloat(await font('Leaf one'))).toBe(36)
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
  const expandedOnly = ['Copy entry and children', 'Cut entry and children', 'Paste entry and children', 'Box select', 'Zoom version', 'Pan version',
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

test('left sidebar text uses enlarged sizes and remains accessible when scrolled or collapsed', async ({ page }) => {
  await openRoom(page)
  await addEntries(page, ['Sidebar entry'])
  await page.getByRole('button', { name: 'Settings' }).click()
  const sidebar = page.locator('.sidebar')
  const sizes = await sidebar.evaluate((element) => {
    const selectors = ['.brand-name', '.section-label', '.current-room-name', '.session-status', '.session-button',
      '.collaborator-info strong', '.collaborator-info small', '.interaction-heading small', '.interaction-action',
      '.interaction-reference', '.interaction-time', '.metric-row', '.metric-row strong', '.active-version-top',
      '.active-version-card > strong', '.active-meta', '.theme-toggle', '.volume-control']
    return selectors.map((selector) => parseFloat(getComputedStyle(element.querySelector(selector)).fontSize))
  })
  expect(sizes).toEqual([25.5, 13.5, 15, 12, 12, 13.5, 12, 10.5, 12, 10.5, 10.5, 15, 16.5, 15, 15, 13.5, 13.5, 15])
  await sidebar.locator('.active-version-card').scrollIntoViewIfNeeded()
  await expect(sidebar.locator('.active-version-card')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(sidebar.locator('.compact-interaction').first()).toHaveCSS('font-size', '27px')
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await page.setViewportSize({ width: 720, height: 800 })
  await expect(sidebar.locator('.brand-name')).toHaveCSS('font-size', '25.5px')
})

test('collapsed sidebar retains room, user and interaction navigation', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Compact log entry'])
  const version = (await state(page, room)).activeId
  const userColor = await page.locator('.interaction-user').first().evaluate((element) => getComputedStyle(element).color)
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  const sidebar = page.locator('.sidebar')
  await expect(sidebar.getByRole('button', { name: 'Change Room', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /Focus .+ \(you\)/ })).toBeVisible()
  const interaction = sidebar.locator('.compact-interaction').first()
  await expect(interaction).toBeEnabled()
  expect(await interaction.evaluate((element) => getComputedStyle(element).color)).toBe(userColor)
  expect(await page.evaluate((name) => JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`))
    .some((entry) => entry.action.includes('Compact log entry')), room)).toBe(true)
  await interaction.click()
  await expectCentered(page, version)
  await sidebar.getByRole('button', { name: 'Change Room', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /room/i })).toBeVisible()
})

test('recent interactions persist per room across reloads', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Room action'])
  await expect(page.locator('.interaction-section')).toContainText('Room action')
  const otherRoom = `test-${randomUUID()}`
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByLabel('Create a new empty room').fill(otherRoom)
  await page.getByRole('button', { name: 'Create room', exact: true }).click()
  await expect(page.locator('.current-room-name')).toHaveText(otherRoom)
  await expect(page.locator('.interaction-action')).not.toContainText('Room action')
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByRole('button', { name: room, exact: true }).click()
  await expect(page.locator('.interaction-section')).toContainText('Room action')
  expect(await page.evaluate((name) => JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`))
    .some((entry) => entry.action.includes('Room action')), room)).toBe(true)
  await page.reload()
  await expect(page.locator('.interaction-section')).toContainText('Room action')
  expect((await activeData(page, room)).some((entry) => entry.value === 'Room action')).toBe(true)
})

test('sidebar restores and stores only the ten most recent interactions', async ({ page }) => {
  const room = `test-${randomUUID()}`
  await page.addInitScript((name) => {
    const key = `canopy-interactions-${encodeURIComponent(name)}`
    if (localStorage.getItem(key)) return
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `entry-${index}`, actorId: 'actor', actorName: 'User', action: `Action ${index}`,
      createdAt: index, versionId: 'v0',
    }))
    localStorage.setItem(key, JSON.stringify(entries))
  }, room)
  await openRoom(page, room)
  await expect(page.locator('.interaction-list li')).toHaveCount(10)
  await expect(page.locator('.interaction-list li').first()).toContainText('Joined room')
  await expect(page.locator('.interaction-list li').last()).toContainText('Action 3')
  const saved = await page.evaluate((name) => JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`)), room)
  expect(saved).toHaveLength(10)
  expect(saved.map((entry) => entry.action)).toEqual([...Array.from({ length: 9 }, (_, index) => `Action ${index + 3}`), 'Joined room'])
  await addEntries(page, ['New action'])
  const updated = await page.evaluate((name) => JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`)), room)
  expect(updated).toHaveLength(10)
  expect(updated[0].action).toBe('Action 4')
  expect(updated.at(-1).action).toContain('New action')
  await page.reload()
  await expect(page.locator('.interaction-list li')).toHaveCount(10)
  await expect(page.locator('.interaction-list')).toContainText('New action')
})

test('sidebar restores recent actions in a new browser session', async ({ browser }) => {
  const first = await browser.newContext()
  let reopened
  try {
    const page = await first.newPage()
    const room = await openRoom(page)
    await addEntries(page, ['Persisted action'])
    const versionId = (await state(page, room)).activeId
    const storageState = await first.storageState()
    await first.close()
    reopened = await browser.newContext({ storageState })
    const nextPage = await reopened.newPage()
    await openRoom(nextPage, room)
    await expect(nextPage.locator('.interaction-section')).toContainText('Persisted action')
    await nextPage.locator('.interaction-section .interaction-reference').last().click()
    await expectCentered(nextPage, versionId)
  } finally {
    await first.close()
    if (reopened) await reopened.close()
  }
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
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await page.evaluate(() => { window.recordedSounds = [] })
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

test('sound starts muted despite saved preferences and resets for each room session', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('canopy-muted', 'false')
    window.recordedSounds = []
    window.Audio = class {
      play() { window.recordedSounds.push('played'); return Promise.resolve() }
    }
  })
  await openRoom(page)
  await addEntries(page, ['Silent'])
  expect(await page.evaluate(() => window.recordedSounds)).toEqual([])
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await expect.poll(() => page.evaluate(() => window.recordedSounds.length)).toBeGreaterThan(0)
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible()
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await page.getByRole('button', { name: 'Change Room', exact: true }).click()
  await page.getByPlaceholder('Room name', { exact: true }).fill(`muted-${randomUUID()}`)
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page.locator('.current-room-name')).toHaveText(/^muted-/)
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
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
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
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
  await expect(page.getByTitle(/new-/)).toBeVisible()
  expect(await takeSounds()).toEqual([])
})

test('opening an invite starts muted', async ({ browser }) => {
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
    expect(await guest.evaluate(() => window.recordedSounds)).toEqual([])
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
    await expect.poll(async () => (await state(host, room)).activeId).not.toBe(parent)
    const target = (await state(host, room)).activeId
    await host.keyboard.press('Control+z')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(parent)
    await expect.poll(async () => (await state(guest, room)).copyLinks.length).toBe(0)
    await expect.poll(async () => (await state(guest, room)).versions.some((version) => version.id === target)).toBe(false)
    await host.keyboard.press('Control+y')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(target)
    await expect.poll(async () => (await state(guest, room)).copyLinks.length).toBe(1)
    await host.keyboard.press('Control+z')
    await expect.poll(async () => (await state(guest, room)).activeId).toBe(parent)
    await addEntries(guest, ['Peer edit'])
    await expect.poll(async () => (await state(host, room)).versions.some((version) => !!findNode(version.data, 'Peer edit'))).toBe(true)
    await host.keyboard.press('Control+y')
    await expect.poll(async () => (await state(host, room)).versions.some((version) => version.id === target)).toBe(false)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('collaborative pings keep the same global position across window sizes', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 900 } }),
    browser.newContext({ viewport: { width: 980, height: 720 } }),
  ])
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()))
  try {
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })

    await host.locator('.action-sidebar-item[title^="Ping ·"]').click()
    const canvasBounds = await host.locator('.graph-canvas').boundingBox()
    const clickX = canvasBounds.width * 0.37
    const clickY = canvasBounds.height * 0.71
    await host.mouse.click(canvasBounds.x + clickX, canvasBounds.y + clickY)
    await expect(host.locator('.ping-origin')).toHaveCount(1)
    await expect(guest.locator('.ping-origin')).toHaveCount(1)

    const recordedPing = async (page) => page.evaluate((name) => {
      const entries = JSON.parse(localStorage.getItem(`canopy-interactions-${encodeURIComponent(name)}`))
      return entries.findLast((entry) => entry.action === 'Ping').ping
    }, room)
    await expect.poll(async () => recordedPing(host)).toMatchObject({ coordinateSpace: 'global' })
    expect(await recordedPing(guest)).toMatchObject(await recordedPing(host))
    const guestCanvas = await guest.locator('.graph-canvas').boundingBox()
    expect(guestCanvas.width).not.toBe(canvasBounds.width)
    expect(guestCanvas.height).not.toBe(canvasBounds.height)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('local editing shortcuts and version merge use their assigned scopes', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['First', 'Second'])
  await focusActive(page)
  await clearEntrySelection(page)
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
  await expect(page.locator('.compare-drawer')).toContainText('Choose two versions')
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

test('a burst of map wheel events is rendered together and fully persisted', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Burst zoom'])
  await focusActive(page)
  const before = await state(page, room)
  const version = before.versions.find((item) => item.id === before.activeId)
  const map = page.locator('.version-card.active .mini-map')
  const rendered = await map.evaluate(async (element) => {
    const bounds = element.getBoundingClientRect()
    const group = element.querySelector('svg > g')
    let changes = 0
    const observer = new MutationObserver((records) => { changes += records.length })
    observer.observe(group, { attributes: true, attributeFilter: ['transform'] })
    for (let index = 0; index < 10; index++) element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, shiftKey: true, deltaY: -30,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
    }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    observer.disconnect()
    return changes
  })
  expect(rendered).toBe(1)
  await expect.poll(async () => (await state(page, room)).versions.find((item) => item.id === version.id).mapView.zoom)
    .toBeCloseTo(version.mapView.zoom * Math.exp(300 * 0.0012), 5)
})

test('regular wheel zooms the graph while shift wheel zooms the version map', async ({ page }) => {
  const room = await openRoom(page)
  await addEntries(page, ['Map entry'])
  await focusActive(page)
  await clearEntrySelection(page)
  const map = page.locator('.version-card.active .mini-map')
  const world = page.locator('.graph-world')
  const content = map.locator('svg > g')
  await map.hover()
  const graphBefore = await world.getAttribute('style')
  const mapBefore = await content.getAttribute('transform')
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
  await clearEntrySelection(page)
  await contextAction(page, room, 'Parent', 'Add child')
  await fillEntries(page, ['Child'])
  const source = (await state(page, room)).activeId
  await focusActive(page)
  await page.keyboard.press('Control+a')
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(3)
  await page.keyboard.press('Control+c')
  await clearEntrySelection(page)
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

test('pasting into an existing treemap moves conflicting treemaps without overlap', async ({ page }) => {
  const data = [
    { id: 'target', value: 'Target', children: [] },
    { id: 'source', value: 'Source', children: [] },
    { id: 'other', value: 'Other', children: [] },
  ]
  const positions = { target: { x: 0, y: 0 }, source: { x: 0.6, y: 0 }, other: { x: 1.2, y: 0 } }
  const room = await openTreemapRoom(page, data, { positions })
  await (await activeTile(page, room, 'Source')).click({ position: { x: 8, y: 8 } })
  await expect(page.locator('.version-card.active .tree-tile.is-selected')).toHaveCount(1)
  await page.keyboard.press('Control+c')
  await (await activeTile(page, room, 'Target')).click({ position: { x: 8, y: 8 } })
  await expect(await activeTile(page, room, 'Target')).toHaveClass(/is-selected/)
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await activeData(page, room))[0].children.length).toBe(1)
  const saved = await state(page, room)
  const pasted = saved.versions.find((item) => item.id === saved.activeId)
  expect(pasted.data[0].children[0].value).toBe('Source')
  expect(pasted.positions.source.x).toBeGreaterThan(positions.source.x)
  await expect(page.locator('.version-card.active .treemap-overlap-outline')).toHaveCount(0)
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

test('root label remains inside the box at maximum zoom near either edge', async ({ page }) => {
  await openRoom(page)
  const root = page.locator('.root-version')
  const canvas = page.locator('.graph-canvas')
  const label = root.locator('.root-overview-label')
  for (const edge of ['left', 'right']) {
    await page.keyboard.press('1')
    await page.waitForTimeout(500)
    const focusedScale = await page.locator('.graph-world').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
    const rootBounds = await root.boundingBox()
    const canvasBounds = await canvas.boundingBox()
    const centerX = canvasBounds.x + canvasBounds.width / 2
    const edgeX = edge === 'left' ? rootBounds.x : rootBounds.x + rootBounds.width
    const desiredEdge = centerX + (edge === 'left' ? -100 : 100)
    const y = canvasBounds.y + canvasBounds.height * 0.3
    await page.mouse.move(centerX, y)
    await page.mouse.down()
    await page.mouse.move(centerX + desiredEdge - edgeX, y, { steps: 6 })
    await page.mouse.up()
    await page.mouse.move(centerX, y)
    await page.mouse.wheel(0, -3000)
    await expect.poll(() => page.locator('.graph-world').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a))
      .toBeCloseTo(focusedScale, 3)
    const result = await root.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const content = element.querySelector('.root-overview-label')
      const text = content.getBoundingClientRect()
      const viewport = element.closest('.graph-canvas').getBoundingClientRect()
      return { left: box.left, right: box.right, labelLeft: text.left, labelRight: text.right,
        viewportLeft: viewport.left, viewportRight: viewport.right, overflow: getComputedStyle(content).overflow }
    })
    expect(result[edge]).toBeGreaterThan(result.viewportLeft)
    expect(result[edge]).toBeLessThan(result.viewportRight)
    expect(result.labelLeft).toBeGreaterThanOrEqual(result.left - 1)
    expect(result.labelRight).toBeLessThanOrEqual(result.right + 1)
    expect(result.overflow).toBe('hidden')
  }
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

test('long unbroken labels wrap within the tile and expose their complete text on hover', async ({ page }) => {
  const room = await openRoom(page)
  const label = 'Averylongunbrokenentrynamewhichmustnotwrapintoseparatefragments'
  await addEntries(page, [label])
  await focusActive(page)
  const tile = await activeTile(page, room, label)
  const text = page.locator('.version-card.active .tile-label')
  await expect(text).toHaveAttribute('aria-label', label)
  await expect(text.locator('tspan')).not.toHaveCount(0)
  const geometry = await text.evaluate((element) => {
    const textBox = element.getBBox()
    const tileBox = element.parentElement.querySelector('.tree-tile').getBBox()
    return { text: { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height },
      tile: { x: tileBox.x, y: tileBox.y, width: tileBox.width, height: tileBox.height } }
  })
  expect(geometry.text.x + geometry.text.width).toBeLessThanOrEqual(geometry.tile.x + geometry.tile.width)
  expect(geometry.text.y + geometry.text.height).toBeLessThanOrEqual(geometry.tile.y + geometry.tile.height)
  await tile.hover()
  await expect(page.getByRole('tooltip')).toContainText(label)
  expect(await text.evaluate((element) => getComputedStyle(element).fontFamily)).not.toMatch(/mono/i)
})

test('low-zoom treemap tooltips do not cover their source version', async ({ page }) => {
  const room = await openRoom(page)
  for (let index = 0; index < 7; index++) await addEntries(page, [`Tooltip entry ${index}`])
  await page.getByRole('button', { name: 'Fit all versions, 4' }).click()
  const activeVersion = (await state(page, room)).activeId
  const card = page.locator(`.version-card[data-version="${activeVersion}"]`)
  await expect(card).toHaveClass(/compact/)
  await expect(card).toHaveClass(/lod-overview/)
  await card.hover({ force: true })
  const tooltip = page.locator('.overview-preview')
  await expect(tooltip).toBeVisible()
  const position = await tooltip.evaluate((element, versionId) => {
    const tip = element.getBoundingClientRect()
    const card = document.querySelector(`.version-card[data-version="${versionId}"]`).getBoundingClientRect()
    return { inViewport: tip.left >= 0 && tip.top >= 0 && tip.right <= window.innerWidth && tip.bottom <= window.innerHeight,
      overlapsCard: tip.left < card.right && tip.right > card.left && tip.top < card.bottom && tip.bottom > card.top }
  }, activeVersion)
  expect(position.inViewport).toBe(true)
  expect(position.overlapsCard).toBe(false)
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
  await expect(page.getByPlaceholder('Entry name').nth(1)).toBeFocused()
  await page.getByPlaceholder('Entry name').nth(1).fill('Second')
  await page.getByRole('button', { name: 'Add 2 entries' }).click()
  await expect.poll(async () => (await state(page, room)).versions.at(-1).change).toBe('Created 2 items')
  await focusActive(page)
  const describedEntry = await activeTile(page, room, 'First')
  await expect(describedEntry.locator('title')).toHaveCount(0)
  await describedEntry.hover()
  await expect(page.locator('.entry-tooltip')).toContainText('A helpful description', { timeout: 1500 })
  await expect(page.locator('.entry-tooltip')).toHaveCount(1)
  await page.keyboard.press('Control+a')
  await page.locator('.version-card.active .tree-tile').first().click({ button: 'right' })
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

for (const departure of ['switches rooms', 'closes unexpectedly']) test(`host ${departure}: connected peers elect a replacement`, async ({ browser }) => {
  test.setTimeout(60000)
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  for (const context of contexts.slice(1)) await context.addInitScript(() => {
    const send = RTCDataChannel.prototype.send
    RTCDataChannel.prototype.send = function (data) {
      if (!window.dropRoomMessages) send.call(this, data)
    }
  })
  const [host, first, second] = await Promise.all(contexts.map((context) => context.newPage()))
  try {
    const room = await openRoom(host)
    await addEntries(host, ['Before handover'])
    for (const guest of [first, second]) {
      await guest.goto(`/?room=${room}`)
      await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
      await expect.poll(async () => (await state(guest, room)).versions
        .some((version) => findNode(version.data, 'Before handover'))).toBe(true)
    }
    await expect(first.locator('.collaborator-list .collaborator')).toHaveCount(3)
    const peerIds = await Promise.all([first, second].map((page) => page.evaluate(() =>
      window.testPeers.find((peer) => peer.open && !peer.destroyed).id)))
    const elected = peerIds.indexOf([...peerIds].sort()[0])
    const unsynced = [first, second][1 - elected]
    await unsynced.evaluate(() => { window.dropRoomMessages = true })
    await addEntries(unsynced, ['Unrelayed edit'])
    await unsynced.evaluate(() => { window.dropRoomMessages = false })
    if (departure === 'switches rooms') {
      await host.getByRole('button', { name: 'Change Room' }).click()
      await host.getByLabel('Create a new empty room').fill(`next-${randomUUID()}`)
      await host.getByRole('button', { name: 'Create room' }).click()
    } else await contexts[0].close()
    await expect.poll(async () => Promise.all([first, second].map((page) => page.getByRole('status').first().textContent())),
      { timeout: 40000 }).toEqual(expect.arrayContaining(['Hosting', 'Connected']))
    await expect([first, second][elected].getByRole('status').first()).toHaveText('Hosting')
    await expect.poll(async () => (await state([first, second][elected], room)).versions
      .some((version) => findNode(version.data, 'Unrelayed edit')), { timeout: 20000 }).toBe(true)
    await addEntries(first, ['After handover'])
    await expect.poll(async () => (await state(second, room)).versions
      .some((version) => findNode(version.data, 'After handover')), { timeout: 20000 }).toBe(true)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('a guest reconnects after its room connection closes', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  await guestContext.addInitScript(() => {
    const create = RTCPeerConnection.prototype.createDataChannel
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = create.apply(this, args)
      window.testRoomChannel = channel
      return channel
    }
  })
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await guest.evaluate(() => window.testRoomChannel.close())
    await expect(guest.getByRole('status').first()).toContainText('Reconnecting')
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await addEntries(guest, ['After reconnect'])
    await expect.poll(async () => (await state(host, room)).versions
      .some((version) => findNode(version.data, 'After reconnect')), { timeout: 20000 }).toBe(true)
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()])
  }
})

test('the only guest becomes host when the host explicitly leaves', async ({ browser }) => {
  const [hostContext, guestContext] = await Promise.all([browser.newContext(), browser.newContext()])
  try {
    const [host, guest] = await Promise.all([hostContext.newPage(), guestContext.newPage()])
    const room = await openRoom(host)
    await addEntries(host, ['Saved before leaving'])
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await host.getByRole('button', { name: 'Change Room' }).click()
    await host.getByLabel('Create a new empty room').fill(`next-${randomUUID()}`)
    await host.getByRole('button', { name: 'Create room' }).click()
    await expect(guest.getByRole('status').first()).toHaveText('Hosting', { timeout: 20000 })
    await expect.poll(async () => (await state(guest, room)).versions
      .some((version) => findNode(version.data, 'Saved before leaving'))).toBe(true)
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()])
  }
})

test('leaving during reconnection does not return to the previous room', async ({ browser }) => {
  const [hostContext, guestContext] = await Promise.all([browser.newContext(), browser.newContext()])
  await guestContext.addInitScript(() => {
    const create = RTCPeerConnection.prototype.createDataChannel
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = create.apply(this, args)
      window.testRoomChannel = channel
      return channel
    }
  })
  try {
    const [host, guest] = await Promise.all([hostContext.newPage(), guestContext.newPage()])
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await guest.evaluate(() => window.testRoomChannel.close())
    await expect(guest.getByRole('status').first()).toContainText('Reconnecting')
    const next = `next-${randomUUID()}`
    await guest.getByRole('button', { name: 'Change Room' }).click()
    await guest.getByLabel('Create a new empty room').fill(next)
    await guest.getByRole('button', { name: 'Create room' }).click()
    await expect(guest.getByRole('status').first()).toHaveText('Hosting')
    await guest.waitForTimeout(2500)
    await expect(guest.locator('.current-room-name')).toHaveText(next)
    await expect(guest.getByRole('status').first()).toHaveText('Hosting')
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()])
  }
})

test('a disconnected guest is warned when the room cannot be resumed', async ({ browser }) => {
  const [hostContext, guestContext] = await Promise.all([browser.newContext(), browser.newContext()])
  await guestContext.addInitScript(() => {
    const create = RTCPeerConnection.prototype.createDataChannel
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = create.apply(this, args)
      window.testRoomChannel = channel
      return channel
    }
  })
  try {
    const [host, guest] = await Promise.all([hostContext.newPage(), guestContext.newPage()])
    const room = await openRoom(host)
    await guest.goto(`/?room=${room}`)
    await expect(guest.getByRole('status').first()).toHaveText('Connected', { timeout: 20000 })
    await guest.evaluate(() => window.testRoomChannel.close())
    await expect(guest.getByRole('status').first()).toContainText('Reconnecting')
    await hostContext.close()
    await expect(guest.getByRole('status').first()).toContainText('no longer available', { timeout: 30000 })
    await expect(guest.locator('.current-room-name')).toHaveText(room)
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()])
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
    await host.getByRole('button', { name: 'Settings' }).click()
    const download = host.waitForEvent('download')
    await host.getByRole('button', { name: 'Export Interaction Log' }).click()
    const buffer = await readFile(await (await download).path())
    const log = JSON.parse(buffer.toString())
    const actorForVersion = (id) => log.events.find((event) => event.category === 'state'
      && event.patch.versions.some((version) => version.id === id))?.actor.id
    const chooser = host.waitForEvent('filechooser')
    await host.getByRole('button', { name: 'Replay Interaction Log' }).click()
    await (await chooser).setFiles({ name: 'concurrent.json', mimeType: 'application/json', buffer })
    await expect(host.locator('.current-room-name')).toHaveText('Interaction Log Replay')
    const expectedChildren = hostChildren.map((item) => [item.id, item.number]).sort()
    for (const child of hostChildren) {
      await host.getByLabel('Replay user').selectOption(actorForVersion(child.id))
      await host.getByRole('button', { name: 'Jump to end' }).click()
      await expect.poll(async () => (await state(host, 'Interaction Log Replay')).versions
        .filter((item) => item.parentId === parent).map((item) => [item.id, item.number]).sort())
        .toEqual(expectedChildren)
    }
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
    await host.getByRole('button', { name: 'Settings' }).click()
    const download = host.waitForEvent('download')
    await host.getByRole('button', { name: 'Export Interaction Log' }).click()
    const buffer = await readFile(await (await download).path())
    const log = JSON.parse(buffer.toString())
    const winnerActorId = log.events.find((event) => event.category === 'state'
      && event.patch.versions.some((version) => version.id === id && version.tag?.title === winner.title))?.actor.id
    const chooser = host.waitForEvent('filechooser')
    await host.getByRole('button', { name: 'Replay Interaction Log' }).click()
    await (await chooser).setFiles({ name: 'conflict.json', mimeType: 'application/json', buffer })
    await expect(host.locator('.current-room-name')).toHaveText('Interaction Log Replay')
    await host.getByLabel('Replay user').selectOption(winnerActorId)
    await host.getByRole('button', { name: 'Jump to end' }).click()
    await expect.poll(async () => (await state(host, 'Interaction Log Replay')).versions.find((version) => version.id === id)?.tag)
      .toEqual(winner)
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
