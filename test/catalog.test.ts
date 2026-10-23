import assert from 'node:assert/strict'
import { test } from 'node:test'
import { API_ROOTS, GoCatalog, MODELS_URL } from '../src/catalog.js'

const catalogResponse = (ids: string[]) => Response.json({ data: ids.map(id => ({ id })) })

test('live discovery selects only Go models, keeps protocol metadata, and caches requests', async () => {
  let requests = 0
  let time = 1
  const warnings: string[] = []
  const catalog = new GoCatalog({
    now: () => time,
    onWarning: warning => warnings.push(warning),
    fetch: async (url, init) => {
      assert.equal(url, MODELS_URL)
      assert.equal(new Headers(init?.headers).get('authorization'), null)
      requests++
      return catalogResponse(['gpt-6-luna', 'minimax-m3', 'gemini-4-argon-contributor', 'glm-5.3', 'future-model', 'glm-5.3'])
    },
  })
  await Promise.all([catalog.refresh(), catalog.refresh()])
  assert.equal(requests, 1)
  assert.equal(catalog.current.length, 4)
  assert.equal(warnings.length, 1)
  for (const model of catalog.current) assert.equal(model.baseUrl, API_ROOTS[model.api])
  await catalog.refresh()
  assert.equal(requests, 1)
  time += 300_001
  await catalog.refresh()
  assert.equal(requests, 2)
  catalog.dispose()
})

test('network errors and malformed or empty catalogs preserve the last usable catalog', async () => {
  let time = 1
  let mode = 0
  const catalog = new GoCatalog({
    now: () => time,
    fetch: async () => {
      if (mode === 0) return catalogResponse(['kimi-k3'])
      if (mode === 1) throw new Error('offline')
      if (mode === 2) return Response.json({ error: 'invalid' })
      return catalogResponse([])
    },
  })
  await catalog.refresh()
  assert.deepEqual(catalog.current.map(model => model.id), ['kimi-k3'])
  for (mode = 1; mode <= 3; mode++) {
    time += 300_001
    await catalog.refresh()
    assert.deepEqual(catalog.current.map(model => model.id), ['kimi-k3'])
  }
  catalog.dispose()
})

test('the built-in catalog works offline and has all four protocols', async () => {
  const catalog = new GoCatalog({ fetch: async () => { throw new Error('offline') } })
  await catalog.refresh()
  assert.ok(catalog.current.length > 20)
  assert.equal(new Set(catalog.current.map(model => model.api)).size, 4)
  catalog.dispose()
})

test('one canceled discovery waiter does not cancel another caller', async () => {
  let complete!: (response: Response) => void
  const catalog = new GoCatalog({ fetch: async () => new Promise(resolve => { complete = resolve }) })
  const controller = new AbortController()
  const canceled = catalog.refresh(controller.signal)
  const other = catalog.refresh()
  controller.abort(new Error('canceled'))
  await assert.rejects(canceled, /canceled/)
  complete(catalogResponse(['kimi-k3']))
  await other
  assert.equal(catalog.current.length, 1)
  catalog.dispose()
})

test('disposing aborts discovery and prevents new network calls', async () => {
  let signal!: AbortSignal
  const catalog = new GoCatalog({ fetch: async (_url, init) => {
    signal = init!.signal!
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  const pending = catalog.refresh()
  catalog.dispose()
  await pending
  assert.equal(signal.aborted, true)
  await catalog.refresh()
})
