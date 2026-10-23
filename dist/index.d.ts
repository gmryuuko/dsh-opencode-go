import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { OpenCodeGoAdapter } from './adapter.js';
export declare const name = "llm-opencode-go";
export declare const inject: string[];
export interface Config {
    token: Volatile<string>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    token: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    token: z<string, string, "volatile-defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config: Config): void;
