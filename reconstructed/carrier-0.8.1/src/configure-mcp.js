// EXTRACTED from src/configure-mcp.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var KNOWN_ACTIONS = /* @__PURE__ */ new Set(["add", "list", "remove", "test", "where"]);
var INSTALL_TIMEOUT_MS = 15 * 6e4;
var DEFAULT_VERIFY_TIMEOUT_MS = 18e4;
var VERIFY_POLL_MS = 1500;
function readBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
async function ensureRuntimes(entries, deps, allowInstall) {
  const runtime = deps.runtime;
  const notes = [];
  if (!runtime) return { ok: true, notes };
  const seen = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (entry.transport !== "stdio" || !entry.command) continue;
    const plan = planRuntime(entry.command, entry.args ?? [], runtime.platform ?? process.platform);
    if (plan.kind === "none" || !plan.probeCommand || seen.has(plan.probeCommand)) continue;
    seen.add(plan.probeCommand);
    if (await runtime.which(plan.probeCommand)) continue;
    if (!allowInstall || !plan.install) {
      return { ok: false, text: `${describeMissingRuntime(plan)} \u5B89\u88C5\u540E\u91CD\u8BD5 action="add"\uFF0C\u6216\u5148\u7528 action="test" \u590D\u67E5\u3002` };
    }
    notes.push(`\u5BBF\u4E3B\u7F3A\u5C11 ${plan.label}\uFF0C\u6B63\u5728\u6267\u884C ${plan.install.describe}\u2026`);
    const result = await runtime.install(plan.install.command, plan.install.args, INSTALL_TIMEOUT_MS);
    const installed = result.ok && await runtime.which(plan.probeCommand);
    if (!installed) {
      const tail = result.output.trim().split("\n").slice(-6).join("\n");
      const sudo = plan.install.needsSudo ? "\uFF08\u8BE5\u547D\u4EE4\u9700\u8981 sudo \u6743\u9650\uFF0C\u65E0\u4EBA\u503C\u5B88\u65F6\u4F1A\u5931\u8D25\uFF09" : "";
      return {
        ok: false,
        text: `\u81EA\u52A8\u5B89\u88C5 ${plan.label} \u672A\u6210\u529F${sudo}\uFF0C\u672A\u5199\u5165\u4EFB\u4F55\u914D\u7F6E\u3002\u8BF7\u5728\u7CFB\u7EDF\u7EC8\u7AEF\u6267\u884C\uFF1A${plan.install.describe}
${plan.manualHint ?? ""}
\u5B89\u88C5\u8F93\u51FA\uFF08\u672B\u5C3E\uFF09\uFF1A
${tail}`.trim()
      };
    }
    notes.push(`${plan.label} \u5B89\u88C5\u5B8C\u6210\u3002`);
  }
  return { ok: true, notes };
}
async function verifyImported(ids, deps, timeoutMs) {
  const wait = deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline2 = Date.now() + Math.max(0, timeoutMs);
  let health = new Map(deps.health().map((entry) => [entry.id, entry]));
  while (Date.now() < deadline2 && ids.some((id) => health.has(id) && !["ready", "error"].includes(health.get(id).state))) {
    await wait(Math.min(VERIFY_POLL_MS, deadline2 - Date.now()));
    health = new Map(deps.health().map((entry) => [entry.id, entry]));
  }
  return ids.map((id) => health.get(id) ?? {
    id,
    state: "error",
    toolCount: 0,
    error: '\u672A\u8BFB\u53D6\u5230\u8FDE\u63A5\u72B6\u6001\uFF1B\u8BF7\u7528 action="test" \u590D\u67E5\u3002'
  });
}
function locationLine(deps) {
  const at = deps.locations?.();
  if (!at) return "";
  const state = at.configExists ? "\u5DF2\u5B58\u5728" : "\u5C1A\u672A\u521B\u5EFA\uFF08\u9996\u6B21\u914D\u7F6E\u65F6\u81EA\u52A8\u751F\u6210\uFF09";
  return `
\u914D\u7F6E\u6587\u4EF6\uFF1A${at.configPath}\uFF08${state}\uFF09`;
}
function describeLocations(deps) {
  const at = deps.locations?.();
  if (!at) {
    return { isError: true, text: "\u672C\u6B21\u8FD0\u884C\u672A\u63D0\u4F9B\u914D\u7F6E\u6587\u4EF6\u4F4D\u7F6E\u4FE1\u606F\u3002" };
  }
  const lines = [
    `\u914D\u7F6E\u6587\u4EF6\uFF1A${at.configPath}`,
    `\u72B6\u6001\uFF1A${at.configExists ? "\u5DF2\u5B58\u5728" : "\u5C1A\u672A\u521B\u5EFA\uFF08\u9996\u6B21\u7528 action=add \u914D\u7F6E\u65F6\u81EA\u52A8\u751F\u6210\uFF09"}`
  ];
  if (at.skillsDirectory) {
    lines.push(`Skill \u5168\u5C40\u76EE\u5F55\uFF08\u914D\u7F6E\u6587\u4EF6\u9ED8\u8BA4\u653E\u5728\u5176\u4E2D\uFF09\uFF1A${at.skillsDirectory}`);
    if (at.skillDirectoryWritable === false) {
      lines.push("\u8BE5 Skill \u76EE\u5F55\u5F53\u524D\u4E0D\u53EF\u5199\uFF08\u4F8B\u5982\u7CFB\u7EDF\u5B89\u88C5\u8DEF\u5F84\uFF09\uFF0C\u56E0\u6B64\u914D\u7F6E\u6587\u4EF6\u56DE\u843D\u5230\u7528\u6237\u4E3B\u76EE\u5F55\u3002");
    }
  }
  if (at.legacyPath && at.legacyPath !== at.configPath) {
    lines.push(`\u65E7\u4F4D\u7F6E\uFF1A${at.legacyPath}${at.legacyExists ? "\uFF08\u4ECD\u5B58\u5728\uFF0C\u4E0B\u6B21\u8BFB\u5199\u65F6\u81EA\u52A8\u8FC1\u79FB\uFF09" : "\uFF08\u4E0D\u5B58\u5728\uFF09"}`);
  }
  if (at.migratedFrom) lines.push(`\u672C\u6B21\u5DF2\u4ECE\u65E7\u4F4D\u7F6E\u8FC1\u79FB\uFF1A${at.migratedFrom}\uFF08\u539F\u6587\u4EF6\u4FDD\u7559\u4E3A .migrated.bak\uFF09`);
  if (at.secretStorage) lines.push(`\u5BC6\u94A5\u5B58\u50A8\uFF1A${at.secretStorage}\uFF08\u5BC6\u94A5\u4E0D\u5199\u5165\u8BE5 JSON\uFF0C\u4E5F\u4E0D\u4F1A\u88AB\u56DE\u663E\uFF09`);
  lines.push("\u8BE5\u6587\u4EF6\u5C5E\u4E8E\u6240\u8FDE\u63A5\u7684\u4E3B\u673A\uFF0C\u4E0D\u662F\u804A\u5929\u6C99\u7BB1\uFF1B\u53EF\u7528 read_files / run_command \u6309\u4E0A\u9762\u7684\u7EDD\u5BF9\u8DEF\u5F84\u67E5\u770B\u3002");
  return { structuredContent: { locations: at }, text: lines.join("\n") };
}
function readConfig(value) {
  if (typeof value === "string") return value.trim() || void 0;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return void 0;
    }
  }
  return void 0;
}
function describeErrors(errors) {
  return errors.map((error2) => `${error2.name}: ${error2.reason}`).join("; ");
}
async function runConfigureMcp(action, args, deps) {
  if (!KNOWN_ACTIONS.has(action)) {
    return { isError: true, text: `Unknown configure_mcp action: ${action || "(empty)"}. Use add, list, remove, test or where.` };
  }
  switch (action) {
    case "add":
      return addServer(args, deps);
    case "remove":
      return removeServer(args, deps);
    case "test":
      return testServers(args, deps);
    case "where":
      return describeLocations(deps);
    default:
      return listServers(deps);
  }
}
async function addServer(args, deps) {
  const config2 = readConfig(args.config);
  if (!config2) {
    return { isError: true, text: "configure_mcp add \u9700\u8981 config\uFF1A\u4E00\u6BB5 mcpServers JSON\u3001\u4E00\u4E2A HTTPS \u7F51\u5740\uFF0C\u6216\u4E00\u884C\u542F\u52A8\u547D\u4EE4\uFF08\u53EF\u628A API \u5BC6\u94A5\u76F4\u63A5\u5185\u8054\uFF09\u3002" };
  }
  const target = args.target === "bridge" ? "bridge" : "both";
  const preview = deps.catalog.preview(config2);
  if (preview.entries.length === 0) {
    const reason = describeErrors(preview.errors) || "\u672A\u80FD\u8BC6\u522B\u4EFB\u4F55 MCP \u670D\u52A1\u3002";
    return { isError: true, text: `\u65E0\u6CD5\u914D\u7F6E MCP\uFF1A${reason}` };
  }
  const ids = preview.entries.map((entry) => entry.id);
  const selected = new Set(ids);
  const runtimeEntries = previewExternalMcpImport(config2).entries.filter((entry) => selected.has(entry.id)).map(({ id, label, transport, command, args: args2 }) => ({ id, label, transport, command, args: args2 }));
  const ready = await ensureRuntimes(runtimeEntries, deps, readBoolean(args.install_runtime, true));
  if (!ready.ok) return { isError: true, text: ready.text };
  const { imported } = await deps.catalog.import(config2, preview.token, ids, target, args.secrets);
  const verify = readBoolean(args.verify, true);
  const timeout = typeof args.verify_timeout_ms === "number" && args.verify_timeout_ms > 0 ? Math.min(args.verify_timeout_ms, 10 * 6e4) : DEFAULT_VERIFY_TIMEOUT_MS;
  const deadline2 = Date.now() + timeout;
  await deps.refresh(verify ? { ids: imported.map((server) => server.id), connectTimeoutMs: timeout } : void 0);
  const added = imported.map((server) => `${server.label} (${server.id})`).join("\u3001");
  const skipped = preview.errors.length ? ` \u8DF3\u8FC7\uFF1A${describeErrors(preview.errors)}\u3002` : "";
  const head = `${`\u5DF2\u914D\u7F6E\u5E76\u542F\u7528 ${imported.length} \u4E2A MCP \u670D\u52A1\uFF1A${added}\u3002${skipped}`.trim()}`;
  const notes = ready.notes.length ? `
${ready.notes.join("\n")}` : "";
  if (!verify) {
    return {
      structuredContent: { imported, skipped: preview.errors, target, verified: false, locations: deps.locations?.() },
      text: `${head}${notes}\uFF08\u672A\u9A8C\u8BC1\u8FDE\u63A5\uFF09${locationLine(deps)}`
    };
  }
  const health = await verifyImported(imported.map((server) => server.id), deps, Math.max(0, deadline2 - Date.now()));
  const lines = health.map((entry) => {
    const parts = [`${entry.id}: ${entry.state}`];
    if (entry.state === "ready") parts.push(`${entry.toolCount} \u4E2A\u5DE5\u5177`);
    if (entry.error) parts.push(entry.error);
    return `- ${parts.join(" \xB7 ")}`;
  });
  const failed = health.filter((entry) => entry.state !== "ready");
  const verified = health.length === imported.length && failed.length === 0;
  const verdict = health.length === 0 ? '\n\u672A\u80FD\u8BFB\u53D6\u8FDE\u63A5\u72B6\u6001\uFF0C\u8BF7\u7528 action="test" \u590D\u67E5\u3002' : failed.length === 0 ? `
\u8FDE\u63A5\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u5DE5\u5177\u5DF2\u53EF\u76F4\u63A5\u4F7F\u7528\u3002` : `
\u4EE5\u4E0B\u670D\u52A1\u5C1A\u672A\u5C31\u7EEA\uFF0C\u914D\u7F6E\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u534F\u52A9\u5904\u7406\u540E\u7528 action="test" \u91CD\u8BD5\uFF1A${failed.map((entry) => entry.id).join("\u3001")}\u3002\u9996\u6B21\u542F\u52A8\u9700\u8981\u4E0B\u8F7D\u4F9D\u8D56\u65F6\u53EF\u80FD\u8F83\u6162\uFF1B\u4E5F\u8BF7\u68C0\u67E5\u7F51\u7EDC\u3001\u4EE3\u7406\u4E0E API \u5BC6\u94A5\u662F\u5426\u6B63\u786E\u3002`;
  return {
    isError: verified ? void 0 : true,
    structuredContent: { imported, skipped: preview.errors, target, verified, health, locations: deps.locations?.() },
    text: `${head}${notes}
${lines.join("\n")}${verdict}${locationLine(deps)}`
  };
}
function listServers(deps) {
  const { servers } = deps.catalog.snapshot();
  const health = new Map(deps.health().map((entry) => [entry.id, entry]));
  const items = servers.map((server) => {
    const state = health.get(server.id);
    return {
      id: server.id,
      label: server.label,
      transport: server.transport,
      enabled: server.enabled && server.bridgeEnabled,
      ...state ? { status: state.state, tools: state.toolCount } : {}
    };
  });
  if (items.length === 0) {
    return {
      structuredContent: { servers: [], locations: deps.locations?.() },
      text: `\u5F53\u524D\u6CA1\u6709\u5DF2\u914D\u7F6E\u7684\u5916\u90E8 MCP \u670D\u52A1\u3002${locationLine(deps)}`
    };
  }
  const text2 = items.map((item) => {
    const parts = [`${item.label} (${item.id})`, item.transport];
    if (!item.enabled) parts.push("\u5DF2\u505C\u7528");
    if ("status" in item && item.status) parts.push(String(item.status));
    if ("tools" in item && typeof item.tools === "number") parts.push(`${item.tools} \u4E2A\u5DE5\u5177`);
    return `- ${parts.join(" \xB7 ")}`;
  }).join("\n");
  return { structuredContent: { servers: items, locations: deps.locations?.() }, text: `${text2}${locationLine(deps)}` };
}
async function removeServer(args, deps) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return { isError: true, text: 'configure_mcp remove \u9700\u8981 id\uFF1B\u5148\u7528 action="list" \u67E5\u770B\u5F53\u524D\u914D\u7F6E\u3002' };
  if (!deps.catalog.snapshot().servers.some((server) => server.id === id)) {
    return { isError: true, text: `\u672A\u627E\u5230 MCP \u670D\u52A1 ${id}\uFF1B\u7528 action="list" \u67E5\u770B\u5F53\u524D\u914D\u7F6E\u3002` };
  }
  await deps.catalog.remove(id);
  await deps.refresh();
  return {
    structuredContent: { removed: id, locations: deps.locations?.() },
    text: `\u5DF2\u5220\u9664 MCP \u670D\u52A1 ${id} \u5E76\u6E05\u9664\u5176\u51ED\u636E\u3002${locationLine(deps)}`
  };
}
async function testServers(args, deps) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (id && !deps.catalog.snapshot().servers.some((server) => server.id === id)) {
    return { isError: true, text: `\u672A\u627E\u5230 MCP \u670D\u52A1 ${id}\uFF1B\u7528 action="list" \u67E5\u770B\u5F53\u524D\u914D\u7F6E\u3002` };
  }
  await deps.refresh();
  const health = deps.health();
  const scoped = id ? health.filter((entry) => entry.id === id) : health;
  if (scoped.length === 0) {
    return { structuredContent: { health: [] }, text: id ? `${id} \u672A\u542F\u7528\uFF0C\u6CA1\u6709\u53EF\u6D4B\u8BD5\u7684\u8FDE\u63A5\u3002` : "\u6CA1\u6709\u53EF\u6D4B\u8BD5\u7684\u5DF2\u542F\u7528 MCP \u670D\u52A1\u3002" };
  }
  const lines = scoped.map((entry) => {
    const parts = [`${entry.id}: ${entry.state}`];
    if (entry.state === "ready") parts.push(`${entry.toolCount} \u4E2A\u5DE5\u5177`);
    if (entry.error) parts.push(entry.error);
    return `- ${parts.join(" \xB7 ")}`;
  });
  const anyError = scoped.some((entry) => entry.state === "error");
  return { isError: anyError || void 0, structuredContent: { health: scoped }, text: lines.join("\n") };
}
