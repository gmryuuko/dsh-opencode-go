import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { OpenCodeGoAdapter } from './adapter.js';
export declare const name = "llm-opencode-go";
export declare const inject: string[];
export interface Config {
    apiKeyEnv: Volatile<string>;
    /** Legacy configuration; migrated into the host credential store. */
    token: Volatile<string>;
    disabledModels: Volatile<string[]>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    apiKeyEnv: z<string, string, "volatile-defined">;
    token: z<string, string, "volatile-defined">;
    disabledModels: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    apiKeyEnv: z<string, string, "volatile-defined">;
    token: z<string, string, "volatile-defined">;
    disabledModels: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config: Config): void;
