import type { BranchingSetting, CopyLink, RetiredVersionNumber, Revision, StoredState, Version } from './workspace'

export type VersionChange = { version: Version; revision: Revision }
export type VersionRemoval = { id: string; revision: Revision }
export type SyncDelta = {
  type: 'sync-delta'
  versions: VersionChange[]
  removed: VersionRemoval[]
  retiredVersionNumbers?: RetiredVersionNumber[]
  active?: { id: string; revision: Revision }
  copyLinks?: { links: CopyLink[]; revision: Revision }
  branching?: BranchingSetting
  nextNode: number
  nextVersion: number
  nextLane: number
}
export type SyncSnapshot = {
  type: 'sync-snapshot'
  state: StoredState
  versions: Record<string, Revision>
  removed: Record<string, Revision>
  active: Revision
  copyLinks: Revision
  interactions?: InteractionEntry[]
  clock: number
}
export type PingLocation = {
  x: number
  y: number
  coordinateSpace?: 'global' | 'viewport' | 'graph' | 'version'
  versionId?: string
  region?: 'header-left' | 'header-right' | 'body' | 'map'
}
export type InteractionEntry = {
  id: string
  actorId: string
  actorName: string
  actorColor?: string
  action: string
  createdAt: number
  versionId?: string
  nodeId?: string
  nodeLabel?: string
  ping?: PingLocation
}
export type RemoteUser = { name: string; color: string; activeVersionId: string | null; selectedNodeIds: string[]; lastSeen: number }
export type Ping = { id: string; userId: string; createdAt: number } & PingLocation

