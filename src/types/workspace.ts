export type TreeNode = { id: string; value: string; description?: string; children: TreeNode[] }
export type MapView = { zoom: number; panX: number; panY: number; manual: boolean }
export type Tile = { id: string; label: string; x: number; y: number; width: number; height: number; depth: number; hasChildren: boolean }
export type SpatialPreview = {
  x: number
  y: number
  versionId: string
  nodeId: string
  kind: 'move' | 'detach' | 'noop' | 'invalid'
  valid: boolean
  data: TreeNode[]
  positions: Record<string, { x: number; y: number }>
  view: MapView
}
export type CopyLink = { sourceVersionId: string; sourceNodeId: string; targetVersionId: string; targetNodeId: string }
export type VersionNumber = { step: number; branch: number; subbranch: number; origin: string; owner: string; scheme?: 2 }
export type RetiredVersionNumber = { id: string; number: VersionNumber; createdAt: number; suffix?: number }
export type Version = {
  id: string
  parentId: string | null
  mergeSourceId?: string
  step: number
  lane: number
  branch: string
  change: string
  data: TreeNode[]
  createdBy?: string
  number?: VersionNumber
  numberSuffix?: number
  positions?: Record<string, { x: number; y: number }>
  mapView?: MapView
  createdAt: number
}
export type StoredState = { versions: Version[]; activeId: string; nextNode: number; nextVersion: number; nextLane: number; copyLinks: CopyLink[]; retiredVersionNumbers?: RetiredVersionNumber[] }
export type Revision = { clock: number; actor: string }
export type CollaborationMetadata = {
  clock: number
  versions: Record<string, Revision>
  removed: Record<string, Revision>
  active: Revision
  copyLinks: Revision
}
export type EntryDraft = { id: string; value: string; description: string }
export type EditorState =
  | { mode: 'create'; parentId: string | null; entries: EntryDraft[] }
  | { mode: 'rename'; parentId: null; nodeId: string; value: string; description: string }
export type SplitDraft = { id: string; value: string; description: string }
export type EntryOperation =
  | { mode: 'merge'; nodeIds: string[]; value: string; description: string }
  | { mode: 'split'; nodeId: string; entries: SplitDraft[]; assignments: Record<string, string> }
