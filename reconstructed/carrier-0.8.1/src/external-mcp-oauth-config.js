// EXTRACTED from src/external-mcp-oauth-config.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var EXTERNAL_MCP_OAUTH_PORT = 17947;
var EXTERNAL_MCP_OAUTH_PATH = "/shuncode/mcp/oauth/callback";
var plain = (value) => !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
var text = (value, name, maximum, opaque = false) => {
  if (value === void 0 || value === "") return void 0;
  if (typeof value !== "string" || value.length > maximum || /[\r\n\0]/.test(value) || value.includes("${")) throw new Error(`OAuth ${name} \u65E0\u6548\uFF0C\u8BF7\u586B\u5199\u5B9E\u9645\u503C\u3002`);
  return (opaque ? value : value.trim()) || void 0;
};
function parseExternalMcpOAuth(value) {
  const type = typeof value.authType === "string" ? value.authType.toLowerCase() : void 0;
  const enabled = type === "oauth" || type === "oauth2" || type === "oauth2.1" || type === void 0 && (value.oauth === true || plain(value.oauth));
  if (!enabled) return { ignored: [] };
  if (value.oauth !== void 0 && value.oauth !== true && !plain(value.oauth)) throw new Error("OAuth \u914D\u7F6E\u987B\u4E3A\u5BF9\u8C61\u6216 true\u3002");
  const nested = plain(value.oauth) ? value.oauth : {};
  const allowed = /* @__PURE__ */ new Set(["clientId", "clientSecret", "scope", "redirectPort"]);
  const ignored = Object.keys(nested).filter((key) => !allowed.has(key)).map((key) => `oauth.${key}`);
  const clientId = text(value.oauthClientId ?? value.clientId ?? nested.clientId, "Client ID", 1024);
  const clientSecret = text(value.oauthClientSecret ?? value.clientSecret ?? nested.clientSecret, "Client Secret", 4096, true);
  const scope = text(value.oauthScope ?? nested.scope, "Scope", 2048);
  if (scope && !/^[\x21\x23-\x5B\x5D-\x7E]+(?: +[\x21\x23-\x5B\x5D-\x7E]+)*$/.test(scope)) throw new Error("OAuth Scope \u5E94\u4E3A\u7A7A\u683C\u5206\u9694\u7684\u6709\u6548\u6743\u9650\u540D\u79F0\u3002");
  const rawPort = nested.redirectPort;
  const redirectPort = rawPort === void 0 ? void 0 : Number(rawPort);
  if (redirectPort !== void 0 && (!Number.isInteger(redirectPort) || redirectPort < 1024 || redirectPort > 65535)) throw new Error("OAuth \u56DE\u8C03\u7AEF\u53E3\u987B\u4E3A 1024\u201365535 \u7684\u6574\u6570\u3002");
  if (clientSecret && !clientId) throw new Error("\u586B\u5199 OAuth Client Secret \u65F6\u4E5F\u987B\u586B\u5199 Client ID\u3002");
  return { options: { ...clientId ? { clientId } : {}, ...scope ? { scope } : {}, ...redirectPort !== void 0 ? { redirectPort } : {} }, clientSecret, ignored };
}
