import net from "node:net";
import tls from "node:tls";

/**
 * Local relay for the Quick Tunnel proxy route (0.7.7 follow-up T2). cloudflared cannot use an HTTP proxy for its
 * edge connection, so it is pointed at 127.0.0.1:<port> (--edge) and every connection is carried to the Cloudflare
 * edge through the proxy with CONNECT: the region names first (the proxy resolves them), then two of the addresses
 * Cloudflare publishes for them, for proxies whose DNS or domain rules misroute the names. Bytes
 * are copied, never read: TLS still terminates at the edge and cloudflared's pinned certificates still decide.
 * Log lines name the edge host and the proxy's answer only, never the proxy address or its credentials.
 */
// https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/
export const CLOUDFLARE_EDGE_TARGETS: readonly string[] = ["region1.v2.argotunnel.com:7844", "region2.v2.argotunnel.com:7844", "198.41.192.7:7844", "198.41.200.53:7844"];
const HEADER_LIMIT = 16 * 1024;

export class ProxyConnectError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProxyConnectError";
  }
}

export interface EdgeRelay {
  readonly port: number;
  /** The last CONNECT failure, cleared by the next success. */
  lastError(): ProxyConnectError | undefined;
  close(): Promise<void>;
}

export interface EdgeRelayOptions {
  proxyUrl: string;
  targets?: readonly string[];
  connectTimeoutMs?: number;
  log?: (line: string) => void;
}

export function parseRelayProxy(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProxyConnectError("The HTTP proxy address is not a valid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyConnectError(`The Quick Tunnel proxy route needs an HTTP(S) proxy; ${url.protocol.replace(/:$/, "")} proxies are not supported.`);
  }
  return url;
}

/** Opens a CONNECT tunnel through the proxy; resolves with a paused socket carrying bytes to `target`. */
export function openConnectTunnel(proxy: URL, target: string, timeoutMs = 10_000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const port = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
    const socket: net.Socket = proxy.protocol === "https:"
      ? tls.connect({ host: proxy.hostname, port, servername: net.isIP(proxy.hostname) ? undefined : proxy.hostname })
      : net.connect({ host: proxy.hostname, port });
    let buffered = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("data", onData);
    };
    const fail = (error: ProxyConnectError) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onError = (error: NodeJS.ErrnoException) => fail(new ProxyConnectError(`Cannot reach the HTTP proxy for CONNECT ${target} (${error.code ?? "error"}).`));
    const onClose = () => fail(new ProxyConnectError(`The HTTP proxy closed the connection during CONNECT ${target}.`));
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end < 0) {
        if (buffered.length > HEADER_LIMIT) fail(new ProxyConnectError(`The HTTP proxy sent an oversized answer to CONNECT ${target}.`));
        return;
      }
      const statusLine = buffered.subarray(0, buffered.indexOf("\r\n")).toString("latin1");
      const status = Number(/^HTTP\/1\.[01] (\d{3})\b/.exec(statusLine)?.[1]);
      if (status !== 200) {
        fail(new ProxyConnectError(`The HTTP proxy refused CONNECT ${target} (HTTP ${Number.isFinite(status) ? status : "?"}).`, Number.isFinite(status) ? status : undefined));
        return;
      }
      settled = true;
      cleanup();
      socket.pause();
      const rest = buffered.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    const timer = setTimeout(() => fail(new ProxyConnectError(`The HTTP proxy did not answer CONNECT ${target} within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.on("data", onData);
    socket.once(proxy.protocol === "https:" ? "secureConnect" : "connect", () => {
      const credentials = proxy.username || proxy.password
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
        : "";
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${credentials}\r\n`);
    });
  });
}

/** Listens on 127.0.0.1 (random port); each accepted connection is carried to the next edge target that answers. */
export async function startEdgeRelay(options: EdgeRelayOptions): Promise<EdgeRelay> {
  const proxy = parseRelayProxy(options.proxyUrl);
  const targets = options.targets?.length ? options.targets : CLOUDFLARE_EDGE_TARGETS;
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); };
  let next = 0;
  let lastError: ProxyConnectError | undefined;
  const logged = new Set<string>();
  const log = (line: string) => {
    if (logged.has(line) || logged.size >= 24) return;   // cloudflared retries; each distinct line once is enough
    logged.add(line);
    options.log?.(`[bridge] Cloudflare edge relay: ${line}`);
  };
  const carry = async (client: net.Socket) => {
    for (let index = 0; index < targets.length; index++) {
      const target = targets[(next + index) % targets.length];
      let upstream: net.Socket;
      try {
        upstream = await openConnectTunnel(proxy, target, options.connectTimeoutMs);
      } catch (error) {
        lastError = error instanceof ProxyConnectError ? error : new ProxyConnectError(String(error));
        log(lastError.message);
        continue;
      }
      if (client.destroyed) { upstream.destroy(); return; }
      next = (next + index + 1) % targets.length;
      log(`CONNECT ${target} accepted by the HTTP proxy.`);
      track(upstream);
      // A proxy can accept CONNECT and still have no working route to port 7844: the edge then never answers.
      let answered = false;
      upstream.once("data", () => { answered = true; lastError = undefined; });
      upstream.on("error", () => upstream.destroy());
      upstream.once("close", () => {
        if (!answered) {
          lastError = new ProxyConnectError(`The HTTP proxy accepted CONNECT ${target}, but the connection closed before the Cloudflare edge answered; the proxy's route to port 7844 is probably blocked.`);
          log(lastError.message);
        }
        client.destroy();
      });
      client.once("close", () => upstream.destroy());
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
      upstream.resume();
      return;
    }
    client.destroy();
  };
  const server = net.createServer({ pauseOnConnect: true }, client => {
    track(client);
    client.on("error", () => client.destroy());
    void carry(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const port = (server.address() as net.AddressInfo).port;
  let closing: Promise<void> | undefined;
  return {
    port,
    lastError: () => lastError,
    close: () => closing ??= new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
