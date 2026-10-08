import { licenseRequestBudget, awaitLicenseSignal } from "./bridge-license-network-policy.mjs";

// Race ONLY public read probes. An order POST is sent once on the winner.
export interface PaymentTransport {
  name: string;
  send: (url: URL, init: RequestInit) => Promise<Response>;
}
export class PaymentCreationUncertainError extends Error {
  constructor() { super("订单创建结果暂不明确，请先检查已有订单，不要重复下单。此次请求不会自动重发。"); this.name = "PaymentCreationUncertainError"; }
}
export async function sendPaymentOnce(
  target: URL, init: RequestInit, routes: PaymentTransport[], log: (message: string) => void = () => {},
  budget = licenseRequestBudget(target.pathname, "POST"),
): Promise<Response> {
  if (init.method?.toUpperCase() !== "POST") throw new Error("Payment transport accepts only POST");
  if (target.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) throw new Error("Payment transport requires HTTPS");
  const overall = AbortSignal.any([AbortSignal.timeout(budget.requestTimeoutMs), ...(init.signal ? [init.signal] : [])]);
  const started = Date.now();
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(budget.probeTimeoutMs), overall]);
  let route: PaymentTransport;
  try {
    route = await awaitLicenseSignal(Promise.any(routes.map(async route => {
      const response = await route.send(new URL("/health", target), { method: "GET", signal, redirect: "error", cache: "no-store" });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Health probe failed"); }
      const health = await response.json() as { ok?: unknown; service?: unknown };
      if (signal.aborted || health.ok !== true || health.service !== "shuncode-bridge-license") throw new Error("Health probe did not verify the license service");
      return route;
    })), signal);
  } catch {
    throw new Error("支付服务连接检查失败，尚未发送下单请求。请检查网络后重试。");
  } finally { controller.abort(); }
  overall.throwIfAborted();
  log(`payment route ready: ${route.name}; probeMs=${Date.now() - started}`);
  const sent = Date.now();
  try {
    // No transport fallback, race, or replay is permitted after this boundary.
    const sendSignal = AbortSignal.any([AbortSignal.timeout(budget.attemptTimeoutMs), overall]);
    const response = await awaitLicenseSignal(route.send(target, { ...init, signal: sendSignal, redirect: "error" }), sendSignal);
    log(`payment create response: HTTP ${response.status}; requestMs=${Date.now() - sent}`);
    if (response.status >= 500 || response.status >= 300 && response.status < 400) throw new PaymentCreationUncertainError();
    // OAuth and redemption share single-send routing, but do not return an order.
    if (response.ok && target.pathname === "/v1/payments/orders") {
      const body = await awaitLicenseSignal(response.text(), sendSignal);
      const parsed = JSON.parse(body) as { order?: { id?: unknown }; checkoutUrl?: unknown };
      if (typeof parsed.order?.id !== "string" || !parsed.order.id || typeof parsed.checkoutUrl !== "string") throw new PaymentCreationUncertainError();
      return new Response(body, { status: response.status, headers: response.headers });
    }
    return response;
  } catch { throw new PaymentCreationUncertainError(); }
}
