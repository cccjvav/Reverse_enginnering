/** Windows PortableGit/ConPTY startup and the private terminal prompt protocol.
 * No user command is wrapped or evaluated here. The one-time bootstrap configures
 * this private PTY and execs the same bundled Bash; subsequent commands remain
 * native source in one persistent interactive shell. POSIX Bash 3.2 is unchanged.
 */
export function windowsManagedBashProtocol(protocolToken: string): {
  args: string[];
  env: Record<string, string>;
} {
  if (!/^[a-zA-Z0-9_-]+$/.test(protocolToken)) {
    throw new Error("Invalid managed terminal protocol token.");
  }
  const bootstrap = [
    // Preserve ISIG and ECHO. Only disable the extra canonical input buffering:
    // with it, MSYS timed read can report EOF and leave input for the next prompt.
    "stty -icanon min 1 time 0 || { printf '%s\\n' 'ShunCode Bash input initialization failed.' >&2; exit 1; }",
    // Noninteractive Bash clears PS1, so carry it under a private name until exec.
    'export PS1="$SHUNCODE_MANAGED_PS1"',
    "unset SHUNCODE_MANAGED_PS1",
    'exec "$BASH" --noprofile --norc -i',
  ].join("; ");
  const prompt = [
    `\\[\\e]633;ShunCode;${protocolToken};W2;`,
    "$((__shuncode_seq=${__shuncode_seq:-0}+1));$?;",
    // Read the parent-shell array before any command substitution. @A supplies
    // an unambiguous, IFS-independent numeric array declaration, never code to eval.
    "${PIPESTATUS[*]@A};",
    "$(printf '%s' \"$PWD\" | base64 | tr -d '\\r\\n')",
    "\\a\\]$ ",
  ].join("");
  return {
    args: ["--noprofile", "--norc", "-c", bootstrap],
    env: { PROMPT_COMMAND: "", SHUNCODE_MANAGED_PS1: prompt },
  };
}

export interface ManagedPromptSnapshot {
  sequence: number;
  exitCode: number;
  cwdBase64: string;
  pipelineExitCodes?: number[];
}

function safeInteger(text: string): number | undefined {
  if (!/^-?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Parse only data. Never execute a Bash declaration or accept a partial list. */
export function parseBashPipelineSnapshot(text: string, declaration = false): number[] | undefined {
  if (!declaration) {
    if (text === "") return [];
    if (!/^\d+(?:,\d+)*$/.test(text)) return undefined;
    const values = text.split(",").map(Number);
    return values.every(value => Number.isSafeInteger(value) && value <= 255) ? values : undefined;
  }
  const match = /^declare -a PIPESTATUS=\((.*)\)$/.exec(text);
  if (!match) return undefined;
  if (match[1] === "") return [];
  const fields = match[1].split(" ");
  const values: number[] = [];
  for (const field of fields) {
    const item = /^\[(\d+)\]="(\d+)"$/.exec(field);
    if (!item || Number(item[1]) !== values.length) return undefined;
    const value = Number(item[2]);
    if (!Number.isSafeInteger(value) || value > 255) return undefined;
    values.push(value);
  }
  return values;
}

/** W2 is Windows-only; the existing three/four-field POSIX format stays valid. */
export function parseManagedPrompt(payload: string): ManagedPromptSnapshot | undefined {
  const fields = payload.split(";");
  const modern = fields[0] === "W2";
  if (modern ? fields.length !== 5 : fields.length !== 3 && fields.length !== 4) return undefined;
  const [sequenceText, exitCodeText] = modern ? fields.slice(1, 3) : fields;
  const sequence = safeInteger(sequenceText);
  const exitCode = safeInteger(exitCodeText);
  if (sequence === undefined || sequence < 0 || exitCode === undefined) return undefined;
  const pipeline = fields[3];
  return {
    sequence,
    exitCode,
    cwdBase64: modern ? fields[4] : fields[2],
    pipelineExitCodes: pipeline === undefined ? undefined : parseBashPipelineSnapshot(pipeline, modern),
  };
}
