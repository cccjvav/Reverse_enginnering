// EVIDENCE, NOT A HOST DECLARATION. Do not import this file into the build.
//
// The author's forked Code OSS declared five members on ChatSimpleToolResultData
// that the public proposed API does not. This file reconstructs those shapes
// from the author's own type annotations and then proves the reconstruction by
// compiling their real code against it, reproduced verbatim from
// recovered/shuncode-extension/src/tool-presentation.ts.
//
// If this file typechecks, the shapes are consistent with everything the author
// wrote. That is a strong claim about the shapes and NOT a claim to have
// recovered the host: only the author's own vscode.d.ts can settle the exact
// spelling, optionality and any members their code never touched.
//
// The interface below is deliberately local. Declaring these members on the
// real vscode namespace would fabricate a host and turn 11 honest errors green.

declare namespace vscode { type Uri = { __uri: true }; type Location = { __loc: true }; }
interface ChatSimpleToolResultData {
  input: string; output: string;
  items?: Array<{ label: string; description?: string; resource?: vscode.Uri | vscode.Location }>;
  metrics?: Array<{ label: string; value: string }>;
  presentationKind?: 'files'|'search'|'edit'|'terminal'|'diagnostics'|'lsp'|'generic';
  presentationStyle?: 'shuncode';
  diffPreview?: Array<{
    path: string;
    hunks: Array<{
      lines: Array<{kind:'add';newLine:number;text:string}|{kind:'delete';oldLine:number;text:string}|{kind:'context';oldLine:number;newLine:number;text:string}>;
      truncated?: boolean }>;
    truncated?: boolean }>;
}
// --- The author's own code, reproduced verbatim from tool-presentation.ts ---
type P = {
  title: string; summary?: string;
  items?: NonNullable<ChatSimpleToolResultData["items"]>;
  metrics?: NonNullable<ChatSimpleToolResultData["metrics"]>;
  diffPreview?: NonNullable<ChatSimpleToolResultData["diffPreview"]>;
};
function withOverflowItem<T extends { label: string }>(items: T[], total: number): T[] {
  if (items.length <= 12) return items;
  const visible = items.slice(0, 12);
  visible.push({ label: `… ${Math.max(0, total - 12)} more` } as T);
  return visible;
}
declare function relativeResource(root: vscode.Uri|undefined, p: string, l?: number, c?: number): vscode.Uri|vscode.Location|undefined;
function searchPresentation(root: vscode.Uri|undefined, total: number, files: number): P {
  const items: Array<{ label: string; description?: string; resource?: vscode.Uri | vscode.Location }> = [];
  items.push({ label: 'a', description: `Line 1`, resource: relativeResource(root,'a',1,1) });
  return { title: 'x', items: withOverflowItem(items, total),
    metrics: [{ label: "Matches", value: String(total) }, { label: "Files", value: String(files) }] };
}
function presentationKind(toolName: string): NonNullable<ChatSimpleToolResultData["presentationKind"]> {
  switch (toolName) { case 'find_files': return 'files'; case 'search_files': return 'search';
    case 'apply_patch': return 'edit'; case 'run_command': return 'terminal';
    case 'diagnostics': return 'diagnostics'; case 'lsp': return 'lsp'; default: return 'generic'; }
}
function parseUnifiedDiffPreview(diff: string|undefined): NonNullable<ChatSimpleToolResultData["diffPreview"]> {
  if (!diff) return [];
  const files: NonNullable<ChatSimpleToolResultData["diffPreview"]> = [];
  let currentFile: NonNullable<ChatSimpleToolResultData["diffPreview"]>[number] | undefined;
  let currentHunk: NonNullable<ChatSimpleToolResultData["diffPreview"]>[number]["hunks"][number] | undefined;
  let oldLine = 0, newLine = 0;
  currentFile = { path: 'p', hunks: [] };
  currentHunk = { lines: [] };
  const line = '+abc'; const marker = line[0];
  const previewLine = marker === "+" ? { kind: "add" as const, newLine, text: line.slice(1) }
    : marker === "-" ? { kind: "delete" as const, oldLine, text: line.slice(1) }
    : { kind: "context" as const, oldLine, newLine, text: line.slice(1) };
  if (currentHunk.lines.length < 20) currentHunk.lines.push(previewLine); else currentHunk.truncated = true;
  if (currentFile.hunks.length < 8) currentFile.hunks.push(currentHunk); else currentFile.truncated = true;
  files.push(currentFile);
  return files;
}
const style: ChatSimpleToolResultData = { input:'i', output:'o', presentationStyle: true ? "shuncode" : undefined,
  presentationKind: presentationKind('find_files') };
// --- Shape assertions ---------------------------------------------------
// The code above annotates its locals independently, so a member could be
// dropped from the interface and everything would still compile. These pin the
// shapes directly.
//
// Note the helper: a plain two-way `extends` check does NOT work here, because
// TypeScript considers { label } and { label; description? } mutually
// assignable - an optional member can vanish unnoticed. Comparing key sets is
// what actually catches that, so both key sets and value types are checked.
type Items = NonNullable<ChatSimpleToolResultData["items"]>;
type Metrics = NonNullable<ChatSimpleToolResultData["metrics"]>;
type Diff = NonNullable<ChatSimpleToolResultData["diffPreview"]>;

type KeysEqual<A, B> =
  [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

type ItemElement = { label: string; description?: string; resource?: vscode.Uri | vscode.Location };
const itemsKeys: KeysEqual<Items[number], ItemElement> = true;
const itemsTypes: Same<Items[number]["label"], string> = true;
const itemsDescription: Same<Items[number]["description"], string | undefined> = true;

type MetricElement = { label: string; value: string };
const metricsKeys: KeysEqual<Metrics[number], MetricElement> = true;
const metricsValue: Same<Metrics[number]["value"], string> = true;

const diffFileKeys: KeysEqual<
  Diff[number], { path: string; hunks: unknown; truncated?: boolean }> = true;
const diffHunkKeys: KeysEqual<
  Diff[number]["hunks"][number], { lines: unknown; truncated?: boolean }> = true;
const diffLineSame: Same<
  Diff[number]["hunks"][number]["lines"][number],
  | { kind: "add"; newLine: number; text: string }
  | { kind: "delete"; oldLine: number; text: string }
  | { kind: "context"; oldLine: number; newLine: number; text: string }
> = true;

const kindSame: Same<
  NonNullable<ChatSimpleToolResultData["presentationKind"]>,
  'files' | 'search' | 'edit' | 'terminal' | 'diagnostics' | 'lsp' | 'generic'
> = true;

export { searchPresentation, parseUnifiedDiffPreview, style,
  itemsKeys, itemsTypes, itemsDescription, metricsKeys, metricsValue,
  diffFileKeys, diffHunkKeys, diffLineSame, kindSame };
