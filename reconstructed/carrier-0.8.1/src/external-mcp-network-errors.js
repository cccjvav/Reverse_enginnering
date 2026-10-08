// EXTRACTED from src/external-mcp-network-errors.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var DNS = /* @__PURE__ */ new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);
var CONNECT = /* @__PURE__ */ new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "UND_ERR_SOCKET"]);
var TIMEOUT = /* @__PURE__ */ new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "REQUEST_TIMEOUT"]);
var PROXY_PROTOCOL = /* @__PURE__ */ new Set(["EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PACKET_LENGTH_TOO_LONG", "HPE_INVALID_CONSTANT", "UND_ERR_PROXY_TUNNEL"]);
var CERTIFICATE = /* @__PURE__ */ new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_NOT_YET_VALID"
]);
var PROTOCOL = /* @__PURE__ */ new Set(["CLIENT_HTTP_UNEXPECTED_CONTENT", "INVALID_RESULT", "NOT_INITIALIZED", "ERA_NEGOTIATION_FAILED", "CLIENT_HTTP_NOT_IMPLEMENTED"]);
var MESSAGES = {
  dns: "\u65E0\u6CD5\u89E3\u6790\u670D\u52A1\u5668\u5730\u5740\uFF1B\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u4EE3\u7406\u7684\u8FDC\u7A0B DNS\u3002",
  connect: "\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668\uFF1B\u5982\u9700\u4EE3\u7406\uFF0C\u8BF7\u5F00\u542F\u4EE3\u7406\u8F6F\u4EF6\u7684\u7CFB\u7EDF\u4EE3\u7406\u6216\u8BBE\u7F6E http.proxy\u3002",
  timeout: "\u8FDE\u63A5\u8D85\u65F6\uFF1B\u8BF7\u68C0\u67E5\u7F51\u7EDC\u3001\u4EE3\u7406\u6216\u670D\u52A1\u72B6\u6001\u540E\u91CD\u8BD5\u3002",
  "proxy-auth": "\u4EE3\u7406\u9700\u8981\u8BA4\u8BC1\uFF1B\u8BF7\u5728 http.proxy \u4E2D\u63D0\u4F9B\u51ED\u636E\u3002",
  "proxy-protocol": "\u4EE3\u7406\u7AEF\u53E3\u7684\u534F\u8BAE\u6216\u6A21\u5F0F\u4E0D\u7B26\uFF08\u4F8B\u5982\u628A SOCKS \u7AEF\u53E3\u5F53\u4F5C HTTP \u7AEF\u53E3\uFF09\uFF1B\u8BF7\u68C0\u67E5\u4EE3\u7406\u8BBE\u7F6E\u3002",
  certificate: "\u8BC1\u4E66\u6821\u9A8C\u5931\u8D25\uFF1B\u4F01\u4E1A\u7F51\u7EDC\u8BF7\u786E\u8BA4\u6839\u8BC1\u4E66\u5DF2\u88C5\u5165\u7CFB\u7EDF\uFF0C\u4E14 http.systemCertificates \u5DF2\u5F00\u542F\u3002",
  auth: "\u9700\u8981\u8BBE\u7F6E\u5BC6\u94A5\uFF1A\u4E0A\u6E38\u62D2\u7EDD\u4E86\u5F53\u524D\u51ED\u636E\uFF08HTTP 401/403\uFF09\u3002",
  http: "\u4E0A\u6E38\u8FD4\u56DE\u4E86\u9519\u8BEF\u72B6\u6001\uFF1B\u8BF7\u68C0\u67E5\u5730\u5740\u6216\u670D\u52A1\u72B6\u6001\u3002",
  protocol: "\u5730\u5740\u53EF\u8FBE\uFF0C\u4F46\u4E0D\u662F Streamable HTTP MCP \u670D\u52A1\u3002",
  unknown: "\u4E0A\u6E38\u4E0D\u53EF\u7528\uFF1B\u8BF7\u68C0\u67E5\u5730\u5740\u3001\u6743\u9650\u6216\u542F\u52A8\u547D\u4EE4\u3002"
};
function field(value, name) {
  return value && typeof value === "object" ? value[name] : void 0;
}
function httpStatus(error2) {
  const holder = error2 && typeof error2 === "object" ? error2 : void 0;
  for (const candidate of [error2, holder?.data, holder?.cause]) {
    const status = field(candidate, "status");
    if (typeof status === "number" && status >= 100 && status < 600) return status;
  }
  return void 0;
}
function codes(error2) {
  const found = [];
  let current = error2;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = field(current, "code");
    if (typeof code === "string") found.push(code.toUpperCase());
    current = current.cause;
  }
  return found;
}
function messages(error2) {
  const parts = [];
  let current = error2;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const message2 = current.message;
    if (typeof message2 === "string") parts.push(message2);
    current = current.cause;
  }
  return parts.join("\n");
}
function attribution(category, status) {
  const failure2 = category === "auth" ? "needs-auth" : category === "proxy-auth" || category === "proxy-protocol" ? "proxy-error" : "failed";
  const message2 = category === "http" && status ? `\u4E0A\u6E38\u8FD4\u56DE HTTP ${status}\uFF1B\u8BF7\u68C0\u67E5\u5730\u5740\u6216\u670D\u52A1\u72B6\u6001\u3002` : MESSAGES[category];
  return { category, status: failure2, message: message2 };
}
function classifyExternalMcpError(error2) {
  const status = httpStatus(error2);
  const all = codes(error2);
  const text2 = messages(error2);
  if (status === 407 || /Proxy response \(407\)/.test(text2)) return attribution("proxy-auth");
  if (/Proxy response \((?!200)\d{3}\)/.test(text2)) return attribution("proxy-protocol");
  if (status === 401 || status === 403 || all.includes("CLIENT_HTTP_AUTHENTICATION") || all.includes("CLIENT_HTTP_FORBIDDEN")) return attribution("auth");
  if (all.some((code) => CERTIFICATE.has(code))) return attribution("certificate");
  if (all.some((code) => PROXY_PROTOCOL.has(code)) || /wrong version number/i.test(text2)) return attribution("proxy-protocol");
  if (all.some((code) => DNS.has(code))) return attribution("dns");
  if (all.some((code) => TIMEOUT.has(code)) || field(error2, "name") === "TimeoutError" || field(error2, "name") === "AbortError") return attribution("timeout");
  if (all.some((code) => CONNECT.has(code))) return attribution("connect");
  if (all.some((code) => PROTOCOL.has(code))) return attribution("protocol");
  if (status !== void 0) return attribution("http", status);
  return attribution("unknown");
}
function externalMcpErrorLogLine(serverId, phase, error2) {
  return `[external-mcp] ${serverId}: ${phase} failed (${classifyExternalMcpError(error2).category})`;
}
