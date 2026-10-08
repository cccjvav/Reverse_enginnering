import { sendPaymentOnce, type PaymentTransport } from "./bridge-payment-network.mjs";
import { execFileSync } from "node:child_process";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { Readable } from "node:stream";
import { HttpsProxyAgent } from "https-proxy-agent";
import { isPacUrl, matchesNoProxy, matchesProxyBypass, pacConfigurationError } from "./proxy-bypass.mjs";

const WINDOWS_INTERNET_SETTINGS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const SYSTEM_PROXY_CACHE_MS = 5_000;
const LOCAL_PROBE_CACHE_MS = 15_000;
const WORKING_PROXY_CACHE_MS = 300_000;
const PROXY_VERIFICATION_CACHE_MS = 300_000;

export interface ExtensionHostFetchOptions {
  method?: string;
  headers?: HeadersInit;
  body?: string;
  signal?: AbortSignal;
  proxyUrl?: string;
  configuredProxy?: string;
  rejectUnauthorized?: boolean;
  useElectron?: boolean;
  /** Disable proxy discovery and force the native direct transport. */
  proxySupport?: "off";
  attemptTimeoutMs?: number;
  probeTimeoutMs?: number;
  respectProxyPolicy?: boolean;
  log?: (message: string) => void;
}

export interface CandidatePortDefinition {
  readonly port: number;
  readonly defaultScheme: "http" | "socks5";
  readonly clientName: string;
}

export const CANDIDATE_LOCAL_PROXY_PORTS: ReadonlyArray<CandidatePortDefinition> = [
  { port: 7890, defaultScheme: "http", clientName: "Clash / Clash for Windows (mixed)" },
  { port: 7897, defaultScheme: "http", clientName: "Clash Verge Rev / Mihomo Party (mixed)" },
  { port: 10809, defaultScheme: "http", clientName: "v2rayN HTTP" },
  { port: 12450, defaultScheme: "http", clientName: "SakuraCat HTTP" },
  { port: 2080, defaultScheme: "http", clientName: "sing-box mixed" },
  { port: 10808, defaultScheme: "socks5", clientName: "v2rayN / sing-box SOCKS5" },
  { port: 1080, defaultScheme: "socks5", clientName: "Shadowsocks SOCKS5" },
  { port: 8888, defaultScheme: "http", clientName: "Fiddler / Charles HTTP" },
  { port: 8080, defaultScheme: "http", clientName: "Standard HTTP proxy" },
  { port: 8118, defaultScheme: "http", clientName: "Privoxy HTTP" },
  { port: 20809, defaultScheme: "http", clientName: "NekoRay HTTP" },
  { port: 20808, defaultScheme: "socks5", clientName: "NekoRay SOCKS5" },
  { port: 6152, defaultScheme: "http", clientName: "Surge HTTP" },
  { port: 6153, defaultScheme: "socks5", clientName: "Surge SOCKS5" },
];

interface WindowsInternetSettings {
  readonly enabled: boolean;
  readonly proxyServer?: string;
  readonly autoConfigUrl?: string;
  readonly proxyOverride?: string;
}

let cachedWindowsSettings: { expiresAt: number; data: WindowsInternetSettings } | undefined;
let cachedActiveLocalPorts: { expiresAt: number; ports: number[] } | undefined;
let cachedWorkingProxy: { expiresAt: number; url: string } | undefined;
let cachedElectronFetch: typeof fetch | null | undefined;
let cachedProxyVerifications: Map<string, { expiresAt: number; verified: boolean }> | undefined;

export function clearProxyCaches(): void {
  cachedWindowsSettings = undefined;
  cachedActiveLocalPorts = undefined;
  cachedWorkingProxy = undefined;
  cachedElectronFetch = undefined;
  cachedProxyVerifications = undefined;
}

function registryValue(name: string): string | undefined {
  try {
    const output = execFileSync("reg.exe", ["query", WINDOWS_INTERNET_SETTINGS, "/v", name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = output.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, "mi"));
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function queryWindowsInternetSettings(): WindowsInternetSettings {
  if (process.platform !== "win32") {
    return { enabled: false };
  }
  const enabledStr = registryValue("ProxyEnable");
  const enabled = Boolean(
    enabledStr &&
      Number.parseInt(enabledStr.replace(/^0x/i, ""), enabledStr.startsWith("0x") ? 16 : 10) !== 0
  );
  const proxyServer = registryValue("ProxyServer");
  const autoConfigUrl = registryValue("AutoConfigURL");
  const proxyOverride = registryValue("ProxyOverride");
  return { enabled, proxyServer, autoConfigUrl, proxyOverride };
}

function getWindowsInternetSettings(): WindowsInternetSettings {
  const now = Date.now();
  if (cachedWindowsSettings && cachedWindowsSettings.expiresAt > now) {
    return cachedWindowsSettings.data;
  }
  const data = queryWindowsInternetSettings();
  cachedWindowsSettings = { expiresAt: now + SYSTEM_PROXY_CACHE_MS, data };
  return data;
}

function windowsSystemProxy(): string | undefined {
  const settings = getWindowsInternetSettings();
  return settings.enabled ? settings.proxyServer : undefined;
}

export function shouldBypassProxy(target: URL, explicitOverride?: string): boolean {
  const hostname = target.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.") ||
    hostname.endsWith(".local")
  ) {
    return true;
  }

  if (matchesNoProxy(target, process.env.NO_PROXY?.trim() || process.env.no_proxy?.trim())) return true;
  const settings = getWindowsInternetSettings();
  // Preserve system/explicit exact-host semantics; NO_PROXY has suffix semantics.
  return [explicitOverride, settings.proxyOverride].some(group =>
    group?.split(/[;,]/).some(rule => matchesProxyBypass(target, rule, false)));
}

function probeLocalPort(port: number, timeoutMs = 60): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

export async function detectActiveLocalProxyPorts(forceRefresh = false): Promise<number[]> {
  const now = Date.now();
  if (!forceRefresh && cachedActiveLocalPorts && cachedActiveLocalPorts.expiresAt > now) {
    return cachedActiveLocalPorts.ports;
  }
  const results = await Promise.all(
    CANDIDATE_LOCAL_PROXY_PORTS.map(async ({ port }) => ({
      port,
      open: await probeLocalPort(port),
    }))
  );
  const openPorts = results.filter((r) => r.open).map((r) => r.port);
  cachedActiveLocalPorts = { expiresAt: now + LOCAL_PROBE_CACHE_MS, ports: openPorts };
  return openPorts;
}

export function getCachedWorkingProxy(): string | undefined {
  if (cachedWorkingProxy && cachedWorkingProxy.expiresAt > Date.now()) {
    return cachedWorkingProxy.url;
  }
  return undefined;
}

export function setCachedWorkingProxy(proxyUrl: string): void {
  cachedWorkingProxy = { expiresAt: Date.now() + WORKING_PROXY_CACHE_MS, url: proxyUrl };
}

/**
 * Proxy endpoints inferred purely from a local port scan. These are guesses, not
 * declared configuration, so callers must verify them before use.
 */
export async function scannedLocalProxyCandidates(forceRefresh = false): Promise<string[]> {
  const activePorts = await detectActiveLocalProxyPorts(forceRefresh);
  return activePorts.map((port) => {
    const portDef = CANDIDATE_LOCAL_PROXY_PORTS.find((definition) => definition.port === port);
    const scheme = portDef?.defaultScheme ?? "http";
    return `${scheme}://127.0.0.1:${port}/`;
  });
}

/**
 * A forward proxy must answer an absolute-form request with the *origin's* response.
 * A local dev server, router console, or captive portal listening on a candidate port
 * happily answers 200 with its own page, and a proxy that demands credentials answers
 * 407. Neither is a usable transport, so neither may be cached as the working proxy or
 * returned to the caller as if it came from the target origin.
 */
function isProxyRejection(status: number): boolean {
  // 407 = proxy auth required; 502/503/504 from the proxy hop itself are not origin answers.
  return status === 407;
}

/**
 * Gateway statuses a forward proxy emits when *it* cannot reach upstream.
 *
 * Unlike 407 these are ambiguous: an origin server may legitimately answer 502/503/504
 * itself. The distinguishing factor is the transport, not the response body:
 *
 * - HTTPS targets travel inside a CONNECT tunnel. Once the proxy answers
 *   "200 Connection Established" it becomes a byte pipe and cannot author a response,
 *   so any 5xx read from that tunnel is genuinely the origin's and must be preserved.
 * - Plain HTTP targets use absolute-form, where the proxy writes the response itself.
 *   Body and header shape vary per proxy product (Clash, Squid, v2rayN all differ), so
 *   content sniffing cannot tell the two apart reliably.
 *
 * Therefore a plain-HTTP gateway status is treated as a *soft* failure: stop trusting
 * that proxy (never cache it as working, try the remaining candidates), but keep the
 * response so it can still be returned if nothing better is found - it may be the
 * origin's real answer and discarding it would invent an error the server never sent.
 */
function isAmbiguousGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * Verify a *port-scanned* proxy guess really speaks the proxy protocol before trusting it.
 *
 * Only the local port scan needs this. An explicit `http.proxy`, a `*_PROXY` environment
 * variable and the Windows Internet Settings registry are all declared configuration: the
 * user or admin named that endpoint, so a failure there must surface as an error rather
 * than be skipped. A port scan, by contrast, only proves *something* is listening on a port
 * that some proxy tool happens to like, which is equally true of a dev server or a router
 * console.
 */
async function verifyProxyCandidate(
  proxyUrl: string,
  target: URL,
  init: ExtensionHostFetchOptions,
  timeoutMs: number,
): Promise<boolean> {
  cachedProxyVerifications ??= new Map();
  const key = `${proxyUrl}|${target.protocol}`;
  const cached = cachedProxyVerifications.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.verified;

  let verified = false;
  try {
    const proxy = new URL(proxyUrl);
    if (proxy.protocol.startsWith("socks")) {
      // A SOCKS5 greeting is already a protocol-level handshake: reaching a connected
      // socket proves the peer speaks SOCKS5 rather than HTTP.
      const socket = await socks5Connect(proxy, target.hostname, Number(target.port) || (target.protocol === "https:" ? 443 : 80), timeoutMs);
      socket.destroy();
      verified = true;
    } else {
      // CONNECT is the unambiguous forward-proxy verb. A plain origin server answers
      // 400/404/405 or closes; only a real forward proxy returns 2xx (or 407).
      verified = await probeHttpProxyConnect(proxy, target, timeoutMs, init);
    }
  } catch {
    verified = false;
  }
  cachedProxyVerifications.set(key, { expiresAt: now + PROXY_VERIFICATION_CACHE_MS, verified });
  return verified;
}

function probeHttpProxyConnect(
  proxy: URL,
  target: URL,
  timeoutMs: number,
  init: ExtensionHostFetchOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    const port = Number(target.port) || (target.protocol === "https:" ? 443 : 80);
    const headers: Record<string, string> = { host: `${target.hostname}:${port}` };
    const authorization = proxyAuthorization(proxy);
    if (authorization) headers["proxy-authorization"] = authorization;
    const client = proxy.protocol === "https:" ? https : http;
    const request = client.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname.replace(/^\[|\]$/g, ""),
      port: Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: `${target.hostname}:${port}`,
      headers,
      timeout: timeoutMs,
      ...(proxy.protocol === "https:" ? { rejectUnauthorized: init.rejectUnauthorized !== false } : {}),
    });
    const settle = (value: boolean, socket?: net.Socket) => {
      socket?.destroy();
      request.destroy();
      resolve(value);
    };
    request.once("connect", (response, socket) => {
      // 407 proves it is a proxy, but an unusable one; treat it as not verified so the
      // caller moves on to the next candidate instead of surfacing the proxy's own page.
      settle(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300, socket);
    });
    // A non-proxy origin server answers CONNECT with a normal HTTP response.
    request.once("response", (response) => { response.resume(); settle(false); });
    request.once("timeout", () => settle(false));
    request.once("error", () => settle(false));
    request.end();
  });
}

function proxyRuleValue(value: string, targetProtocol: string): { endpoint: string; isSocks?: boolean } | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes("=")) return { endpoint: trimmed };
  const rules = new Map<string, string>();
  for (const part of trimmed.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const endpoint = part.slice(separator + 1).trim();
    if (key && endpoint) rules.set(key, endpoint);
  }
  const scheme = targetProtocol.replace(/:$/, "").toLowerCase();
  if (rules.has(scheme)) return { endpoint: rules.get(scheme)!, isSocks: scheme.startsWith("socks") };
  if (rules.has("http")) return { endpoint: rules.get("http")!, isSocks: false };
  if (rules.has("proxy")) return { endpoint: rules.get("proxy")!, isSocks: false };
  if (rules.has("socks")) return { endpoint: rules.get("socks")!, isSocks: true };
  return undefined;
}

function systemPacConfigured(): boolean {
  return Boolean(getWindowsInternetSettings().autoConfigUrl?.trim());
}

export function normalizeProxyUrl(
  value: string | undefined,
  targetProtocol: string,
  options?: { allowSocks?: boolean }
): string | undefined {
  if (!value?.trim() || isPacUrl(value)) return undefined;
  const allowSocks = options?.allowSocks ?? true;
  const resolved = proxyRuleValue(value, targetProtocol);
  if (!resolved || !resolved.endpoint) return undefined;
  const { endpoint, isSocks: ruleIsSocks } = resolved;
  const isSocks = ruleIsSocks || /^socks/i.test(endpoint);
  if (isSocks && !allowSocks) return undefined;

  let normalized = endpoint;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(endpoint)) {
    normalized = isSocks ? `socks5://${endpoint}` : `http://${endpoint}`;
  } else if (/^socks:/i.test(endpoint)) {
    normalized = endpoint.replace(/^socks:/i, "socks5:");
  }
  try {
    const parsed = new URL(normalized);
    // A forward proxy is an authority, not a script/resource URL.
    if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) return undefined;
    const validProtocols = ["http:", "https:", "socks:", "socks5:", "socks5h:"];
    if (!validProtocols.includes(parsed.protocol) || !parsed.hostname) return undefined;
    if (!allowSocks && parsed.protocol.startsWith("socks")) return undefined;
    if (parsed.protocol.startsWith("socks") && parsed.pathname === "") {
      parsed.pathname = "/";
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export async function resolveExtensionHostProxyCandidates(
  target: URL,
  configuredProxy?: string
): Promise<string[]> {
  if (shouldBypassProxy(target)) {
    return [];
  }
  const rawCandidates: string[] = [];

  if (configuredProxy?.trim()) {
    rawCandidates.push(configuredProxy.trim());
  }

  if (process.env.HTTPS_PROXY) rawCandidates.push(process.env.HTTPS_PROXY);
  if (process.env.https_proxy) rawCandidates.push(process.env.https_proxy);
  if (process.env.ALL_PROXY) rawCandidates.push(process.env.ALL_PROXY);
  if (process.env.all_proxy) rawCandidates.push(process.env.all_proxy);
  if (process.env.HTTP_PROXY) rawCandidates.push(process.env.HTTP_PROXY);
  if (process.env.http_proxy) rawCandidates.push(process.env.http_proxy);

  const winSettings = getWindowsInternetSettings();
  if (winSettings.enabled && winSettings.proxyServer) {
    rawCandidates.push(winSettings.proxyServer);
  }
  // A PAC URL serves JavaScript, not an HTTP CONNECT proxy.
  // PAC evaluation belongs to the Electron/system network stack.
  const working = getCachedWorkingProxy();
  if (working) rawCandidates.push(working);

  for (const scanned of await scannedLocalProxyCandidates()) {
    rawCandidates.push(scanned);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawCandidates) {
    const normalized = normalizeProxyUrl(raw, target.protocol, { allowSocks: true });
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export function resolveExtensionHostProxy(target: URL, configuredProxy?: string): string | undefined {
  if (shouldBypassProxy(target)) {
    return undefined;
  }
  // An explicit SOCKS5 setting must not lose to an unrelated HTTP env proxy.
  const explicitProxy = normalizeProxyUrl(configuredProxy, target.protocol);
  if (explicitProxy) return explicitProxy;
  const envCandidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  ];

  // 1. Prefer HTTP/HTTPS proxies first
  for (const candidate of envCandidates) {
    const normalized = normalizeProxyUrl(candidate, target.protocol, { allowSocks: false });
    if (normalized) return normalized;
  }

  // 2. Try SOCKS candidates from environment
  for (const candidate of envCandidates) {
    const normalized = normalizeProxyUrl(candidate, target.protocol, { allowSocks: true });
    if (normalized) return normalized;
  }

  // 3. Windows system proxy (WinINET)
  const winProxy = windowsSystemProxy();
  const normalizedWin = normalizeProxyUrl(winProxy, target.protocol, { allowSocks: true });
  if (normalizedWin) return normalizedWin;

  // Prefer a recently verified proxy over unverified scanned ports, never over policy.
  if (!systemPacConfigured()) {
    const working = getCachedWorkingProxy();
    if (working) return working;
  }

  // 5. Active local proxy auto-detection (cached)
  if (cachedActiveLocalPorts?.ports.length) {
    for (const port of cachedActiveLocalPorts.ports) {
      const portDef = CANDIDATE_LOCAL_PROXY_PORTS.find((p) => p.port === port);
      const scheme = portDef?.defaultScheme ?? "http";
      const normalizedLocal = normalizeProxyUrl(`${scheme}://127.0.0.1:${port}/`, target.protocol, {
        allowSocks: true,
      });
      if (normalizedLocal) return normalizedLocal;
    }
  }

  return undefined;
}

async function socks5Connect(
  proxy: URL,
  targetHost: string,
  targetPort: number,
  timeoutMs = 6_000
): Promise<net.Socket> {
  // TCP data events are not protocol frames. Read exact lengths and leave any
  // coalesced application bytes in the socket for the HTTP/TLS consumer.
  const socket = net.connect({ host: proxy.hostname.replace(/^\[|\]$/g, ""), port: Number(proxy.port) || 1080 });
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const onError = (error: Error) => { failure = error; wake?.(); };
  const onClose = () => { failure ??= new Error("SOCKS5 proxy closed during handshake"); wake?.(); };
  const onReadable = () => wake?.();
  socket.on("error", onError);
  socket.on("close", onClose);
  socket.on("end", onClose);
  socket.on("readable", onReadable);
  const timer = setTimeout(() => socket.destroy(new Error("SOCKS5 handshake timed out")), timeoutMs);
  const read = async (length: number): Promise<Buffer> => {
    while (true) {
      if (failure) throw failure;
      const chunk = socket.read(length) as Buffer | null;
      if (chunk) return chunk;
      await new Promise<void>(resolve => { wake = resolve; });
      wake = undefined;
    }
  };
  try {
    const user = Buffer.from(decodeURIComponent(proxy.username));
    const password = Buffer.from(decodeURIComponent(proxy.password));
    const auth = Boolean(user.length || password.length);
    if (auth && (!user.length || user.length > 255 || !password.length || password.length > 255)) {
      throw new Error("SOCKS5 credentials must contain 1 to 255 bytes each");
    }
    socket.write(Buffer.from([5, 1, auth ? 2 : 0]));
    const greeting = await read(2);
    if (greeting[0] !== 5 || greeting[1] !== (auth ? 2 : 0)) throw new Error("SOCKS5 authentication method rejected");
    if (auth) {
      socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([password.length]), password]));
      const reply = await read(2);
      if (reply[0] !== 1 || reply[1] !== 0) throw new Error("SOCKS5 authentication failed");
    }
    const host = targetHost.replace(/^\[|\]$/g, "");
    let address: Buffer;
    if (net.isIPv4(host)) {
      address = Buffer.from([1, ...host.split(".").map(Number)]);
    } else if (net.isIPv6(host)) {
      // URL canonicalizes IPv4-mapped literals into IPv6 hextets.
      const canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
      const halves = canonical.split("::");
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves[1] ? halves[1].split(":") : [];
      const words = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
      address = Buffer.alloc(17);
      address[0] = 4;
      words.forEach((word, index) => address.writeUInt16BE(parseInt(word, 16), 1 + index * 2));
    } else {
      const domain = Buffer.from(host);
      if (!domain.length || domain.length > 255) throw new Error("SOCKS5 target hostname is too long");
      address = Buffer.concat([Buffer.from([3, domain.length]), domain]);
    }
    socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, Buffer.from([targetPort >> 8, targetPort & 255])]));
    const reply = await read(4);
    if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) throw new Error(`SOCKS5 connect error code: ${reply[1]}`);
    if (reply[3] === 1) await read(6);
    else if (reply[3] === 4) await read(18);
    else if (reply[3] === 3) await read((await read(1))[0] + 2);
    else throw new Error("SOCKS5 reply has an invalid address type");
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
    socket.removeListener("readable", onReadable);
    socket.removeListener("error", onError);
    socket.removeListener("close", onClose);
    socket.removeListener("end", onClose);
  }
}

class Socks5HttpAgent extends http.Agent {
  constructor(private readonly proxy: URL, options?: http.AgentOptions) {
    super(options);
  }
  override createConnection(
    options: http.ClientRequestArgs,
    callback?: ((err: Error | null, stream: any) => void) | undefined
  ): any {
    const host = options.host || (options as any).hostname || "localhost";
    const port = Number(options.port) || 80;
    socks5Connect(this.proxy, host, port)
      .then((socket) => callback?.(null, socket))
      .catch((err) => callback?.(err, undefined as any));
    return undefined;
  }
}

class Socks5HttpsAgent extends https.Agent {
  constructor(
    private readonly proxy: URL,
    private readonly rejectUnauthorizedTls: boolean,
    options?: https.AgentOptions
  ) {
    super(options);
  }
  override createConnection(
    options: https.RequestOptions,
    callback?: ((err: Error | null, stream: any) => void) | undefined
  ): any {
    const host = options.host || (options as any).hostname || "localhost";
    const port = Number(options.port) || 443;
    socks5Connect(this.proxy, host, port)
      .then((rawSocket) => {
        const tlsSocket = tls.connect({
          socket: rawSocket,
          servername: (options as any).servername || host,
          rejectUnauthorized: this.rejectUnauthorizedTls !== false,
        });
        tlsSocket.once("error", (err) => callback?.(err, undefined as any));
        tlsSocket.once("secureConnect", () => callback?.(null, tlsSocket));
      })
      .catch((err) => callback?.(err, undefined as any));
    return undefined;
  }
}

function electronNetFetch(): typeof fetch | undefined {
  if (cachedElectronFetch !== undefined) return cachedElectronFetch ?? undefined;
  try {
    const electronModuleName = "electron";
    const electron = require(electronModuleName) as { net?: { fetch?: typeof fetch } };
    cachedElectronFetch = typeof electron.net?.fetch === "function" ? electron.net.fetch.bind(electron.net) : null;
  } catch {
    cachedElectronFetch = null;
  }
  return cachedElectronFetch ?? undefined;
}

function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function requestInit(init: ExtensionHostFetchOptions, signal: AbortSignal): RequestInit {
  return {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal,
    cache: "no-store",
  };
}

function proxyAuthorization(proxy: URL): string | undefined {
  if (!proxy.username && !proxy.password) return undefined;
  const username = decodeURIComponent(proxy.username);
  const password = decodeURIComponent(proxy.password);
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function requestHeaders(init: ExtensionHostFetchOptions, target: URL): Record<string, string> {
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  if (!headers.host) headers.host = target.host;
  if (init.body !== undefined && !headers["content-length"] && !headers["transfer-encoding"]) {
    headers["content-length"] = String(Buffer.byteLength(init.body));
  }
  return headers;
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }
  return headers;
}

function toFetchResponse(response: IncomingMessage, method = "GET"): Response {
  const status = response.statusCode ?? 500;
  const noBody = method.toUpperCase() === "HEAD" || [204, 205, 304].includes(status);
  if (noBody) response.resume();
  const body = noBody ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status,
    statusText: response.statusMessage ?? "",
    headers: responseHeaders(response.headers),
  });
}

function writeBody(request: http.ClientRequest, body: string | undefined): void {
  if (body !== undefined) request.write(body);
  request.end();
}

function directRequest(target: URL, init: ExtensionHostFetchOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(
      target,
      {
        method: init.method ?? "GET",
        headers: requestHeaders(init, target),
        signal: init.signal,
        ...(target.protocol === "https:" ? { rejectUnauthorized: init.rejectUnauthorized !== false } : {}),
      },
      (response) => resolve(toFetchResponse(response, init.method))
    );
    request.once("error", reject);
    writeBody(request, init.body);
  });
}

function requestHttpTargetThroughProxy(
  target: URL,
  proxy: URL,
  init: ExtensionHostFetchOptions
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = proxy.protocol === "https:" ? https : http;
    const headers = requestHeaders(init, target);
    const authorization = proxyAuthorization(proxy);
    if (authorization) headers["proxy-authorization"] = authorization;
    const request = client.request(
      {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
        method: init.method ?? "GET",
        path: target.toString(),
        headers,
        signal: init.signal,
        ...(proxy.protocol === "https:" ? { rejectUnauthorized: init.rejectUnauthorized !== false } : {}),
      },
      (response) => resolve(toFetchResponse(response, init.method))
    );
    request.once("error", reject);
    writeBody(request, init.body);
  });
}

function requestHttpsTargetThroughProxy(
  target: URL,
  proxy: URL,
  init: ExtensionHostFetchOptions
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const agent = new HttpsProxyAgent(proxy, {
      rejectUnauthorized: init.rejectUnauthorized !== false,
    });
    const request = https.request(
      target,
      {
        method: init.method ?? "GET",
        headers: requestHeaders(init, target),
        signal: init.signal,
        agent,
        rejectUnauthorized: init.rejectUnauthorized !== false,
      },
      (result) => resolve(toFetchResponse(result, init.method))
    );
    request.once("error", reject);
    writeBody(request, init.body);
  });
}

function requestTargetThroughSocksProxy(
  target: URL,
  proxy: URL,
  init: ExtensionHostFetchOptions
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const headers = requestHeaders(init, target);
    if (isHttps) {
      const agent = new Socks5HttpsAgent(proxy, init.rejectUnauthorized !== false);
      const request = https.request(
        target,
        {
          method: init.method ?? "GET",
          headers,
          signal: init.signal,
          agent,
          rejectUnauthorized: init.rejectUnauthorized !== false,
        },
        (result) => resolve(toFetchResponse(result, init.method))
      );
      request.once("error", reject);
      writeBody(request, init.body);
    } else {
      const agent = new Socks5HttpAgent(proxy);
      const request = http.request(
        target,
        {
          method: init.method ?? "GET",
          headers,
          signal: init.signal,
          agent,
        },
        (result) => resolve(toFetchResponse(result, init.method))
      );
      request.once("error", reject);
      writeBody(request, init.body);
    }
  });
}

export function fetchThroughExtensionHostProxy(
  target: URL,
  init: ExtensionHostFetchOptions
): Promise<Response> {
  if (init.proxySupport === "off") return directRequest(target, init);
  if (isPacUrl(init.proxyUrl)) throw pacConfigurationError();
  const proxyUrl = normalizeProxyUrl(init.proxyUrl, target.protocol, { allowSocks: true });
  if (init.proxyUrl?.trim() && !proxyUrl) throw new Error("Unsupported or invalid proxy URL");
  if (!proxyUrl) return directRequest(target, init);
  const proxy = new URL(proxyUrl);
  if (proxy.protocol.startsWith("socks")) {
    return requestTargetThroughSocksProxy(target, proxy, init);
  }
  return target.protocol === "https:"
    ? requestHttpsTargetThroughProxy(target, proxy, init)
    : requestHttpTargetThroughProxy(target, proxy, init);
}

// Normalize a mislabeled scheme only for a known local SOCKS5-only listener.
function knownLocalSocksProxyScheme(proxyUrl: string): string {
  try {
    const proxy = new URL(proxyUrl);
    if (proxy.protocol !== "http:") return proxyUrl;
    const rawHost = proxy.hostname.toLowerCase();
    const hostname = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
    const loopback = hostname === "localhost" || hostname === "::1"
      || (net.isIP(hostname) === 4 && hostname.startsWith("127."));
    const port = Number(proxy.port);
    const definition = CANDIDATE_LOCAL_PROXY_PORTS.find(candidate => candidate.port === port && candidate.defaultScheme === "socks5");
    if (!loopback || !definition) return proxyUrl;
    // Some VS Code profiles label v2rayN's SOCKS-only 10808 listener as http.proxy.
    // Correct only the protocol at that same known local endpoint; never add a route.
    return proxyUrl.replace(/^http:/i, "socks5:");
  } catch {
    return proxyUrl;
  }
}

// An explicitly selected or system-configured proxy is a route policy, not permission
// to send credentials directly if it fails. Auto-discovered proxies remain fallbacks.
export function resolveDeclaredLicenseProxy(target: URL, init: ExtensionHostFetchOptions): string | undefined {
  if (!init.respectProxyPolicy) return undefined;
  const declared = [init.configuredProxy, process.env.HTTPS_PROXY, process.env.https_proxy,
    process.env.ALL_PROXY, process.env.all_proxy, process.env.HTTP_PROXY, process.env.http_proxy,
    windowsSystemProxy()].some(value => value?.trim());
  const resolved = declared ? resolveExtensionHostProxy(target, init.configuredProxy) : undefined;
  if (!resolved) return undefined;
  const selected = knownLocalSocksProxyScheme(resolved);
  if (selected !== resolved) {
    init.log?.("Configured local proxy " + new URL(resolved).host + " is on a known SOCKS5-only port; using SOCKS5 at the same endpoint.");
  }
  return selected;
}

/**
 * One route per request for Chat/agent traffic: do not replay a prompt after an
 * uncertain proxy or PAC failure, and never bypass a declared proxy on failure.
 * Unlike license discovery this deliberately does not scan guessed local ports.
 */
export async function fetchWithExtensionHostPolicyOnce(target: URL, init: ExtensionHostFetchOptions): Promise<Response> {
  const request = requestInit(init, init.signal ?? new AbortController().signal);
  if (init.proxySupport === "off" || shouldBypassProxy(target)) return fetch(target, request);
  if ([init.proxyUrl, init.configuredProxy].some(isPacUrl)) throw pacConfigurationError();
  if ([init.proxyUrl, init.configuredProxy].some(value => value?.trim() && !normalizeProxyUrl(value, target.protocol))) {
    throw new Error("Unsupported or invalid proxy URL");
  }
  const manualProxy = [init.proxyUrl, init.configuredProxy, process.env.HTTPS_PROXY, process.env.https_proxy,
    process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy].some(value => value?.trim());
  if (!manualProxy && systemPacConfigured()) {
    const electronFetch = electronNetFetch();
    if (!electronFetch) throw pacConfigurationError();
    const response = await electronFetch(target.toString(), request);
    if (response.status === 407) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("System PAC proxy authentication required; direct fallback is disabled.");
    }
    return response;
  }
  const proxyUrl = init.proxyUrl
    ? normalizeProxyUrl(init.proxyUrl, target.protocol)
    : resolveDeclaredLicenseProxy(target, { ...init, respectProxyPolicy: true });
  if (!proxyUrl && manualProxy) throw new Error("Configured proxy is unsupported or unavailable; direct fallback is disabled.");
  if (proxyUrl) {
    const response = await fetchThroughExtensionHostProxy(target, { ...init, proxyUrl });
    if (response.status === 407) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Configured proxy authentication required; direct fallback is disabled.");
    }
    return response;
  }
  return fetch(target, request);
}

export async function fetchWithExtensionHostFallbacks(
  target: URL,
  init: ExtensionHostFetchOptions
): Promise<Response> {
  const timeoutMs = Math.max(1_000, Math.min(init.attemptTimeoutMs ?? 20_000, 60_000));
  const failures: string[] = [];

  const run = async (
    name: string,
    operation: (signal: AbortSignal) => Promise<Response>,
    customTimeoutMs?: number
  ): Promise<Response | undefined> => {
    if (init.signal?.aborted) throw init.signal.reason;
    try {
      init.log?.(`${name} -> ${target.origin}`);
      const effectiveTimeout = customTimeoutMs ?? timeoutMs;
      const response = await operation(attemptSignal(init.signal, effectiveTimeout));
      init.log?.(`${name} <- HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      const detail = `${name}: ${errorMessage(error)}`;
      failures.push(detail);
      init.log?.(`${detail}; trying fallback`);
      return undefined;
    }
  };

  // Do not rediscover proxies after the user explicitly disabled proxy support.
  if (init.proxySupport === "off") {
    return directRequest(target, { ...init, signal: attemptSignal(init.signal, timeoutMs) });
  }
  if ([init.proxyUrl, init.configuredProxy].some(isPacUrl)) throw pacConfigurationError();
  if ([init.proxyUrl, init.configuredProxy].some(value => value?.trim() && !normalizeProxyUrl(value, target.protocol))) {
    throw new Error("Unsupported or invalid proxy URL");
  }

  const isBypassed = !init.proxyUrl && shouldBypassProxy(target);
  const electronFetch = init.useElectron !== false ? electronNetFetch() : undefined;

  // Local loopback or intranet targets should always go direct
  if (isBypassed) {
    const response = await run("Native direct", signal => directRequest(target, { ...init, signal }));
    if (response) return response;
    throw new Error(`Local network request failed after all transports. ${failures.join(" | ")}`);
  }

  // A system PAC is routing policy, not another best-effort proxy candidate.
  // Let Chromium resolve it before cached/scanned proxies. Never silently bypass
  // that policy when Electron is unavailable or the system transport fails.
  const manualProxy = [init.proxyUrl, init.configuredProxy, process.env.HTTPS_PROXY,
    process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy,
    process.env.ALL_PROXY, process.env.all_proxy].some(value => value?.trim());
  if (!manualProxy && true && systemPacConfigured()) {
    if (!electronFetch) throw pacConfigurationError();
    const response = await run("Electron system PAC", signal => electronFetch(target.toString(), requestInit(init, signal)));
    if (response && response.status !== 407) return response;
    if (response) void response.body?.cancel().catch(() => undefined);
    throw new Error("System PAC transport failed or requires proxy authentication; automatic proxy/direct fallback is disabled.");
  }

  const declaredProxy = resolveDeclaredLicenseProxy(target, init);
  if (declaredProxy) {
    const response = await run("Configured proxy", signal => fetchThroughExtensionHostProxy(target, { ...init, proxyUrl: declaredProxy, signal }));
    if (response && response.status !== 407) return response;
    if (response) void response.body?.cancel().catch(() => undefined);
    throw new Error("Configured proxy network request failed; direct fallback is disabled. " + failures.join(" | "));
  }

  // Resolve all proxy candidates
  const proxyCandidates: string[] = [];
  const explicitProxies = new Set<string>();
  if (init.proxyUrl) {
    const norm = normalizeProxyUrl(init.proxyUrl, target.protocol, { allowSocks: true });
    if (norm) {
      proxyCandidates.push(norm);
      explicitProxies.add(norm);
    }
  }
  const resolved = await resolveExtensionHostProxyCandidates(target, init.configuredProxy);
  for (const c of resolved) {
    if (!proxyCandidates.includes(c)) proxyCandidates.push(c);
  }
  // Only endpoints discovered by scanning local ports are unverified guesses. Declared
  // configuration (http.proxy, *_PROXY, Windows Internet Settings) is trusted as-is.
  const scannedGuesses = new Set(
    (await scannedLocalProxyCandidates())
      .map(candidate => normalizeProxyUrl(candidate, target.protocol, { allowSocks: true }))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
  for (const explicit of explicitProxies) scannedGuesses.delete(explicit);

  // Prioritize active proxy candidates for external destinations
  if (proxyCandidates.length > 0) {
    // A gateway 5xx seen on a plain-HTTP hop is ambiguous: it may be the proxy failing
    // upstream, or the origin's own answer relayed faithfully. Keep the first one aside
    // so it can still be returned if every other transport fails, rather than inventing
    // a generic error the server never sent.
    let ambiguousGatewayResponse: Response | undefined;
    for (const candidateProxy of proxyCandidates) {
      // Measured: proxied TLS to Cloudflare Workers is 1.0-1.4s typically but spikes to ~3.8s.
      // Honor the caller budget instead of silently clipping license requests to 4/12s.
      // The caller's overall AbortSignal still bounds all fallback attempts.
      const proxyAttemptTimeout = timeoutMs;
      // Auto-discovered candidates are just "something is listening on a known port".
      // Verify the peer actually speaks the proxy protocol before sending it the request,
      // otherwise a local dev server or router console answers with its own page and that
      // body would be handed back as if the target origin had produced it.
      if (scannedGuesses.has(candidateProxy)) {
        const verified = await verifyProxyCandidate(candidateProxy, target, init, proxyAttemptTimeout);
        if (!verified) {
          const detail = `Proxy (${new URL(candidateProxy).protocol}//${new URL(candidateProxy).host}): not a usable forward proxy`;
          failures.push(detail);
          init.log?.(`${detail}; trying fallback`);
          continue;
        }
      }
      const response = await run(
        `Proxy (${new URL(candidateProxy).protocol}//${new URL(candidateProxy).host})`,
        (signal) =>
          fetchThroughExtensionHostProxy(target, {
            ...init,
            proxyUrl: candidateProxy,
            signal,
          }),
        proxyAttemptTimeout
      );
      if (response) {
        // A 407 is the proxy talking about itself, not the origin's answer. Never cache it
        // as working and never hand its body back as if the target had produced it.
        if (isProxyRejection(response.status)) {
          void response.body?.cancel().catch(() => undefined);
          const detail = `Proxy (${new URL(candidateProxy).protocol}//${new URL(candidateProxy).host}): HTTP ${response.status} proxy authentication required`;
          failures.push(detail);
          init.log?.(`${detail}; trying fallback`);
          continue;
        }
        // On an HTTPS target the CONNECT tunnel makes the proxy a byte pipe, so a 5xx is
        // provably the origin's. Only a plain-HTTP hop can have authored it, and there the
        // proxy must not be cached as working while other candidates remain untried.
        if (target.protocol !== "https:" && isAmbiguousGatewayStatus(response.status)) {
          const detail = `Proxy (${new URL(candidateProxy).protocol}//${new URL(candidateProxy).host}): HTTP ${response.status} gateway error, origin unverified`;
          failures.push(detail);
          init.log?.(`${detail}; trying fallback`);
          if (!ambiguousGatewayResponse) ambiguousGatewayResponse = response;
          else void response.body?.cancel().catch(() => undefined);
          continue;
        }
        setCachedWorkingProxy(candidateProxy);
        return response;
      }
    }
    // Every proxy candidate produced only an ambiguous gateway error. Prefer a working
    // direct transport; if that fails too, hand back the preserved 5xx unchanged.
    if (ambiguousGatewayResponse) {
      const direct = electronFetch
        ? await run("Electron net.fetch (after gateway error)", (signal) =>
            electronFetch(target.toString(), requestInit(init, signal)))
        : await run("Node fetch (after gateway error)", (signal) =>
            fetch(target, requestInit(init, signal)));
      if (direct) {
        void ambiguousGatewayResponse.body?.cancel().catch(() => undefined);
        return direct;
      }
      init.log?.("Direct transports unavailable; returning the proxy gateway response unchanged");
      return ambiguousGatewayResponse;
    }
  }

  // Direct transport fallbacks
  if (electronFetch) {
    const response = await run("Electron net.fetch", (signal) =>
      electronFetch(target.toString(), requestInit(init, signal))
    );
    if (response) return response;
  } else if (init.useElectron !== false) {
    init.log?.("Electron net.fetch unavailable; trying fallback");
  }

  const response = await run("Node fetch", (signal) => fetch(target, requestInit(init, signal)));
  if (response) return response;

  throw new Error(`Network request failed after all transports. ${failures.join(" | ")}`);
}


/** Payment-only fast selection. Existing generic proxy routing is unchanged. */
export async function fetchPaymentOrderOnce(target: URL, init: ExtensionHostFetchOptions): Promise<Response> {
  const native: PaymentTransport = { name: "native", send: (url, request) => directRequest(url, { ...init, ...request, headers: request.headers, body: typeof request.body === "string" ? request.body : undefined, signal: request.signal ?? undefined }) };
  const options = { method: "POST", headers: init.headers, body: init.body, signal: init.signal };
  if (init.proxySupport === "off" || !init.proxyUrl && shouldBypassProxy(target)) return sendPaymentOnce(target, options, [native], init.log);
  if ([init.proxyUrl, init.configuredProxy].some(isPacUrl)) throw pacConfigurationError();
  if ([init.proxyUrl, init.configuredProxy].some(value => value?.trim() && !normalizeProxyUrl(value, target.protocol))) throw new Error("Unsupported or invalid proxy URL");
  const electron = init.useElectron !== false ? electronNetFetch() : undefined;
  const electronRoute: PaymentTransport | undefined = electron ? { name: "electron", send: (url, request) => electron(url.toString(), request) } : undefined;
  const manualProxy = [init.proxyUrl, init.configuredProxy, process.env.HTTPS_PROXY, process.env.https_proxy,
    process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy].some(value => value?.trim());
  if (!manualProxy && systemPacConfigured()) {
    if (!electronRoute) throw pacConfigurationError();
    return sendPaymentOnce(target, options, [electronRoute], init.log);
  }
  const declaredProxy = resolveDeclaredLicenseProxy(target, init);
  if (declaredProxy) {
    const route: PaymentTransport = { name: "configured-proxy", send: (url, request) => fetchThroughExtensionHostProxy(url, {
      ...init, ...request, proxyUrl: declaredProxy, headers: request.headers,
      body: typeof request.body === "string" ? request.body : undefined, signal: request.signal ?? undefined,
    }) };
    return sendPaymentOnce(target, options, [route], init.log);
  }
  const candidates = await resolveExtensionHostProxyCandidates(target, init.configuredProxy);
  const explicit = normalizeProxyUrl(init.proxyUrl, target.protocol, { allowSocks: true });
  if (explicit && !candidates.includes(explicit)) candidates.unshift(explicit);
  const routes: PaymentTransport[] = candidates.map((proxyUrl, index) => ({
    name: `proxy-${index + 1}`,
    send: (url, request) => fetchThroughExtensionHostProxy(url, { ...init, ...request, proxyUrl, headers: request.headers, body: typeof request.body === "string" ? request.body : undefined, signal: request.signal ?? undefined }),
  }));
  if (electronRoute) routes.push(electronRoute);
  routes.push(native);
  return sendPaymentOnce(target, options, routes, init.log);
}
