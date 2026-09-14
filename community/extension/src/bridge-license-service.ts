/**
 * Community edition policy, authored during recovery.
 * The legacy class/fields are a compatibility adapter, NOT a fabricated licence.
 * No OAuth, checkout, receipt polling, JWT signing/verification or usage upload.
 * Provider accounts (e.g. Codex) and Bridge transport authentication are separate.
 */
export interface BridgeAccessSnapshot {
  readonly edition: "community";
  readonly available: true;
  readonly requiresAccount: false;
  readonly requiresPayment: false;
  readonly serverConfigured: false;
  readonly signedIn: false;
  readonly installationId: string;
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly giteeUserId: string;
  readonly giteeLogin: string;
  readonly email: string;
  readonly avatarUrl: string;
  /** Legacy availability flag. It does not assert possession of a paid licence. */
  readonly licensed: true;
  readonly expiresAt: string;
  readonly permanent: true;
  readonly error: string;
  readonly plans: readonly never[];
  readonly paymentTypes: readonly never[];
  readonly plansError: string;
  readonly paymentOrder: {
    readonly id: string; readonly status: string; readonly checkoutUrl: string;
    readonly planId: string; readonly planName: string; readonly amount: string;
    readonly paymentType: string; readonly createdAt: string; readonly expiresAt: string;
    readonly paidAt: string; readonly entitlementExpiresAt: string; readonly error: string;
  };
}

export class BridgeLicenseService {
  // Accept the historical constructor shape but never access identity/receipt storage.
  constructor(_context?: unknown, _output?: unknown) {}
  async initialize(): Promise<void> {}
  async getStatus(): Promise<BridgeAccessSnapshot> {
    return {
      edition: "community", available: true, requiresAccount: false, requiresPayment: false,
      serverConfigured: false, signedIn: false, installationId: "", githubUserId: "", githubLogin: "",
      giteeUserId: "", giteeLogin: "", email: "", avatarUrl: "",
      licensed: true, expiresAt: "", permanent: true, error: "",
      plans: [], paymentTypes: [], plansError: "",
      paymentOrder: {
        id: "", status: "disabled", checkoutUrl: "", planId: "", planName: "", amount: "",
        paymentType: "", createdAt: "", expiresAt: "", paidAt: "", entitlementExpiresAt: "", error: "",
      },
    };
  }
  async requireFeature(feature: string): Promise<void> {
    if (feature !== "bridge") throw new Error(`Unknown community capability: ${feature}`);
  }
  // Compatibility for old callers: none of these starts an authentication flow.
  async signIn(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async signInWithGitee(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async signOut(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async refresh(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async refreshSession(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async loadPlans(_force = false): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async getPaymentOrder(_orderId = ""): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
  async createPayment(_planId: string, _paymentType: string): Promise<never> {
    throw new Error("COMMUNITY_PAYMENTS_DISABLED: ShunCode Bridge is free; no payment is required or accepted by this build.");
  }
  async redeem(_code: string): Promise<never> {
    throw new Error("COMMUNITY_PAYMENTS_DISABLED: No activation code is needed for ShunCode Bridge.");
  }
  async reportUsage(_count: number): Promise<boolean> { return true; }
  dispose(): void {}
}
