import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createServer } from '../server.mjs'
import { stringifyDocument } from '@roccho/graph-editor'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const documentFixture = Buffer.from(stringifyDocument({ schema: 3, canvas: { width: 900, height: 360 }, maps: [{ id: 'map-1', title: 'Map 1', timeline: [{ id: 'state-1', title: 'State 1', cells: [] }] }] }))
const controlFixture = Buffer.from([
  { id: 'root', op: 'document', schema: 3, state: 'active', rel: null },
  { id: 'review', state: 'active', rel: { parent: 'root', kind: 'reviews' } },
  { id: 'detail', state: 'active', rel: { parent: 'review', kind: 'details' } },
].map(record => JSON.stringify(record)).join('\n') + '\n')
const tasksFixture = Buffer.from('{"id":"task-1","state":"active"}\n')
const hash = body => `"sha256-${createHash('sha256').update(body).digest('hex')}"`
const encode = records => `${records.map(record => JSON.stringify(record)).join('\n')}\n`
const ignoreMissing = error => { if (error.code !== 'ENOENT') throw error }

const openApp = async (t, { includeDocument = true } = {}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'policy-app-'))
  const controlPath = path.join(directory, 'control.jsonl')
  const tasksPath = path.join(directory, 'tasks.jsonl')
  const documentPath = path.join(directory, 'document.json')
  await writeFile(controlPath, controlFixture)
  await writeFile(tasksPath, tasksFixture)
  if (includeDocument) await writeFile(documentPath, documentFixture)
  const server = createServer({ controlPath, tasksPath, documentPath })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await unlink(controlPath).catch(ignoreMissing)
    await unlink(tasksPath).catch(ignoreMissing)
    await unlink(documentPath).catch(ignoreMissing)
    await rmdir(directory).catch(ignoreMissing)
  })
  return { controlPath, tasksPath, documentPath, origin }
}

const putControl = (origin, etag, body, headers = {}) => fetch(`${origin}/control.jsonl`, {
  method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'If-Match': etag, ...headers }, body,
})
const putDocument = (origin, body, headers = {}) => fetch(`${origin}/document.json`, {
  method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json; charset=utf-8', ...headers }, body,
})

test('GET and HEAD expose OPS-mapped verified UI and external data routes', async t => {
  const { origin, tasksPath } = await openApp(t)
  const expected = controlFixture
  const control = await fetch(`${origin}/control.jsonl`)
  assert.deepEqual(Buffer.from(await control.arrayBuffer()), expected)
  assert.equal(control.headers.get('etag'), hash(expected))
  const head = await fetch(`${origin}/control.jsonl`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  const tasks = await fetch(`${origin}/tasks.jsonl`)
  assert.deepEqual(Buffer.from(await tasks.arrayBuffer()), tasksFixture)
  assert.equal(tasks.headers.get('content-type'), 'application/x-ndjson; charset=utf-8')
  assert.equal((await fetch(`${origin}/tasks.jsonl`, { method: 'HEAD' })).status, 200)
  for (const route of ['/', '/index.html', '/control.html', '/control.mjs', '/task.html', '/graph.html', '/document.json', '/dist/graph.mjs', '/dist/graph.css']) assert.equal((await fetch(`${origin}${route}`)).status, 200, route)
  const index = await (await fetch(`${origin}/`)).text()
  assert.match(index, /id="policy-app-config"/)
  assert.match(index, /src="\/control\.mjs"/)
  assert.equal((await fetch(`${origin}/release-map.json`)).status, 404)
  assert.equal((await fetch(`${origin}/dist/release-map.mjs`)).status, 404)
  assert.equal((await fetch(`${origin}/missing`)).status, 404)
  assert.equal((await fetch(`${origin}/control.jsonl`, { method: 'POST' })).status, 405)
  await unlink(tasksPath)
  assert.equal((await fetch(`${origin}/tasks.jsonl`)).status, 500)
})

test('all three external paths are mandatory and no packaged data fallback exists', () => {
  assert.throws(() => createServer(), /controlPath is required/)
  assert.throws(() => createServer({ controlPath: 'a' }), /tasksPath is required/)
  assert.throws(() => createServer({ controlPath: 'a', tasksPath: 'b' }), /documentPath is required/)
})

test('server owns product routes/config and verifies UI assets before listen', async () => {
  const serverSource = await readFile(path.join(appRoot, 'server.mjs'), 'utf8')
  assert.match(serverSource, /import\.meta\.resolve\('@roccho\/policy-ui\/asset-manifest\.json'\)/)
  assert.match(serverSource, /UI asset hash mismatch/)
  assert.match(serverSource, /const product = \{[\s\S]*routes:[\s\S]*configs:/)
  assert.match(serverSource, /encodeConfig[\s\S]*POLICY_APP_BOOTSTRAP/)
  assert.doesNotMatch(serverSource, /defaultDocumentPath|document\.json'\)/)
  await assert.rejects(readFile(path.join(appRoot, 'index.html')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(path.join(appRoot, 'src')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), [])
})

test('document GET and HEAD expose canonical bytes with a strong ETag', async t => {
  const { origin } = await openApp(t)
  const expected = documentFixture
  const response = await fetch(`${origin}/document.json`)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected)
  assert.equal(response.headers.get('etag'), hash(expected))
  const head = await fetch(`${origin}/document.json`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal(head.headers.get('etag'), hash(expected))
})

test('document PUT canonicalizes, reads back, rejects stale updates, and leaves control bytes unchanged', async t => {
  const { controlPath, documentPath, origin } = await openApp(t)
  const controlBaseline = await readFile(controlPath)
  const baseline = await readFile(documentPath)
  const value = JSON.parse(baseline)
  value.maps[0].title = 'Changed title'
  const expected = Buffer.from(stringifyDocument(value))
  const saved = await putDocument(origin, JSON.stringify(value), { 'If-Match': hash(baseline) })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).etag, hash(expected))
  assert.deepEqual(await readFile(documentPath), expected)
  assert.equal((await putDocument(origin, baseline, { 'If-Match': hash(baseline) })).status, 412)
  assert.deepEqual(await readFile(controlPath), controlBaseline)
})

test('same-ETag concurrent document PUT has one winner', async t => {
  const { documentPath, origin } = await openApp(t)
  const baseline = await readFile(documentPath)
  const candidates = ['Left', 'Right'].map(title => {
    const value = JSON.parse(baseline)
    value.maps[0].title = title
    return Buffer.from(stringifyDocument(value))
  })
  const responses = await Promise.all(candidates.map(body => putDocument(origin, body, { 'If-Match': hash(baseline) })))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412])
  const final = await readFile(documentPath)
  assert.ok(candidates.some(candidate => candidate.equals(final)))
})

test('missing document can be created once and updates remain conditional', async t => {
  const { documentPath, origin } = await openApp(t, { includeDocument: false })
  const source = documentFixture
  assert.equal((await fetch(`${origin}/document.json`)).status, 404)
  assert.equal((await putDocument(origin, source, { 'If-Match': hash(source) })).status, 412)
  assert.equal((await putDocument(origin, source, { 'If-None-Match': '*' })).status, 201)
  assert.deepEqual(await readFile(documentPath), source)
  assert.equal((await putDocument(origin, source, { 'If-None-Match': '*' })).status, 412)
})

test('document PUT guards reject without mutation', async t => {
  const { documentPath, origin } = await openApp(t)
  const baseline = await readFile(documentPath)
  const etag = hash(baseline)
  assert.equal((await putDocument(origin, baseline)).status, 428)
  assert.equal((await putDocument(origin, baseline, { 'If-Match': etag, 'If-None-Match': '*' })).status, 400)
  assert.equal((await putDocument(origin, baseline, { 'If-None-Match': 'anything' })).status, 400)
  assert.equal((await fetch(`${origin}/document.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: baseline })).status, 403)
  assert.equal((await putDocument(origin, baseline, { 'If-Match': etag, 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await putDocument(origin, Buffer.alloc(256 * 1024 + 1), { 'If-Match': etag })).status, 413)
  assert.equal((await putDocument(origin, '{', { 'If-Match': etag })).status, 400)
  assert.deepEqual(await readFile(documentPath), baseline)
})

test('PUT rejects invalid schema 3 control graphs without changing the fixture', async t => {
  const { controlPath, origin } = await openApp(t)
  const baseline = await readFile(controlPath)
  const etag = hash(baseline)
  const valid = baseline.toString('utf8').trim().split(/\r?\n/).map(JSON.parse)
  const cases = [
    records => { delete records[2].id },
    records => { records[2].id = records[1].id },
    records => { records[1].rel.parent = 'missing' },
    records => { records[1].rel.parent = records[1].id },
    records => { records[1].rel = null },
    records => { records[0].schema = 2 },
    records => {
      const parent = records.find(record => record.state === 'active' && record.rel !== null && records.some(child => child.state === 'active' && child.rel?.parent === record.id))
      assert.ok(parent)
      parent.state = 'inactive'
    },
  ]
  for (const mutate of cases) {
    const records = structuredClone(valid)
    mutate(records)
    assert.equal((await putControl(origin, etag, encode(records))).status, 400)
  }
  assert.equal((await putControl(origin, etag, new Uint8Array([0xff]))).status, 400)
  assert.deepEqual(await readFile(controlPath), baseline)
})

test('control PUT guards reject before mutation', async t => {
  const { controlPath, origin } = await openApp(t)
  const baseline = await readFile(controlPath)
  const etag = hash(baseline)
  assert.equal((await fetch(`${origin}/missing`, { method: 'PUT' })).status, 405)
  assert.equal((await fetch(`${origin}/control.jsonl`, { method: 'PUT', headers: { 'Content-Type': 'application/x-ndjson', 'If-Match': etag }, body: baseline })).status, 403)
  assert.equal((await putControl(origin, etag, baseline, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await fetch(`${origin}/control.jsonl`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/x-ndjson' }, body: baseline })).status, 428)
  assert.equal((await putControl(origin, etag, Buffer.alloc(256 * 1024 + 1))).status, 413)
  assert.deepEqual(await readFile(controlPath), baseline)
})

test('valid control PUT replaces exact bytes and stale PUT cannot overwrite', async t => {
  const { controlPath, origin } = await openApp(t)
  const baseline = await readFile(controlPath)
  const oldEtag = hash(baseline)
  const records = baseline.toString('utf8').trim().split(/\r?\n/).map(JSON.parse)
  records[1].title = 'changed'
  const candidate = Buffer.from(encode(records))
  const saved = await putControl(origin, oldEtag, candidate)
  assert.equal(saved.status, 200)
  assert.deepEqual(await readFile(controlPath), candidate)
  records[1].title = 'stale'
  assert.equal((await putControl(origin, oldEtag, encode(records))).status, 412)
  assert.deepEqual(await readFile(controlPath), candidate)
})

test('same-ETag concurrent control PUT has one winner', async t => {
  const { controlPath, origin } = await openApp(t)
  const baseline = await readFile(controlPath)
  const etag = hash(baseline)
  const records = baseline.toString('utf8').trim().split(/\r?\n/).map(JSON.parse)
  const candidates = ['left', 'right'].map(title => Buffer.from(encode(records.map((record, index) => index === 1 ? { ...record, title } : record))))
  const responses = await Promise.all(candidates.map(candidate => putControl(origin, etag, candidate)))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412])
  const final = await readFile(controlPath)
  assert.ok(candidates.some(candidate => candidate.equals(final)))
})
