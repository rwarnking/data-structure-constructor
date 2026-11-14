import type { MapView, Tile, TreeNode } from '../types/workspace'
import { nodeParentIds } from './tree'

export function layoutTileLabel(tile: Tile) {
  const width = Math.max(0, tile.width - 10)
  const height = Math.max(0, Math.min(tile.height, tile.hasChildren ? TREE_HEADER_HEIGHT : tile.height) - 6)
  const wrap = (capacity: number) => {
    const lines: string[] = []
    let line = ''
    for (const word of tile.label.trim().split(/\s+/)) {
      let remaining = Array.from(word)
      if (line && line.length + 1 + remaining.length <= capacity) {
        line += ` ${word}`
        continue
      }
      if (line) lines.push(line)
      line = ''
      while (remaining.length > capacity) {
        lines.push(remaining.slice(0, capacity).join(''))
        remaining = remaining.slice(capacity)
      }
      line = remaining.join('')
    }
    if (line) lines.push(line)
    return lines
  }
  for (let fontSize = Math.min(24, Math.floor(height)); fontSize >= 7; fontSize--) {
    const capacity = Math.floor(width / (fontSize * 0.67))
    if (capacity < 1) continue
    const lines = wrap(capacity)
    const maxLines = Math.floor(height / (fontSize * 1.15))
    if (lines.length <= maxLines) return { fontSize, lines }
    if (fontSize === 7 && maxLines > 0) {
      const visible = lines.slice(0, maxLines)
      visible[maxLines - 1] = `${Array.from(visible[maxLines - 1]!).slice(0, Math.max(0, capacity - 1)).join('')}…`
      return { fontSize, lines: visible }
    }
  }
  return { fontSize: 0, lines: [] as string[] }
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
): MapView {
  const viewport = {
    width: CARD_WIDTH - 14,
    height: CARD_HEIGHT - 47,
  }
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
type ChildLayout = { node: TreeNode; x: number; y: number; width: number; height: number }
type LayoutCache = Map<TreeNode, { width: number; height: number; children: ChildLayout[] }>

function childLayouts(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache): ChildLayout[] {
  const cached = cache.get(node)
  if (cached) return cached.children
  const children = node.children.map((child) => ({ node: child, ...treeDimensions(child, positions, cache) }))
  if (!children.length) return []

  let best: { score: number; layouts: Array<typeof children[number] & { x: number; y: number }> } | null = null
  for (let columns = 1; columns <= children.length; columns += 1) {
    const rows = Math.ceil(children.length / columns)
    const columnWidths = Array.from({ length: columns }, (_, column) =>
      Math.max(...children.filter((_, index) => index % columns === column).map((child) => child.width)))
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(...children.slice(row * columns, (row + 1) * columns).map((child) => child.height)))
    const columnOffsets = columnWidths.map((_, column) =>
      columnWidths.slice(0, column).reduce((sum, width) => sum + width + TREE_PADDING, 0))
    const rowOffsets = rowHeights.map((_, row) =>
      rowHeights.slice(0, row).reduce((sum, height) => sum + height + TREE_PADDING, 0))
    const width = columnWidths.reduce((sum, item) => sum + item, 0) + TREE_PADDING * (columns - 1) + TREE_PADDING * 2
    const height = rowHeights.reduce((sum, item) => sum + item, 0)
      + TREE_PADDING * (rows - 1) + TREE_PADDING * 2 + TREE_HEADER_HEIGHT
    const childArea = children.reduce((sum, child) => sum + child.width * child.height, 0)
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
  return resolveRootOverlaps(data, { ...defaults, ...existing, [nodeId]: position }, nodeId)
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
  fixedId?: string,
) {
  const resolved = { ...positions }
  const ordered = fixedId
    ? [...data].sort((left, right) => Number(right.id === fixedId) - Number(left.id === fixedId))
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
  const tiles: Tile[] = []
  const place = (node: TreeNode, x: number, y: number, width: number, height: number, depth: number) => {
    tiles.push({
      id: node.id, label: node.value,
      x, y, width, height, depth, hasChildren: node.children.length > 0,
    })
    if (!node.children.length) return
    for (const childLayout of childLayouts(node, undefined, cache)) {
      place(
        childLayout.node,
        x + childLayout.x,
        y + childLayout.y,
        childLayout.width,
        childLayout.height,
        depth + 1,
      )
    }
  }
  place(root, offsetX, offsetY, size.width, size.height, 0)
  return tiles
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
