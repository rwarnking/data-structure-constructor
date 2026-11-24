import Peer, { type DataConnection, type PeerError } from 'peerjs'

export type RoomStatus = {
  state: 'idle' | 'hosting' | 'joining' | 'connected' | 'reconnecting' | 'error'
  peers: number
  message: string
}

export type RoomMessageHandler = (message: unknown, reply: (message: unknown) => void) => void | false

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
  private reconnectTimer = 0
  private reconnectStarted = 0
  private generation = 0
  private queuedMessages: unknown[] = []
  private hasConnected = false
  private handoverCandidates: string[] = []
  private knownPeers: string[] = []
  private heartbeatTimer = 0
  private watchdogTimer = 0
  private lastHostMessage = 0
  private onMessage: RoomMessageHandler = () => undefined
  private onStatus: (status: RoomStatus) => void = () => undefined

  async hostRoom(room: string, onMessage: RoomMessageHandler, onStatus: (status: RoomStatus) => void) {
    this.prepare(onMessage, onStatus)
    this.host = true
    this.publishStatus('hosting', 1, 'Waiting for peers')
    const peer = new Peer(roomPeerId(room))
    this.peer = peer
    peer.on('open', () => {
      if (this.peer === peer) {
        this.startHeartbeat()
        this.publishStatus('hosting', 1 + this.hostConnections.size, 'Hosting session')
      }
    })
    peer.on('connection', (connection) => {
      if (this.peer === peer) this.attachHostConnection(connection)
      else connection.close()
    })
    peer.on('error', (error) => { if (this.peer === peer && !this.reconnectStarted) this.handleError(error) })
    this.watchHostSignaling(peer, this.generation)
    await this.waitForOpen(peer)
  }

  async joinRoom(room: string, onMessage: RoomMessageHandler, onStatus: (status: RoomStatus) => void) {
    this.prepare(onMessage, onStatus)
    this.publishStatus('joining', 1, 'Connecting to host')
    const peer = new Peer()
    this.peer = peer
    const generation = this.generation
    peer.on('error', (error) => {
      if (this.peer === peer && !this.reconnectStarted) this.handleError(error)
    })
    peer.on('disconnected', () => {
      if (this.peer === peer && !this.host && this.hasConnected && !this.hubConnection?.open) {
        this.scheduleReconnect(room, peer, generation)
      }
    })
    peer.on('connection', (connection) => {
      if (this.peer !== peer || this.host) { connection.close(); return }
      connection.on('open', () => connection.send({ type: 'room-election-probe' }))
      connection.on('error', () => connection.close())
      window.setTimeout(() => connection.close(), 3000)
    })
    await this.waitForOpen(peer)
    await this.connectToHost(room, peer, generation)
  }

  private async connectToHost(room: string, peer: Peer, generation: number) {
    const connection = peer.connect(roomPeerId(room), { reliable: true })
    this.hubConnection = connection
    connection.on('open', () => {
      if (generation !== this.generation || this.hubConnection !== connection) return
      const reconnecting = this.reconnectStarted !== 0
      this.reconnectStarted = 0
      this.hasConnected = true
      this.handoverCandidates = []
      this.lastHostMessage = Date.now()
      window.clearInterval(this.watchdogTimer)
      this.watchdogTimer = window.setInterval(() => {
        if (this.peer !== peer || this.hubConnection !== connection || generation !== this.generation) return
        if (Date.now() - this.lastHostMessage < 15000) return
        this.hubConnection = null
        this.scheduleReconnect(room, peer, generation)
        connection.close()
      }, 3000)
      this.publishStatus('connected', 2, 'Connected to shared session')
      if (reconnecting) this.onMessage({ type: 'sync-request' }, (message) => connection.send(message))
      for (const message of this.queuedMessages.splice(0)) connection.send(message)
      connection.send({ type: 'sync-request' })
    })
    connection.on('data', (message) => {
      if (generation === this.generation && this.hubConnection === connection) {
        this.lastHostMessage = Date.now()
        this.handleDataMessage(message, () => undefined)
      }
    })
    connection.on('close', () => {
      if (this.hasConnected && this.peer === peer && generation === this.generation
        && this.hubConnection === connection && this.reconnectStarted === 0) {
        this.scheduleReconnect(room, peer, generation)
      }
    })
    connection.on('error', (error) => {
      if (!this.reconnectStarted && generation === this.generation) this.handleError(error)
    })
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        connection.close()
        reject(new Error('Timed out connecting to the room'))
      }, this.reconnectStarted ? 3000 : 15000)
      const cleanup = () => {
        window.clearTimeout(timeout)
        connection.off('open', onOpen)
        connection.off('error', onError)
        connection.off('close', onClose)
        peer.off('error', onPeerError)
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
      const onPeerError = (error: PeerError<string>) => {
        cleanup()
        reject(error)
      }
      connection.once('open', onOpen)
      connection.once('error', onError)
      connection.once('close', onClose)
      peer.once('error', onPeerError)
      if (connection.open) onOpen()
    })
  }

  private scheduleReconnect(room: string, peer: Peer, generation: number) {
    if (generation !== this.generation || this.reconnectStarted) return
    this.reconnectStarted = Date.now()
    this.publishStatus('reconnecting', 1, 'Reconnecting to room')
    const retry = async () => {
      if (generation !== this.generation || this.peer !== peer) return
      if (Date.now() - this.reconnectStarted >= 15000 || peer.destroyed) {
        this.publishStatus('error', 1, 'Room is no longer available or could not be reconnected')
        return
      }
      try {
        if (this.handoverCandidates[0] === peer.id) {
          try { await this.takeOverHost(room, peer, generation) }
          catch {
            if (generation !== this.generation || this.peer !== peer) return
            await this.connectToHost(room, peer, generation)
          }
          return
        }
        if (peer.disconnected) {
          peer.reconnect()
          await this.waitForOpen(peer)
        }
        await this.connectToHost(room, peer, generation)
      } catch {
        if (generation === this.generation && this.peer === peer) {
          if (!this.handoverCandidates.length && this.knownPeers.length > 1 && !peer.disconnected) {
            const reachable = await this.reachablePeers(peer)
            if (generation !== this.generation || this.peer !== peer) return
            if (reachable.length > 1) this.handoverCandidates = reachable
          }
          this.reconnectTimer = window.setTimeout(() => void retry(), 1000)
        }
      }
    }
    this.reconnectTimer = window.setTimeout(() => void retry(), 1000)
  }

  private async reachablePeers(peer: Peer) {
    const peers = this.knownPeers.filter((id) => id !== peer.id)
    const reachable = await Promise.all(peers.map((id) => new Promise<string | null>((resolve) => {
      const connection = peer.connect(id, { reliable: true })
      let settled = false
      const finish = (found: boolean) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        connection.close()
        resolve(found ? id : null)
      }
      const timeout = window.setTimeout(() => finish(false), 2000)
      connection.on('data', (message) => finish(!!message && typeof message === 'object'
        && (message as { type?: string }).type === 'room-election-probe'))
      connection.on('error', () => finish(false))
      connection.on('close', () => finish(false))
    })))
    return [peer.id, ...reachable.filter((id): id is string => !!id)].sort()
  }

  private async takeOverHost(room: string, previous: Peer, generation: number) {
    const candidate = new Peer(roomPeerId(room))
    try { await this.waitForOpen(candidate) }
    catch (error) { candidate.destroy(); throw error }
    if (generation !== this.generation || this.peer !== previous) {
      candidate.destroy()
      return
    }
    this.peer = candidate
    this.host = true
    this.hubConnection = null
    this.reconnectStarted = 0
    this.handoverCandidates = []
    this.queuedMessages = []
    window.clearInterval(this.watchdogTimer)
    candidate.on('connection', (connection) => {
      if (this.peer === candidate) this.attachHostConnection(connection)
      else connection.close()
    })
    candidate.on('error', (error) => { if (this.peer === candidate && !this.reconnectStarted) this.handleError(error) })
    this.watchHostSignaling(candidate, generation)
    this.startHeartbeat()
    previous.destroy()
    this.publishStatus('hosting', 1, 'Hosting session')
  }

  private startHeartbeat() {
    window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = window.setInterval(() => this.send({ type: 'host-heartbeat' }), 3000)
  }

  private watchHostSignaling(peer: Peer, generation: number) {
    peer.on('disconnected', () => {
      if (this.peer !== peer || generation !== this.generation || this.reconnectStarted) return
      this.reconnectStarted = Date.now()
      this.publishStatus('reconnecting', 1 + this.hostConnections.size, 'Reconnecting room signaling')
      const retry = async () => {
        if (this.peer !== peer || generation !== this.generation) return
        if (peer.destroyed || Date.now() - this.reconnectStarted >= 15000) {
          this.publishStatus('error', 1 + this.hostConnections.size, 'Room signaling could not be reconnected')
          return
        }
        try {
          peer.reconnect()
          await this.waitForOpen(peer)
          if (this.peer !== peer || generation !== this.generation) return
          this.reconnectStarted = 0
          this.publishStatus('hosting', 1 + this.hostConnections.size, 'Hosting session')
        } catch {
          if (this.peer === peer && generation === this.generation) {
            this.reconnectTimer = window.setTimeout(() => void retry(), 1000)
          }
        }
      }
      this.reconnectTimer = window.setTimeout(() => void retry(), 1000)
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
      else if (this.reconnectStarted) this.queuedMessages.push(message)
    }
  }

  isHosting() { return this.host }

  close() {
    const previous = this.peer
    const handover = this.host && this.hostConnections.size > 0
    if (handover) {
      const candidates = [...this.hostConnections].filter((connection) => connection.open)
        .map((connection) => connection.peer).sort()
      for (const connection of this.hostConnections) {
        if (connection.open) connection.send({ type: 'host-handover', candidates })
      }
    }
    this.generation++
    window.clearTimeout(this.reconnectTimer)
    window.clearInterval(this.heartbeatTimer)
    window.clearInterval(this.watchdogTimer)
    this.reconnectStarted = 0
    this.queuedMessages = []
    this.hasConnected = false
    this.handoverCandidates = []
    this.knownPeers = []
    this.peer = null
    this.hubConnection = null
    this.hostConnections.clear()
    this.host = false
    if (previous) {
      if (handover) window.setTimeout(() => previous.destroy(), 250)
      else previous.destroy()
    }
    this.publishStatus('idle', 0, 'Not connected')
  }

  private prepare(onMessage: RoomMessageHandler, onStatus: (status: RoomStatus) => void) {
    this.close()
    this.onMessage = onMessage
    this.onStatus = onStatus
  }

  private attachHostConnection(connection: DataConnection) {
    const peer = this.peer
    connection.on('open', () => {
      if (this.peer !== peer) return
      this.hostConnections.add(connection)
      if (!this.reconnectStarted) this.publishStatus('hosting', 1 + this.hostConnections.size, `Hosting · ${this.hostConnections.size} peer${this.hostConnections.size === 1 ? '' : 's'}`)
      this.sendPeerCount()
    })
    connection.on('data', (message) => {
      if (this.peer !== peer) return
      const relay = this.handleDataMessage(message, (response) => {
        if (connection.open) connection.send(response)
      })
      if (relay === false) return
      for (const other of this.hostConnections) {
        if (other !== connection && other.open) other.send(message)
      }
    })
    connection.on('close', () => {
      if (this.peer !== peer) return
      this.hostConnections.delete(connection)
      if (!this.reconnectStarted) this.publishStatus('hosting', 1 + this.hostConnections.size, `Hosting · ${this.hostConnections.size} peer${this.hostConnections.size === 1 ? '' : 's'}`)
      this.sendPeerCount()
    })
    connection.on('error', (error) => { if (this.peer === peer) this.handleError(error) })
  }

  private sendPeerCount() {
    const message = { type: 'peer-count', count: 1 + this.hostConnections.size,
      peers: [...this.hostConnections].filter((connection) => connection.open).map((connection) => connection.peer).sort() }
    for (const connection of this.hostConnections) {
      if (connection.open) connection.send(message)
    }
  }

  private handleDataMessage(message: unknown, reply: (message: unknown) => void) {
    if (message && typeof message === 'object'
      && (message as { type?: string }).type === 'host-heartbeat') return false
    if (message && typeof message === 'object'
      && (message as { type?: string }).type === 'host-handover') {
      const candidates = (message as { candidates?: unknown }).candidates
      if (!this.host && Array.isArray(candidates) && candidates.every((item) => typeof item === 'string')) {
        this.handoverCandidates = [...new Set(candidates)].sort()
      }
      return false
    }
    if (message && typeof message === 'object'
      && (message as { type?: string }).type === 'peer-count') {
      const count = (message as { count?: unknown }).count
      const peers = (message as { peers?: unknown }).peers
      if (!this.host && Array.isArray(peers) && peers.every((id) => typeof id === 'string')) this.knownPeers = peers
      if (!this.host && typeof count === 'number' && Number.isInteger(count) && count >= 1) {
        this.publishStatus('connected', count, 'Connected to shared session')
      }
      return false
    }
    return this.onMessage(message, reply)
  }

  private waitForOpen(peer: Peer) {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        peer.off('open', onOpen)
        peer.off('error', onError)
        reject(new Error('Timed out connecting to the signaling server'))
      }, this.reconnectStarted ? 3000 : 15000)
      const onOpen = () => {
        window.clearTimeout(timeout)
        peer.off('error', onError)
        resolve()
      }
      const onError = (error: PeerError<string>) => {
        window.clearTimeout(timeout)
        peer.off('open', onOpen)
        if (!this.reconnectStarted) this.handleError(error)
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
