import type { MapView, Tile, TreeNode, Version } from './workspace'

export type VersionCardModel = {
  active: Version
  compareIds: string[]
  compareMode: boolean
  zoom: number
  overNode: string | null
  hoveredNode: { versionId: string; nodeId: string } | null
  selectedNodes: string[]
  draggedSubtreeIds: string[]
  draggedOriginalTile: Tile | null
  selectionBox: { versionId: string; left: number; top: number; width: number; height: number } | null
  clientId: string
  colorForUser: (id: string) => string
  isReadOnly: boolean
  versionTiles: Map<string, Tile[]>
  duplicateValueLinks: Map<string, { id: string; path: string }[]>
  displayCardPosition: (version: Version) => { x: number; y: number }
  cardWidth: (version: Version) => number
  cardHeight: (version: Version) => number
  rootLabelOffset: () => number
  rootLabelX: () => number
  rootLabelWidth: () => number
  versionAuthorColor: (version: Version) => string
  activeUsersFor: (id: string) => { id: string; color: string }[]
  descendantsCount: (nodes: TreeNode[]) => number
  isPreviewing: (version: Version) => boolean
  previewLabel: () => string
  versionAction: (version: Version) => { label: string; symbol: string }
  cardData: (version: Version) => TreeNode[]
  mapViewport: (version: Version) => { width: number; height: number }
  cardMapView: (version: Version) => MapView
  mapTransform: (version: Version) => string
  changedEntries: Map<string, Set<string>>
  tileSelectionColor: (versionId: string, nodeId: string) => string | undefined
  dragOverlayTiles: (version: Version) => Tile[]
  handleVersionClick: (version: Version, event: MouseEvent) => void
  handleVersionDoubleClick: (version: Version) => void
  onVersionContext: (version: Version, event: MouseEvent) => void
  onVersionMenu: (version: Version, event: MouseEvent) => void
  startMapPan: (event: PointerEvent, version: Version) => void
  zoomMap: (event: WheelEvent, version: Version) => void
  startMapTileGesture: (event: PointerEvent, version: Version, nodeId: string) => void
  enterTile: (event: PointerEvent, version: Version, nodeId: string) => void
  moveTileTooltip: (event: PointerEvent, versionId: string, nodeId: string) => void
  leaveTile: (versionId: string, nodeId: string) => void
  onTileClick: (version: Version, nodeId: string, event: MouseEvent) => void
  onTileDoubleClick: (version: Version, nodeId: string) => void
  onTileContext: (event: MouseEvent, nodeId: string) => void
}
