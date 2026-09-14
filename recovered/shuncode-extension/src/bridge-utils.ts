import type { BridgeActivityItem, BridgeActivityPresentation, BridgeDiffFilePreview, BridgeDiffHunkPreview, BridgeDiffLinePreview } from "./bridge-constants.js";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function boundedText(value: unknown, maxChars = 16_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return undefined;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated for Bridge UI]`;
}

export function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

export function stringField(text: string | undefined, field: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!match) return undefined;
  const raw = match[1].trim();
  if (raw === "null") return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    return raw;
  }
}

export function numberField(text: string | undefined, field: string): number | null | undefined {
  const raw = stringField(text, field);
  if (raw === undefined) return undefined;
  if (raw === "null") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function blockBetween(text: string | undefined, begin: string, end: string): string | undefined {
  if (!text) return undefined;
  const start = text.indexOf(begin);
  if (start < 0) return undefined;
  const contentStart = start + begin.length;
  const finish = text.indexOf(end, contentStart);
  const value = text.slice(contentStart, finish >= 0 ? finish : undefined).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return value || undefined;
}

export function parseListDirectoryItems(text: string | undefined): BridgeActivityItem[] {
  if (!text) return [];
  const items: BridgeActivityItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\[(DIR|FILE|LINK|OTHER)\]\s+(.+)$/);
    if (!match) continue;
    items.push({ kind: match[1] === "DIR" ? "folder" : "file", path: match[2] });
  }
  return items;
}

export function parseDiagnosticsItems(text: string | undefined): BridgeActivityItem[] {
  if (!text) return [];
  const items: BridgeActivityItem[] = [];
  const blocks = text.split(/--- DIAGNOSTIC \d+ ---/).slice(1);
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    const location = lines[0]?.match(/^(.+):(\d+):(\d+)$/);
    if (!location) continue;
    const severity = stringField(block, "severity") as BridgeActivityItem["severity"];
    const messageStart = lines.findIndex((line) => line.startsWith("code:"));
    const message = messageStart >= 0 ? lines.slice(messageStart + 1).join(" ").trim() : undefined;
    items.push({
      kind: "diagnostic",
      path: location[1],
      line: Number(location[2]),
      column: Number(location[3]),
      label: message || undefined,
      severity,
    });
  }
  return items;
}

export function parseLspItems(text: string | undefined): BridgeActivityItem[] {
  if (!text) return [];
  const items: BridgeActivityItem[] = [];
  const blocks = text.split(/--- RESULT \d+ ---/).slice(1);
  for (const block of blocks) {
    const pathValue = stringField(block, "path");
    if (!pathValue || /^[a-z]+:\/\//i.test(pathValue)) continue;
    const range = stringField(block, "selection_range") ?? stringField(block, "range");
    const position = range?.match(/^(\d+):(\d+)/);
    items.push({
      kind: "symbol",
      path: pathValue,
      line: position ? Number(position[1]) : undefined,
      column: position ? Number(position[2]) : undefined,
      label: stringField(block, "name"),
      description: stringField(block, "kind") ?? stringField(block, "container"),
    });
  }
  return items;
}

export const MAX_DIFF_PREVIEW_FILES = 8;
export const MAX_DIFF_PREVIEW_HUNKS_PER_FILE = 4;
export const MAX_DIFF_PREVIEW_LINES_PER_HUNK = 18;

export function diffPath(header: string): string | undefined {
  const value = header.trim();
  if (!value || value === "/dev/null") return undefined;
  return value.replace(/^[ab]\//, "");
}

export function parseUnifiedDiffPreview(diff: string | undefined): BridgeDiffFilePreview[] {
  if (!diff) return [];
  const lines = diff.split(/\r?\n/);
  const files: BridgeDiffFilePreview[] = [];
  let currentFile: { oldPath?: string; newPath?: string; hunks: BridgeDiffHunkPreview[]; truncated?: boolean } | undefined;
  let currentHunk: { oldStart: number; newStart: number; lines: BridgeDiffLinePreview[]; truncated?: boolean } | undefined;
  let oldLine = 0;
  let newLine = 0;

  const finishHunk = () => {
    if (!currentFile || !currentHunk) return;
    if (currentFile.hunks.length < MAX_DIFF_PREVIEW_HUNKS_PER_FILE) currentFile.hunks.push(currentHunk);
    else currentFile.truncated = true;
    currentHunk = undefined;
  };

  const finishFile = () => {
    finishHunk();
    if (!currentFile) return;
    const path = currentFile.newPath ?? currentFile.oldPath;
    if (path) {
      if (files.length < MAX_DIFF_PREVIEW_FILES) files.push({ path, ...currentFile });
      else if (files.length > 0) files[files.length - 1] = { ...files[files.length - 1]!, truncated: true };
    }
    currentFile = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("--- ")) {
      finishFile();
      const oldPath = diffPath(line.slice(4));
      const next = lines[index + 1];
      const newPath = next?.startsWith("+++ ") ? diffPath(next.slice(4)) : undefined;
      currentFile = { oldPath, newPath, hunks: [] };
      if (next?.startsWith("+++ ")) index += 1;
      continue;
    }
    if (!currentFile) continue;
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      finishHunk();
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      currentHunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      continue;
    }
    if (!currentHunk || line === "\\ No newline at end of file" || line === "... <diff truncated>") continue;
    const marker = line[0];
    if (marker !== " " && marker !== "+" && marker !== "-") continue;
    const previewLine: BridgeDiffLinePreview = marker === "+"
      ? { kind: "add", newLine, text: line.slice(1) }
      : marker === "-"
        ? { kind: "delete", oldLine, text: line.slice(1) }
        : { kind: "context", oldLine, newLine, text: line.slice(1) };
    if (currentHunk.lines.length < MAX_DIFF_PREVIEW_LINES_PER_HUNK) currentHunk.lines.push(previewLine);
    else currentHunk.truncated = true;
    if (marker !== "+") oldLine += 1;
    if (marker !== "-") newLine += 1;
  }
  finishFile();
  return files;
}

export function bridgePresentation(
  toolName: string,
  args: Record<string, unknown>,
  resultText?: string,
  structuredContent?: Record<string, unknown>,
  isError = false,
): BridgeActivityPresentation {
  const input = boundedText(args, 8_000);
  const output = boundedText(resultText, 24_000);
  const structured = structuredContent ?? {};

  if (toolName === "read_files") {
    const requested = recordArray(args.files).map((file) => typeof file.path === "string" ? file.path : undefined);
    const returned = recordArray(structured.files).map((file) => typeof file.path === "string" ? file.path : undefined);
    const files = uniqueStrings([...requested, ...returned]);
    return {
      kind: "files",
      title: files.length === 1 ? `Read ${files[0]}` : `Read ${files.length || "workspace"} files`,
      subtitle: isError ? "File read failed" : files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : undefined,
      files,
      items: files.map((file) => ({ kind: "file", path: file })),
      input: undefined,
      output: isError ? output : undefined,
    };
  }

  if (toolName === "find_files") {
    const files = uniqueStrings(recordArray(structured.files).map((file) => typeof file.path === "string" ? file.path : undefined));
    const patterns = Array.isArray(args.patterns) ? args.patterns.filter((value): value is string => typeof value === "string") : [];
    return {
      kind: "files",
      title: files.length ? `Found ${files.length} file${files.length === 1 ? "" : "s"}` : "Find files",
      subtitle: patterns.length ? patterns.join(", ") : undefined,
      files,
      items: files.map((file) => ({ kind: "file", path: file })),
      input: undefined,
      output: isError ? output : undefined,
    };
  }

  if (toolName === "search_files") {
    const matches = recordArray(structured.matches);
    const files = uniqueStrings(matches.map((match) => typeof match.path === "string" ? match.path : undefined));
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    const items: BridgeActivityItem[] = matches.flatMap((match) => {
      if (typeof match.path !== "string") return [];
      return [{
        kind: "match" as const,
        path: match.path,
        line: typeof match.line === "number" ? match.line : undefined,
        column: typeof match.column === "number" ? match.column : undefined,
        label: typeof match.text === "string" ? match.text.trim() : undefined,
      }];
    });
    return {
      kind: "search",
      title: pattern ? `Searched “${pattern}”` : "Searched workspace",
      subtitle: matches.length ? `${matches.length} match${matches.length === 1 ? "" : "es"} in ${files.length} file${files.length === 1 ? "" : "s"}` : undefined,
      files,
      items,
      input: undefined,
      output: isError ? output : undefined,
    };
  }

  if (toolName === "apply_patch") {
    const fileRows = recordArray(structured.files);
    const files = uniqueStrings(fileRows.map((file) => typeof file.destination_path === "string"
      ? file.destination_path
      : typeof file.path === "string" ? file.path : undefined));
    const summary = asRecord(structured.summary);
    const additions = typeof summary.additions === "number" ? summary.additions : undefined;
    const deletions = typeof summary.deletions === "number" ? summary.deletions : undefined;
    const changeSummary = additions !== undefined || deletions !== undefined ? `+${additions ?? 0} -${deletions ?? 0}` : undefined;
    const diff = boundedText(structured.diff, 32_000);
    return {
      kind: "edit",
      title: files.length === 1 ? `Edited ${files[0]}` : `Edited ${files.length || "workspace"} files`,
      subtitle: isError ? "Edit failed" : changeSummary,
      files,
      items: fileRows.flatMap((file) => typeof file.path === "string" ? [{
        kind: "file" as const,
        path: typeof file.destination_path === "string" ? file.destination_path : file.path,
        description: typeof file.action === "string" ? file.action : undefined,
        additions: typeof file.additions === "number" ? file.additions : undefined,
        deletions: typeof file.deletions === "number" ? file.deletions : undefined,
      }] : []),
      input: undefined,
      output: isError ? output : undefined,
      diff,
      diffPreview: parseUnifiedDiffPreview(diff),
    };
  }

  if (toolName === "list_directory") {
    const target = typeof args.path === "string" && args.path.trim() ? args.path.trim() : "workspace";
    const items = parseListDirectoryItems(resultText);
    return {
      kind: "files",
      title: `Explored ${target}`,
      subtitle: items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : undefined,
      items,
      files: items.filter((item) => item.kind === "file").map((item) => item.path),
      input: undefined,
      output: isError ? output : undefined,
    };
  }

  if (toolName === "run_command") {
    const command = typeof args.command === "string" ? args.command.trim() : "Run command";
    const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : undefined;
    const terminalId = stringField(resultText, "terminal_id");
    const terminalName = stringField(resultText, "terminal_name");
    const commandId = stringField(resultText, "command_id");
    const exitCode = numberField(resultText, "exit_code");
    const terminalOutput = blockBetween(resultText, "--- OUTPUT BEGIN ---", "--- OUTPUT END ---");
    const status = stringField(resultText, "status");
    const subtitle = [terminalName, cwd, status && status !== "completed" ? status : undefined, exitCode !== undefined && exitCode !== null ? `exit ${exitCode}` : undefined].filter(Boolean).join(" · ") || undefined;
    return { kind: "terminal", title: command || "Run command", subtitle, input: undefined, output: terminalOutput ?? (isError ? output : undefined), terminalId, commandId, exitCode };
  }

  if (toolName === "get_command_output") {
    const commandId = typeof args.command_id === "string" ? args.command_id : undefined;
    return {
      kind: "terminal",
      title: "Read command output",
      subtitle: [stringField(resultText, "terminal_name"), stringField(resultText, "status") ?? commandId].filter(Boolean).join(" · ") || undefined,
      input: undefined,
      output: blockBetween(resultText, "--- OUTPUT BEGIN ---", "--- OUTPUT END ---") ?? output,
      terminalId: stringField(resultText, "terminal_id"),
      commandId,
      exitCode: numberField(resultText, "exit_code"),
    };
  }

  if (toolName === "cancel_command") {
    const commandId = typeof args.command_id === "string" ? args.command_id : undefined;
    const status = stringField(resultText, "status");
    const forceRequired = stringField(resultText, "force_required") === "true";
    return {
      kind: "terminal",
      title: status === "cancelled"
        ? "Cancelled command"
        : forceRequired
          ? "Command needs force confirmation"
          : "Requested command cancellation",
      subtitle: [status, commandId].filter(Boolean).join(" · ") || undefined,
      input: undefined,
      output: isError ? output : undefined,
      terminalId: stringField(resultText, "terminal_id"),
      commandId,
      exitCode: numberField(resultText, "exit_code"),
    };
  }

  if (toolName === "send_command_input") {
    const commandId = typeof args.command_id === "string" ? args.command_id : undefined;
    return { kind: "terminal", title: "Sent command input", subtitle: commandId, input: boundedText(args.input, 2_000), terminalId: stringField(resultText, "terminal_id"), commandId, output: isError ? output : undefined };
  }

  if (toolName === "get_diagnostics") {
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : "workspace";
    const items = parseDiagnosticsItems(resultText);
    const errors = items.filter((item) => item.severity === "error").length;
    const warnings = items.filter((item) => item.severity === "warning").length;
    const summary = items.length ? `${errors} error${errors === 1 ? "" : "s"} · ${warnings} warning${warnings === 1 ? "" : "s"}` : "No diagnostics";
    return { kind: "diagnostics", title: `Checked diagnostics · ${scope}`, subtitle: summary, items, input: undefined, output: isError ? output : undefined };
  }

  if (toolName === "lsp") {
    const operationId = typeof args.operation === "string" ? args.operation : "";
    const operation = operationId ? operationId.replace(/_/g, " ") : "code intelligence";
    const subject = typeof args.query === "string" && args.query.trim()
      ? args.query.trim()
      : typeof args.path === "string" && args.path.trim()
        ? args.path.trim()
        : undefined;
    const items = parseLspItems(resultText);
    const resultSummary = items.length ? `${items.length} result${items.length === 1 ? "" : "s"}` : subject;
    const hoverOutput = operationId === "hover" ? blockBetween(resultText, "--- CONTENT BEGIN ---", "--- CONTENT END ---") : undefined;
    return { kind: "lsp", title: `LSP · ${operation}`, subtitle: resultSummary, items, input: undefined, output: isError ? output : hoverOutput };
  }

  return { kind: "generic", title: toolName, input, output };
}

