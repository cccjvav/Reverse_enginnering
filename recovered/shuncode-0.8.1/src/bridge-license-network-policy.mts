export interface LicenseNetworkBudget { readonly requestTimeoutMs: number; readonly attemptTimeoutMs: number; readonly probeTimeoutMs: number; }

// Per-operation budgets. Transport deadlines never relax license verification.
export const LICENSE_NETWORK_POLICY = Object.freeze({
  version: "license-network-budget-v3",
  query: Object.freeze({ requestTimeoutMs: 9_000, attemptTimeoutMs: 6_000, probeTimeoutMs: 5_000 }),
  authorization: Object.freeze({ requestTimeoutMs: 15_000, attemptTimeoutMs: 12_000, probeTimeoutMs: 5_000 }),
  manualAuthorization: Object.freeze({ requestTimeoutMs: 20_000, attemptTimeoutMs: 8_000, probeTimeoutMs: 5_000 }),
  singleSend: Object.freeze({ requestTimeoutMs: 27_000, attemptTimeoutMs: 12_000, probeTimeoutMs: 12_000 }),
  payment: Object.freeze({ requestTimeoutMs: 18_000, attemptTimeoutMs: 12_000, probeTimeoutMs: 5_000 }),
});

export function licenseRequestBudget(path: string, method = "GET") {
  if (method.toUpperCase() === "POST" && path === "/v1/payments/orders") return LICENSE_NETWORK_POLICY.payment;
  if (path.startsWith("/v1/auth/") || path === "/v1/licenses/redeem") return LICENSE_NETWORK_POLICY.singleSend;
  if (path === "/v1/licenses/refresh") return LICENSE_NETWORK_POLICY.authorization;
  return LICENSE_NETWORK_POLICY.query;
}

// Bound waiting as well as signal-aware I/O; even a misbehaving transport must not
// hold the UI forever. Callers also pass this signal into I/O to cancel real work.
export function awaitLicenseSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("License server request timed out."));
    if (signal.aborted) { operation.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
