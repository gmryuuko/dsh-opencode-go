// DSH loads browser plugins through its shared module factory (including React).
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go',
  factory(require) {
    const { createElement: h, useState, useSyncExternalStore } = require('react')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')

    function apply(ctx) {
      const form = ctx.configForms.get('llm-opencode-go')
      const subscribe = listener => form.subscribe(listener)
      const snapshot = () => form.getSnapshot()

      function TokenSettings() {
        const state = useSyncExternalStore(subscribe, snapshot)
        const [token, setToken] = useState('')
        const [saving, setSaving] = useState(false)
        const [notice, setNotice] = useState('')
        const [failed, setFailed] = useState(false)
        const ready = state.status === 'ready' && state.writable
        const disabled = !ready || saving

        async function save(event) {
          event.preventDefault()
          if (disabled || !token.trim()) return
          const key = token.trim().replace(/^Bearer\s+/i, '')
          if (!/^[\x21-\x7e]+$/.test(key)) {
            setFailed(true)
            setNotice('请输入完整的 API Key，不要包含空格、换行或其他文字。')
            return
          }
          setSaving(true)
          setNotice('')
          setFailed(false)
          try {
            const accepted = await form.set('token', key)
            if (!accepted) throw new Error('Save refused')
            setToken('')
            setNotice('已保存。回到会话，在模型选择器中选择 OpenCode Go 下的模型。')
          } catch {
            setFailed(true)
            setNotice('保存失败，输入内容已保留。请确认插件已启用后重试。')
          } finally {
            setSaving(false)
          }
        }

        return h('form', { onSubmit: save, style: { display: 'grid', gap: 12, maxWidth: 560 } },
          h('label', { htmlFor: 'opencode-go-token', style: { fontWeight: 500 } }, 'OpenCode Go API Key'),
          h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } },
            '填写 Go API Key 并保存后，模型才会出现在会话选择器中。已保存的 key 不会回显；留空不会更改它。'),
          h('input', {
            id: 'opencode-go-token', type: 'password', value: token,
            autoComplete: 'off', spellCheck: false, disabled,
            placeholder: '粘贴 OpenCode Go API Key',
            onChange: event => { setToken(event.target.value); setNotice('') },
            style: {
              boxSizing: 'border-box', width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l2, #888)', font: 'inherit',
              background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit',
            },
          }),
          !ready && h('p', { role: 'status' }, '配置暂不可用，请确认插件已启用并刷新页面。'),
          notice && h('p', { role: failed ? 'alert' : 'status', style: { margin: 0 } }, notice),
          h(Button, { type: 'submit', variant: 'primary', disabled: disabled || !token.trim() },
            saving ? '保存中…' : '保存 API Key'),
        )
      }

      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: 'dsh-opencode-go',
      }, ({ view }) => view === 'summary' ? '配置 OpenCode Go API Key' : h(TokenSettings))))
    }

    return { inject: ['slots', 'configForms'], apply }
  },
})
