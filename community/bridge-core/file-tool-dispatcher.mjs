// Maintenance candidate, NOT wired into the extension/overlay. Host-owned policy is mandatory.
import {
  FILE_TOOL_DEFINITIONS, parseApplyPatchInput, parseFindFilesInput,
  parseReadFilesInput, parseReadImageInput, parseSearchFilesInput
} from '../../reconstructed/bridge-core/src/file-tool-registry.js';
import { normalizeFileToolInput, normalizeFileToolName } from '../../reconstructed/bridge-core/src/file-tool-input-compat.js';
import { validateToolInput } from '../../reconstructed/bridge-core/src/tool-input-validation.js';
import { applyPatch, formatApplyPatchForModel } from '../../reconstructed/bridge-core/src/apply-patch.js';
import { findFiles, formatFindFilesForModel } from '../../reconstructed/bridge-core/src/find-files.js';
import { readFiles, formatReadFilesForModel } from './read-files.mjs';
import { readImage, formatReadImageForModel } from '../../reconstructed/bridge-core/src/read-image.js';
import { searchFiles, formatSearchFilesForModel } from '../../reconstructed/bridge-core/src/search-files.js';

const implementations = new Map([
  ['apply_patch', [parseApplyPatchInput, applyPatch, formatApplyPatchForModel]],
  ['find_files', [parseFindFilesInput, findFiles, formatFindFilesForModel]],
  ['read_files', [parseReadFilesInput, readFiles, formatReadFilesForModel]],
  ['read_image', [parseReadImageInput, readImage, formatReadImageForModel]],
  ['search_files', [parseSearchFilesInput, searchFiles, formatSearchFilesForModel]]
]);

export async function invokeAuthorizedFileTool(name, args, context) {
  try {
    // Do not silently inherit original implicit allow behavior, including for batch aliases.
    if (typeof context?.checkPermission !== 'function') {
      throw Object.assign(new Error('Host-owned file permission policy is required.'), {code: 'PERMISSION_POLICY_REQUIRED'});
    }
    const canonical = normalizeFileToolName(name);
    const implementation = implementations.get(canonical);
    if (!implementation) throw Object.assign(new Error('Unsupported file tool.'), {code: 'INVALID_ARGUMENT'});
    const normalized = normalizeFileToolInput(canonical, args);
    const definition = FILE_TOOL_DEFINITIONS.find(tool => tool.name === canonical);
    validateToolInput(canonical, definition.inputSchema, normalized);
    const [parse, execute, format] = implementation;
    const input = parse(normalized);
    const roots = typeof context.workspaceRoots === 'function' ? context.workspaceRoots() : context.workspaceRoots;
    if (!Array.isArray(roots) || roots.length === 0 || roots.some(root => typeof root !== 'string' || !root)) {
      throw Object.assign(new Error('At least one workspace root is required.'), {code: 'INVALID_ARGUMENT'});
    }
    const authorize = context.checkPermission;
    const result = await execute(input, {
      workspaceRoots: [...roots], signal: context.signal,
      // Config is trusted HOST configuration, keyed per tool; never taken from model args.
      config: context.configByTool?.[canonical],
      checkPermission: async absolutePath => (await authorize(absolutePath, canonical)) === true
    });
    const text = format(result);
    const isError = result.status === 'error' || (result.summary?.succeeded === 0 && result.summary?.failed > 0);
    if (canonical !== 'read_image') return {text, structuredContent: result, isError: isError || undefined};
    const content = [{type: 'text', text}];
    if (isError) return {text, structuredContent: result, content, isError: true};
    const {base64, ...metadata} = result;
    if (!base64) throw new Error('Image result is missing data.');
    content.push({type: 'image', data: base64, mimeType: result.mime_type});
    return {text, structuredContent: metadata, content};
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'FILE_TOOL_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    // Do not promise "nothing was read/written" after arbitrary execution exceptions.
    return {text: `${code}: ${message}`, isError: true,
      structuredContent: {status: 'error', error_code: code, message}};
  }
}
