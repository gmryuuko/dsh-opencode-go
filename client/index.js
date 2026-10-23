// DSH loads browser plugins through its shared module factory (including React).
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go',
  factory(require) {
    const { createElement: h, useEffect, useState, useSyncExternalStore } = require('react')
    const { Button, Switch } = require('@deepseek-ai/dsh-client-ui-primitives')
    const hintStyle = { margin: 0, color: 'var(--dsw-alias-label-secondary)' }

    function apply(ctx) {
      const form = ctx.configForms.get('llm-opencode-go')
      const subscribe = listener => form.subscribe(listener)
      const snapshot = () => form.getSnapshot()

      function ModelSettings({ state }) {
        const [models, setModels] = useState([])
        const [loading, setLoading] = useState(true)
        const [refresh, setRefresh] = useState(0)
        const [loadError, setLoadError] = useState('')
        const [saveError, setSaveError] = useState('')
        const [saving, setSaving] = useState(null)
        const disabledModels = state.value?.disabledModels ?? []

        useEffect(() => {
          let active = true
          setLoading(true)
          setLoadError('')
          ctx.remote.llm.discoverModels('llm-opencode-go', { provider: 'opencode-go' }).then(answer => {
            if (!active) return
            if (!answer.ok) {
              setLoadError(/no model discovery is registered/.test(answer.error?.message ?? '')
                ? '模型管理后端尚未更新，请完全退出 DSH（包括托盘）后重新打开。'
                : '模型列表加载失败，请重新加载。')
              return
            }
            setModels([...answer.value].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)))
          }).catch(() => {
            if (active) setLoadError('模型列表加载失败，请重新加载。')
          }).finally(() => {
            if (active) setLoading(false)
          })
          return () => { active = false }
        }, [refresh])

        async function toggle(id, enabled) {
          if (saving !== null || state.status !== 'ready' || !state.writable) return
          setSaving(id)
          setSaveError('')
          const current = form.getSnapshot().value?.disabledModels ?? []
          const next = enabled ? current.filter(model => model !== id) : [...new Set([...current, id])]
          try {
            if (!await form.set('disabledModels', next)) throw new Error('Save refused')
          } catch {
            setSaveError('模型开关保存失败，请重试。')
          } finally {
            setSaving(null)
          }
        }

        return h('section', { 'aria-label': '模型开关', style: { display: 'grid', gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('h3', { style: { margin: 0 } }, `模型${models.length ? `（${models.filter(model => !disabledModels.includes(model.id)).length}/${models.length} 已开启）` : ''}`),
            h(Button, { type: 'button', variant: 'outline', disabled: loading, onClick: () => setRefresh(value => value + 1) }, '重新加载'),
          ),
          h('p', { style: hintStyle }, '开关自动保存。关闭后，该模型会从会话选择器中隐藏，已有会话也无法再用它发起请求。'),
          loading && h('p', { role: 'status', style: hintStyle }, '正在加载模型…'),
          loadError && h('p', { role: 'alert', style: hintStyle }, loadError),
          saveError && h('p', { role: 'alert', style: hintStyle }, saveError),
          !loading && !loadError && models.length === 0 && h('p', { style: hintStyle }, '暂时没有可用的模型。'),
          h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } }, models.map(model =>
            h('li', {
              key: model.id, 'data-model-id': model.id,
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, #888)' },
            },
            h('div', { style: { minWidth: 0, overflowWrap: 'anywhere' } },
              h('div', null, model.name ?? model.id),
              model.name && model.name !== model.id && h('div', { style: { ...hintStyle, fontSize: 12 } }, model.id),
            ),
            h(Switch, {
              label: `启用 ${model.name ?? model.id}`, checked: !disabledModels.includes(model.id),
              disabled: saving !== null || state.status !== 'ready' || !state.writable,
              onChange: enabled => toggle(model.id, enabled),
            })),
          )),
        )
      }

      function OpenCodeSettings() {
        const state = useSyncExternalStore(subscribe, snapshot)
        const [token, setToken] = useState('')
        const [saving, setSaving] = useState(false)
        const [notice, setNotice] = useState('')
        const [failed, setFailed] = useState(false)
        const [credential, setCredential] = useState(null)
        const [credentialError, setCredentialError] = useState('')
        const keyRef = state.value?.apiKeyEnv
        const ready = state.status === 'ready' && !!keyRef
        const disabled = !ready || saving || !credential?.writable

        useEffect(() => {
          if (!keyRef) return
          let active = true
          setCredential(null)
          setCredentialError('')
          const refresh = async () => {
            try {
              const answer = await ctx.remote.credentials.describe([keyRef])
              if (!answer.ok || !answer.value[keyRef]) throw new Error('Credential status unavailable')
              if (active) { setCredential(answer.value[keyRef]); setCredentialError('') }
            } catch {
              if (active) setCredentialError('无法读取凭据状态，请重新打开设置页面。')
            }
          }
          void refresh()
          const off = ctx.remote.$on('credentials/reference-updated', ref => {
            if (ref === keyRef) void refresh()
          })
          return () => { active = false; off() }
        }, [keyRef])

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
            const answer = await ctx.remote.credentials.set(keyRef, key)
            if (!answer.ok) throw new Error('Save refused')
            setToken('')
            setCredential({ configured: true, writable: true })
            if (!await form.unset('token').catch(() => false)) {
              setFailed(true)
              setNotice('API Key 已保存到凭据库，但旧配置中的 token 未能清除，请重试保存。')
              return
            }
            setNotice('已保存。回到会话，在模型选择器中选择 OpenCode Go 下的模型。')
          } catch {
            setFailed(true)
            setNotice('保存失败，输入内容已保留。请确认插件已启用后重试。')
          } finally {
            setSaving(false)
          }
        }

        return h('section', { style: { display: 'grid', gap: 24, maxWidth: 760 } },
          h('h2', { style: { margin: 0, fontSize: 20 } }, 'OpenCode Go'),
          h('form', { onSubmit: save, style: { display: 'grid', gap: 12, maxWidth: 560 } },
            h('label', { htmlFor: 'opencode-go-token', style: { fontWeight: 500 } }, 'OpenCode Go API Key'),
            h('p', { style: hintStyle },
              'API Key 由 DSH 凭据服务保存，不再写入插件配置。已保存的 key 不会回显；留空不会更改它。'),
            credential && h('p', { style: hintStyle }, credential.configured ? '已配置 API Key' : '尚未配置 API Key'),
            credentialError && h('p', { role: 'alert', style: hintStyle }, credentialError),
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
            !ready && h('p', { role: 'status' }, state.status === 'ready'
              ? '凭据存储后端尚未更新，请完全退出 DSH（包括托盘）后重新打开。'
              : '配置暂不可用，请确认插件已启用并刷新页面。'),
            notice && h('p', { role: failed ? 'alert' : 'status', style: { margin: 0 } }, notice),
            h(Button, { type: 'submit', variant: 'primary', disabled: disabled || !token.trim() },
              saving ? '保存中…' : '保存 API Key'),
          ),
          h(ModelSettings, { state }),
        )
      }

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'opencode-go', order: 11, label: () => 'OpenCode Go',
      }, OpenCodeSettings)))
    }

    return { inject: ['slots', 'configForms', 'remote', 'remote.llm', 'remote.credentials'], apply }
  },
})
