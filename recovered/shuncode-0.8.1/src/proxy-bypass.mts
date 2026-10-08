import { BlockList, isIP } from "node:net";

function canonicalHost(value: string): string {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host) === 6) {
    try { return new URL(`http://[${host}]/`).hostname.slice(1, -1); } catch { return host; }
  }
  return host;
}

/** macOS system lists write IPv4 networks abbreviated ("169.254/16", "10/8"); the missing octets are zero.
 * Anything that is not 1-4 dotted decimal octets is left to the regular IP parser. */
function abbreviatedIpv4Network(value: string): string | undefined {
  const parts = value.split(".");
  if (parts.length > 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return undefined;
  return [...parts, "0", "0", "0"].slice(0, 4).join(".");
}

/** NO_PROXY deliberately supports host:port in addition to domain/IP/CIDR rules.
 * System bypass lists can opt out of implicit subdomain matching.
 * Never resolve DNS to test a CIDR: doing so leaks SOCKS destination lookups.
 */
export function matchesProxyBypass(target: URL, raw: string, subdomains = true): boolean {
  let rule = raw.trim().toLowerCase();
  if (!rule) return false;
  const host = canonicalHost(target.hostname);
  if (rule === "*") return true;
  if (rule === "<local>") return !host.includes(".") && !host.includes(":");
  const cidr = rule.match(/^(.+)\/(\d{1,3})$/);
  if (cidr) {
    const network = abbreviatedIpv4Network(cidr[1]!) ?? canonicalHost(cidr[1]!);
    const family = isIP(network);
    if (!family || isIP(host) !== family) return false;
    try {
      const list = new BlockList();
      list.addSubnet(network, Number(cidr[2]), family === 6 ? "ipv6" : "ipv4");
      return list.check(host, family === 6 ? "ipv6" : "ipv4");
    } catch { return false; }
  }
  let port: string | undefined;
  if (rule.startsWith("[")) {
    const match = rule.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!match) return false;
    rule = match[1]!;
    port = match[2];
  } else if ((rule.match(/:/g) ?? []).length === 1) {
    const match = rule.match(/^([^:]+):(\d+)$/);
    if (!match) return false;
    rule = match[1]!;
    port = match[2];
  }
  if (port !== undefined) {
    const number = Number(port);
    if (!Number.isInteger(number) || number < 1 || number > 65535) return false;
    const effectivePort = target.port || ({ "https:": "443", "wss:": "443", "http:": "80", "ws:": "80" }[target.protocol]);
    if (Number(effectivePort) !== number) return false;
  }
  rule = canonicalHost(rule);
  if (isIP(rule)) return host === rule;
  if (rule.includes(":")) return false;
  if (rule.startsWith("*.")) rule = rule.slice(1);
  if (rule.startsWith(".")) {
    const domain = rule.slice(1);
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  }
  if (rule.includes("*")) {
    const pattern = rule.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${pattern}$`).test(host);
  }
  return host === rule || (subdomains && !isIP(host) && host.endsWith(`.${rule}`));
}

export function matchesNoProxy(target: URL, value: string | undefined): boolean {
  return Boolean(value?.split(/[;,]/).some(rule => matchesProxyBypass(target, rule)));
}

/** Only HTTP(S) PAC URLs are accepted; never log embedded credentials or query strings. */
export function isPacUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim().replace(/^pac\+/, ""));
    return ["http:", "https:"].includes(url.protocol)
      && (/^pac\+/i.test(value.trim()) || /\.(?:pac|dat)$/i.test(url.pathname));
  } catch { return false; }
}

export function pacConfigurationError(): Error {
  return new Error("PAC configuration is not a forward proxy endpoint. Configure the PAC URL in system proxy settings and use the Electron system transport, or supply an HTTP/SOCKS5 proxy endpoint for Node-only requests. No automatic proxy/direct fallback was attempted.");
}
