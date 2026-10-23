import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { act, create } from 'react-test-renderer'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const clientSource = readFileSync(new URL(`../${manifest.exports['./client']}`, import.meta.url), 'utf8')

function mount(write: (field: string, value: string) => Promise<boolean> = async () => true) {
  let client: any
  runInNewContext(clientSource, { window: { __ModuleLoader__: { load(module: any) {
    assert.equal(module.id, manifest.name)
    client = module.factory((name: string) => {
      if (name === 'react') return React
      assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives')
      return { Button: (props: any) => React.createElement('button', props) }
    })
  } } } })
  const listeners = new Set<() => void>()
  let snapshot = { status: 'ready', writable: true, value: {} }
  let Component: any
  let disposed = false
  let cleanup: () => void
  client.apply({
    configForms: { get(id: string) {
      assert.equal(id, 'llm-opencode-go')
      return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
        set: write,
      }
    } },
    slots: {
      inject(slot: string, register: () => () => void) {
        assert.equal(slot, 'plugins.bundle.config')
        return register()
      },
      register(options: any, component: any) {
        assert.equal(options.name, 'plugins.bundle.config')
        assert.equal(options.key, manifest.name)
        Component = component
        return () => { disposed = true }
      },
    },
    effect(register: () => () => void) { cleanup = register() },
  })
  let renderer: any
  act(() => { renderer = create(React.createElement(Component, { view: 'page' })) })
  return {
    renderer,
    input: () => renderer.root.findByType('input'),
    button: () => renderer.root.findByType('button'),
    edit(text: string) { act(() => renderer.root.findByType('input').props.onChange({ target: { value: text } })) },
    async save() { await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) },
    unavailable() {
      act(() => { snapshot = { ...snapshot, status: 'unavailable' }; for (const notify of listeners) notify() })
    },
    dispose() {
      act(() => renderer.unmount())
      cleanup!()
      assert.equal(disposed, true)
      assert.equal(listeners.size, 0)
    },
  }
}

test('the published browser entry registers an editable key form on the plugin detail page', t => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'))
  assert.ok(manifest.files.includes('client'))
  const ui = mount()
  t.after(() => ui.dispose())
  assert.equal(ui.input().props.type, 'password')
  assert.equal(ui.input().props.value, '')
  assert.equal(ui.button().props.disabled, true)
  ui.edit('test-key')
  assert.equal(ui.button().props.disabled, false)
  ui.unavailable()
  assert.equal(ui.input().props.disabled, true)
  assert.equal(ui.button().props.disabled, true)
})

test('saving writes only the key through DSH configForms and clears the secret draft', async t => {
  const writes: unknown[] = []
  const ui = mount(async (...args) => { writes.push(args); return true })
  t.after(() => ui.dispose())
  ui.edit('  Bearer test-key  ')
  assert.deepEqual(writes, [])
  await ui.save()
  assert.deepEqual(writes, [['token', 'test-key']])
  assert.equal(ui.input().props.value, '')
  assert.match(ui.renderer.root.findByProps({ role: 'status' }).children.join(''), /已保存/)
})

for (const failure of ['refused', 'disconnected']) {
  test(`a ${failure} save keeps the draft and reports failure without exposing error details`, async t => {
    const ui = mount(async () => {
      if (failure === 'disconnected') throw new Error('test-key must not reach the notice')
      return false
    })
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
  const ui = mount(async (...args) => { writes.push(args); return true })
  t.after(() => ui.dispose())
  for (const key of ['', '  ', '中文-key', 'test\nkey']) {
    ui.edit(key)
    await ui.save()
  }
  assert.deepEqual(writes, [])
})
