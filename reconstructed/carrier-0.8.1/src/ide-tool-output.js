// EXTRACTED from src/ide-tool-output.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

function ideToolStructuredContent(name, text2) {
  const tags = {
    run_command: "RUN_COMMAND",
    get_command_output: "COMMAND_OUTPUT",
    cancel_command: "CANCEL_COMMAND",
    send_command_input: "SEND_COMMAND_INPUT"
  };
  const tag = tags[name];
  if (!tag) return { text: text2 };
  const fail2 = () => {
    throw new Error(`Invalid ${name} result envelope. The operation may already have executed; do not retry automatically.
${text2}`);
  };
  const opening = `=== ${tag} BEGIN ===
`;
  const closing = `=== ${tag} END ===`;
  if (!text2.startsWith(opening) || !text2.endsWith(closing)) return fail2();
  const hasOutput = name === "run_command" || name === "get_command_output";
  const begin = "\n--- OUTPUT BEGIN ---\n";
  const end = `
--- OUTPUT END ---
${closing}`;
  const boundary = hasOutput ? text2.indexOf(begin, opening.length) : text2.length - closing.length - 1;
  if (boundary < opening.length || hasOutput && !text2.endsWith(end)) return fail2();
  const result = {};
  const allowed = /* @__PURE__ */ new Set(["command_id", "terminal_id", "terminal_name", "execution", "shell", "terminal_reused", "command", "status", "exit_code", "pipeline_exit_codes", "cwd", "background", "script_bridge", "echo_gate", "echo_gate_released_bytes", "shell_prompt_seq", "recovered_by_abort", "suspected_parser_error", "hint", "duration_ms", "next_offset", "total_output_bytes", "output_lost", "output_start_offset", "has_more", "status_before", "cancel_requested", "already_requested", "already_finished", "interrupt_sent", "force_requested", "force_required", "forced", "risk", "risk_level", "risk_reason", "grace_ms", "terminal_reusable", "bytes_sent", "append_newline"]);
  for (const line of text2.slice(opening.length, boundary).split("\n")) {
    const match = /^([a-z_]+): (.*)$/.exec(line);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(result, match[1])) return fail2();
    const [, key, value] = match;
    try {
      result[key] = JSON.parse(value);
    } catch {
      result[key] = value;
    }
  }
  if (typeof result.command_id !== "string" || !result.command_id.trim()) return fail2();
  if (typeof result.status !== "string" || !["running", "completed", "failed", "killed", "cancelled"].includes(result.status)) return fail2();
  for (const key of ["terminal_id", "cwd"]) if (result[key] !== void 0 && typeof result[key] !== "string") return fail2();
  if (result.exit_code !== void 0 && result.exit_code !== null && !Number.isSafeInteger(result.exit_code)) return fail2();
  if (result.pipeline_exit_codes !== void 0 && result.pipeline_exit_codes !== null && (!Array.isArray(result.pipeline_exit_codes) || !result.pipeline_exit_codes.every(Number.isSafeInteger))) return fail2();
  if (hasOutput) result.output = text2.slice(boundary + begin.length, text2.length - end.length);
  return result;
}
function ideDirectoryStructuredContent(directory, entries, truncated) {
  return { path: directory, truncated, entries: entries.map((entry) => ({
    name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
    path: entry.path,
    type: entry.type === "dir" ? "directory" : entry.type === "unknown" ? "other" : entry.type
  })) };
}
