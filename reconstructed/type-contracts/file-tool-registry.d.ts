/** Original dispatcher contract: permissions/config are NOT forwarded. */
export type ToolContentBlock = {type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string};
export interface FileToolResult {
  text: string;
  structuredContent: Record<string, unknown>;
  content?: ToolContentBlock[];
  isError?: boolean;
}
export type FileToolName = 'apply_patch' | 'find_files' | 'read_files' | 'read_image' | 'search_files';
export interface FileToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {type: 'object'} & Record<string, unknown>;
  outputSchema?: {type: 'object'} & Record<string, unknown>;
  annotations?: {title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean};
}
export declare const APPLY_PATCH_TOOL: FileToolDefinition;
export declare const FIND_FILES_TOOL: FileToolDefinition;
export declare const READ_FILES_TOOL: FileToolDefinition;
export declare const READ_IMAGE_TOOL: FileToolDefinition;
export declare const SEARCH_FILES_TOOL: FileToolDefinition;
export declare const FILE_TOOL_DEFINITIONS: FileToolDefinition[];
export declare const FILE_TOOL_NAMES: string[];
export declare function isFileToolName(name: string): boolean;
export declare function invokeFileTool(name: string, args: Record<string, unknown>, context: {
  workspaceRoots: string[] | (() => string[]); signal?: AbortSignal;
}): Promise<FileToolResult>;
export declare function dispatchFileTool(name: string, args: Record<string, unknown>, context: {
  workspaceRoots: string[]; signal?: AbortSignal;
}): Promise<FileToolResult>;
export declare function buildFileToolErrorResult(name: string, error: unknown): FileToolResult;
