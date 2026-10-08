// EXTRACTED from src/external-mcp-import.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var ID_PATTERN = /^[a-z][a-z0-9_]{1,16}$/;
var PLAIN_OBJECT = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function suggestedExternalMcpId(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const prefixed = /^[a-z]/.test(slug) ? slug : `s_${slug}`;
  return (prefixed.slice(0, 17).replace(/_+$/g, "") || "server").padEnd(2, "x");
}
function validateExternalMcpId(id) {
  if (!ID_PATTERN.test(id)) throw new Error("\u670D\u52A1\u5668 ID \u987B\u4E3A 2-17 \u4F4D\u7684\u5C0F\u5199\u82F1\u6587\u5B57\u6BCD\u3001\u6570\u5B57\u6216\u4E0B\u5212\u7EBF\uFF0C\u4E14\u4EE5\u5B57\u6BCD\u5F00\u5934\u3002");
}
function validateExternalMcpUrl(value) {
  let url2;
  try {
    if (value.includes("${")) throw new Error("unresolved");
    url2 = new URL(value.trim());
  } catch {
    throw new Error("URL \u683C\u5F0F\u9519\u8BEF\u3002");
  }
  if (!["http:", "https:"].includes(url2.protocol) || !url2.hostname || url2.hash || url2.username || url2.password) {
    throw new Error("\u4EC5\u652F\u6301\u65E0\u5185\u5D4C\u7528\u6237\u540D\u3001\u5BC6\u7801\u6216\u7247\u6BB5\u7684 HTTP(S) MCP URL\u3002");
  }
  const loopback = url2.hostname === "localhost" || url2.hostname === "127.0.0.1" || url2.hostname === "[::1]";
  if (url2.protocol === "http:" && !loopback) throw new Error("\u975E\u672C\u673A\u5730\u5740\u9700\u4F7F\u7528 HTTPS\uFF1B\u4E0D\u5411\u660E\u6587 HTTP \u53D1\u9001\u51ED\u636E\u3002");
  return url2;
}
function stringMap(value, field3) {
  if (value === void 0) return void 0;
  if (!PLAIN_OBJECT(value)) throw new Error(`${field3} \u5FC5\u987B\u662F\u952E\u503C\u5B57\u7B26\u4E32\u5BF9\u8C61\u3002`);
  const result = /* @__PURE__ */ Object.create(null);
  if (Object.keys(value).length > 40) throw new Error(`${field3} \u8D85\u8FC7 40 \u9879\u9650\u5236\u3002`);
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 100 || !(field3 === "env" ? /^[A-Za-z_][A-Za-z0-9_]*$/ : /^[A-Za-z][A-Za-z0-9_-]*$/).test(key) || typeof entry !== "string" || entry.length > 4096) {
      throw new Error(`${field3} \u7684\u540D\u79F0\u6216\u503C\u65E0\u6548\u3002`);
    }
    if (field3 === "env" && ["SHUNCODE_MCP_MANAGED", "SHUNCODE_MCP_TIMEOUT_MS"].includes(key.toUpperCase()) || field3 === "headers" && ["host", "content-length", "transfer-encoding", "connection", "mcp-session-id", "mcp-protocol-version", "proxy-authorization", "x-shuncode-managed-streamable-http", "x-shuncode-mcp-timeout-ms", "x-shuncode-mcp-oauth"].includes(key.toLowerCase())) {
      throw new Error(`${field3} \u4F7F\u7528\u4E86 ShunCode \u4FDD\u7559\u7684\u5185\u90E8\u5B57\u6BB5\u3002`);
    }
    if (field3 === "headers" && (/[\r\n\0]/.test(entry) || Object.keys(result).some((name) => name.toLowerCase() === key.toLowerCase()))) throw new Error("headers \u542B\u6362\u884C\u3001\u7A7A\u5B57\u7B26\u6216\u91CD\u590D\u540D\u79F0\u3002");
    if (field3 === "env" && entry.includes("\0")) throw new Error("env \u542B\u7A7A\u5B57\u7B26\u3002");
    if (entry.includes("${")) throw new Error(`${field3} \u5305\u542B\u5C1A\u672A\u89E3\u6790\u7684\u53D8\u91CF\u5F15\u7528\uFF1B\u8BF7\u5148\u63D0\u4F9B\u5B9E\u9645\u503C\u3002`);
    result[key] = entry;
  }
  return result;
}
function splitExternalMcpCommand(line) {
  if (!line.trim() || line.length > 8192 || /[\r\n\0]/.test(line)) throw new Error("\u8BF7\u8F93\u5165\u4E00\u884C\u6709\u6548\u7684\u542F\u52A8\u547D\u4EE4\u3002");
  if (/[|;&<>`]/.test(line) || line.includes("$(") || line.includes("${")) {
    throw new Error("\u547D\u4EE4\u4E2D\u4E0D\u80FD\u4F7F\u7528 shell \u7BA1\u9053\u3001\u91CD\u5B9A\u5411\u6216\u53D8\u91CF\u5C55\u5F00\uFF1B\u8BF7\u6539\u7528\u7ED3\u6784\u5316 JSON\u3002");
  }
  const words = [];
  let word = "", quote, started = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = void 0;
        continue;
      }
      if (ch === "\\" && quote === '"' && line[i + 1] === '"') {
        word += '"';
        i++;
        continue;
      }
      word += ch;
      started = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote) throw new Error("\u547D\u4EE4\u5F15\u53F7\u672A\u95ED\u5408\uFF1B\u8BF7\u6539\u7528\u7ED3\u6784\u5316 JSON\u3002");
  if (started) words.push(word);
  if (!words[0] || words.some((item) => !item || item.length > 4096)) throw new Error("\u547D\u4EE4\u6216\u53C2\u6570\u4E3A\u7A7A/\u8FC7\u957F\u3002");
  if (words.length > 64) throw new Error("\u547D\u4EE4\u53C2\u6570\u8D85\u8FC7 64 \u9879\u9650\u5236\u3002");
  return words;
}
function transportHint(value) {
  if (typeof value !== "string") return void 0;
  switch (value.trim().toLowerCase().replace(/[\s_-]/g, "")) {
    case "stdio":
      return "stdio";
    case "streamablehttp":
    case "streamablehttps":
      return "streamable-http";
    case "sse":
      return "sse";
    case "http":
    case "https":
    case "remote":
    case "auto":
      return "auto";
    default:
      return void 0;
  }
}
function optionalText(value, field3, max) {
  if (value === void 0 || value === "") return void 0;
  if (typeof value !== "string" || value.length > max || value.includes("\0") || field3 === "cwd" && (/[\r\n]/.test(value) || value.includes("${"))) {
    throw new Error(`${field3} \u683C\u5F0F\u65E0\u6548${field3 === "cwd" ? "\uFF0C\u8BF7\u63D0\u4F9B\u5DF2\u89E3\u6790\u7684\u8DEF\u5F84" : ""}\u3002`);
  }
  return value.trim() || void 0;
}
function externalMcpTimeout(value) {
  if (value === void 0 || value === "") return void 0;
  const seconds = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error("\u8D85\u65F6\u987B\u4E3A 1\u20133600 \u79D2\u7684\u6570\u5B57\u3002");
  }
  return seconds;
}
function warn(warnings, name, fields2, reason = "\u5DF2\u5FFD\u7565\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\uFF08\u4EC5\u663E\u793A\u540D\u79F0\uFF0C\u4E0D\u663E\u793A\u503C\uFF09\u3002") {
  if (fields2.length) warnings.push({ name: name.slice(0, 100), fields: fields2, reason });
}
function makeDraft(name, value, warnings) {
  if (!PLAIN_OBJECT(value)) throw new Error("\u670D\u52A1\u5668\u5B9A\u4E49\u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002");
  const allowed = /* @__PURE__ */ new Set(["type", "transport", "command", "args", "env", "cwd", "url", "baseUrl", "headers", "disabled", "enabled", "name", "label", "description", "timeout", "timeoutMs", "authType", "oauth", "oauthClientId", "oauthClientSecret", "oauthScope", "clientId", "clientSecret"]);
  warn(warnings, name, Object.keys(value).filter((field3) => !allowed.has(field3)));
  if (value.disabled === true || value.enabled === false) throw new Error("\u8BE5\u670D\u52A1\u5668\u5DF2\u5728\u6E90\u914D\u7F6E\u4E2D\u505C\u7528\uFF1B\u8BF7\u5148\u542F\u7528\u518D\u5BFC\u5165\u3002");
  const id = suggestedExternalMcpId(name);
  validateExternalMcpId(id);
  const displayName = value.label ?? value.name;
  const label = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 100) : name.slice(0, 100);
  const oauth = parseExternalMcpOAuth(value);
  warn(warnings, name, oauth.ignored, "\u5DF2\u5FFD\u7565 OAuth \u4E2D\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\u53CA\u5BFC\u5165\u7684\u4EE4\u724C\uFF1B\u8BF7\u5728\u672C\u673A\u91CD\u65B0\u6388\u6743\u3002");
  const rawTransport = value.transport ?? value.type;
  const transport = transportHint(rawTransport);
  if (rawTransport !== void 0 && transport === void 0) warn(warnings, name, [value.transport !== void 0 ? "transport" : "type"], "\u672A\u8BC6\u522B\u4F20\u8F93\u63D0\u793A\uFF0C\u5DF2\u6839\u636E URL/command \u81EA\u52A8\u8BC6\u522B\uFF1B\u672A\u663E\u793A\u539F\u59CB\u503C\u3002");
  const description = optionalText(value.description, "description", 2e3);
  const rawTimeout = value.timeout ?? (value.timeoutMs === void 0 ? void 0 : Number(value.timeoutMs) / 1e3);
  const timeout = externalMcpTimeout(rawTimeout);
  const metadata = { ...description ? { description } : {}, ...timeout !== void 0 ? { timeout } : {} };
  const address = value.url ?? value.baseUrl;
  if (address !== void 0) {
    if (typeof address !== "string") throw new Error("URL \u683C\u5F0F\u9519\u8BEF\u3002");
    if (transport === "stdio") throw new Error("URL \u4E0E stdio \u7C7B\u578B\u51B2\u7A81\u3002");
    if (value.command !== void 0 || value.args !== void 0 || value.env !== void 0) throw new Error("HTTP \u914D\u7F6E\u4E0D\u80FD\u540C\u65F6\u5305\u542B stdio \u547D\u4EE4\u3002");
    if (value.cwd !== void 0) warn(warnings, name, ["cwd"], "\u8FDC\u7A0B HTTP/SSE \u670D\u52A1\u6CA1\u6709\u672C\u5730\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u5DF2\u5FFD\u7565 cwd\u3002");
    const url2 = validateExternalMcpUrl(address);
    const headers = stringMap(value.headers, "headers");
    if (oauth.options && Object.keys(headers ?? {}).some((key) => key.toLowerCase() === "authorization")) throw new Error("OAuth \u4E0E\u81EA\u5B9A\u4E49 Authorization \u4E0D\u80FD\u540C\u65F6\u8BBE\u7F6E\uFF1B\u5176\u4ED6\u8BF7\u6C42\u5934\u53EF\u4EE5\u4FDD\u7559\u3002");
    return {
      id,
      label,
      transport: "http",
      httpTransport: transport ?? "auto",
      url: url2.toString(),
      headers,
      ...metadata,
      ...oauth.options ? { authType: "oauth", oauth: oauth.options, oauthClientSecret: oauth.clientSecret } : {}
    };
  }
  if (oauth.options) throw new Error("OAuth \u4EC5\u9002\u7528\u4E8E HTTP/SSE \u670D\u52A1\u3002");
  if (transport && transport !== "stdio") throw new Error("\u8FDC\u7A0B MCP \u7F3A\u5C11 URL\u3002");
  if (typeof value.command !== "string" || !value.command.trim() || /[\r\n\0]/.test(value.command) || value.command.length > 4096) throw new Error("stdio MCP \u7F3A\u5C11\u6709\u6548 command\u3002");
  if (value.headers !== void 0) throw new Error("stdio \u4E0D\u652F\u6301 headers\u3002");
  if (value.args !== void 0 && (!Array.isArray(value.args) || value.args.length > 64 || value.args.some((arg) => typeof arg !== "string" || arg.length > 4096 || /[\r\n\0]/.test(arg)))) {
    throw new Error("stdio args \u5FC5\u987B\u662F\u6700\u591A 64 \u9879\u7684\u5B57\u7B26\u4E32\u6570\u7EC4\u3002");
  }
  if (value.command.includes("${") || value.args?.some((arg) => arg.includes("${"))) throw new Error("\u547D\u4EE4\u5305\u542B\u5C1A\u672A\u89E3\u6790\u7684\u53D8\u91CF\u5F15\u7528\u3002");
  const cwd = optionalText(value.cwd, "cwd", 4096);
  return { id, label, transport: "stdio", command: value.command.trim(), args: value.args ?? [], env: stringMap(value.env, "env"), ...cwd ? { cwd } : {}, ...metadata };
}
function previewExternalMcpImport(input) {
  const raw = input.trim();
  const warnings = [];
  if (!raw || raw.length > 64e3) return { entries: [], errors: [{ name: "\u8F93\u5165", reason: "\u8BF7\u8F93\u5165 64 KB \u4EE5\u5185\u7684 URL\u3001\u547D\u4EE4\u6216 MCP JSON\u3002" }], warnings };
  try {
    let definitions;
    if (/^https?:\/\//i.test(raw)) {
      const url2 = validateExternalMcpUrl(raw);
      definitions = [[url2.hostname, { url: raw }]];
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      throw new Error("\u4EC5\u652F\u6301 HTTP(S) MCP URL\uFF0C\u4E0D\u652F\u6301\u5176\u4ED6\u534F\u8BAE\u3002");
    } else if (raw.startsWith("{")) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("JSON \u683C\u5F0F\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u62EC\u53F7\u3001\u9017\u53F7\u548C\u5F15\u53F7\u3002");
      }
      if (!PLAIN_OBJECT(parsed)) throw new Error("\u914D\u7F6E\u987B\u4E3A JSON \u5BF9\u8C61\u3002");
      const root = parsed.mcpServers ?? parsed.servers;
      if (root !== void 0) {
        if (parsed.mcpServers !== void 0 && parsed.servers !== void 0) throw new Error("\u8BF7\u53EA\u63D0\u4F9B mcpServers \u6216 servers \u4E2D\u7684\u4E00\u79CD\u3002");
        const allowed = /* @__PURE__ */ new Set(["mcpServers", "servers", "$schema"]);
        warn(warnings, "JSON \u6839\u8282\u70B9", Object.keys(parsed).filter((key) => !allowed.has(key)), "\u5DF2\u5FFD\u7565\u6839\u8282\u70B9\u9644\u52A0\u5B57\u6BB5\uFF1B\u4E0D\u4F1A\u6267\u884C inputs\uFF0C\u5F15\u7528\u7684\u53D8\u91CF\u4ECD\u987B\u5148\u586B\u5165\u5B9E\u9645\u503C\u3002");
        if (!PLAIN_OBJECT(root)) throw new Error("mcpServers/servers \u987B\u4E3A\u952E\u503C\u5BF9\u8C61\u3002");
        definitions = Object.entries(root);
      } else {
        if (typeof parsed.name !== "string" || !parsed.name.trim()) throw new Error("\u5355\u9879 JSON \u9700\u586B\u5199 name \u5B57\u6BB5\u3002");
        const { name, ...single } = parsed;
        definitions = [[name, single]];
      }
    } else {
      const [command, ...args] = splitExternalMcpCommand(raw);
      const pkg = args.find((arg) => /^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/i.test(arg) && !arg.startsWith("-"));
      definitions = [[pkg || command.split(/[\\/]/).pop() || "server", { command, args }]];
    }
    if (definitions.length < 1 || definitions.length > 20) throw new Error("\u6BCF\u6279\u5E94\u5305\u542B 1-20 \u4E2A MCP \u670D\u52A1\u3002");
    const entries = [];
    const errors = [];
    const ids = /* @__PURE__ */ new Set();
    for (const [name, value] of definitions) {
      try {
        const draft = makeDraft(name, value, warnings);
        if (ids.has(draft.id)) throw new Error(`\u540D\u79F0\u8F6C\u6362\u540E\u7684 ID ${draft.id} \u91CD\u590D\uFF1B\u8BF7\u4FEE\u6539\u952E\u540D\u3002`);
        ids.add(draft.id);
        entries.push(draft);
      } catch (error2) {
        errors.push({ name: name.slice(0, 100), reason: error2 instanceof Error ? error2.message : "\u914D\u7F6E\u65E0\u6548\u3002" });
      }
    }
    return { entries, errors, warnings };
  } catch (error2) {
    return { entries: [], errors: [{ name: "\u8F93\u5165", reason: error2 instanceof Error ? error2.message : "\u65E0\u6CD5\u89E3\u6790\u3002" }], warnings };
  }
}
