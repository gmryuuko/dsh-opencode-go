import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { MessageId, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { OpenCodeGoAdapter } from '../src/adapter.js'
import { GoCatalog } from '../src/catalog.js'
import { Config } from '../src/index.js'

const fixture = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
const event = (type: string, data: unknown) => `event: ${type}\n${fixture(data)}`

function chat() {
  const chunk = (delta: unknown, finish_reason: string | null = null) => fixture({
    id: 'chat-1', model: 'glm-5.3', choices: [{ index: 0, delta, finish_reason }],
  })
  return chunk({ role: 'assistant', reasoning_content: '思考' })
    + chunk({ content: '你好' })
    + chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] })
    + chunk({ tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] })
    + chunk({}, 'tool_calls')
    + fixture({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, prompt_tokens_details: { cached_tokens: 4 } } })
    + 'data: [DONE]\n\n'
}

function responses() {
  const item = { id: 'msg-1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '你好', annotations: [] }] }
  return event('response.created', { type: 'response.created', response: { id: 'resp-1', status: 'in_progress', output: [] } })
    + event('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
    + event('response.content_part.added', { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
    + event('response.output_text.delta', { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg-1', delta: '你好' })
    + event('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item })
    + event('response.completed', { type: 'response.completed', response: { id: 'resp-1', model: 'gpt-6-luna', status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28, input_tokens_details: { cached_tokens: 4 } } } })
}

function anthropic() {
  return event('message_start', { type: 'message_start', message: { id: 'msg-1', type: 'message', role: 'assistant', model: 'minimax-m3', content: [], usage: { input_tokens: 16, cache_read_input_tokens: 4, output_tokens: 0 } } })
    + event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } })
    + event('content_block_stop', { type: 'content_block_stop', index: 0 })
    + event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
    + event('message_stop', { type: 'message_stop' })
}

function google() {
  return fixture({ candidates: [{ content: { role: 'model', parts: [{ text: '你好' }] }, index: 0, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, cachedContentTokenCount: 4, candidatesTokenCount: 8, totalTokenCount: 28 } })
}

interface Call { url: string; headers: Headers; body: Record<string, any>; signal?: AbortSignal | null }

function intercept(sse: () => string, status = 200) {
  const calls: Call[] = []
  const mocked = mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    calls.push({ url: request.url, headers: request.headers, body: JSON.parse(await request.text()), signal: init?.signal ?? request.signal })
    // Deliberately split UTF-8 and SSE frames across arbitrary transport chunks.
    const bytes = new TextEncoder().encode(sse())
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17))
      controller.close()
    } }), { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } })
  })
  return { calls, restore: () => mocked.mock.restore() }
}

function request(model = 'glm-5.3'): GenerateOptions {
  return {
    provider: 'opencode-go', model, maxTokens: 128,
    sessionId: 'session-1' as GenerateOptions['sessionId'],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ name: 'read_file', description: 'Read a source file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
  }
}

async function collect(stream: AsyncIterable<StreamChunk>) {
  const result: StreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}

test('configuration exposes exactly one live secret field', () => {
  const schema = Config.toJSON()
  const root = schema.refs[schema.uid]
  assert.deepEqual(Object.keys(root.dict!), ['token'])
  const token = schema.refs[root.dict!.token]
  assert.equal(token.meta?.role, 'secret')
  assert.equal(token.meta?.volatile, true)
})

test('missing and invalid tokens fail without exposing secrets or making requests', async () => {
  for (const token of ['', '中文-token', 'secret\ninjected']) {
    const adapter = new OpenCodeGoAdapter({ token: () => token })
    await assert.rejects(collect(adapter.stream(request())), error => {
      assert.ok(error instanceof LlmError)
      assert.ok(['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(error.code))
      if (token) assert.ok(!error.message.includes(token))
      return true
    })
    adapter.dispose()
  }
})

for (const [model, path, stream] of [
  ['glm-5.3', '/openai/v1/chat/completions', chat],
  ['gpt-6-luna', '/openai/v1/responses', responses],
  ['minimax-m3', '/anthropic/v1/messages', anthropic],
  ['gemini-4-argon-contributor', '/google/v1beta/models/gemini-4-argon-contributor:streamGenerateContent', google],
] as const) {
  test(`${model}: native protocol, authentication, session routing, streaming, usage, and finish`, async () => {
    const transport = intercept(stream)
    const adapter = new OpenCodeGoAdapter({ token: () => 'test-token' })
    try {
      const chunks = await collect(adapter.stream(request(model)))
      assert.equal(transport.calls.length, 1)
      const call = transport.calls[0]
      assert.equal(new URL(call.url).pathname, `/inference/go${path}`)
      assert.ok([...call.headers.values()].some(value => value.includes('test-token')))
      assert.equal(call.headers.get('x-opencode-session'), 'session-1')
      assert.match(call.headers.get('user-agent')!, /deepseek-harness/)
      assert.ok(call.body.tools || call.body.input?.some((item: any) => item.type === 'additional_tools' && item.tools?.length))
      assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === '你好'))
      const usageIndex = chunks.findIndex(chunk => chunk.type === 'usage')
      const finishIndex = chunks.findIndex(chunk => chunk.type === 'finish')
      assert.ok(usageIndex >= 0 && usageIndex < finishIndex)
      assert.equal(finishIndex, chunks.length - 1)
      const usage = chunks[usageIndex]
      assert.equal(usage.type === 'usage' && usage.usage.inputTokens, 16)
      if (model === 'glm-5.3') {
        assert.ok(chunks.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === '思考'))
        const tool = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
        assert.equal(tool?.type === 'block-end' && tool.block.type === 'tool-call' && tool.block.arguments, '{"path":"a.ts"}')
        assert.equal(chunks.at(-1)?.type === 'finish' && (chunks.at(-1) as any).reason.kind, 'tool-calls')
      }
    } finally { transport.restore(); adapter.dispose() }
  })
}

test('token changes take effect on the next request and support a pasted Bearer prefix', async () => {
  let token = ' Bearer first-token '
  const adapter = new OpenCodeGoAdapter({ token: () => token })
  const transport = intercept(chat)
  try {
    await collect(adapter.stream(request()))
    token = 'second-token'
    await collect(adapter.stream(request()))
    assert.equal(transport.calls[0].headers.get('authorization'), 'Bearer first-token')
    assert.equal(transport.calls[1].headers.get('authorization'), 'Bearer second-token')
  } finally { transport.restore(); adapter.dispose() }
})

test('prepared auxiliary calls get a stable fallback session while independent conversations remain separate', async () => {
  const adapter = new OpenCodeGoAdapter({ token: () => 'test-token' })
  const transport = intercept(chat)
  try {
    const options = request()
    delete options.sessionId
    options.messages = [{ id: MessageId('user-1'), role: 'user', source: { kind: 'user', userId: 'user' }, content: [{ type: 'text', text: 'hello' }] }] as GenerateOptions['messages']
    const prepared = await adapter.prepareCall('opencode-go', 'glm-5.3')
    await collect(prepared.stream(Object.freeze(options)))
    await collect(prepared.stream({ ...options, messages: [...options.messages] }))
    const other = request()
    delete other.sessionId
    await collect(adapter.stream(other))
    assert.equal(transport.calls[0].headers.get('x-opencode-session'), transport.calls[1].headers.get('x-opencode-session'))
    assert.notEqual(transport.calls[0].headers.get('x-opencode-session'), transport.calls[2].headers.get('x-opencode-session'))
    assert.equal(options.sessionId, undefined)
  } finally { transport.restore(); adapter.dispose() }
})

test('unsupported stop sequences and pre-aborted requests are refused', async () => {
  const adapter = new OpenCodeGoAdapter({ token: () => 'test-token' })
  try {
    await assert.rejects(collect(adapter.stream({ ...request(), stop: ['END'] })), { code: 'UNSUPPORTED_OPTION' })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(adapter.prepareCall('opencode-go', 'glm-5.3', controller.signal))
  } finally { adapter.dispose() }
})

test('an unauthenticated installation offers no selectable models', async () => {
  const catalog = new GoCatalog({ fetch: async () => { throw new Error('offline') } })
  const adapter = new OpenCodeGoAdapter({ token: () => '', catalog })
  assert.deepEqual(await adapter.listModels('opencode-go'), [])
  adapter.dispose()
})

test('provider HTTP errors settle as an error finish without SDK retries', async () => {
  const adapter = new OpenCodeGoAdapter({ token: () => 'test-token' })
  const transport = intercept(() => JSON.stringify({ error: { message: 'invalid API key', type: 'authentication_error' } }), 401)
  try {
    const chunks = await collect(adapter.stream(request()))
    assert.equal(transport.calls.length, 1)
    assert.equal(chunks.at(-1)?.type === 'finish' && (chunks.at(-1) as any).reason.kind, 'error')
  } finally { transport.restore(); adapter.dispose() }
})
