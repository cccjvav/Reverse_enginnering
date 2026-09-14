// RECONSTRUCTED from src/jsonrpc-request-id-registry.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


function keyOf(id) {
  return `${typeof id}:${String(id)}`;
}

function requestIdOf(message) {
  if (!message || typeof message !== "object") return void 0;
  const candidate = message;
  if (typeof candidate.method !== "string") return void 0;
  return typeof candidate.id === "string" || typeof candidate.id === "number" ? candidate.id : void 0;
}

function requestIdsOfRequest(body) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    const id = requestIdOf(message);
    return id === void 0 ? [] : [id];
  });
}

var JsonRpcRequestIdRegistry = class {
  active = /* @__PURE__ */ new Set();
  claim(ids) {
    const seen = /* @__PURE__ */ new Set();
    for (const id of ids) {
      const key = keyOf(id);
      if (seen.has(key) || this.active.has(key)) {
        return { ok: false, conflictId: id };
      }
      seen.add(key);
    }
    seen.forEach((key) => this.active.add(key));
    return { ok: true };
  }
  release(ids) {
    ids.forEach((id) => this.active.delete(keyOf(id)));
  }
};

export { JsonRpcRequestIdRegistry, keyOf, requestIdOf, requestIdsOfRequest };
