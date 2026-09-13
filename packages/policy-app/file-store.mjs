import { createHash } from 'node:crypto'
import { link, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const checksum = body => `"sha256-${createHash('sha256').update(body).digest('hex')}"`
const stale = () => Object.assign(new Error('stale ETag'), { code: 'STALE_ETAG' })

export const createFileStore = filePath => {
  let writeTail = Promise.resolve()
  let temporarySequence = 0
  const read = async () => { const body = await readFile(filePath); return { body, etag: checksum(body) } }
  const replaceNow = async (expectedEtag, body) => {
    let current
    try { current = await read() } catch (error) { if (error.code === 'ENOENT') throw stale(); throw error }
    if (current.etag !== expectedEtag) throw stale()
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++temporarySequence}.tmp`)
    let pending = true
    try {
      await writeFile(temporary, body, { flag: 'wx' })
      try { current = await read() } catch (error) { if (error.code === 'ENOENT') throw stale(); throw error }
      if (current.etag !== expectedEtag) throw stale()
      await rename(temporary, filePath)
      pending = false
    } finally { if (pending) await unlink(temporary).catch(() => undefined) }
    return checksum(body)
  }
  const createNow = async body => {
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++temporarySequence}.tmp`)
    let pending = true
    try {
      await writeFile(temporary, body, { flag: 'wx' })
      try { await link(temporary, filePath) } catch (error) { if (error.code === 'EEXIST') throw stale(); throw error }
      await unlink(temporary)
      pending = false
    } finally { if (pending) await unlink(temporary).catch(() => undefined) }
    return checksum(body)
  }
  const enqueue = operation => { const result = writeTail.then(operation, operation); writeTail = result.catch(() => undefined); return result }
  return { read, replace: (expectedEtag, body) => enqueue(() => replaceNow(expectedEtag, body)), create: body => enqueue(() => createNow(body)) }
}
