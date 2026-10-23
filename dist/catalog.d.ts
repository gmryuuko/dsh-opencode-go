import type { Api, Model, Provider } from '@earendil-works/pi-ai';
export declare const PROVIDER = "opencode-go";
export declare const MODELS_URL = "https://opencode.ai/inference/go/v1/models";
export declare const API_ROOTS: Readonly<Record<string, string>>;
/** Reuse pi-ai's native multi-protocol dispatch and session headers. */
export declare function goProvider(models: readonly Model<Api>[]): Provider;
export interface CatalogOptions {
    fetch?: typeof globalThis.fetch;
    now?: () => number;
    onWarning?: (message: string) => void;
}
/** Public model discovery with a bounded, deduplicated refresh and offline fallback. */
export declare class GoCatalog {
    private readonly options;
    private readonly definitions;
    private models;
    private refreshAfter;
    private pending?;
    private readonly lifetime;
    constructor(options?: CatalogOptions);
    get current(): readonly Model<Api>[];
    has(id: string): boolean;
    dispose(): void;
    refresh(signal?: AbortSignal): Promise<void>;
    private refreshShared;
    private update;
}
