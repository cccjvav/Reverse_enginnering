// RECONSTRUCTED from src/managed-command-cancellation.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { classifyManagedCommandRisk } from './managed-command-risk.js';

var NATIVE_MANAGED_COMMAND_OWNER_ID = "native-chat";

var DEFAULT_CANCELLATION_LIMIT = 12;

var DEFAULT_CANCELLATION_WINDOW_MS = 6e4;

var DEFAULT_FORCE_PROMPT_LIMIT = 5;

var DEFAULT_FORCE_PROMPT_WINDOW_MS = 6e4;

var DEFAULT_FORCE_PROMPT_COOLDOWN_MS = 1e4;

var DEFAULT_FORCE_RESERVATION_TTL_MS = 5 * 6e4;

function forceCancellationRequiresConfirmation(preview) {
  return preview.status === "running" && preview.riskLevel === "high";
}

function bridgeManagedCommandOwnerId(sessionId) {
  const normalized = sessionId?.trim();
  if (!normalized) throw new Error("MCP_SESSION_UNAVAILABLE: the Bridge MCP session is not initialized.");
  return `bridge:${normalized}`;
}

function managedCommandNotAccessibleError() {
  return new Error(
    "COMMAND_NOT_ACCESSIBLE: command_id is unknown, expired, or belongs to another command-owner scope."
  );
}

function waitForCommandOrGrace(target, graceMs) {
  if (target.status !== "running") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, graceMs);
    timer.unref?.();
    void target.done.then(finish, finish);
  });
}

var PerOwnerCancellationRateLimiter = class {
  constructor(cancellationLimit, cancellationWindowMs, forcePromptLimit, forcePromptWindowMs, forcePromptCooldownMs, forceReservationTtlMs) {
    this.cancellationLimit = cancellationLimit;
    this.cancellationWindowMs = cancellationWindowMs;
    this.forcePromptLimit = forcePromptLimit;
    this.forcePromptWindowMs = forcePromptWindowMs;
    this.forcePromptCooldownMs = forcePromptCooldownMs;
    this.forceReservationTtlMs = forceReservationTtlMs;
  }
  cancellationLimit;
  cancellationWindowMs;
  forcePromptLimit;
  forcePromptWindowMs;
  forcePromptCooldownMs;
  forceReservationTtlMs;
  histories = /* @__PURE__ */ new Map();
  recordCancellation(ownerId, now) {
    const history = this.history(ownerId, now);
    this.prune(history, now);
    if (history.cancellations.length >= this.cancellationLimit) {
      throw new Error("CANCEL_RATE_LIMITED: too many cancellation requests in this command-owner scope.");
    }
    history.cancellations.push(now);
  }
  reserveForcePrompt(ownerId, commandId, now) {
    const history = this.history(ownerId, now);
    this.prune(history, now);
    const previous = history.promptByCommand.get(commandId);
    if (previous !== void 0 && now - previous < this.forcePromptCooldownMs) {
      throw new Error("FORCE_PROMPT_COOLDOWN: wait before requesting another force confirmation for this command.");
    }
    if (history.forcePrompts.length >= this.forcePromptLimit) {
      throw new Error("CANCEL_RATE_LIMITED: too many force-confirmation prompts in this command-owner scope.");
    }
    history.forcePrompts.push(now);
    history.promptByCommand.set(commandId, now);
    history.reservations.set(commandId, now);
  }
  consumeForceReservation(ownerId, commandId, now) {
    const history = this.history(ownerId, now);
    this.prune(history, now);
    if (!history.reservations.delete(commandId)) {
      throw new Error("FORCE_CONFIRMATION_REQUIRED: force cancellation requires a current host-owned local confirmation.");
    }
  }
  releaseOwner(ownerId) {
    this.histories.delete(ownerId);
  }
  history(ownerId, now) {
    this.pruneStaleHistories(now);
    const existing = this.histories.get(ownerId);
    if (existing) {
      existing.lastTouchedAt = now;
      return existing;
    }
    const created = {
      cancellations: [],
      forcePrompts: [],
      promptByCommand: /* @__PURE__ */ new Map(),
      reservations: /* @__PURE__ */ new Map(),
      lastTouchedAt: now
    };
    this.histories.set(ownerId, created);
    return created;
  }
  pruneStaleHistories(now) {
    const historyTtlMs = Math.max(
      this.cancellationWindowMs,
      this.forcePromptWindowMs,
      this.forceReservationTtlMs
    );
    for (const [ownerId, history] of this.histories) {
      this.prune(history, now);
      const empty = history.cancellations.length === 0 && history.forcePrompts.length === 0 && history.promptByCommand.size === 0 && history.reservations.size === 0;
      if (empty && now - history.lastTouchedAt >= historyTtlMs) this.histories.delete(ownerId);
    }
  }
  prune(history, now) {
    history.cancellations = history.cancellations.filter((timestamp) => now - timestamp < this.cancellationWindowMs);
    history.forcePrompts = history.forcePrompts.filter((timestamp) => now - timestamp < this.forcePromptWindowMs);
    for (const [commandId, timestamp] of history.promptByCommand) {
      if (now - timestamp >= this.forcePromptWindowMs) history.promptByCommand.delete(commandId);
    }
    for (const [commandId, timestamp] of history.reservations) {
      if (now - timestamp >= this.forceReservationTtlMs) history.reservations.delete(commandId);
    }
  }
};

var ManagedCommandCanceller = class {
  now;
  waitForGrace;
  limiter;
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.waitForGrace = options.waitForGrace ?? waitForCommandOrGrace;
    this.limiter = new PerOwnerCancellationRateLimiter(
      options.cancellationLimit ?? DEFAULT_CANCELLATION_LIMIT,
      options.cancellationWindowMs ?? DEFAULT_CANCELLATION_WINDOW_MS,
      options.forcePromptLimit ?? DEFAULT_FORCE_PROMPT_LIMIT,
      options.forcePromptWindowMs ?? DEFAULT_FORCE_PROMPT_WINDOW_MS,
      options.forcePromptCooldownMs ?? DEFAULT_FORCE_PROMPT_COOLDOWN_MS,
      options.forceReservationTtlMs ?? DEFAULT_FORCE_RESERVATION_TTL_MS
    );
  }
  preview(target, ownerId) {
    this.assertOwner(target, ownerId);
    const risk = classifyManagedCommandRisk(target.command);
    return {
      commandId: target.id,
      command: target.command,
      cwd: target.cwd,
      status: target.status,
      elapsedMs: Math.max(0, this.now() - target.startedAt),
      riskLevel: risk.level,
      riskReason: risk.reason,
      riskConsequence: risk.consequence
    };
  }
  reserveForcePrompt(target, ownerId) {
    const preview = this.preview(target, ownerId);
    if (preview.status === "running") this.limiter.reserveForcePrompt(ownerId, target.id, this.now());
    return preview;
  }
  releaseOwner(ownerId) {
    this.limiter.releaseOwner(ownerId);
  }
  async cancel(target, request) {
    const preview = this.preview(target, request.ownerId);
    const confirmationRequired = forceCancellationRequiresConfirmation(preview);
    const statusBefore = target.status;
    const alreadyFinished = statusBefore !== "running";
    const alreadyRequested = target.cancelRequestedAt !== void 0;
    if (alreadyFinished) {
      return this.result(target, preview, statusBefore, alreadyRequested, true, false, false);
    }
    this.limiter.recordCancellation(request.ownerId, this.now());
    const interruptSent = alreadyRequested ? false : target.requestInterrupt(this.now());
    await this.waitForGrace(target, request.graceMs);
    if (target.status === "running" && request.force) {
      if (confirmationRequired) {
        if (!request.forceConfirmed) {
          throw new Error("FORCE_CONFIRMATION_REQUIRED: force cancellation requires host-owned local confirmation.");
        }
        this.limiter.consumeForceReservation(request.ownerId, target.id, this.now());
      }
      target.forceClose();
    }
    const forceRequired = target.status === "running";
    return this.result(target, preview, statusBefore, alreadyRequested, false, interruptSent, forceRequired);
  }
  assertOwner(target, ownerId) {
    if (target.ownerId !== ownerId) throw managedCommandNotAccessibleError();
  }
  result(target, preview, statusBefore, alreadyRequested, alreadyFinished, interruptSent, forceRequired) {
    return {
      statusBefore,
      status: target.status,
      exitCode: target.exitCode,
      cancelRequested: target.cancelRequestedAt !== void 0,
      alreadyRequested,
      alreadyFinished,
      interruptSent,
      forceRequired,
      forced: target.cancelForced === true,
      riskLevel: preview.riskLevel,
      riskReason: preview.riskReason,
      terminalReusable: target.terminalReusable
    };
  }
};

export { DEFAULT_CANCELLATION_LIMIT, DEFAULT_CANCELLATION_WINDOW_MS, DEFAULT_FORCE_PROMPT_COOLDOWN_MS, DEFAULT_FORCE_PROMPT_LIMIT, DEFAULT_FORCE_PROMPT_WINDOW_MS, DEFAULT_FORCE_RESERVATION_TTL_MS, ManagedCommandCanceller, NATIVE_MANAGED_COMMAND_OWNER_ID, PerOwnerCancellationRateLimiter, bridgeManagedCommandOwnerId, forceCancellationRequiresConfirmation, managedCommandNotAccessibleError, waitForCommandOrGrace };
