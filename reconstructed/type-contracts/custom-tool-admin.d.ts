/** Mutates workspace manifests/Skill directories; this API is not an OS sandbox. */
import type { CustomToolLog } from './custom-tools.js';
export declare function toggleCustomTool(roots: string[], name: string, log?: CustomToolLog): {name: string; enabled: boolean};
export declare function deleteCustomTool(roots: string[], name: string, log?: CustomToolLog): {name: string; deleted: string};
export * as import_node_fs7 from 'node:fs';
export declare const import_node_path11: typeof import('node:path') & { default: typeof import('node:path') };
