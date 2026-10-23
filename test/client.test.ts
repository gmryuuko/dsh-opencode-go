import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { act, create } from 'react-test-renderer'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const clientSource = readFileSync(new URL(`../${manifest.exports['./client']}`, import.meta.url), 'utf8')

const models = [{ id: 'glm-5.3', name: 'GLM 5.3' }, { id: 'kimi-k3', name: 'Kimi K3' }]

async function mount({
  write = async (_field: string, _value: unknown) => true,
  writeCredential = async (_ref: string, _value: string): Promise<any> => ({ ok: true }),
  clearLegacy = async () => true,
  discover = async (): Promise<any> => ({ ok: true, value: models }),
  disabledModels = [] as string[],
} = {}) {
  let client: any
  runInNewContext(clientSource, { window: { __ModuleLoader__: { load(module: any) {
    assert.equal(module.id, manifest.name)
    client = module.factory((name: string) => {
      if (name === 'react') return React
      assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives')
      return {
        Button: (props: any) => React.createElement('button', props),
        Switch: (props: any) => React.createElement('button', {
          role: 'switch', 'aria-label': props.label, 'aria-checked': props.checked,
          disabled: props.disabled, onClick: () => props.onChange(!props.checked),
        }),
      }
    })
  } } } })
  const listeners = new Set<() => void>()
  const credentialListeners = new Set<(ref: string) => void>()
  let configured = false
  let snapshot = { status: 'ready', writable: true, value: { apiKeyEnv: 'OPENCODE_GO_API_KEY', disabledModels } }
  let Component: any
  let disposed = false
  let cleanup: () => void
  client.apply({
    remote: {
      $on(event: string, listener: (ref: string) => void) {
        assert.equal(event, 'credentials/reference-updated')
        credentialListeners.add(listener)
        return () => credentialListeners.delete(listener)
      },
      credentials: {
        async describe(refs: string[]) {
          assert.deepEqual(Array.from(refs), ['OPENCODE_GO_API_KEY'])
          return { ok: true, value: { OPENCODE_GO_API_KEY: { configured, writable: true } } }
        },
        async set(ref: string, value: string) {
          const answer = await writeCredential(ref, value)
          if (answer.ok) {
            configured = true
            for (const notify of credentialListeners) notify(ref)
          }
          return answer
        },
      },
      llm: { discoverModels(ns: string, request: any) {
      assert.equal(ns, 'llm-opencode-go')
      assert.deepEqual(Object.keys(request), ['provider'])
      assert.equal(request.provider, 'opencode-go')
      return discover()
    } } },
    configForms: { get(id: string) {
      assert.equal(id, 'llm-opencode-go')
      return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
        async unset(field: string) {
          assert.equal(field, 'token')
          return clearLegacy()
        },
        async set(field: string, value: unknown) {
          const ownedValue = structuredClone(value)
          const accepted = await write(field, ownedValue)
          if (accepted && field === 'disabledModels') {
            snapshot = { ...snapshot, value: { ...snapshot.value, disabledModels: ownedValue as string[] } }
            for (const notify of listeners) notify()
          }
          return accepted
        },
      }
    } },
    slots: {
      inject(slot: string, register: () => () => void) {
        assert.equal(slot, 'settings.section')
        return register()
      },
      register(options: any, component: any) {
        assert.equal(options.name, 'settings.section')
        assert.equal(options.id, 'opencode-go')
        assert.equal(options.label(), 'OpenCode Go')
        Component = component
        return () => { disposed = true }
      },
    },
    effect(register: () => () => void) { cleanup = register() },
  })
  let renderer: any
  await act(async () => { renderer = create(React.createElement(Component)) })
  return {
    renderer,
    input: () => renderer.root.findByType('input'),
    button: () => renderer.root.findByType('form').findByType('button'),
    modelSwitch: (id: string) => renderer.root.findByProps({ 'data-model-id': id }).findByProps({ role: 'switch' }),
    edit(text: string) { act(() => renderer.root.findByType('input').props.onChange({ target: { value: text } })) },
    async save() { await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) },
    async toggle(id: string) {
      await act(async () => { await renderer.root.findByProps({ 'data-model-id': id }).findByProps({ role: 'switch' }).props.onClick() })
    },
    async reload() {
      await act(async () => { renderer.root.findAllByType('button').find((button: any) => button.children.includes('重新加载')).props.onClick() })
    },
    unavailable() {
      act(() => { snapshot = { ...snapshot, status: 'unavailable' }; for (const notify of listeners) notify() })
    },
    dispose() {
      act(() => renderer.unmount())
      cleanup!()
      assert.equal(disposed, true)
      assert.equal(listeners.size, 0)
      assert.equal(credentialListeners.size, 0)
    },
  }
}

test('the browser entry registers an independent settings tab with key and model controls', async t => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
  assert.ok(manifest.files.includes('client'))
  const ui = await mount()
  t.after(() => ui.dispose())
  assert.equal(ui.input().props.type, 'password')
  assert.equal(ui.input().props.value, '')
  assert.equal(ui.button().props.disabled, true)
  assert.equal(ui.modelSwitch('glm-5.3').props['aria-checked'], true)
  assert.equal(ui.modelSwitch('kimi-k3').props['aria-checked'], true)
  ui.edit('test-key')
  assert.equal(ui.button().props.disabled, false)
  ui.unavailable()
  assert.equal(ui.input().props.disabled, true)
  assert.equal(ui.button().props.disabled, true)
  assert.equal(ui.modelSwitch('glm-5.3').props.disabled, true)
})

test('saving sends the key only to credentials, then clears the legacy config and secret draft', async t => {
  const writes: unknown[] = []
  const ui = await mount({
    write: async () => { assert.fail('the key must never be written to configForms') },
    writeCredential: async (...args) => { writes.push(args); return { ok: true } },
    clearLegacy: async () => { writes.push('clear legacy'); return true },
  })
  t.after(() => ui.dispose())
  ui.edit('  Bearer test-key  ')
  assert.deepEqual(writes, [])
  await ui.save()
  assert.deepEqual(writes, [['OPENCODE_GO_API_KEY', 'test-key'], 'clear legacy'])
  assert.equal(ui.input().props.value, '')
  assert.match(ui.renderer.root.findByProps({ role: 'status' }).children.join(''), /已保存/)
})

for (const failure of ['refused', 'disconnected']) {
  test(`a ${failure} save keeps the draft and reports failure without exposing error details`, async t => {
    const ui = await mount({ writeCredential: async () => {
      if (failure === 'disconnected') throw new Error('test-key must not reach the notice')
      return { ok: false }
    }, clearLegacy: async () => { assert.fail('failed credential writes must keep the legacy key') } })
    t.after(() => ui.dispose())
    ui.edit('test-key')
    await ui.save()
    assert.equal(ui.input().props.value, 'test-key')
    const message = ui.renderer.root.findByProps({ role: 'alert' }).children.join('')
    assert.match(message, /保存失败/)
    assert.doesNotMatch(message, /test-key/)
    assert.equal(ui.button().props.disabled, false)
  })
}

test('blank and malformed keys cannot overwrite saved credentials', async t => {
  const writes: unknown[] = []
  const ui = await mount({ writeCredential: async (...args) => { writes.push(args); return { ok: true } } })
  t.after(() => ui.dispose())
  for (const key of ['', '  ', '中文-key', 'test\nkey']) {
    ui.edit(key)
    await ui.save()
  }
  assert.deepEqual(writes, [])
})

test('model switches save immediately, retain hidden preferences, and can re-enable every model', async t => {
  const writes: unknown[] = []
  const ui = await mount({
    disabledModels: ['retired-model'],
    write: async (...args) => { writes.push(args); return true },
  })
  t.after(() => ui.dispose())
  await ui.toggle('glm-5.3')
  assert.equal(ui.modelSwitch('glm-5.3').props['aria-checked'], false)
  assert.equal(ui.modelSwitch('kimi-k3').props['aria-checked'], true)
  await ui.toggle('kimi-k3')
  assert.equal(ui.modelSwitch('kimi-k3').props['aria-checked'], false)
  await ui.toggle('glm-5.3')
  assert.equal(ui.modelSwitch('glm-5.3').props['aria-checked'], true)
  assert.deepEqual(writes, [
    ['disabledModels', ['retired-model', 'glm-5.3']],
    ['disabledModels', ['retired-model', 'glm-5.3', 'kimi-k3']],
    ['disabledModels', ['retired-model', 'kimi-k3']],
  ])
  const reopened = await mount({ disabledModels: ['retired-model', 'kimi-k3'] })
  t.after(() => reopened.dispose())
  assert.equal(reopened.modelSwitch('kimi-k3').props['aria-checked'], false)
})

test('a refused model change preserves its saved switch state and the staged API key', async t => {
  const ui = await mount({ write: async () => false })
  t.after(() => ui.dispose())
  ui.edit('unsaved-key')
  await ui.toggle('glm-5.3')
  assert.equal(ui.modelSwitch('glm-5.3').props['aria-checked'], true)
  assert.equal(ui.input().props.value, 'unsaved-key')
  assert.match(ui.renderer.root.findByProps({ role: 'alert' }).children.join(''), /模型开关保存失败/)
})

test('a failed model listing can retry without blocking API key entry', async t => {
  let calls = 0
  const ui = await mount({ discover: async () => ++calls === 1 ? { ok: false } : { ok: true, value: models } })
  t.after(() => ui.dispose())
  assert.equal(ui.input().props.disabled, false)
  assert.match(ui.renderer.root.findByProps({ role: 'alert' }).children.join(''), /模型列表加载失败/)
  await ui.reload()
  assert.equal(ui.renderer.root.findAllByProps({ role: 'alert' }).length, 0)
  assert.equal(ui.modelSwitch('glm-5.3').props['aria-checked'], true)
})

test('an old backend reports a full restart instruction instead of a generic model failure', async t => {
  const ui = await mount({ discover: async () => ({ ok: false, error: { message: 'no model discovery is registered for "llm-opencode-go"' } }) })
  t.after(() => ui.dispose())
  assert.match(ui.renderer.root.findByProps({ role: 'alert' }).children.join(''), /完全退出 DSH/)
})

test('a failed legacy cleanup accurately reports that the new credential was saved', async t => {
  const ui = await mount({ clearLegacy: async () => { throw new Error('read-only') } })
  t.after(() => ui.dispose())
  ui.edit('test-key')
  await ui.save()
  assert.equal(ui.input().props.value, '')
  assert.match(ui.renderer.root.findByProps({ role: 'alert' }).children.join(''), /已保存到凭据库.*未能清除/)
})
