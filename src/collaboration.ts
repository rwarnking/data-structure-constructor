import Peer, { type DataConnection, type PeerError } from 'peerjs'

export type RoomStatus = {
  state: 'idle' | 'hosting' | 'joining' | 'connected' | 'error'
  peers: number
  message: string
}

export type RoomMessageHandler = (message: unknown, reply: (message: unknown) => void) => void

function roomPeerId(room: string) {
  let hash = 14695981039346656037n
  for (const byte of new TextEncoder().encode(room)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  return `canopy-${hash.toString(36)}`
}

export class PeerRoom {
  private peer: Peer | null = null
  private hostConnections = new Set<DataConnection>()
  private hubConnection: DataConnection | null = null
  private host = false
  private room = ''
  private onMessage: RoomMessageHandler = () => undefined
  private onStatus: (status: RoomStatus) => void = () => undefined

  async hostRoom(room: string, onMessage: RoomMessageHandler, onStatus: (status: RoomStatus) => void) {
    this.prepare(room, onMessage, onStatus)
    this.host = true
    this.publishStatus('hosting', 1, 'Waiting for peers')
    const peer = new Peer(roomPeerId(room))
    this.peer = peer
    peer.on('open', () => this.publishStatus('hosting', 1 + this.hostConnections.size, 'Hosting session'))
    peer.on('connection', (connection) => this.attachHostConnection(connection))
    peer.on('error', (error) => this.handleError(error))
    await this.waitForOpen(peer)
  }

  async joinRoom(room: string, onMessage: RoomMessageHandler, onStatus: (status: RoomStatus) => void) {
    this.prepare(room, onMessage, onStatus)
    this.publishStatus('joining', 1, 'Connecting to host')
    const peer = new Peer()
    this.peer = peer
    peer.on('error', (error) => this.handleError(error))
    await this.waitForOpen(peer)
    const connection = peer.connect(roomPeerId(room), { reliable: true })
    this.hubConnection = connection
    connection.on('open', () => {
      this.publishStatus('connected', 2, 'Connected to shared session')
      connection.send({ type: 'sync-request' })
    })
    connection.on('data', (message) => this.handleDataMessage(message, () => undefined))
    connection.on('close', () => {
      if (this.peer === peer) this.publishStatus('error', 1, 'Connection to the host was closed')
    })
    connection.on('error', (error) => this.handleError(error))
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        this.publishStatus('error', 0, 'Timed out connecting to the room')
        reject(new Error('Timed out connecting to the room'))
      }, 15000)
      const cleanup = () => {
        window.clearTimeout(timeout)
        connection.off('open', onOpen)
        connection.off('error', onError)
        connection.off('close', onClose)
      }
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onClose = () => {
        cleanup()
        reject(new Error('Connection to the host was closed'))
      }
      connection.once('open', onOpen)
      connection.once('error', onError)
      connection.once('close', onClose)
      if (connection.open) onOpen()
    })
  }

  send(message: unknown) {
    if (!this.peer || this.peer.destroyed) return
    if (this.host) {
      for (const connection of this.hostConnections) {
        if (connection.open) connection.send(message)
      }
    } else {
      const connection = this.hubConnection
      if (connection?.open) connection.send(message)
    }
  }

  close() {
    this.peer?.destroy()
    this.peer = null
    this.hubConnection = null
    this.hostConnections.clear()
    this.host = false
    this.publishStatus('idle', 0, 'Not connected')
  }

  private prepare(room: string, onMessage: RoomMessageHandler, onStatus: (status: RoomStatus) => void) {
    this.close()
    this.room = room
    this.onMessage = onMessage
    this.onStatus = onStatus
  }

  private attachHostConnection(connection: DataConnection) {
    connection.on('open', () => {
      this.hostConnections.add(connection)
      this.publishStatus('hosting', 1 + this.hostConnections.size, `Hosting · ${this.hostConnections.size} peer${this.hostConnections.size === 1 ? '' : 's'}`)
      this.sendPeerCount()
    })
    connection.on('data', (message) => {
      this.handleDataMessage(message, (response) => {
        if (connection.open) connection.send(response)
      })
      for (const other of this.hostConnections) {
        if (other !== connection && other.open) other.send(message)
      }
    })
    connection.on('close', () => {
      this.hostConnections.delete(connection)
      this.publishStatus('hosting', 1 + this.hostConnections.size, `Hosting · ${this.hostConnections.size} peer${this.hostConnections.size === 1 ? '' : 's'}`)
      this.sendPeerCount()
    })
    connection.on('error', (error) => this.handleError(error))
  }

  private sendPeerCount() {
    const message = { type: 'peer-count', count: 1 + this.hostConnections.size }
    for (const connection of this.hostConnections) {
      if (connection.open) connection.send(message)
    }
  }

  private handleDataMessage(message: unknown, reply: (message: unknown) => void) {
    if (message && typeof message === 'object'
      && (message as { type?: string }).type === 'peer-count') {
      const count = (message as { count?: unknown }).count
      if (typeof count === 'number' && Number.isInteger(count) && count >= 1) {
        this.publishStatus(this.host ? 'hosting' : 'connected', count, this.host ? `Hosting · ${count - 1} peer${count === 2 ? '' : 's'}` : 'Connected to shared session')
      }
      return
    }
    this.onMessage(message, reply)
  }

  private waitForOpen(peer: Peer) {
    return new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        peer.off('error', onError)
        resolve()
      }
      const onError = (error: PeerError<string>) => {
        peer.off('open', onOpen)
        this.handleError(error)
        reject(error)
      }
      peer.once('open', onOpen)
      peer.once('error', onError)
    })
  }

  private handleError(error: PeerError<string>) {
    this.publishStatus('error', 0, error.message || 'Peer connection failed')
  }

  private publishStatus(state: RoomStatus['state'], peers: number, message: string) {
    this.onStatus({ state, peers, message })
  }
}

export function getClientId() {
  const key = 'canopy-client-id'
  const stored = sessionStorage.getItem(key)
  if (stored && /^[a-f0-9]{12}$/.test(stored)) return stored
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  sessionStorage.setItem(key, id)
  return id
}
