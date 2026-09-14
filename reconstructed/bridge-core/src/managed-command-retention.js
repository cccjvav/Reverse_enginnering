// RECONSTRUCTED from src/managed-command-retention.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var MANAGED_COMMAND_COMPLETED_STATE_TTL_MS = 60 * 60 * 1e3;

var MAX_COMPLETED_COMMAND_STATES_PER_OWNER = 32;

function managedCommandStateIdsToPrune(records, now = Date.now()) {
  const prune = /* @__PURE__ */ new Set();
  const retainedByOwner = /* @__PURE__ */ new Map();
  for (const record3 of records) {
    if (record3.status === "running") continue;
    if (record3.endedAt === void 0 || now - record3.endedAt >= MANAGED_COMMAND_COMPLETED_STATE_TTL_MS) {
      prune.add(record3.id);
      continue;
    }
    const retained = retainedByOwner.get(record3.ownerId) ?? [];
    retained.push(record3);
    retainedByOwner.set(record3.ownerId, retained);
  }
  for (const retained of retainedByOwner.values()) {
    retained.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || a.id.localeCompare(b.id));
    for (const excess of retained.slice(MAX_COMPLETED_COMMAND_STATES_PER_OWNER)) prune.add(excess.id);
  }
  return [...prune];
}

export { MANAGED_COMMAND_COMPLETED_STATE_TTL_MS, MAX_COMPLETED_COMMAND_STATES_PER_OWNER, managedCommandStateIdsToPrune };
