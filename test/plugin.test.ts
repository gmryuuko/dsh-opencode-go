import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
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

test('saving a token through the real Loader exposes models and notifies the picker without remounting', async () => {
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
    let updates = 0
    ctx.on('llm/adapters-updated', () => { updates++ })
    await loader.update(id, { config: { token: 'test-key' } })
    assert.equal(loader.resolve(id).fiber, fiber)
    assert.equal(updates, 1)
    assert.ok((await ctx.llm.listModels('opencode-go')).length > 0)
    await loader.update(id, { config: { token: '' } })
    assert.equal(updates, 2)
    assert.deepEqual(await ctx.llm.listModels('opencode-go'), [])
  } finally {
    loader.root.stop()
    await ctx.fiber.dispose()
    offline.mock.restore()
  }
})
