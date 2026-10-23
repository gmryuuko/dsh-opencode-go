import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import SettingsForms from '@deepseek-ai/dsh-settings'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.js'

test('the real DSH service loads the plugin, exposes model metadata, and cleans up registration', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  try {
    const fiber = await ctx.plugin(plugin, { token: 'test-token' })
    assert.deepEqual(ctx.llm.listProviders(), [{ id: 'opencode-go', name: 'OpenCode Go' }])
    const model = await ctx.llm.resolveModelInfo('opencode-go', 'glm-5.3')
    assert.ok(model.context!.contextWindow > 0)
    assert.ok(model.reasoning!.efforts.length > 0)
    await fiber.dispose()
    assert.deepEqual(ctx.llm.listProviders(), [])
  } finally { await ctx.fiber.dispose() }
})

for (const scenario of ['fresh', 'same-key', 'same-env-key', 'different-key', 'store-fails', 'cleanup-fails']) {
  test(`legacy key migration uses real settings and preserves data: ${scenario}`, async t => {
    const offline = mock.method(globalThis, 'fetch', async () => { throw new Error('offline fixture') })
    const ctx = new Context()
    const stored = new Map<string, string>()
    const ref = 'OPENCODE_GO_API_KEY'
    if (scenario === 'same-key' || scenario === 'same-env-key') stored.set(ref, 'legacy-key')
    if (scenario === 'different-key') stored.set(ref, 'existing-key')
    let writes = 0
    ctx.provide('credentials', {
      async resolve(name: string) {
        return stored.has(name) ? { value: stored.get(name), source: scenario === 'same-env-key' && writes === 0 ? 'env' : 'file' } : undefined
      },
      async set(name: string, value: string) {
        if (scenario === 'store-fails') throw new Error('write denied')
        writes++
        stored.set(name, value)
        ctx.emit('credentials/reference-updated', name as any)
      },
    })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Loader)
    const loader = ctx.loader
    t.after(async () => { loader.root.stop(); await ctx.fiber.dispose(); offline.mock.restore() })
    ctx.provide('profileContext', { home: join(tmpdir(), `opencode-go-test-${randomUUID()}`), name: 'test' })
    ctx.provide('configEditor', {
      entries: () => [...loader.entries()],
      configuration: () => [...loader.entries()].map(entry => ({ entry, inherited: {}, override: entry.options.config ?? {} })),
      async edit(entry: any, change: any) {
        if (scenario === 'cleanup-fails') throw new Error('read-only config')
        await loader.update(entry.id, { config: change(entry.options.config ?? {}, {}) })
      },
    })
    await ctx.plugin(SettingsForms)
    loader.builtins.opencodeGo = plugin
    const id = await loader.create({ name: 'cordis:opencodeGo', config: { token: 'legacy-key', disabledModels: ['kimi-k3'] } })
    await loader.await()
    await setImmediate() // Allow the post-mount migration to settle.
    const entry = loader.resolve(id)
    if (scenario === 'fresh' || scenario === 'same-key' || scenario === 'same-env-key') {
      assert.equal(stored.get(ref), 'legacy-key')
      assert.equal(entry.options.config.token, undefined)
      assert.deepEqual(entry.options.config.disabledModels, ['kimi-k3'])
      assert.equal(JSON.stringify(ctx.settings.describe({ redactSecrets: true })).includes('legacy-key'), false)
      assert.ok((await ctx.llm.listModels('opencode-go')).length > 0)
      const fiber = entry.fiber
      let updates = 0
      ctx.on('llm/adapters-updated', () => { updates++ })
      stored.delete(ref)
      ctx.emit('credentials/reference-updated', ref as any)
      assert.equal(updates, 1)
      assert.deepEqual(await ctx.llm.listModels('opencode-go'), [])
      assert.equal(entry.fiber, fiber)
    } else {
      assert.equal(entry.options.config.token, 'legacy-key')
      assert.equal(stored.get(ref), scenario === 'store-fails' ? undefined : scenario === 'different-key' ? 'existing-key' : 'legacy-key')
    }
    assert.equal(writes, ['fresh', 'same-env-key', 'cleanup-fails'].includes(scenario) ? 1 : 0)
  })
}

test('a duplicate provider cannot replace an existing DSH route', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  class ExistingAdapter extends LlmAdapter {
    async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  try {
    ctx.llm.registerAdapter(['opencode-go'], new ExistingAdapter())
    assert.throws(() => plugin.apply(ctx, plugin.Config({ token: 'test-token' })), { code: 'DUPLICATE_ADAPTER' })
    assert.deepEqual(ctx.llm.listProviders(), [{ id: 'opencode-go', name: 'opencode-go' }])
  } finally { await ctx.fiber.dispose() }
})

test('token and model switches update the real Loader and picker without remounting', async () => {
  const offline = mock.method(globalThis, 'fetch', async () => { throw new Error('offline catalog fixture') })
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Loader)
  const loader = ctx.loader
  loader.builtins.opencodeGo = plugin
  try {
    const id = await loader.create({ name: 'cordis:opencodeGo', config: { token: '' } })
    await loader.await()
    const fiber = loader.resolve(id).fiber
    assert.ok(fiber)
    assert.deepEqual(await ctx.llm.listModels('opencode-go'), [])
    const catalog = await ctx.llm.discoverModels(id, { provider: 'opencode-go' })
    assert.ok(catalog.length > 0)
    let updates = 0
    ctx.on('llm/adapters-updated', () => { updates++ })
    await loader.update(id, { config: { token: 'test-key' } })
    assert.equal(loader.resolve(id).fiber, fiber)
    assert.equal(updates, 1)
    assert.ok((await ctx.llm.listModels('opencode-go')).length > 0)
    await loader.update(id, { config: { token: 'test-key', disabledModels: catalog.map(model => model.id) } })
    assert.equal(loader.resolve(id).fiber, fiber)
    assert.equal(updates, 2)
    assert.deepEqual(await ctx.llm.listModels('opencode-go'), [])
    assert.deepEqual(await ctx.llm.discoverModels(id, { provider: 'opencode-go' }), catalog)
    await loader.update(id, { config: { token: 'test-key', disabledModels: [] } })
    assert.equal(updates, 3)
    assert.ok((await ctx.llm.listModels('opencode-go')).length > 0)
    await loader.update(id, { config: { token: '' } })
    assert.equal(updates, 4)
    assert.deepEqual(await ctx.llm.listModels('opencode-go'), [])
    await loader.resolve(id).fiber!.dispose()
    await assert.rejects(ctx.llm.discoverModels(id, { provider: 'opencode-go' }), { code: 'NO_DISCOVERY' })
  } finally {
    loader.root.stop()
    await ctx.fiber.dispose()
    offline.mock.restore()
  }
})
