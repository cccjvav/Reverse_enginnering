/** Community lifecycle adapter. No commercial revalidation timer or usage upload. */
import type { BridgeManager, BridgeStatus } from "./bridge-server.js";
import type { BridgeAccessSnapshot, BridgeLicenseService } from "./bridge-license-service.js";

export class BridgeAccessController {
  constructor(
    private readonly licenseService: BridgeLicenseService,
    private readonly bridge: BridgeManager,
    private readonly _output?: unknown,
  ) {}
  async start(domain?: string): Promise<BridgeStatus> {
    // Keep BridgeManager's own checks, route tokens, workspace and tunnel safeguards.
    return this.bridge.start(domain);
  }
  async stop(): Promise<BridgeStatus> { return this.bridge.stop(); }
  async getAccessStatus(): Promise<BridgeAccessSnapshot> { return this.licenseService.getStatus(); }
  async signIn(): Promise<BridgeAccessSnapshot> { return this.licenseService.signIn(); }
  async signInWithGitee(): Promise<BridgeAccessSnapshot> { return this.licenseService.signInWithGitee(); }
  async refreshSession(): Promise<BridgeAccessSnapshot> { return this.licenseService.refreshSession(); }
  async refresh(): Promise<BridgeAccessSnapshot> { return this.licenseService.refresh(); }
  // Signing out of the retired shop must not stop a free Bridge or change auto-start.
  async signOut(): Promise<BridgeAccessSnapshot> { return this.licenseService.signOut(); }
  async redeem(code: string): Promise<BridgeAccessSnapshot> { return this.licenseService.redeem(code); }
  async loadPlans(force = false): Promise<BridgeAccessSnapshot> { return this.licenseService.loadPlans(force); }
  async createPayment(planId: string, paymentType: string): Promise<BridgeAccessSnapshot> {
    return this.licenseService.createPayment(planId, paymentType);
  }
  async getPaymentOrder(orderId = ""): Promise<BridgeAccessSnapshot> { return this.licenseService.getPaymentOrder(orderId); }
  dispose(): void {}
}
