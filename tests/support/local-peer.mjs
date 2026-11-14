import Peer from 'peerjs/dist/bundler.mjs'

export default class LocalPeer extends Peer {
  constructor(id) {
    super(id, {
      host: '127.0.0.1',
      port: 19101,
      path: '/',
      secure: false,
      config: { iceServers: [] },
    })
  }
}
