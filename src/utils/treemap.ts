import type { MapView, Tile, TreeNode } from '../types/workspace'
import { nodeParentIds } from './tree'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'

let labelContext: CanvasRenderingContext2D | null | undefined
export function layoutTileLabel(tile: Tile) {
  const width = Math.max(0, tile.width - 10)
  const height = Math.max(0, Math.min(tile.height, tile.hasChildren ? TREE_HEADER_HEIGHT : tile.height) - 6)
  const fontSize = tile.hasChildren ? 16 : 18
  const maxLines = tile.hasChildren ? Math.min(1, Math.floor(height / (fontSize * 1.15))) : Math.floor(height / (fontSize * 1.15))
  if (!maxLines) return { fontSize, lines: [] as string[] }
  if (labelContext === undefined && typeof document !== 'undefined') {
    labelContext = document.createElement('canvas').getContext('2d')
  }
  if (labelContext) labelContext.font = `500 ${fontSize}px Arial, sans-serif`
  const measure = (text: string) => labelContext
    ? labelContext.measureText(text).width : text.length * fontSize * 0.65
  if (measure('...') > width) return { fontSize, lines: [] as string[] }
  if (tile.hasChildren) {
    let text = tile.label.trim()
    if (measure(text) > width) {
      while (text && measure(`${text}...`) > width) text = Array.from(text).slice(0, -1).join('')
      text = `${text.trimEnd()}...`
    }
    return { fontSize, lines: text ? [text] : [] }
  }
  const words = tile.label.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  let truncated = false
  for (const word of words) {
    const pieces = word.match(/[^-]+-?|-/g) ?? [word]
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index]!
      const separator = index === 0 && line ? ' ' : ''
      if (measure(line + separator + piece) <= width) {
        line += separator + piece
        continue
      }
      if (line) { lines.push(line); line = '' }
      if (lines.length >= maxLines) { truncated = true; break }
      if (measure(piece) > width) {
        let shortened = piece
        while (shortened && measure(`${shortened}...`) > width) shortened = Array.from(shortened).slice(0, -1).join('')
        line = `${shortened}...`
        truncated = true
        break
      }
      line = piece
    }
    if (truncated) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (truncated && lines.length && !lines.at(-1)!.endsWith('...')) {
    let last = lines.at(-1)!
    while (last && measure(`${last}...`) > width) last = Array.from(last).slice(0, -1).join('')
    lines[lines.length - 1] = `${last.trimEnd()}...`
  }
  return { fontSize, lines }
}

export const CARD_WIDTH = 260
export const CARD_HEIGHT = 260
export const TREE_MAP_HEIGHT = CARD_HEIGHT - 40
const LEAF_TILE_WIDTH = 152
const LEAF_TILE_HEIGHT = 106
const TREE_PADDING = 8
const TREE_HEADER_HEIGHT = 28
export const MAP_PADDING = 12
export const MAP_GAP = 12
const VERSION_TREEMAP_ASPECT = (CARD_WIDTH - 14) / (CARD_HEIGHT - 47)
export const MAP_ZOOM_MIN = 0.0001
export const MAP_ZOOM_MAX = 8

export function fitMapViewToLayout(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  view: MapView,
  padding = MAP_PADDING,
  viewport = { width: CARD_WIDTH - 14, height: CARD_HEIGHT - 47 },
): MapView {
  const geometry = mapGeometry(data, positions, viewport.width, viewport.height)
  const fit = Math.max(MAP_ZOOM_MIN, Math.min(
    1,
    (viewport.width - padding * 2) / geometry.width,
    (viewport.height - padding * 2) / geometry.height,
  ))
  if (view.zoom <= fit) return view
  return {
    zoom: fit,
    panX: (viewport.width - geometry.width * fit) / 2 - geometry.minX * fit,
    panY: (viewport.height - geometry.height * fit) / 2 - geometry.minY * fit,
    manual: true,
  }
}

export function fitMapViewAfterDrag(
  previousData: TreeNode[],
  previousPositions: Record<string, { x: number; y: number }> | undefined,
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  view: MapView,
  viewport: { width: number; height: number },
): MapView {
  const oldTiles = tilesForForest(previousData, previousPositions)
  const newTiles = new Map(tilesForForest(data, positions).map((tile) => [tile.id, tile]))
  const visible = {
    left: -view.panX / view.zoom, top: -view.panY / view.zoom,
    right: (viewport.width - view.panX) / view.zoom, bottom: (viewport.height - view.panY) / view.zoom,
  }
  const bounds: { left: number; top: number; right: number; bottom: number }[] = []
  for (const old of oldTiles) {
    const next = newTiles.get(old.id)
    if (!next || old.width <= 0 || old.height <= 0) continue
    const left = Math.max(old.x, visible.left)
    const top = Math.max(old.y, visible.top)
    const right = Math.min(old.x + old.width, visible.right)
    const bottom = Math.min(old.y + old.height, visible.bottom)
    if (left >= right || top >= bottom) continue
    bounds.push({
      left: next.x + (left - old.x) / old.width * next.width,
      top: next.y + (top - old.y) / old.height * next.height,
      right: next.x + (right - old.x) / old.width * next.width,
      bottom: next.y + (bottom - old.y) / old.height * next.height,
    })
  }
  if (!bounds.length) return view
  const left = Math.min(...bounds.map((bound) => bound.left))
  const top = Math.min(...bounds.map((bound) => bound.top))
  const right = Math.max(...bounds.map((bound) => bound.right))
  const bottom = Math.max(...bounds.map((bound) => bound.bottom))
  const padding = Math.min(MAP_PADDING, viewport.width / 4, viewport.height / 4)
  const scale = Math.max(MAP_ZOOM_MIN, Math.min(view.zoom,
    (viewport.width - padding * 2) / Math.max(1, right - left),
    (viewport.height - padding * 2) / Math.max(1, bottom - top)))
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  return {
    zoom: scale,
    panX: clamp(view.panX, padding - left * scale, viewport.width - padding - right * scale),
    panY: clamp(view.panY, padding - top * scale, viewport.height - padding - bottom * scale),
    manual: true,
  }
}

export type MapDirection = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left'
export function outOfViewDirections(tiles: Tile[], view: MapView, viewport: { width: number; height: number }): MapDirection[] {
  const found = new Set<MapDirection>()
  const diagonals = { up: { left: 'up-left', right: 'up-right' }, down: { left: 'down-left', right: 'down-right' } } as const
  for (const tile of tiles) {
    if (tile.width <= 0 || tile.height <= 0) continue
    const left = tile.x * view.zoom + view.panX
    const right = (tile.x + tile.width) * view.zoom + view.panX
    const top = tile.y * view.zoom + view.panY
    const bottom = (tile.y + tile.height) * view.zoom + view.panY
    const horizontal = right <= 0 ? 'left' : left >= viewport.width ? 'right' : ''
    const vertical = bottom <= 0 ? 'up' : top >= viewport.height ? 'down' : ''
    if (vertical && horizontal) {
      found.add(diagonals[vertical][horizontal])
    }
    else if (vertical) found.add(vertical)
    else if (horizontal) found.add(horizontal)
  }
  return (['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'] as const)
    .filter((direction) => found.has(direction))
}
type ChildLayout = { node: TreeNode; x: number; y: number; width: number; height: number }
type LayoutCache = Map<TreeNode, { width: number; height: number; children: ChildLayout[] }>

function childLayouts(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache): ChildLayout[] {
  const cached = cache.get(node)
  if (cached) return cached.children
  const children = node.children.map((child) => ({ node: child, ...treeDimensions(child, positions, cache) }))
  if (!children.length) return []

  let best: { score: number; layouts: Array<typeof children[number] & { x: number; y: number }> } | null = null
  const childArea = children.reduce((sum, child) => sum + child.width * child.height, 0)
  for (let columns = 1; columns <= children.length; columns += 1) {
    const rows = Math.ceil(children.length / columns)
    const columnWidths = Array<number>(columns).fill(0)
    const rowHeights = Array<number>(rows).fill(0)
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!
      const column = index % columns
      const row = Math.floor(index / columns)
      columnWidths[column] = Math.max(columnWidths[column]!, child.width)
      rowHeights[row] = Math.max(rowHeights[row]!, child.height)
    }
    const columnOffsets: number[] = []
    const rowOffsets: number[] = []
    let offset = 0
    for (const width of columnWidths) {
      columnOffsets.push(offset)
      offset += width + TREE_PADDING
    }
    offset = 0
    for (const height of rowHeights) {
      rowOffsets.push(offset)
      offset += height + TREE_PADDING
    }
    const width = columnWidths.reduce((sum, item) => sum + item, 0) + TREE_PADDING * (columns - 1) + TREE_PADDING * 2
    const height = rowHeights.reduce((sum, item) => sum + item, 0)
      + TREE_PADDING * (rows - 1) + TREE_PADDING * 2 + TREE_HEADER_HEIGHT
    const waste = Math.max(0, (width * height - childArea) / Math.max(1, childArea))
    const score = Math.abs(Math.log((width / height) / VERSION_TREEMAP_ASPECT)) + waste * 0.025
    if (best && score >= best.score) continue
    best = {
      score,
      layouts: children.map((child, index) => ({
        ...child,
        x: TREE_PADDING + columnOffsets[index % columns]!,
        y: TREE_PADDING + TREE_HEADER_HEIGHT + rowOffsets[Math.floor(index / columns)]!,
      })),
    }
  }
  return best!.layouts
}
function outerDimensions(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache) {
  const size = treeDimensions(node, positions, cache)
  const width = Math.max(size.width, size.height * VERSION_TREEMAP_ASPECT)
  return {
    width,
    height: Math.max(size.height, width / VERSION_TREEMAP_ASPECT),
  }
}
export function outerTreemapDimensions(node: TreeNode, positions?: Record<string, { x: number; y: number }>) {
  return outerDimensions(node, positions, new Map())
}
export function compactTreemapPositions(data: TreeNode[], viewport: { width: number; height: number }) {
  const cache: LayoutCache = new Map()
  const ordered = data.map((node, index) => ({
    node, index, size: outerDimensions(node, undefined, cache),
  })).sort((left, right) => right.size.height - left.size.height
    || right.size.width - left.size.width || left.index - right.index)
  const candidateWidths = [...new Set(ordered.reduce<number[]>((widths, item) => {
    widths.push((widths.at(-1) ?? MAP_PADDING) + item.size.width + (widths.length ? MAP_GAP : 0))
    return widths
  }, []))]
  let best: { area: number; aspectDelta: number; fitScale: number; positions: Record<string, { x: number; y: number }> } | null = null
  for (const targetWidth of candidateWidths) {
    let x = MAP_PADDING
    let y = MAP_PADDING
    let rowHeight = 0
    let maxRight = MAP_PADDING
    let maxBottom = MAP_PADDING
    const placed = new Map<string, { x: number; y: number }>()
    for (const { node, size } of ordered) {
      if (x > MAP_PADDING && x + size.width > MAP_PADDING + targetWidth) {
        x = MAP_PADDING
        y += rowHeight + MAP_GAP
        rowHeight = 0
      }
      placed.set(node.id, { x, y })
      x += size.width + MAP_GAP
      rowHeight = Math.max(rowHeight, size.height)
      maxRight = Math.max(maxRight, x - MAP_GAP)
      maxBottom = Math.max(maxBottom, y + size.height)
    }
    const width = maxRight - MAP_PADDING
    const height = maxBottom - MAP_PADDING
    const area = width * height
    const aspectDelta = Math.abs(Math.log((width / Math.max(1, height)) / (viewport.width / viewport.height)))
    const fitScale = Math.min(1, viewport.width / Math.max(1, width), viewport.height / Math.max(1, height))
    if (best && (fitScale < best.fitScale
      || (fitScale === best.fitScale && aspectDelta > best.aspectDelta)
      || (fitScale === best.fitScale && aspectDelta === best.aspectDelta && area >= best.area))) continue
    best = {
      area, aspectDelta, fitScale,
      positions: Object.fromEntries(data.map((node) => {
        const position = placed.get(node.id)!
        return [node.id, { x: position.x / CARD_WIDTH, y: position.y / TREE_MAP_HEIGHT }]
      })),
    }
  }
  return best?.positions ?? {}
}
function treeDimensions(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache): { width: number; height: number } {
  const cached = cache.get(node)
  if (cached) return cached
  if (!node.children.length) {
    const leaf = { width: LEAF_TILE_WIDTH, height: LEAF_TILE_HEIGHT, children: [] }
    cache.set(node, leaf)
    return leaf
  }
  const children = childLayouts(node, positions, cache)
  const layout = {
    width: Math.max(...children.map((child) => child.x + child.width)) + TREE_PADDING,
    height: Math.max(...children.map((child) => child.y + child.height)) + TREE_PADDING,
    children,
  }
  cache.set(node, layout)
  return layout
}
export function mapGeometry(
  data: TreeNode[],
  positions?: Record<string, { x: number; y: number }>,
  minWidth = CARD_WIDTH - 12,
  minHeight = CARD_HEIGHT - 65,
) {
  const cache: LayoutCache = new Map()
  const defaults = defaultPositionsWithCache(data, positions, cache)
  const extents = data.map((node) => {
    const position = positions?.[node.id] ?? defaults[node.id]!
    const size = outerDimensions(node, positions, cache)
    const left = position.x * CARD_WIDTH
    const top = position.y * TREE_MAP_HEIGHT
    return { left, top, right: left + size.width, bottom: top + size.height }
  })
  const minX = Math.min(0, ...extents.map((item) => item.left)) - MAP_PADDING
  const minY = Math.min(0, ...extents.map((item) => item.top)) - MAP_PADDING
  const maxX = Math.max(minX + minWidth, ...extents.map((item) => item.right + MAP_PADDING))
  const maxY = Math.max(minY + minHeight, ...extents.map((item) => item.bottom + MAP_PADDING))
  const width = maxX - minX
  const height = maxY - minY
  return { minX, minY, width, height, viewBox: `${minX} ${minY} ${width} ${height}` }
}
export function defaultPositions(
  data: TreeNode[],
  positions?: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  return defaultPositionsWithCache(data, positions, new Map())
}
function defaultPositionsWithCache(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  cache: LayoutCache,
): Record<string, { x: number; y: number }> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(data.length)))
  const columnWidths = Array.from({ length: Math.min(columns, data.length) }, (_, column) =>
    Math.max(...data.filter((_, index) => index % columns === column).map((node) => outerDimensions(node, positions, cache).width)))
  const rowCount = Math.ceil(data.length / columns)
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(...data.slice(row * columns, (row + 1) * columns).map((node) => outerDimensions(node, positions, cache).height)))
  const columnOffsets = columnWidths.map((_, column) =>
    columnWidths.slice(0, column).reduce((sum, width) => sum + width + MAP_PADDING, MAP_PADDING))
  const rowOffsets = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + MAP_PADDING, MAP_PADDING))
  return Object.fromEntries(data.map((node, index) => [
    node.id,
    { x: columnOffsets[index % columns]! / CARD_WIDTH, y: rowOffsets[Math.floor(index / columns)]! / TREE_MAP_HEIGHT },
  ]))
}
export function positionsAfterMove(
  data: TreeNode[],
  existing: Record<string, { x: number; y: number }> | undefined,
  nodeId: string,
  position: { x: number; y: number },
) {
  const defaults = defaultPositions(data, existing)
  if (!data.some((node) => node.id === nodeId)) return { ...defaults, ...existing }
  return resolveRootOverlaps(data, { ...defaults, ...existing, [nodeId]: position }, [nodeId])
}
export function positionsAfterMoves(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
  fixedIds: string[],
) {
  return resolveRootOverlaps(data, positions, fixedIds)
}
export function positionsAfterDetach(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
  moves: { id: string; parentId?: string }[],
) {
  const resolved = { ...positions }
  const moving = new Set(moves.map((move) => move.id))
  const occupied = data.filter((node) => !moving.has(node.id))
  for (const move of moves) {
    const node = data.find((item) => item.id === move.id)
    const position = resolved[move.id]
    if (!node || !position) throw new Error(`Missing detached root or position: ${move.id}`)
    const parent = move.parentId ? tileForNode(data, resolved, move.parentId) : undefined
    resolved[move.id] = nearestDetachedPosition(position, outerTreemapDimensions(node), occupied, resolved, parent)
    occupied.push(node)
  }
  return resolved
}

function nearestDetachedPosition(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  occupied: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
  parent?: Tile,
) {
  const x = preferred.x * CARD_WIDTH
  const y = preferred.y * TREE_MAP_HEIGHT
  const obstacles = occupied.map((node) => {
    const position = positions[node.id] ?? { x: 0, y: 0 }
    const other = outerTreemapDimensions(node)
    return {
      left: position.x * CARD_WIDTH - size.width - MAP_GAP,
      right: position.x * CARD_WIDTH + other.width + MAP_GAP,
      top: position.y * TREE_MAP_HEIGHT - size.height - MAP_GAP,
      bottom: position.y * TREE_MAP_HEIGHT + other.height + MAP_GAP,
    }
  })
  // The closest point outside these expanded rectangles lies at the requested x or a rectangle edge.
  const xs = [x, ...obstacles.flatMap((obstacle) => [obstacle.left, obstacle.right])]
  let best: { x: number; y: number; distance: number; parentDistance: number } | undefined
  for (const candidateX of xs) {
    const intervals = obstacles.filter((obstacle) => candidateX > obstacle.left && candidateX < obstacle.right)
      .map((obstacle) => ({ top: obstacle.top, bottom: obstacle.bottom }))
      .sort((a, b) => a.top - b.top)
    const merged: { top: number; bottom: number }[] = []
    for (const interval of intervals) {
      const last = merged.at(-1)
      if (last && interval.top < last.bottom) last.bottom = Math.max(last.bottom, interval.bottom)
      else merged.push({ ...interval })
    }
    const collision = merged.find((interval) => y > interval.top && y < interval.bottom)
    const ys = collision ? [collision.top, collision.bottom] : [y]
    for (const candidateY of ys) {
      const distance = (candidateX - x) ** 2 + (candidateY - y) ** 2
      const dx = parent ? Math.max(parent.x - candidateX - size.width, candidateX - parent.x - parent.width, 0) : 0
      const dy = parent ? Math.max(parent.y - candidateY - size.height, candidateY - parent.y - parent.height, 0) : 0
      const parentDistance = dx * dx + dy * dy
      if (!best || distance < best.distance - 1e-8
        || (Math.abs(distance - best.distance) <= 1e-8 && parentDistance < best.parentDistance)) {
        best = { x: candidateX, y: candidateY, distance, parentDistance }
      }
    }
  }
  return { x: best!.x / CARD_WIDTH, y: best!.y / TREE_MAP_HEIGHT }
}
export function positionsForData(
  previousData: TreeNode[],
  nextData: TreeNode[],
  previousPositions?: Record<string, { x: number; y: number }>,
  mapView?: MapView,
  viewport = { width: CARD_WIDTH - 14, height: CARD_HEIGHT - 47 },
) {
  const previousParents = nodeParentIds(previousData)
  const nextParents = nodeParentIds(nextData)
  const inherited = Object.fromEntries(Object.entries(previousPositions ?? {}).filter(([id]) =>
    previousParents.has(id) && nextParents.has(id) && previousParents.get(id) === nextParents.get(id)))
  const positions = { ...defaultPositions(nextData, inherited), ...inherited }
  const newRoots = nextData.filter((node) => previousParents.get(node.id) !== null)
  const occupied = nextData.filter((node) => !newRoots.some((added) => added.id === node.id))
  const view = mapView ?? { zoom: 1, panX: 0, panY: 0, manual: false }
  const anchor = {
    x: (viewport.width / 2 - view.panX) / view.zoom,
    y: (viewport.height / 2 - view.panY) / view.zoom,
  }
  for (const node of newRoots) {
    const size = outerTreemapDimensions(node)
    const originTile = previousParents.has(node.id)
      ? tileForNode(previousData, previousPositions, node.id)
      : undefined
    const preferred = originTile
      ? { x: originTile.x + originTile.width + MAP_GAP, y: originTile.y }
      : { x: anchor.x - size.width / 2, y: anchor.y - size.height / 2 }
    positions[node.id] = nearestFreePosition(preferred, size, occupied, positions)
    occupied.push(node)
  }
  return resolveRootOverlaps(nextData, positions)
}
function nearestFreePosition(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  occupied: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
) {
  const stepX = size.width + MAP_GAP
  const stepY = size.height + MAP_GAP
  const isFree = (candidate: { x: number; y: number }) => !occupied.some((other) => {
    const position = positions[other.id] ?? { x: 0, y: 0 }
    const otherSize = outerTreemapDimensions(other)
    return candidate.x < position.x * CARD_WIDTH + otherSize.width + MAP_GAP
      && candidate.x + size.width + MAP_GAP > position.x * CARD_WIDTH
      && candidate.y < position.y * TREE_MAP_HEIGHT + otherSize.height + MAP_GAP
      && candidate.y + size.height + MAP_GAP > position.y * TREE_MAP_HEIGHT
  })
  if (isFree(preferred)) return { x: preferred.x / CARD_WIDTH, y: preferred.y / TREE_MAP_HEIGHT }
  for (let ring = 1; ring <= Math.max(80, occupied.length * 2); ring += 1) {
    const candidates = [
      { x: preferred.x + ring * stepX, y: preferred.y },
      { x: preferred.x, y: preferred.y + ring * stepY },
      { x: preferred.x - ring * stepX, y: preferred.y },
      { x: preferred.x, y: preferred.y - ring * stepY },
    ]
    for (let offset = 1; offset < ring; offset += 1) {
      candidates.push(
        { x: preferred.x + ring * stepX, y: preferred.y + offset * stepY },
        { x: preferred.x - offset * stepX, y: preferred.y + ring * stepY },
        { x: preferred.x - ring * stepX, y: preferred.y - offset * stepY },
        { x: preferred.x + offset * stepX, y: preferred.y - ring * stepY },
      )
    }
    const free = candidates.slice(-4 * ring).find(isFree)
    if (free) return { x: free.x / CARD_WIDTH, y: free.y / TREE_MAP_HEIGHT }
  }
  const fallback = { ...preferred }
  while (!isFree(fallback)) fallback.x += stepX
  return { x: fallback.x / CARD_WIDTH, y: fallback.y / TREE_MAP_HEIGHT }
}
function resolveRootOverlaps(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
  fixedIds: string[] = [],
) {
  const resolved = { ...positions }
  const fixed = new Set(fixedIds)
  const ordered = fixed.size
    ? [...data].sort((left, right) => Number(fixed.has(right.id)) - Number(fixed.has(left.id)))
    : data
  const occupied: TreeNode[] = []
  for (const node of ordered) {
    const position = resolved[node.id] ?? { x: 0, y: 0 }
    const size = outerTreemapDimensions(node)
    if (!nearestPositionIsFree(position, size, occupied, resolved)) {
      resolved[node.id] = nearestFreePosition(
        { x: position.x * CARD_WIDTH, y: position.y * TREE_MAP_HEIGHT },
        size,
        occupied,
        resolved,
      )
    }
    occupied.push(node)
  }
  return resolved
}
export function nearestPositionIsFree(
  position: { x: number; y: number },
  size: { width: number; height: number },
  occupied: TreeNode[],
  positions: Record<string, { x: number; y: number }>,
) {
  const candidate = { x: position.x * CARD_WIDTH, y: position.y * TREE_MAP_HEIGHT }
  return !occupied.some((other) => {
    const otherPosition = positions[other.id] ?? { x: 0, y: 0 }
    const otherSize = outerTreemapDimensions(other)
    return candidate.x < otherPosition.x * CARD_WIDTH + otherSize.width + MAP_GAP
      && candidate.x + size.width + MAP_GAP > otherPosition.x * CARD_WIDTH
      && candidate.y < otherPosition.y * TREE_MAP_HEIGHT + otherSize.height + MAP_GAP
      && candidate.y + size.height + MAP_GAP > otherPosition.y * TREE_MAP_HEIGHT
  })
}
export function tilesFor(
  root: TreeNode,
  forest: TreeNode[],
  _index: number,
  positions?: Record<string, { x: number; y: number }>,
): Tile[] {
  return tilesForWithCache(root, forest, positions, new Map())
}
function tilesForWithCache(
  root: TreeNode,
  forest: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  cache: LayoutCache,
): Tile[] {
  const position = positions?.[root.id] ?? defaultPositionsWithCache(forest, positions, cache)[root.id]!
  const size = outerDimensions(root, undefined, cache)
  const offsetX = position.x * CARD_WIDTH
  const offsetY = position.y * TREE_MAP_HEIGHT
  const tree = hierarchy(root).sum((node) => node.children.length ? 0 : 1)
  const layout = treemap<TreeNode>()
    .size([size.width, size.height])
    .tile(treemapSquarify)
    .paddingTop(TREE_HEADER_HEIGHT + TREE_PADDING)
    .paddingLeft(TREE_PADDING)
    .paddingRight(TREE_PADDING)
    .paddingBottom(TREE_PADDING)
    .paddingInner(TREE_PADDING)
  return layout(tree).descendants().map((node) => ({
    id: node.data.id, label: node.data.value,
    x: offsetX + node.x0, y: offsetY + node.y0,
    width: node.x1 - node.x0, height: node.y1 - node.y0,
    depth: node.depth, hasChildren: !!node.children?.length,
  }))
}
export function tilesForForest(data: TreeNode[], positions?: Record<string, { x: number; y: number }>) {
  const cache: LayoutCache = new Map()
  const resolved = data.some((root) => !positions?.[root.id])
    ? { ...defaultPositionsWithCache(data, positions, cache), ...positions } : positions
  return data.flatMap((root) => tilesForWithCache(root, data, resolved, cache))
}
export function tileForNode(
  data: TreeNode[],
  positions: Record<string, { x: number; y: number }> | undefined,
  nodeId: string,
) {
  const cache: LayoutCache = new Map()
  const resolved = data.some((root) => !positions?.[root.id])
    ? { ...defaultPositionsWithCache(data, positions, cache), ...positions } : positions
  for (const root of data) {
    const tile = tilesForWithCache(root, data, resolved, cache).find((item) => item.id === nodeId)
    if (tile) return tile
  }
  return undefined
}
