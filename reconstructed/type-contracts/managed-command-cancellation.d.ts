/** Candidate contract from the canceller and preserved CommandState adapter. */
export type ManagedCommandStatus = 'running' | 'completed' | 'failed' | 'killed' | 'cancelled';
export interface ManagedCommandCancellationTarget {
  readonly id: string;
  readonly ownerId: string;
  readonly command: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly status: ManagedCommandStatus;
  readonly exitCode: number | null;
  readonly cancelRequestedAt?: number;
  readonly cancelForced?: boolean;
  readonly terminalReusable: boolean;
  readonly done: Promise<void>;
  requestInterrupt(at: number): boolean;
  forceClose(): void;
}
export interface ManagedCommandCancellationPreview {
  commandId: string;
  command: string;
  cwd: string;
  status: ManagedCommandStatus;
  elapsedMs: number;
  riskLevel: 'normal' | 'high';
  riskReason: string | undefined;
  riskConsequence: string | undefined;
}
export interface ManagedCommandCancellationResult {
  statusBefore: ManagedCommandStatus;
  status: ManagedCommandStatus;
  exitCode: number | null;
  cancelRequested: boolean;
  alreadyRequested: boolean;
  alreadyFinished: boolean;
  interruptSent: boolean;
  forceRequired: boolean;
  forced: boolean;
  riskLevel: 'normal' | 'high';
  riskReason: string | undefined;
  terminalReusable: boolean;
}
export interface CancellationOptions {
  now?: () => number;
  waitForGrace?: (target: ManagedCommandCancellationTarget, graceMs: number) => Promise<void>;
  cancellationLimit?: number;
  cancellationWindowMs?: number;
  forcePromptLimit?: number;
  forcePromptWindowMs?: number;
  forcePromptCooldownMs?: number;
  forceReservationTtlMs?: number;
}
export declare class ManagedCommandCanceller {
  constructor(options?: CancellationOptions);
  preview(target: ManagedCommandCancellationTarget, ownerId: string): ManagedCommandCancellationPreview;
  reserveForcePrompt(target: ManagedCommandCancellationTarget, ownerId: string): ManagedCommandCancellationPreview;
  releaseOwner(ownerId: string): void;
  cancel(target: ManagedCommandCancellationTarget, request: {
    ownerId: string; graceMs: number; force?: boolean; forceConfirmed?: boolean;
  }): Promise<ManagedCommandCancellationResult>;
  assertOwner(target: ManagedCommandCancellationTarget, ownerId: string): void;
}
export declare const NATIVE_MANAGED_COMMAND_OWNER_ID: string;
export declare function bridgeManagedCommandOwnerId(sessionId?: string): string;
export declare function forceCancellationRequiresConfirmation(preview: ManagedCommandCancellationPreview): boolean;
export declare function managedCommandNotAccessibleError(): Error;
export declare function waitForCommandOrGrace(target: ManagedCommandCancellationTarget, graceMs: number): Promise<void>;
