// EXTRACTED from src/mcp-runtime-provision.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var WRAPPERS = /* @__PURE__ */ new Set(["cmd", "cmd.exe", "sh", "bash", "zsh", "powershell", "powershell.exe", "pwsh"]);
var WRAPPER_FLAGS = /* @__PURE__ */ new Set(["/c", "/k", "-c", "-command", "-file", "-nologo", "-noprofile", "/d", "/s"]);
function resolveLaunchExecutable(command, args = []) {
  const base = (command ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (!WRAPPERS.has(base)) return base;
  for (const arg of args) {
    const token = (arg ?? "").trim();
    if (!token) continue;
    if (WRAPPER_FLAGS.has(token.toLowerCase())) continue;
    const first = token.split(/\s+/)[0] ?? "";
    return first.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  }
  return base;
}
function planRuntime(command, args = [], platform = process.platform) {
  const executable = resolveLaunchExecutable(command, args);
  if (executable === "npx" || executable === "node" || executable === "npm" || executable === "pnpm" || executable === "yarn" || executable === "bunx") {
    const probeCommand = executable === "bunx" ? "bunx" : executable;
    const install = platform === "win32" ? { command: "winget", args: ["install", "--id", "OpenJS.NodeJS.LTS", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"], describe: "winget install OpenJS.NodeJS.LTS" } : platform === "darwin" ? { command: "brew", args: ["install", "node"], describe: "brew install node" } : { command: "sudo", args: ["-n", "apt-get", "install", "-y", "nodejs", "npm"], describe: "sudo apt-get install -y nodejs npm", needsSudo: true };
    return {
      kind: "node",
      probeCommand,
      label: "Node.js\uFF08\u63D0\u4F9B npx\uFF09",
      install,
      manualHint: platform === "win32" ? "\u4E5F\u53EF\u4ECE https://nodejs.org \u4E0B\u8F7D LTS \u5B89\u88C5\u5305\u3002" : platform === "darwin" ? "\u4E5F\u53EF\u4ECE https://nodejs.org \u4E0B\u8F7D LTS \u5B89\u88C5\u5305\uFF0C\u6216\u5148\u5B89\u88C5 Homebrew\u3002" : "\u82E5\u53D1\u884C\u7248\u4E0D\u662F Debian/Ubuntu\uFF0C\u8BF7\u7528\u672C\u673A\u5305\u7BA1\u7406\u5668\u5B89\u88C5 nodejs \u4E0E npm\u3002"
    };
  }
  if (executable === "uvx" || executable === "uv") {
    return { kind: "python", probeCommand: executable, label: "uv / uvx\uFF08ShunCode \u5DF2\u5185\u7F6E\uFF09" };
  }
  if (executable === "python" || executable === "python3" || executable === "pipx") {
    const install = platform === "win32" ? { command: "winget", args: ["install", "--id", "Python.Python.3.12", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"], describe: "winget install Python.Python.3.12" } : platform === "darwin" ? { command: "brew", args: ["install", "python"], describe: "brew install python" } : { command: "sudo", args: ["-n", "apt-get", "install", "-y", "python3", "python3-pip"], describe: "sudo apt-get install -y python3 python3-pip", needsSudo: true };
    return { kind: "python", probeCommand: executable, label: "Python 3", install, manualHint: "\u591A\u6570 Python MCP \u670D\u52A1\u5668\u4E5F\u53EF\u6539\u7528 ShunCode \u5185\u7F6E\u7684 uvx \u542F\u52A8\u3002" };
  }
  if (!executable) return { kind: "none", probeCommand: "", label: "" };
  return { kind: "unknown", probeCommand: executable, label: executable, manualHint: `\u8BF7\u786E\u8BA4 ${executable} \u5DF2\u5B89\u88C5\u5E76\u5728 PATH \u4E2D\u3002` };
}
function describeMissingRuntime(plan) {
  const how = plan.install ? `\u5B89\u88C5\u547D\u4EE4\uFF1A${plan.install.describe}\u3002` : "";
  return `\u5BBF\u4E3B\u7F3A\u5C11 ${plan.label || plan.probeCommand}\uFF0Cstdio \u670D\u52A1\u5668\u65E0\u6CD5\u542F\u52A8\u3002${how}${plan.manualHint ?? ""}`.trim();
}
