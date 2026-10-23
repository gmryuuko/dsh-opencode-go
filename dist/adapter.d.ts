import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import type { PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai';
import { GoCatalog } from './catalog.js';
export interface OpenCodeGoOptions {
    token: () => string | Promise<string>;
    disabledModels?: () => readonly string[];
    catalog?: GoCatalog;
    resolveAttachments?: PiAiAdapterOptions['resolveAttachments'];
    resolveImageAccess?: PiAiAdapterOptions['resolveImageAccess'];
}
/** Single public provider, backed by the official DSH streaming/replay adapter. */
export declare class OpenCodeGoAdapter extends PiAiAdapter {
    private readonly options;
    readonly catalog: GoCatalog;
    private readonly anonymousSessions;
    constructor(options: OpenCodeGoOptions);
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private assertEnabled;
    private withSession;
    dispose(): void;
}
