import z from '@deepseek-ai/schemastery';
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { OpenCodeGoAdapter } from './adapter.js';
import { GoCatalog, PROVIDER } from './catalog.js';
export { OpenCodeGoAdapter } from './adapter.js';
export const name = 'llm-opencode-go';
export const inject = ['llm'];
export const Config = z.object({
    token: z.string().role('secret').description('OpenCode Go token（API Key）').default('').volatile(),
});
export function apply(ctx, config) {
    const catalog = new GoCatalog({ onWarning: message => ctx.logger.warn(message) });
    const adapter = new OpenCodeGoAdapter({
        token: () => config.token.get(),
        catalog,
        resolveAttachments: () => ctx.get('attachments'),
        resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    });
    ctx.llm.registerAdapter([PROVIDER], adapter);
    ctx.on('loader/volatile-update', () => ctx.emit('llm/adapters-updated'));
    ctx.effect(() => () => adapter.dispose());
}
//# sourceMappingURL=index.js.map