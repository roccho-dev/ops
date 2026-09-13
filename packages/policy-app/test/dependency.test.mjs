import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const graphArtifactUrl = new URL('vendor/roccho-graph-editor-0.1.0.tgz', root)
const graphSha256 = 'a5f02c21f4ba49fe36f7ce6d1aeda1b0a52b80427f3b31377e0fb45fd605048e'
const policyArtifactUrl = new URL('vendor/roccho-policy-ui-0.1.0.tgz', root)
const policySha256 = 'b58e140ba9bc5478e413c5c1d9ee1398ceb718b53bcf5d434ac237c4b9be987d'
const tarPaths = archive => {
  const tar = gunzipSync(archive)
  const paths = []
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) break
    const sizeText = tar.subarray(offset + 124, offset + 136).toString('ascii').replace(/\0.*$/, '').trim()
    const size = Number.parseInt(sizeText || '0', 8)
    paths.push(name)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return paths.sort()
}

test('vendored UI artifacts, file locators, lock integrities, payloads, and APIs are exact', async () => {
  const graphArtifact = await readFile(graphArtifactUrl)
  const policyArtifact = await readFile(policyArtifactUrl)
  assert.equal(createHash('sha256').update(graphArtifact).digest('hex'), graphSha256)
  assert.equal(createHash('sha256').update(policyArtifact).digest('hex'), policySha256)
  assert.deepEqual(tarPaths(graphArtifact), [
    'package/package.json',
    'package/src/component.mjs',
    'package/src/editor.mjs',
    'package/src/index.mjs',
    'package/src/model.mjs',
    'package/style.css',
  ])
  assert.deepEqual(tarPaths(policyArtifact), [
    'package/asset-manifest.json',
    'package/assets/control.html',
    'package/assets/control.mjs',
    'package/assets/graph.css',
    'package/assets/graph.html',
    'package/assets/graph.mjs',
    'package/assets/index.html',
    'package/assets/task.html',
    'package/package.json',
    'package/src/control-graph.mjs',
  ])
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.dependencies['@roccho/graph-editor'], 'file:vendor/roccho-graph-editor-0.1.0.tgz')
  assert.equal(manifest.dependencies['@roccho/policy-ui'], 'file:vendor/roccho-policy-ui-0.1.0.tgz')
  const lock = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
  for (const [name, artifact] of [['graph-editor', graphArtifact], ['policy-ui', policyArtifact]]) {
    assert.match(lock, new RegExp(`specifier: file:vendor\\/roccho-${name}-0\\.1\\.0\\.tgz`))
    const integrity = `sha512-${createHash('sha512').update(artifact).digest('base64')}`
    assert.ok(lock.includes(`resolution: {integrity: ${integrity}, tarball: file:vendor/roccho-${name}-0.1.0.tgz}`))
  }
  const installed = JSON.parse(await readFile(new URL('node_modules/@roccho/graph-editor/package.json', root), 'utf8'))
  const policyInstalled = JSON.parse(await readFile(new URL('node_modules/@roccho/policy-ui/package.json', root), 'utf8'))
  assert.equal(installed.name, '@roccho/graph-editor')
  assert.equal(installed.version, '0.1.0')
  assert.deepEqual(installed.exports, { '.': './src/index.mjs', './style.css': './style.css' })
  assert.deepEqual(Object.keys(await import('@roccho/graph-editor')).sort(), ['mountGraphEditor', 'normalizeDocument', 'stringifyDocument'])
  assert.deepEqual(policyInstalled.exports, { './asset-manifest.json': './asset-manifest.json', './control-graph': './src/control-graph.mjs' })
  assert.deepEqual(Object.keys(await import('@roccho/policy-ui/control-graph')).sort(), ['connectControl', 'parseControl', 'scanLines'])
})

test('dependency direction is OPS to UI with no frontend, model, parser, or copied SSOT', async () => {
  const files = (await readdir(root)).filter(name => !['node_modules', 'dist', 'src'].includes(name)).sort()
  assert.deepEqual(files, ['.gitignore', 'file-store.mjs', 'package.json', 'pnpm-lock.yaml', 'server.mjs', 'test', 'vendor'])
  const server = await readFile(new URL('server.mjs', root), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const installed = JSON.parse(await readFile(new URL('node_modules/@roccho/graph-editor/package.json', root), 'utf8'))
  assert.match(server, /from '@roccho\/graph-editor'/)
  assert.match(server, /from '@roccho\/policy-ui\/control-graph'/)
  assert.doesNotMatch(server, /@maxgraph\/core|\.\/model|\.\/editor|\.\/control-graph/)
  assert.equal(manifest.dependencies['@maxgraph/core'], undefined)
  assert.equal(installed.dependencies?.['@roccho/policy-app'], undefined)
})
