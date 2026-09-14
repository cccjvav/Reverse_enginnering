// RECONSTRUCTED from src/managed-command-risk.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var NORMAL_RISK = { level: "normal" };

function highRisk(reason, consequence) {
  return { level: "high", reason, consequence };
}

function parseInvocations(source) {
  const invocations = [];
  let words = [];
  let word = "";
  let quote;
  let escaped = false;
  const finishWord = () => {
    if (word.length > 0) words.push(word);
    word = "";
  };
  const finishInvocation = () => {
    finishWord();
    if (words.length > 0) invocations.push(words);
    words = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      word += char;
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === quote) quote = void 0;
      else if (char === "\\" && quote === '"') escaped = true;
      else word += char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && word.length === 0) {
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      finishWord();
      if (char === "\n") finishInvocation();
      continue;
    }
    if (char === ";" || char === "|" || char === "&") {
      finishInvocation();
      continue;
    }
    word += char;
  }
  finishInvocation();
  return invocations;
}

function executableName(value) {
  return (value.replace(/\\/g, "/").split("/").pop() ?? value).toLowerCase();
}

function stripLeadingOptions(words, optionsWithValues = /* @__PURE__ */ new Set()) {
  const remaining = [...words];
  while (remaining[0]?.startsWith("-")) {
    const option = remaining.shift() ?? "";
    if (option === "--") break;
    const name = option.split("=")[0];
    if (!option.includes("=") && optionsWithValues.has(name)) remaining.shift();
  }
  return remaining;
}

function unwrapInvocation(original) {
  let words = [...original];
  for (let depth = 0; depth < 6 && words.length > 0; depth += 1) {
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
    const executable = executableName(words[0] ?? "");
    if (executable === "sudo") {
      words = stripLeadingOptions(words.slice(1), /* @__PURE__ */ new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-T", "--command-timeout", "-R", "--chroot", "-D", "--chdir"]));
      continue;
    }
    if (executable === "env") {
      words = stripLeadingOptions(words.slice(1), /* @__PURE__ */ new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]));
      continue;
    }
    if (["command", "builtin", "nohup", "time"].includes(executable)) {
      words = stripLeadingOptions(words.slice(1));
      continue;
    }
    if (executable === "npx") {
      words = stripLeadingOptions(words.slice(1), /* @__PURE__ */ new Set(["-p", "--package", "-c", "--call"]));
      continue;
    }
    if (executable === "bundle" && executableName(words[1] ?? "") === "exec") {
      words = words.slice(2);
      continue;
    }
    break;
  }
  return words;
}

var RELEASE_SCRIPT = /^(?:package|pack|dist|release|sign)(?:[._:-]|$)/i;

var ARCHIVE_SCRIPT = /^(?:archive|restore)(?:[._:-]|$)/i;

var PACKAGE_MUTATIONS = /* @__PURE__ */ new Set(["add", "ci", "install", "link", "remove", "uninstall", "update", "upgrade"]);

var PACKAGE_INSPECTION = /* @__PURE__ */ new Set(["audit", "check", "info", "list", "ls", "outdated", "show", "view", "why"]);

function classifyPackageManager(executable, args) {
  const action = (args[0] ?? "").toLowerCase();
  if (PACKAGE_MUTATIONS.has(action) || executable === "yarn" && action === "") {
    return highRisk("dependency installation or package upgrade", "Stopping mid-change may leave dependencies or system packages partially updated.");
  }
  if (action === "pack" || action === "run" && RELEASE_SCRIPT.test(args[1] ?? "")) {
    return highRisk("packaging or signing operation", "Stopping mid-write may leave an incomplete or unsigned release artifact.");
  }
  if (["exec", "dlx"].includes(action)) return classifyWords(args.slice(1));
  if (PACKAGE_INSPECTION.has(action)) return NORMAL_RISK;
  return NORMAL_RISK;
}

function tarMutates(args) {
  const mutatingLongOptions = /* @__PURE__ */ new Set(["--append", "--concatenate", "--create", "--delete", "--extract", "--get", "--update"]);
  return args.some((arg) => {
    if (arg.startsWith("--")) return mutatingLongOptions.has(arg.split("=")[0]);
    if (arg.startsWith("-") || /^[ctxruAtvf]+$/i.test(arg)) return /[cxruA]/.test(arg.replace(/^-/, ""));
    return false;
  });
}

function classifyWords(original) {
  const words = unwrapInvocation(original);
  const executable = executableName(words[0] ?? "");
  const args = words.slice(1);
  if (!executable) return NORMAL_RISK;
  if (["signtool", "makeappx", "makepri", "codesign", "productbuild", "pkgbuild", "notarytool"].includes(executable) || RELEASE_SCRIPT.test(executable)) {
    return highRisk("packaging or signing operation", "Stopping mid-write may leave an incomplete or unsigned release artifact.");
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(executable)) return classifyPackageManager(executable, args);
  if (["winget", "choco", "scoop", "brew", "gem", "pip", "pip3", "pipx"].includes(executable) && PACKAGE_MUTATIONS.has((args[0] ?? "").toLowerCase())) {
    return highRisk("installation or upgrade operation", "Stopping mid-change may leave dependencies or system packages partially updated.");
  }
  const action = (args[0] ?? "").toLowerCase();
  if (executable === "prisma" && action === "migrate" || executable === "alembic" && ["upgrade", "downgrade"].includes(action) || executable === "rails" && args.some((arg) => /^db:migrate(?::|$)/i.test(arg)) || /^(?:migrate|migration)(?:[._:-]|$)/i.test(executable)) {
    return highRisk("database migration operation", "Stopping mid-migration may leave application or database state partially migrated.");
  }
  if (["tar", "bsdtar"].includes(executable) && tarMutates(args)) return highRisk("archive creation, extraction, or restore", "Stopping now may leave a partial archive or partially restored destination.");
  if (executable === "zip" && !args.some((arg) => ["-sf", "--show-files", "-T", "--test"].includes(arg))) return highRisk("archive creation or mutation", "Stopping now may leave a partial or inconsistent archive.");
  if (executable === "unzip" && !args.some((arg) => /^-(?:l|t|Z)/.test(arg))) return highRisk("archive extraction or restore", "Stopping now may leave a partially restored destination.");
  if (executable === "ditto" || ARCHIVE_SCRIPT.test(executable)) return highRisk("archive or restore operation", "Stopping now may leave a partial archive or partially restored destination.");
  if (["mv", "move", "robocopy"].includes(executable) || executable === "rsync" && !args.some((arg) => arg === "--dry-run" || /^-[^-]*n/.test(arg))) {
    return highRisk("bulk move or synchronization operation", "Stopping mid-transfer may leave source and destination contents inconsistent.");
  }
  if (["bash", "zsh", "sh", "node", "python", "python3", "ruby", "powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(executable)) {
    const script = args.find((arg) => !arg.startsWith("-"));
    if (script) return classifyWords([script, ...args.slice(args.indexOf(script) + 1)]);
  }
  return NORMAL_RISK;
}

function classifyManagedCommandRisk(command) {
  for (const invocation of parseInvocations(command)) {
    const risk = classifyWords(invocation);
    if (risk.level === "high") return risk;
  }
  return NORMAL_RISK;
}

export { ARCHIVE_SCRIPT, NORMAL_RISK, PACKAGE_INSPECTION, PACKAGE_MUTATIONS, RELEASE_SCRIPT, classifyManagedCommandRisk, classifyPackageManager, classifyWords, executableName, highRisk, parseInvocations, stripLeadingOptions, tarMutates, unwrapInvocation };
