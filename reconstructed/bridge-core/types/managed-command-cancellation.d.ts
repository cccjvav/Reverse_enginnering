// Hand-written types for reconstructed/bridge-core/src/managed-command-cancellation.js
//
// PROVENANCE. The original .ts for this module was never shipped, so unlike the
// Electron 44 clipboard work these types are reconstructed rather than read
// back. Each one is justified below, and the justification matters more than
// the type: a plausible-looking wrong type is worse than `any`, because it
// stops the compiler from asking.
//
//   FIRST-HAND  The names ManagedCommandCancellationTarget and
//               ManagedCommandCancellationPreview are the author's own,
//               imported as types by recovered src/ide-tool-broker.ts.
//               ide-tool-broker.ts:1712 constructs a Target literal, which
//               fixes its member set exactly, and line 59 declares the status
//               union verbatim.
//   OBSERVED    Field names and value domains read off the shipped
//               implementation: preview() at line 156 and result() at line 205
//               return object literals, and classifyManagedCommandRisk only
//               ever yields level "normal" or "high".
//   INFERRED    Optionality. riskReason/riskConsequence are optional because
//               ide-tool-broker.ts:1752-1755 guards them with `?` and `??`.

/** Terminal lifecycle states, as declared in ide-tool-broker.ts:59. */
export type ManagedCommandStatus =
	| 'running'
	| 'completed'
	| 'failed'
	| 'killed'
	| 'cancelled';

/** Risk classification. classify... only ever produces these two levels. */
export type ManagedCommandRiskLevel = 'normal' | 'high';

/**
 * The cancellable handle the extension hands to this module.
 *
 * Shape taken from the author's own construction site,
 * recovered/shuncode-extension/src/ide-tool-broker.ts:1712. Several members are
 * getters there; from the consumer's side they read as plain properties.
 */
export interface ManagedCommandCancellationTarget {
	readonly id: string;
	readonly ownerId: string;
	readonly command: string;
	readonly cwd: string;
	readonly startedAt: number;
	readonly status: ManagedCommandStatus;
	readonly exitCode: number | null;
	/** Set once a cancellation has been asked for; undefined until then. */
	readonly cancelRequestedAt?: number;
	/** True once a force-close was actually carried out. */
	readonly cancelForced?: boolean;
	/** Whether the terminal slot can be handed back to the pool. */
	readonly terminalReusable: boolean;
	/** Resolves when the command finishes, however it finishes. */
	readonly done: Promise<unknown>;
	/** Sends SIGINT / PTY interrupt. Returns false if not running. */
	requestInterrupt(at: number): boolean;
	/** SIGKILL or slot teardown. No-op if the command already stopped. */
	forceClose(): void;
}

/** Snapshot used to describe a command before cancelling it. preview():156. */
export interface ManagedCommandCancellationPreview {
	readonly commandId: string;
	readonly command: string;
	readonly cwd: string;
	readonly status: ManagedCommandStatus;
	readonly elapsedMs: number;
	readonly riskLevel: ManagedCommandRiskLevel;
	readonly riskReason?: string;
	readonly riskConsequence?: string;
}

/** Outcome of a cancellation attempt. Field set from result():205. */
export interface ManagedCommandCancellationResult {
	readonly statusBefore: ManagedCommandStatus;
	readonly status: ManagedCommandStatus;
	readonly exitCode: number | null;
	readonly cancelRequested: boolean;
	readonly alreadyRequested: boolean;
	readonly alreadyFinished: boolean;
	readonly interruptSent: boolean;
	/** True when the command survived the grace period and force is needed. */
	readonly forceRequired: boolean;
	readonly forced: boolean;
	readonly riskLevel: ManagedCommandRiskLevel;
	readonly riskReason?: string;
	readonly terminalReusable: boolean;
}

/** Request accepted by ManagedCommandCanceller.cancel(). */
export interface ManagedCommandCancellationRequest {
	readonly ownerId: string;
	/** How long to wait after the interrupt before escalating. */
	readonly graceMs: number;
	readonly force?: boolean;
	/**
	 * Host-owned confirmation for high-risk force cancellation. The
	 * implementation throws FORCE_CONFIRMATION_REQUIRED without it, so it must
	 * never be defaulted to true by a caller.
	 */
	readonly forceConfirmed?: boolean;
}

export const DEFAULT_CANCELLATION_LIMIT: number;
export const DEFAULT_CANCELLATION_WINDOW_MS: number;
export const DEFAULT_FORCE_PROMPT_COOLDOWN_MS: number;
export const DEFAULT_FORCE_PROMPT_LIMIT: number;
export const DEFAULT_FORCE_PROMPT_WINDOW_MS: number;
export const DEFAULT_FORCE_RESERVATION_TTL_MS: number;
export const NATIVE_MANAGED_COMMAND_OWNER_ID: string;

/** Derives the owner id used for bridge-initiated commands. */
export function bridgeManagedCommandOwnerId(sessionId: string): string;

/** High-risk commands require explicit local confirmation before force-kill. */
export function forceCancellationRequiresConfirmation(
	preview: ManagedCommandCancellationPreview
): boolean;

/** The error thrown when a caller asks about another owner's command. */
export function managedCommandNotAccessibleError(): Error;

/** Waits for the command to finish, or for the grace period to elapse. */
export function waitForCommandOrGrace(
	target: ManagedCommandCancellationTarget,
	graceMs: number
): Promise<void>;

/** Per-owner rate limiting for cancellations and force prompts. */
export class PerOwnerCancellationRateLimiter {
	constructor(options?: {
		limit?: number;
		windowMs?: number;
		forcePromptLimit?: number;
		forcePromptWindowMs?: number;
		forcePromptCooldownMs?: number;
		forceReservationTtlMs?: number;
	});
	recordCancellation(ownerId: string, now: number): void;
	reserveForcePrompt(ownerId: string, commandId: string, now: number): void;
	consumeForceReservation(ownerId: string, commandId: string, now: number): void;
	releaseOwner(ownerId: string): void;
}

export class ManagedCommandCanceller {
	constructor(options?: {
		now?: () => number;
		limiter?: PerOwnerCancellationRateLimiter;
	});
	/** Throws if ownerId does not own the target. */
	preview(
		target: ManagedCommandCancellationTarget,
		ownerId: string
	): ManagedCommandCancellationPreview;
	reserveForcePrompt(
		target: ManagedCommandCancellationTarget,
		ownerId: string
	): ManagedCommandCancellationPreview;
	releaseOwner(ownerId: string): void;
	cancel(
		target: ManagedCommandCancellationTarget,
		request: ManagedCommandCancellationRequest
	): Promise<ManagedCommandCancellationResult>;
}
