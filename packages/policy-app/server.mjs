import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeDocument, stringifyDocument } from '@roccho/graph-editor'
import { connectControl, parseControl } from '@roccho/policy-ui/control-graph'
import { createFileStore } from './file-store.mjs'

const maxBodyBytes = 256 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })
const requestError = (status, message) => Object.assign(new Error(message), { status })
const sha256 = body => createHash('sha256').update(body).digest('hex')
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

const loadAssets = () => {
  const manifestPath = fileURLToPath(import.meta.resolve('@roccho/policy-ui/asset-manifest.json'))
  const root = path.dirname(manifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!exactKeys(manifest, ['schema', 'assets']) || manifest.schema !== 1 || !Array.isArray(manifest.assets)) throw new Error('invalid UI asset manifest')
  const types = new Set(['text/html; charset=utf-8', 'text/javascript; charset=utf-8', 'text/css; charset=utf-8'])
  const assets = new Map()
  for (const asset of manifest.assets) {
    if (!asset || !exactKeys(asset, ['id', 'file', 'contentType', 'sha256'])) throw new Error('invalid UI asset entry')
    if (typeof asset.id !== 'string' || !asset.id || assets.has(asset.id)) throw new Error('duplicate or invalid UI asset id')
    if (typeof asset.file !== 'string' || !/^assets\/[A-Za-z0-9._-]+$/.test(asset.file)) throw new Error('unsafe UI asset path')
    if (!types.has(asset.contentType) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error('invalid UI asset metadata')
    const file = path.resolve(root, ...asset.file.split('/'))
    if (path.dirname(file) !== path.resolve(root, 'assets')) throw new Error('unsafe UI asset resolution')
    const body = readFileSync(file)
    if (sha256(body) !== asset.sha256) throw new Error(`UI asset hash mismatch: ${asset.id}`)
    assets.set(asset.id, { body, type: asset.contentType })
  }
  const expected = ['shell.index', 'shell.control', 'shell.task', 'shell.graph', 'module.control', 'module.graph', 'style.graph']
  if (assets.size !== expected.length || expected.some(id => !assets.has(id))) throw new Error('incomplete UI asset manifest')
  return assets
}

const encodeConfig = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const composeShell = (template, config, moduleUrl, styleUrl) => {
  const source = template.toString('utf8')
  const bootstrap = `<script type="application/json" id="policy-app-config">${encodeConfig(config)}</script><script type="module" src="${moduleUrl}"></script>`
  let result = source.replace('<!--POLICY_APP_BOOTSTRAP-->', bootstrap)
  if (styleUrl) result = result.replace('<!--POLICY_APP_STYLE-->', `<link rel="stylesheet" href="${styleUrl}">`)
  if (result === source || result.includes('<!--POLICY_APP_BOOTSTRAP-->') || result.includes('<!--POLICY_APP_STYLE-->')) throw new Error('invalid UI shell composition slot')
  return Buffer.from(result)
}

const decode = body => { try { return decoder.decode(body) } catch { throw requestError(400, 'invalid UTF-8') } }
const validateControl = body => {
  try { connectControl(parseControl(decode(body))) } catch (error) { if (error.code === 'INVALID_CONTROL') throw requestError(400, error.message); throw error }
  return body
}
const canonicalDocument = body => {
  try { return Buffer.from(stringifyDocument(normalizeDocument(JSON.parse(decode(body))))) } catch (error) { if (error instanceof SyntaxError || error.code === 'INVALID_DOCUMENT') throw requestError(400, error.message); throw error }
}
const readBody = async request => {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw requestError(413, 'body too large')
  const chunks = []
  let size = 0
  for await (const chunk of request) { size += chunk.length; if (size > maxBodyBytes) throw requestError(413, 'body too large'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}

const product = {
  routes: {
    '/': 'shell.index', '/index.html': 'shell.index', '/control.html': 'shell.control', '/task.html': 'shell.task', '/graph.html': 'shell.graph',
    '/control.mjs': 'module.control', '/dist/graph.mjs': 'module.graph', '/dist/graph.css': 'style.graph',
  },
  configs: {
    'shell.index': { view: 'index', labels: { title: 'Control UI', heading: 'Control UI' }, links: [
      { href: '/control.html', label: 'P/D Control', detail: 'policy/control.jsonl' },
      { href: '/task.html', label: 'Tasks · TODO', detail: 'tasks.jsonl' },
      { href: '/graph.html', label: 'Release map', detail: 'document.json' },
    ] },
    'shell.control': { view: 'control', endpoints: { control: '/control.jsonl' }, labels: { title: 'P/D Control', stale: 'stale: reload required; no automatic overwrite', saved: 'saved', delete: 'delete' } },
    'shell.task': { view: 'task', endpoints: { tasks: '/tasks.jsonl' }, labels: { title: 'Tasks · TODO', heading: 'Tasks', message: 'TODO / 未実装', link: 'tasks.jsonl' } },
    'shell.graph': { endpoints: { document: '/document.json' }, labels: { title: 'Release map editor', documentName: 'document', stale: 'Stale version; reload explicitly or preserve your unsaved work.', editor: { heading: 'Release map editor', scope: 'Diagram SSOT only — not infrastructure state, permission, or receipt authority.', backLabel: 'Control UI', backHref: '/', canvasLabel: 'Editable release map canvas' } } },
  },
}

export const createServer = ({ controlPath, tasksPath, documentPath, host = '127.0.0.1' } = {}) => {
  for (const [name, value] of Object.entries({ controlPath, tasksPath, documentPath })) if (typeof value !== 'string' || !value) throw new TypeError(`${name} is required`)
  const assets = loadAssets()
  const routes = new Map(Object.entries(product.routes).map(([route, id]) => {
    const asset = assets.get(id)
    if (!id.startsWith('shell.')) return [route, asset]
    return [route, { type: asset.type, body: composeShell(asset.body, product.configs[id], id === 'shell.graph' ? '/dist/graph.mjs' : '/control.mjs', id === 'shell.graph' ? '/dist/graph.css' : undefined) }]
  }))
  routes.set('/tasks.jsonl', { type: 'application/x-ndjson; charset=utf-8', file: tasksPath })
  const documents = new Map([
    ['/control.jsonl', { type: 'application/x-ndjson; charset=utf-8', requestType: 'application/x-ndjson', store: createFileStore(controlPath), canonicalize: validateControl, allowCreate: false, missingStatus: 500 }],
    ['/document.json', { type: 'application/json; charset=utf-8', requestType: 'application/json', store: createFileStore(documentPath), canonicalize: canonicalDocument, allowCreate: true, missingStatus: 404 }],
  ])
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    let pathname
    try { pathname = new URL(request.url ?? '/', `http://${host}`).pathname } catch { response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Bad Request\n'); return }
    if (request.method === 'PUT') {
      const document = documents.get(pathname)
      if (!document) { response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Method Not Allowed\n'); return }
      try {
        const address = server.address()
        const expectedOrigin = `http://${host}:${typeof address === 'object' && address ? address.port : ''}`
        if (request.headers.origin !== expectedOrigin) throw requestError(403, 'origin rejected')
        const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
        if (contentType !== document.requestType) throw requestError(415, `${document.requestType} required`)
        const ifMatch = request.headers['if-match'], ifNoneMatch = request.headers['if-none-match']
        const hasMatch = typeof ifMatch === 'string' && Boolean(ifMatch), hasNone = typeof ifNoneMatch === 'string' && Boolean(ifNoneMatch)
        if (document.allowCreate && hasMatch && hasNone) throw requestError(400, 'choose If-Match or If-None-Match')
        if (document.allowCreate && hasNone && ifNoneMatch !== '*') throw requestError(400, 'If-None-Match must be *')
        if (!hasMatch && !(document.allowCreate && hasNone)) throw requestError(428, document.allowCreate ? 'If-Match or If-None-Match required' : 'If-Match required')
        const body = document.canonicalize(await readBody(request)), creating = document.allowCreate && hasNone
        const nextEtag = creating ? await document.store.create(body) : await document.store.replace(ifMatch, body)
        const result = Buffer.from(JSON.stringify({ ok: true, etag: nextEtag }))
        response.writeHead(creating ? 201 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': result.length, ETag: nextEtag })
        response.end(result)
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : error.code === 'STALE_ETAG' ? 412 : 500
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(`${status === 500 ? 'Write failed' : error.message}\n`)
      }
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: documents.has(pathname) ? 'GET, HEAD, PUT' : 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Method Not Allowed\n'); return }
    const route = routes.get(pathname), document = documents.get(pathname)
    if (!route && !document) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not Found\n'); return }
    try {
      const result = document ? await document.store.read() : { body: route.body ?? await readFile(route.file) }
      response.writeHead(200, { 'Content-Type': document?.type ?? route.type, 'Content-Length': result.body.length, ...(result.etag ? { ETag: result.etag } : {}) })
      response.end(request.method === 'HEAD' ? undefined : result.body)
    } catch (error) {
      if (document && error.code === 'ENOENT' && document.missingStatus === 404) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not Found\n'); return }
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(`Read failed: ${error.code ?? 'UNKNOWN'}\n`)
    }
  })
  return server
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const host = '127.0.0.1'
  const rawPort = process.argv[2] ?? process.env.CONTROL_UI_PORT ?? '4173'
  const controlPath = process.argv[3], tasksPath = process.argv[4], documentPath = process.argv[5]
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${rawPort}`)
  const server = createServer({ host, controlPath, tasksPath, documentPath })
  server.listen(port, host, () => console.log(`Policy UI: http://${host}:${port}/`))
}
