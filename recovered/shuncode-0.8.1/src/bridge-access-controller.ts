import * as vscode from "vscode";
import type { BridgeManager, BridgeStatus } from "./bridge-server.js";
import type { BridgeAccessSnapshot, BridgeLicenseService } from "./bridge-license-service.js";
import { showBridgeAccessStopNotice } from "./bridge-notices.js";

const LICENSE_REVALIDATION_INTERVAL_MS = 15 * 60 * 1000;

export class BridgeAccessController implements vscode.Disposable {
  private validationTimer: ReturnType<typeof setInterval> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private validationInFlight = false;

  constructor(
    private readonly licenseService: BridgeLicenseService,
    private readonly bridge: BridgeManager,
    private readonly output: vscode.OutputChannel,
  ) {}

  async start(domain?: string): Promise<BridgeStatus> {
    const status = await this.bridge.start(domain);
    this.startValidationTimer();
    void this.scheduleExpiryValidation().catch(error => this.output.appendLine(`[bridge-license] expiry timer unavailable: ${String(error)}`));
    return status;
  }

  async stop(): Promise<BridgeStatus> {
    this.stopValidationTimer();
    return await this.bridge.stop();
  }

  async getAccessStatus(): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.getStatus();
  }

  async signIn(): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.signIn();
  }

  async signInWithGitee(): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.signInWithGitee();
  }

  async reauthenticate(): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.reauthenticate();
  }

  async refreshSession(): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.refreshSession();
  }

  async refresh(): Promise<BridgeAccessSnapshot> {
    const snapshot = await this.licenseService.refresh();
    return await this.stopIfAccessLost(snapshot, "license refresh") ? await this.licenseService.getStatus() : snapshot;
  }

  async signOut(): Promise<BridgeAccessSnapshot> {
    if (this.bridge.getStatus().state === "running" || this.bridge.getStatus().state === "starting") {
      await this.stop();
    }
    return await this.licenseService.signOut();
  }

  async redeem(code: string): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.redeem(code);
  }

  async loadPlans(force = false): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.loadPlans(force);
  }

  async createPayment(planId: string, paymentType: string): Promise<BridgeAccessSnapshot> {
    return await this.licenseService.createPayment(planId, paymentType);
  }

  async getPaymentOrder(orderId = ""): Promise<BridgeAccessSnapshot> {
    const snapshot = await this.licenseService.getPaymentOrder(orderId);
    return await this.stopIfAccessLost(snapshot, "payment/license update") ? await this.licenseService.getStatus() : snapshot;
  }

  private startValidationTimer(): void {
    this.stopValidationTimer();
    this.validationTimer = setInterval(() => void this.revalidateRunningBridge(), LICENSE_REVALIDATION_INTERVAL_MS);
    this.validationTimer.unref?.();
  }

  private stopValidationTimer(): void {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = undefined;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }

  private async scheduleExpiryValidation(): Promise<void> {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.bridge.getStatus().state !== "running") return;
    const expiresAt = await this.licenseService.runningLicenseExpiresAt();
    if (this.bridge.getStatus().state !== "running" || !expiresAt) return;
    const delay = Math.min(Math.max(1, expiresAt - Date.now()), 0x7fffffff);
    this.expiryTimer = setTimeout(() => void this.revalidateRunningBridge(), delay);
    this.expiryTimer.unref?.();
  }

  private async revalidateRunningBridge(): Promise<void> {
    if (this.validationInFlight || this.bridge.getStatus().state !== "running") return;
    this.validationInFlight = true;
    try {
      await this.licenseService.revalidateRunningFeature();
    } catch (error) {
      if (this.bridge.getStatus().state !== "running") return;
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[bridge-license] running Bridge authorization failed; stopping Bridge: ${message}`);
      await this.stop();
      // 停止原因写进 Bridge 状态（页面显示中文说明）；通知不拼接英文原文，原文在输出通道里。
      this.bridge.noteAccessStop("license-renew-failed", message);
      showBridgeAccessStopNotice("license-renew-failed", this.output);
    } finally {
      this.validationInFlight = false;
      if (this.bridge.getStatus().state === "running") {
        void this.scheduleExpiryValidation().catch(error => this.output.appendLine(`[bridge-license] expiry timer unavailable: ${String(error)}`));
      }
    }
  }

  private async stopIfAccessLost(snapshot: BridgeAccessSnapshot, reason: string): Promise<boolean> {
    if (snapshot.licensed || !["running", "starting"].includes(this.bridge.getStatus().state)) return false;
    let message = snapshot.error || "no active entitlement";
    try {
      // Snapshot expiry is not proof of revocation. Verify online once immediately
      // before disconnecting, including after a payment/status refresh.
      await this.licenseService.requireFeature("bridge");
      return true;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!["running", "starting"].includes(this.bridge.getStatus().state)) return false;
    this.output.appendLine(`[bridge-license] stopping Bridge after ${reason}: ${message}`);
    await this.stop();
    this.bridge.noteAccessStop("access-lost", message);
    return false;
  }

  dispose(): void {
    this.stopValidationTimer();
  }
}
