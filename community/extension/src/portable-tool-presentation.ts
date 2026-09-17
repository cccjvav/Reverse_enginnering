/** Reconstructed local data model. NOT an augmentation of the host's vscode API. */
import type * as vscode from 'vscode';
import { boundedTechnicalText } from '../../../recovered/shuncode-extension/src/chat-history.mjs';

export interface ShunCodeToolResultData {
  input: string;
  output: string;
  presentationStyle?: 'shuncode';
  presentationKind?: 'files' | 'search' | 'edit' | 'terminal' | 'diagnostics' | 'lsp' | 'generic';
  isError?: boolean;
  durationMs?: number;
  terminalId?: string;
  diff?: string;
  diffPreview?: Array<{path: string; truncated?: boolean; hunks: Array<{truncated?: boolean; lines: Array<
    | {kind: 'add'; newLine: number; text: string}
    | {kind: 'delete'; oldLine: number; text: string}
    | {kind: 'context'; oldLine: number; newLine: number; text: string}
  >}>}>;
  summary?: string;
  detailsLabel?: string;
  items?: Array<{label: string; description?: string; added?: number; removed?: number; resource?: vscode.Uri | vscode.Location}>;
  metrics?: Array<{label: string; value: string}>;
}

/** Deliberate text fallback: never claims the public carrier implements our rich cards. */
export function toPortableToolResultData(
  data: ShunCodeToolResultData, technicalInput: string, technicalOutput: string, isComplete: boolean,
): vscode.ChatSimpleToolResultData {
  const sections: string[] = [];
  if (data.isError) sections.push('Status: error');
  if (data.summary) sections.push(data.summary);
  if (data.items?.length) sections.push('Items\n' + data.items.slice(0, 13).map(item =>
    item.label + (item.description ? ' — ' + item.description : '') +
      (item.added !== undefined || item.removed !== undefined ? ` (+${item.added ?? 0} / -${item.removed ?? 0})` : '')).join('\n'));
  if (data.metrics?.length) sections.push(data.metrics.slice(0, 20).map(m => `${m.label}: ${m.value}`).join('\n'));
  if (data.durationMs !== undefined && !data.metrics?.some(m => m.label === 'Duration')) sections.push(`Duration: ${data.durationMs} ms`);
  if (data.terminalId) sections.push('Terminal: ' + data.terminalId);
  if (data.diff) sections.push('Diff\n' + boundedTechnicalText(data.diff));
  else if (data.diffPreview?.length) {
    sections.push('Diff preview\n' + data.diffPreview.slice(0, 8).map(file => file.path + '\n' +
      file.hunks.slice(0, 4).map(hunk => hunk.lines.slice(0, 18).map(line =>
        (line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' ') + line.text).join('\n') +
        (hunk.truncated ? '\n… preview truncated' : '')).join('\n') +
      (file.truncated ? '\n… file preview truncated' : '')).join('\n'));
  }
  const output = data.output || technicalOutput;
  if (output) sections.push('Technical output\n' + boundedTechnicalText(output));
  if (!sections.length) sections.push(isComplete ? 'Tool returned no textual output.' : 'Tool is running.');
  // Parsed summaries and paths can also contain secrets. Redact the WHOLE final output.
  return {
    input: boundedTechnicalText(technicalInput || data.input),
    output: boundedTechnicalText(sections.join('\n\n')),
  };
}
