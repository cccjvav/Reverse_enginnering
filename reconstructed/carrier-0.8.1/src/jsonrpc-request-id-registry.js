// EXTRACTED from src/jsonrpc-request-id-registry.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

function keyOf2(id) {
  return `${typeof id}:${String(id)}`;
}
function requestIdOf(message2) {
  if (!message2 || typeof message2 !== "object") return void 0;
  const candidate = message2;
  if (typeof candidate.method !== "string") return void 0;
  return typeof candidate.id === "string" || typeof candidate.id === "number" ? candidate.id : void 0;
}
function requestIdsOfRequest(body) {
  const messages2 = Array.isArray(body) ? body : [body];
  return messages2.flatMap((message2) => {
    const id = requestIdOf(message2);
    return id === void 0 ? [] : [id];
  });
}
var JsonRpcRequestIdRegistry = class {
  active = /* @__PURE__ */ new Set();
  claim(ids) {
    const seen = /* @__PURE__ */ new Set();
    for (const id of ids) {
      const key = keyOf2(id);
      if (seen.has(key) || this.active.has(key)) {
        return { ok: false, conflictId: id };
      }
      seen.add(key);
    }
    seen.forEach((key) => this.active.add(key));
    return { ok: true };
  }
  release(ids) {
    ids.forEach((id) => this.active.delete(keyOf2(id)));
  }
};
