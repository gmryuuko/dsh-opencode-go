import type { Api, Model, Provider } from '@earendil-works/pi-ai'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode'

export const PROVIDER = 'opencode-go'
export const MODELS_URL = 'https://opencode.ai/inference/go/v1/models'

// The native SDKs append different suffixes to these roots.
export const API_ROOTS: Readonly<Record<string, string>> = {
  'openai-completions': 'https://opencode.ai/inference/go/openai/v1',
  'openai-responses': 'https://opencode.ai/inference/go/openai/v1',
  'anthropic-messages': 'https://opencode.ai/inference/go/anthropic',
  'google-generative-ai': 'https://opencode.ai/inference/go/google/v1beta',
}

/** Reuse pi-ai's native multi-protocol dispatch and session headers. */
export function goProvider(models: readonly Model<Api>[]): Provider {
  const native = opencodeGoProvider()
  return {
    ...native,
    // Never fall back to an unrelated OPENCODE_API_KEY or SDK credential.
    auth: {
      apiKey: {
        name: 'OpenCode Go token',
        resolve: async ({ credential }) => ({
          auth: credential?.type === 'api_key' && credential.key ? { apiKey: credential.key } : {},
        }),
      },
    },
    getModels: () => models,
    getAllModels: () => models,
  }
}

function route(model: Model<Api>, id = model.id): Model<Api> {
  if (!(model.api in API_ROOTS)) throw new Error(`Unsupported Go protocol: ${model.api}`)
  return { ...structuredClone(model), id, provider: PROVIDER, baseUrl: API_ROOTS[model.api] }
}

function knownModels(): { initial: Model<Api>[]; known: Map<string, Model<Api>> } {
  const initial = opencodeGoProvider().getModels().map(model => route(model))
  const known = new Map(initial.map(model => [model.id, model]))
  // Go's /models may retain older IDs. Only admit those when the live Go
  // endpoint actually lists them; Zen's catalog alone never grants Go access.
  for (const model of opencodeProvider().getModels()) {
    if (!known.has(model.id) && model.api in API_ROOTS) known.set(model.id, route(model))
  }
  // The Go endpoint and the upstream catalog currently spell this ID differently.
  const flash = known.get('minimax-m3.1-flash-free')
  if (flash) known.set('minimax-m3.1-flash', route(flash, 'minimax-m3.1-flash'))
  // The Go guide assigns these legacy MiniMax models to Messages, unlike Zen.
  for (const id of ['minimax-m2.5', 'minimax-m2.7']) {
    const model = known.get(id)
    if (model) {
      const { compat: _compat, ...rest } = model
      known.set(id, route({ ...rest, api: 'anthropic-messages' }))
    }
  }
  return { initial, known }
}

export interface CatalogOptions {
  fetch?: typeof globalThis.fetch
  now?: () => number
  onWarning?: (message: string) => void
}

/** Public model discovery with a bounded, deduplicated refresh and offline fallback. */
export class GoCatalog {
  private readonly definitions = knownModels()
  private models = this.definitions.initial
  private refreshAfter = 0
  private pending?: Promise<void>
  private readonly lifetime = new AbortController()

  constructor(private readonly options: CatalogOptions = {}) {}

  get current(): readonly Model<Api>[] { return this.models }

  has(id: string): boolean { return this.models.some(model => model.id === id) }

  dispose(): void { this.lifetime.abort() }

  refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const operation = this.refreshShared()
    if (!signal) return operation
    return new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      if (signal.aborted) abort()
    })
  }

  private refreshShared(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.resolve()
    if (this.pending) return this.pending
    if ((this.options.now ?? Date.now)() < this.refreshAfter) return Promise.resolve()
    this.pending = this.update().finally(() => { this.pending = undefined })
    return this.pending
  }

  private async update(): Promise<void> {
    const now = this.options.now ?? Date.now
    // Failures retry after one minute rather than making every picker wait.
    this.refreshAfter = now() + 60_000
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(MODELS_URL, {
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(5_000)]),
        redirect: 'error',
        headers: { accept: 'application/json', 'user-agent': 'dsh-opencode-go/0.1.0' },
      })
      if (!response.ok) throw new Error('model discovery failed')
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
        throw new Error('invalid model catalog')
      }
      const discovered = new Map<string, Model<Api>>()
      let unknown = 0
      for (const entry of body.data) {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue
        const definition = this.definitions.known.get(entry.id)
        if (definition) discovered.set(entry.id, definition)
        else unknown++
      }
      if (discovered.size === 0) throw new Error('no known models in catalog')
      this.models = [...discovered.values()]
      this.refreshAfter = now() + 5 * 60_000
      if (unknown) this.options.onWarning?.(`OpenCode Go: ${unknown} 个模型缺少协议元数据，已跳过；更新插件可补齐。`)
    } catch {
      if (!this.lifetime.signal.aborted) {
        this.options.onWarning?.('OpenCode Go: 模型目录暂时不可用，继续使用上次目录或内置目录。')
      }
    }
  }
}
