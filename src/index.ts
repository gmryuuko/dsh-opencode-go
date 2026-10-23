import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { OpenCodeGoAdapter } from './adapter.js'
import { GoCatalog, PROVIDER } from './catalog.js'

export { OpenCodeGoAdapter } from './adapter.js'

export const name = 'llm-opencode-go'
export const inject = ['llm']

export interface Config {
  apiKeyEnv: Volatile<string>
  /** Legacy configuration; migrated into the host credential store. */
  token: Volatile<string>
  disabledModels: Volatile<string[]>
}

export const Config = z.object({
  apiKeyEnv: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).description('API Key 凭据名称').default('OPENCODE_GO_API_KEY').volatile(),
  token: z.string().role('secret').description('旧版 token（自动迁移）').default('').volatile(),
  disabledModels: z.array(z.string()).description('已关闭的模型').default([]).volatile(),
})

export function apply(ctx: Context, config: Config): void {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  const catalog = new GoCatalog({ onWarning: message => ctx.logger.warn(message) })
  const adapter = new OpenCodeGoAdapter({
    token: async () => (await ctx.get('credentials')?.resolve(credentialRef(config.apiKeyEnv.get())))?.value ?? config.token.get(),
    disabledModels: () => config.disabledModels.get(),
    catalog,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
  })
  ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.llm.registerModelDiscovery(settingsNs, async (_request, signal) => {
    await catalog.refresh(signal)
    return catalog.current.map(({ id, name }) => ({ id, name }))
  })
  ctx.on('loader/volatile-update', () => ctx.emit('llm/adapters-updated'))
  ctx.on('credentials/reference-updated', ref => {
    if (ref === config.apiKeyEnv.get()) ctx.emit('llm/adapters-updated')
  })
  ctx.effect(() => () => adapter.dispose())

  ctx.inject(['credentials', 'settings', 'loader'], child => {
    let active = true
    child.effect(() => () => { active = false })
    // Settings can edit this entry only after its Loader mount has settled.
    void child.root.loader.await().then(async () => {
      if (!active || typeof ctx.fiber.entry?.options.config?.token !== 'string' || !config.token.get().trim()) return
      const legacy = config.token.get()
      const key = assertUsableApiKey(legacy.trim().replace(/^Bearer\s+/i, ''), 'dsh-opencode-go', 'token')
      const ref = credentialRef(config.apiKeyEnv.get())
      const stored = await child.credentials.resolve(ref)
      if (stored && stored.value !== key) {
        child.logger.warn('OpenCode Go: 已有不同的凭据，旧 token 未自动清除；请在设置页保存需要使用的 key。')
        return
      }
      const descriptor = child.settings.describe().find(entry => entry.ns === settingsNs)
      if (!descriptor) return
      if (stored?.source !== 'file') await child.credentials.set(ref, key)
      if (!active || config.token.get() !== legacy || config.apiKeyEnv.get() !== ref) return
      await child.settings.mutate(settingsNs, [{ op: 'unset', path: ['token'] }], descriptor.revision)
    }).catch(() => {
      if (active) child.logger.warn('OpenCode Go: 旧 token 迁移未完成，原配置已保留；请在设置页重新保存 key。')
    })
  })
}
