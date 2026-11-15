import type { CopyLink, RetiredVersionNumber, Revision, StoredState, Version } from './workspace'

export type VersionChange = { version: Version; revision: Revision }
export type VersionRemoval = { id: string; revision: Revision }
export type SyncDelta = {
  type: 'sync-delta'
  versions: VersionChange[]
  removed: VersionRemoval[]
  retiredVersionNumbers?: RetiredVersionNumber[]
  active?: { id: string; revision: Revision }
  copyLinks?: { links: CopyLink[]; revision: Revision }
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
export type InteractionEntry = {
  id: string
  actorId: string
  actorName: string
  action: string
  createdAt: number
  versionId?: string
  nodeId?: string
  nodeLabel?: string
  ping?: { x: number; y: number }
}
export type RemoteUser = { name: string; activeVersionId: string | null; selectedNodeIds: string[]; lastSeen: number }
export type Ping = { id: string; userId: string; x: number; y: number; createdAt: number }

