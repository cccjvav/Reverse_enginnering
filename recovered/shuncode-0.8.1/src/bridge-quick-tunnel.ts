/**
 * How the Bridge starts a Cloudflare Quick Tunnel (0.7.7 follow-up T1/T2). Pure: no vscode, no I/O.
 *
 * T1, own config: without --config, cloudflared reads ~/.cloudflared/config.yml. Ingress rules or a tunnel ID written
 *     there for another service then take over the Bridge address, and every request is answered with 404. The Bridge
 *     always passes its own file, so nothing in the user's cloudflared setup applies to it.
 * T2, route: without --protocol, cloudflared runs quick tunnels over QUIC only (UDP 7844) and never falls back.
 *     direct = --protocol auto (QUIC, falling back to HTTP/2 on TCP 7844).
 *     proxy  = HTTP/2 to ShunCode's local relay (--edge), which carries each edge connection through the HTTP proxy
 *              with CONNECT (cloudflare-edge-relay.ts). No hosts file, no administrator rights, no extra service.
 */
export type CloudflareEdgeRouteSetting = "auto" | "direct" | "proxy";
export type QuickTunnelRoute = "direct" | "proxy";

export const CLOUDFLARE_EDGE_ROUTE_SETTING = "bridge.cloudflareEdgeRoute";
export const QUICK_TUNNEL_CONFIG_NAME = "cloudflared-quick-tunnel.yml";
export const QUICK_TUNNEL_CONFIG_TEXT = [
  "# Written by ShunCode for the Bridge Quick Tunnel. cloudflared is started with --config pointing here, so",
  "# ~/.cloudflared/config.yml (ingress rules, tunnel IDs, protocol) does not apply to the Bridge address.",
  "no-autoupdate: true",
  "",
].join("\n");
/** Auto route with a proxy available: how long a direct start may take to register an edge connection. */
export const QUICK_TUNNEL_DIRECT_PROBE_MS = 45_000;
export const QUICK_TUNNEL_EDGE_TIMEOUT_MS = 120_000;

export function normalizeEdgeRouteSetting(value: unknown): CloudflareEdgeRouteSetting {
  return value === "direct" || value === "proxy" ? value : "auto";
}

export function quickTunnelArgs(options: { localPort: number; configFile: string; route: QuickTunnelRoute; relayPort?: number }): string[] {
  if (!options.configFile) throw new Error("Quick Tunnel needs its own cloudflared config file.");
  const args = ["tunnel", "--config", options.configFile, "--no-autoupdate"];
  if (options.route === "proxy") {
    if (!options.relayPort) throw new Error("Quick Tunnel proxy route needs a relay port.");
    const edge = `127.0.0.1:${options.relayPort}`;
    // Listed twice: cloudflared splits static edge addresses into two regions by index.
    args.push("--protocol", "http2", "--edge", edge, "--edge", edge);
  } else {
    args.push("--protocol", "auto");
  }
  args.push("--url", `http://127.0.0.1:${options.localPort}`);
  return args;
}

/** Route of the next start attempt. Auto goes through the proxy once direct failed, or once the proxy worked. */
export function chooseQuickTunnelRoute(options: { setting: CloudflareEdgeRouteSetting; proxyAvailable: boolean; directFailed: boolean; proxyWorked: boolean }): QuickTunnelRoute {
  if (options.setting !== "auto") return options.setting;
  if (!options.proxyAvailable) return "direct";
  return options.directFailed || options.proxyWorked ? "proxy" : "direct";
}

/** Edge-registration deadline of one start attempt: short only while auto still has the proxy route to try. */
export function quickTunnelEdgeTimeoutMs(options: { setting: CloudflareEdgeRouteSetting; route: QuickTunnelRoute; proxyAvailable: boolean }): number {
  return options.setting === "auto" && options.route === "direct" && options.proxyAvailable ? QUICK_TUNNEL_DIRECT_PROBE_MS : QUICK_TUNNEL_EDGE_TIMEOUT_MS;
}
