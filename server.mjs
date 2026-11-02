import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const root = process.cwd()
const statePath = resolve(root, 'data', 'workspace.json')
const staticRoot = resolve(root, 'dist')
const staticMode = process.argv.includes('--static')
const port = Number(process.env.PORT ?? (staticMode ? 4173 : 4174))
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' })
  response.end(body)
}

async function handleState(request, response) {
  if (request.method === 'GET') {
    try {
      send(response, 200, JSON.stringify({ state: JSON.parse(await readFile(statePath, 'utf8')) }))
    } catch (error) {
      if (error.code === 'ENOENT') send(response, 200, JSON.stringify({ state: null }))
      else send(response, 500, JSON.stringify({ error: 'Unable to read workspace' }))
    }
    return
  }

  if (request.method !== 'PUT') {
    send(response, 405, JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 2_000_000) {
      send(response, 413, JSON.stringify({ error: 'Workspace is too large' }))
      return
    }
  }

  try {
    const workspace = JSON.parse(body)
    if (!Array.isArray(workspace.versions) || typeof workspace.activeId !== 'string') {
      send(response, 400, JSON.stringify({ error: 'Invalid workspace state' }))
      return
    }
    await mkdir(resolve(root, 'data'), { recursive: true })
    const temporaryPath = `${statePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(workspace), 'utf8')
    await rename(temporaryPath, statePath)
    send(response, 204, '')
  } catch {
    send(response, 400, JSON.stringify({ error: 'Invalid workspace state' }))
  }
}

async function handleStatic(pathname, response) {
  let requestedPath
  try { requestedPath = decodeURIComponent(pathname) } catch {
    send(response, 400, 'Bad request', 'text/plain; charset=utf-8')
    return
  }
  const candidate = resolve(staticRoot, `.${requestedPath}`)
  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) {
    send(response, 403, 'Forbidden', 'text/plain; charset=utf-8')
    return
  }
  let filePath = candidate
  try {
    const contents = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' })
    response.end(contents)
  } catch {
    filePath = resolve(staticRoot, 'index.html')
    try {
      response.writeHead(200, { 'Content-Type': mimeTypes['.html'] })
      response.end(await readFile(filePath))
    } catch {
      send(response, 503, 'Build the application before starting production mode.', 'text/plain; charset=utf-8')
    }
  }
}

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === '/api/state') {
    await handleState(request, response)
    return
  }
  if (staticMode && (request.method === 'GET' || request.method === 'HEAD')) {
    await handleStatic(pathname, response)
    return
  }
  send(response, 404, JSON.stringify({ error: 'Not found' }))
}).listen(port, '127.0.0.1', () => {
  console.log(`Workspace API listening on http://127.0.0.1:${port}`)
})