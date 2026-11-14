import { PeerServer } from 'peer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const peerServer = PeerServer({ port: 19101, host: '127.0.0.1', path: '/' })
const vite = await createServer({
  configFile: false,
  plugins: [vue()],
  resolve: {
    alias: [{ find: /^peerjs$/, replacement: fileURLToPath(new URL('./local-peer.mjs', import.meta.url)) }],
  },
  server: { host: '127.0.0.1', port: 19100, strictPort: true },
})
await vite.listen()
console.log('Integration test server ready')

async function close() {
  await vite.close()
  peerServer.close()
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
