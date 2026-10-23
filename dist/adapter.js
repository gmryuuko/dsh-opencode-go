import { createHash, randomUUID } from 'node:crypto';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { LlmError, assertUsableApiKey, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { GoCatalog, goProvider, PROVIDER } from './catalog.js';
/** Single public provider, backed by the official DSH streaming/replay adapter. */
export class OpenCodeGoAdapter extends PiAiAdapter {
    catalog;
    anonymousSessions = new WeakMap();
    constructor(options) {
        const catalog = options.catalog ?? new GoCatalog();
        let previous = catalog.current;
        const makeProfiles = () => new Map([[PROVIDER, {
                    provider: PROVIDER,
                    displayName: 'OpenCode Go',
                    piProvider: goProvider(catalog.current),
                    modelErrors: new Map(),
                    configuredMaxTokens: new Map(),
                    retryPolicy: resolveRetryPolicy(undefined, 'dsh-opencode-go'),
                    streamIdleTimeoutMs: 300_000,
                    maxRequestImageBytes: 20 * 1024 * 1024,
                    requestImagePixelBudget: 2048 * 2048,
                    requestImageMaxBytes: 1024 * 1024,
                }]]);
        let profiles = makeProfiles();
        super({
            profiles: () => {
                if (previous !== catalog.current) {
                    previous = catalog.current;
                    profiles = makeProfiles();
                }
                return profiles;
            },
            resolveApiKey: async () => {
                const token = options.token().trim().replace(/^Bearer\s+/i, '');
                if (!token)
                    throw new LlmError('请在左侧插件页打开 dsh-opencode-go，填写 OpenCode Go API Key。', 'MISSING_CREDENTIAL');
                return assertUsableApiKey(token, 'dsh-opencode-go', 'token');
            },
            auth: {
                credentials: new InMemoryCredentialStore(),
                authContext: { env: async () => undefined, fileExists: async () => false },
            },
            resolveAttachments: options.resolveAttachments,
            resolveImageAccess: options.resolveImageAccess,
        });
        this.catalog = catalog;
    }
    async listModels(provider) {
        await this.catalog.refresh();
        return super.listModels(provider);
    }
    async resolveModel(provider, model, signal) {
        signal?.throwIfAborted();
        if (!this.catalog.has(model))
            await this.catalog.refresh(signal);
        signal?.throwIfAborted();
        return super.resolveModel(provider, model, signal);
    }
    async prepareCall(provider, model, signal) {
        signal?.throwIfAborted();
        if (!this.catalog.has(model))
            await this.catalog.refresh(signal);
        signal?.throwIfAborted();
        const prepared = await super.prepareCall(provider, model, signal);
        return { ...prepared, stream: options => prepared.stream(this.withSession(options)) };
    }
    stream(options) {
        return super.stream(this.withSession(options));
    }
    withSession(options) {
        if (options.sessionId)
            return options;
        // Auxiliary calls sometimes omit sessionId. A durable user-message ID
        // keeps retries and later steps in that conversation on the same route.
        const first = options.messages.find(message => message.role === 'user' && message.id);
        let sessionId;
        if (first?.id) {
            sessionId = `dsh-${createHash('sha256').update(String(first.id)).digest('hex').slice(0, 32)}`;
        }
        else {
            sessionId = this.anonymousSessions.get(options.messages) ?? `dsh-${randomUUID()}`;
            this.anonymousSessions.set(options.messages, sessionId);
        }
        return { ...options, sessionId: sessionId };
    }
    dispose() { this.catalog.dispose(); }
}
//# sourceMappingURL=adapter.js.map