/** Candidate facade contract. An object schema is not proof of deep schema validity. */
export type CustomToolLog = (message: string) => void;
export type CustomToolInputSchema = { type: 'object' } & Record<string, unknown>;
export interface CustomToolManifest {
  name: string;
  title: string;
  description: string;
  inputSchema: CustomToolInputSchema;
  command: string[];
  timeoutMs: number;
  enabled: boolean;
  sourcePath: string;
  skillDir?: string;
}
export interface CustomToolStatusEntry {
  name: string;
  title: string;
  description: string;
  enabled: boolean;
  source: 'skill' | 'manifest';
}
export interface CustomToolLoadOptions { skillsEnabled?: boolean }
export interface CustomToolExecutionResult {
  isError: boolean;
  text: string;
  structuredContent: {
    exit_code: number | null;
    timed_out: boolean;
    aborted: boolean;
    duration_ms: number;
  };
}
export declare const MAX_MANIFESTS_PER_ROOT: 64;
export declare const CUSTOM_TOOLS_DIR_NAME: '.shuncode/mcp-tools';
export declare const CUSTOM_TOOL_OUTPUT_SCHEMA: {
  type: 'object';
  properties: {
    exit_code: { type: string[] };
    timed_out: { type: string };
    aborted: { type: string };
    duration_ms: { type: string };
  };
  required: string[];
  additionalProperties: boolean;
};
export declare function loadCustomTools(roots: string[], log?: CustomToolLog, options?: CustomToolLoadOptions): CustomToolManifest[];
export declare function listEnabledCustomTools(roots: string[], log?: CustomToolLog, options?: CustomToolLoadOptions): CustomToolManifest[];
export declare function findCustomTool(roots: string[], name: string, log?: CustomToolLog, options?: CustomToolLoadOptions): CustomToolManifest | undefined;
export declare function toStatusEntries(tools: CustomToolManifest[]): CustomToolStatusEntry[];
export declare function customToolsFingerprint(tools: CustomToolManifest[]): string;
export interface CustomToolExecutionOptions {
  signal?: AbortSignal;
  /** Accepted by the preserved caller, but NOT invoked by the extracted executor. */
  log?: CustomToolLog;
}
export declare function executeCustomTool(roots: string[], tool: CustomToolManifest, args: Record<string, unknown>,
  options?: CustomToolExecutionOptions): Promise<CustomToolExecutionResult>;
export * as import_node_fs6 from 'node:fs';
export declare const import_node_path10: typeof import('node:path') & { default: typeof import('node:path') };
