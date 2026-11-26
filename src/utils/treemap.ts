import type { MapView, Tile, TreeNode } from '../types/workspace'
import { findNode, nodeParentIds } from './tree'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import Hypher from 'hypher'
import english from 'hyphenation.en-us'

let labelContext: CanvasRenderingContext2D | null | undefined
const hyphenator = new Hypher(english)

function prefixThatFits(text: string, width: number, measure: (text: string) => number) {
  let prefix = ''
  for (const character of Array.from(text)) {
    if (measure(prefix + character) > width) break
    prefix += character
  }
  return prefix.trimEnd()
}

function wrapLongWord(word: string, width: number, measure: (text: string) => number) {
  const characters = Array.from(word)
  const syllables = hyphenator.hyphenate(word)
  const boundaries: number[] = []
  let syllableOffset = 0
  for (const syllable of syllables) {
    syllableOffset += Array.from(syllable).length
    if (syllableOffset > 0 && syllableOffset < characters.length) boundaries.push(syllableOffset)
  }
  boundaries.push(characters.length)

  const lines: string[] = []
  let offset = 0
  while (offset < characters.length) {
    let plainEnd = offset
    let markedEnd = offset
    let markedSuffix = ''
    for (const boundary of boundaries) {
      if (boundary <= offset) continue
      const piece = characters.slice(offset, boundary).join('')
      const needsHyphen = boundary < characters.length && characters[boundary - 1] !== '-'
      if (needsHyphen && measure(`${piece}-`) <= width) {
        markedEnd = boundary
        markedSuffix = '-'
      } else if (piece.endsWith('-') && measure(piece) <= width) {
        markedEnd = boundary
        markedSuffix = ''
      }
      else if (measure(piece) <= width) plainEnd = boundary
    }

    const bestEnd = markedEnd > offset ? markedEnd : plainEnd
    const bestSuffix = markedEnd > offset ? markedSuffix : ''
    if (bestEnd === offset) {
      const remainder = characters.slice(offset).join('')
      let piece = prefixThatFits(remainder, width, measure)
      if (!piece) break
      const end = offset + Array.from(piece).length
      if (end < characters.length && characters[end - 1] !== '-' && measure(`${piece}-`) <= width) {
        piece += '-'
      }
      lines.push(piece)
      offset = end
      continue
    }

    lines.push(`${characters.slice(offset, bestEnd).join('')}${bestSuffix}`)
    offset = bestEnd
  }
  return lines
}

export function layoutTileLabel(tile: Tile) {
  const width = Math.max(0, tile.width - 10)
  const height = Math.max(0, Math.min(tile.height, tile.hasChildren ? TREE_HEADER_HEIGHT : tile.height) - 6)
  const fontSize = tile.hasChildren ? PARENT_FONT_SIZE : LEAF_FONT_SIZE
  const maxLines = tile.hasChildren ? Math.min(1, Math.floor(height / (fontSize * 1.15))) : Math.floor(height / (fontSize * 1.15))
  if (!maxLines) return { fontSize, lines: [] as string[] }
  if (labelContext === undefined && typeof document !== 'undefined') {
    labelContext = document.createElement('canvas').getContext('2d')
  }
  if (labelContext) labelContext.font = `500 ${fontSize}px Arial, sans-serif`
  const measure = (text: string) => labelContext
    ? labelContext.measureText(text).width : text.length * fontSize * 0.65
  const text = tile.label.trim()
  if (tile.hasChildren) {
    return { fontSize, lines: text ? [prefixThatFits(text, width, measure)].filter(Boolean) : [] }
  }

  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  let truncated = false
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= width) {
      line = candidate
      continue
    }
    if (line) {
      lines.push(line)
      line = ''
      if (lines.length >= maxLines) { truncated = true; break }
    }
    if (measure(word) <= width) {
      line = word
      continue
    }
    const wrapped = wrapLongWord(word, width, measure)
    if (!wrapped.length) { truncated = true; break }
    for (let index = 0; index < wrapped.length; index++) {
      if (lines.length >= maxLines) { truncated = true; break }
      if (index === wrapped.length - 1) line = wrapped[index]!
      else lines.push(wrapped[index]!)
    }
    if (truncated) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (truncated && maxLines === 1) {
    return { fontSize, lines: [prefixThatFits(text, width, measure)].filter(Boolean) }
  }
  if (truncated && lines.length && measure('...') <= width) {
    let last = lines.at(-1)!
    while (last && measure(`${last}...`) > width) last = Array.from(last).slice(0, -1).join('')
    lines[lines.length - 1] = `${last.trimEnd()}...`
  }
  return { fontSize, lines }
}

export const CARD_WIDTH = 260
export const CARD_HEIGHT = 260
export const TREE_MAP_HEIGHT = CARD_HEIGHT - 40
const LEAF_FONT_SIZE = 36
const PARENT_FONT_SIZE = 32
const LABEL_PADDING = 10
// Minimum width: 2 letters at the label width estimate plus the label padding.
const minimumWidth = (fontSize: number) => Math.ceil(fontSize * 0.65 * 2 + LABEL_PADDING)
const LEAF_TILE_WIDTH = minimumWidth(LEAF_FONT_SIZE)
const LEAF_TILE_HEIGHT = 106
const PARENT_TILE_WIDTH = minimumWidth(PARENT_FONT_SIZE)
const TREE_PADDING = 8
const TREE_HEADER_HEIGHT = 44
const PARENT_TILE_HEIGHT = TREE_HEADER_HEIGHT + TREE_PADDING * 2
const ALTERNATIVE_ASPECTS = [0.8, 1, 1.5]
const MAX_ROOT_SCALE = 1.5
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
type SolvedLayout = { width: number; height: number; tiles: Tile[] }
type LayoutEntry = { width: number; height: number; children: ChildLayout[]; solved?: SolvedLayout }
type LayoutCache = Map<TreeNode, LayoutEntry>

function childLayouts(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache): ChildLayout[] {
  const cached = cache.get(node)
  if (cached) return cached.children
  const children = node.children.map((child) => ({ node: child, ...treeDimensions(child, positions, cache) }))
  if (!children.length) return []

  const first = children[0]!
  if (children.every((child) => child.width === first.width && child.height === first.height)) {
    let bestColumns = 1
    let bestScore = Infinity
    const childArea = children.length * first.width * first.height
    for (let columns = 1; columns <= children.length; columns += 1) {
      const rows = Math.ceil(children.length / columns)
      const width = columns * first.width + TREE_PADDING * (columns + 1)
      const height = rows * first.height + TREE_PADDING * (rows + 1) + TREE_HEADER_HEIGHT
      const waste = Math.max(0, (width * height - childArea) / Math.max(1, childArea))
      const score = Math.abs(Math.log((width / height) / VERSION_TREEMAP_ASPECT)) + waste * 0.025
      if (score < bestScore) {
        bestScore = score
        bestColumns = columns
      }
    }
    return children.map((child, index) => ({
      ...child,
      x: TREE_PADDING + (index % bestColumns) * (first.width + TREE_PADDING),
      y: TREE_PADDING + TREE_HEADER_HEIGHT + Math.floor(index / bestColumns) * (first.height + TREE_PADDING),
    }))
  }

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
function squarifiedNodes(root: TreeNode, width: number, height: number, ratio?: number) {
  const layout = treemap<TreeNode>()
    .size([width, height])
    .tile(ratio ? treemapSquarify.ratio(ratio) : treemapSquarify)
    .paddingTop(TREE_HEADER_HEIGHT + TREE_PADDING)
    .paddingLeft(TREE_PADDING)
    .paddingRight(TREE_PADDING)
    .paddingBottom(TREE_PADDING)
    .paddingInner(TREE_PADDING)
  return layout(hierarchy(root).sum((node) => node.children.length ? 0 : 1)).descendants()
}
// Factor by which the whole root must grow for its tightest entry to reach the minimum (1 = satisfied).
function minimumSizeFactor(nodes: ReturnType<typeof squarifiedNodes>) {
  let factor = 1
  for (const node of nodes) {
    const width = Math.max(1, node.x1 - node.x0)
    const height = Math.max(1, node.y1 - node.y0)
    const parent = !!node.children?.length
    factor = Math.max(
      factor,
      (parent ? PARENT_TILE_WIDTH : LEAF_TILE_WIDTH) / width,
      (parent ? PARENT_TILE_HEIGHT : LEAF_TILE_HEIGHT) / height,
    )
  }
  return factor
}
function alternativeAspects() {
  const byDistance = ALTERNATIVE_ASPECTS
    .map((aspect) => ({ aspect, distance: Math.abs(Math.log(aspect / VERSION_TREEMAP_ASPECT)) }))
    .sort((left, right) => left.distance - right.distance)
  const excluded = byDistance[0]!.aspect
  return ALTERNATIVE_ASPECTS.filter((aspect) => aspect !== excluded)
}
function solveTreemap(root: TreeNode, base: { width: number; height: number }): SolvedLayout {
  const area = base.width * base.height
  const attempts = [
    { aspect: VERSION_TREEMAP_ASPECT, ratio: undefined as number | undefined },
    ...alternativeAspects().map((aspect) => ({ aspect, ratio: 1 })),
  ]
  const run = (attempt: typeof attempts[number], scale: number) => {
    const height = Math.sqrt(area / attempt.aspect) * scale
    const width = height * attempt.aspect
    return { width, height, nodes: squarifiedNodes(root, width, height, attempt.ratio) }
  }
  const finish = (result: ReturnType<typeof run>): SolvedLayout => ({
    width: result.width,
    height: result.height,
    tiles: result.nodes.map((node) => ({
      id: node.data.id, label: node.data.value,
      x: node.x0, y: node.y0, width: node.x1 - node.x0, height: node.y1 - node.y0,
      depth: node.depth, hasChildren: !!node.children?.length,
    })),
  })
  const tolerance = 1.0005
  for (const attempt of attempts) {
    const result = run(attempt, 1)
    if (minimumSizeFactor(result.nodes) <= tolerance) return finish(result)
  }
  // No attempt fits at scale 1: find the scale each one needs and apply the smallest, capped.
  let best = { attempt: attempts[0]!, scale: Infinity }
  for (const attempt of attempts) {
    let scale = 1
    for (let step = 0; step < 12 && scale < 4; step += 1) {
      const factor = minimumSizeFactor(run(attempt, scale).nodes)
      if (factor <= tolerance) break
      scale *= Math.min(2, Math.max(1.01, factor))
    }
    if (scale < best.scale) best = { attempt, scale }
  }
  return finish(run(best.attempt, Math.min(best.scale, MAX_ROOT_SCALE)))
}
function outerDimensions(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache) {
  return solvedLayout(node, positions, cache)
}
function solvedLayout(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache) {
  const entry = treeDimensions(node, positions, cache)
  if (entry.solved) return entry.solved
  const width = Math.max(entry.width, entry.height * VERSION_TREEMAP_ASPECT)
  const solved = solveTreemap(node, { width, height: Math.max(entry.height, width / VERSION_TREEMAP_ASPECT) })
  entry.solved = solved
  return solved
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
function treeDimensions(node: TreeNode, positions: Record<string, { x: number; y: number }> | undefined, cache: LayoutCache): LayoutEntry {
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
  const rowCount = Math.ceil(data.length / columns)
  const columnWidths = Array<number>(Math.min(columns, data.length)).fill(0)
  const rowHeights = Array<number>(rowCount).fill(0)
  for (let index = 0; index < data.length; index += 1) {
    const size = outerDimensions(data[index]!, positions, cache)
    const column = index % columns
    const row = Math.floor(index / columns)
    columnWidths[column] = Math.max(columnWidths[column]!, size.width)
    rowHeights[row] = Math.max(rowHeights[row]!, size.height)
  }
  const columnOffsets: number[] = []
  const rowOffsets: number[] = []
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
  return { ...defaults, ...existing, [nodeId]: position }
}

type TreemapBounds = { id: string; left: number; top: number; right: number; bottom: number }
type ExpansionDirection = 'right' | 'left' | 'down' | 'up'

export function resolveTreemapExpansion(
  before: TreemapBounds,
  after: TreemapBounds,
  treemaps: TreemapBounds[],
) {
  const directions: ExpansionDirection[] = []
  if (after.right > before.right) directions.push('right')
  if (after.left < before.left) directions.push('left')
  if (after.bottom > before.bottom) directions.push('down')
  if (after.top < before.top) directions.push('up')
  const horizontal = (direction: ExpansionDirection) => direction === 'left' || direction === 'right'
  const positive = (direction: ExpansionDirection) => direction === 'right' || direction === 'down'
  function axis(bounds: TreemapBounds, direction: ExpansionDirection) {
    const start = horizontal(direction) ? bounds.left : bounds.top
    const end = horizontal(direction) ? bounds.right : bounds.bottom
    return positive(direction) ? { start, end } : { start: -end, end: -start }
  }
  function projectedOverlap(a: TreemapBounds, b: TreemapBounds, direction: ExpansionDirection) {
    return horizontal(direction) ? a.top < b.bottom && a.bottom > b.top : a.left < b.right && a.right > b.left
  }
  function onSide(a: TreemapBounds, b: TreemapBounds, direction: ExpansionDirection) {
    const left = axis(a, direction)
    const right = axis(b, direction)
    return right.start + right.end >= left.start + left.end
  }
  const candidates = new Map<ExpansionDirection, { bounds: TreemapBounds; distance: number }[]>()
  for (const bounds of treemaps) {
    if (bounds.id === after.id) continue
    const matches = directions.flatMap((direction) => {
      const oldAxis = axis(before, direction)
      const newAxis = axis(after, direction)
      const other = axis(bounds, direction)
      if (!projectedOverlap(after, bounds, direction) || !onSide(before, bounds, direction)
        || other.start >= newAxis.end || other.end <= oldAxis.end) return []
      return [{ direction, distance: newAxis.end - other.start }]
    })
    matches.sort((a, b) => a.distance - b.distance || directions.indexOf(a.direction) - directions.indexOf(b.direction))
    const match = matches[0]
    if (match) {
      const group = candidates.get(match.direction) ?? []
      group.push({ bounds, distance: match.distance })
      candidates.set(match.direction, group)
    }
  }
  const moved = new Map<string, { x: number; y: number }>()
  for (const direction of directions) {
    const initial = (candidates.get(direction) ?? []).filter(({ bounds }) => !moved.has(bounds.id))
    if (!initial.length) continue
    const group = new Map(initial.map(({ bounds }) => [bounds.id, bounds]))
    let distance = Math.max(...initial.map((item) => item.distance))
    let changed = true
    while (changed) {
      changed = false
      for (const member of group.values()) {
        const memberAxis = axis(member, direction)
        for (const other of treemaps) {
          if (other.id === after.id || group.has(other.id) || moved.has(other.id)
            || !projectedOverlap(member, other, direction) || !onSide(member, other, direction)) continue
          const otherAxis = axis(other, direction)
          if (otherAxis.start >= memberAxis.end + distance || otherAxis.end <= memberAxis.start) continue
          group.set(other.id, other)
          if (projectedOverlap(after, other, direction) && onSide(before, other, direction)
            && otherAxis.start < axis(after, direction).end && otherAxis.end > axis(before, direction).end) {
            distance = Math.max(distance, axis(after, direction).end - otherAxis.start)
          }
          changed = true
        }
      }
    }
    const displacement = positive(direction) ? distance : -distance
    for (const id of group.keys()) {
      moved.set(id, horizontal(direction) ? { x: displacement, y: 0 } : { x: 0, y: displacement })
    }
  }
  return moved
}

export function positionsAfterAttachment(
  previousData: TreeNode[],
  data: TreeNode[],
  previousPositions: Record<string, { x: number; y: number }> | undefined,
  targetId: string,
) {
  const oldPositions = { ...defaultPositions(previousData, previousPositions), ...previousPositions }
  const positions = positionsForData(previousData, data, oldPositions)
  const target = previousData.find((root) => !!findNode([root], targetId))
  const nextTarget = target && data.find((root) => root.id === target.id)
  if (!target || !nextTarget) throw new Error(`Missing attachment target treemap: ${targetId}`)
  pushExpandedTreemap(target, nextTarget, data, positions)
  return positions
}

function pushExpandedTreemap(previous: TreeNode, current: TreeNode, roots: TreeNode[],
  positions: Record<string, { x: number; y: number }>) {
  function bounds(node: TreeNode): TreemapBounds {
    const position = positions[node.id]!
    const size = outerTreemapDimensions(node, positions)
    const left = position.x * CARD_WIDTH
    const top = position.y * TREE_MAP_HEIGHT
    return { id: node.id, left, top, right: left + size.width, bottom: top + size.height }
  }
  const before = bounds(previous)
  const after = bounds(current)
  for (const [id, delta] of resolveTreemapExpansion(before, after, roots.map(bounds))) {
    const position = positions[id]!
    positions[id] = { x: position.x + delta.x / CARD_WIDTH, y: position.y + delta.y / TREE_MAP_HEIGHT }
  }
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
  const previousRoots = new Map(previousData.map((root) => [root.id, root]))
  for (const root of occupied) {
    const previous = previousRoots.get(root.id)
    if (!previous) continue
    const pending = [root]
    let added = false
    while (pending.length && !added) {
      const current = pending.pop()!
      added = !previousParents.has(current.id)
      pending.push(...current.children)
    }
    if (added) pushExpandedTreemap(previous, root, occupied, positions)
  }
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
  return positions
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
  const offsetX = position.x * CARD_WIDTH
  const offsetY = position.y * TREE_MAP_HEIGHT
  return solvedLayout(root, undefined, cache).tiles.map((tile) => ({
    ...tile, x: offsetX + tile.x, y: offsetY + tile.y,
  }))
}
export function orderedTreemapRoots(data: TreeNode[], order?: string[]) {
  if (!order?.length) return data
  const roots = new Map(data.map((node) => [node.id, node]))
  const ordered: TreeNode[] = []
  for (const id of order) {
    const node = roots.get(id)
    if (node) { ordered.push(node); roots.delete(id) }
  }
  return [...ordered, ...roots.values()]
}
export function overlappingTreemapIds(tiles: Tile[]) {
  const roots = tiles.filter((tile) => tile.depth === 0)
    .map((tile, order) => ({ tile, order }))
    .sort((a, b) => a.tile.x - b.tile.x)
  let active: typeof roots = []
  const overlapping = new Set<string>()
  for (const current of roots) {
    active = active.filter((other) => other.tile.x + other.tile.width > current.tile.x)
    for (const other of active) {
      if (other.tile.y < current.tile.y + current.tile.height && other.tile.y + other.tile.height > current.tile.y) {
        overlapping.add(current.order > other.order ? current.tile.id : other.tile.id)
      }
    }
    active.push(current)
  }
  return overlapping
}
export function tilesForForest(data: TreeNode[], positions?: Record<string, { x: number; y: number }>, order?: string[]) {
  const cache: LayoutCache = new Map()
  const resolved = data.some((root) => !positions?.[root.id])
    ? { ...defaultPositionsWithCache(data, positions, cache), ...positions } : positions
  return orderedTreemapRoots(data, order).flatMap((root) => tilesForWithCache(root, data, resolved, cache))
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
