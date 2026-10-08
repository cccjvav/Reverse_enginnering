import { lookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { classifyExternalMcpError } from '../../../src/external-mcp-network-errors.js';
import { matchesNoProxy } from './proxy-bypass.mjs';

/**
 * 「网络诊断」 for a shared HTTP MCP server (R2 §7.3.2), run only after the user agrees. Credential-free by design: no
 * Authorization, no path or query of the stored address; results name protocol//host only. Stages: route decision →
 * DNS → TCP (or proxy CONNECT) → TLS → HTTP (any status, 401/405 included, means reachable).
 */
export type DiagnosisStage = 'route' | 'dns' | 'tcp' | 'tls' | 'http';
export interface DiagnosisStep { stage: DiagnosisStage; ok: boolean; detail: string }
export interface DiagnosisReport { target: string; route: string; steps: DiagnosisStep[]; ok: boolean }
export interface DiagnosisDeps {
  lookup(host: string): Promise<{ address: string }>;
  connect(host: string, port: number, timeoutMs: number): Promise<net.Socket>;
  secure(socket: net.Socket, servername: string, timeoutMs: number): Promise<tls.TLSSocket>;
  request(socket: net.Socket | tls.TLSSocket, lines: string[], timeoutMs: number): Promise<string>;
}
const TIMEOUT_MS = 5_000;

export function safeProxyLabel(proxy: string): string {
  try { const url = new URL(proxy); return `${url.protocol}//${url.host}`; } catch { return '(无效代理地址)'; }
}

/**
 * The route of one diagnosed address: the per-address decision real connections make (loopback, the system bypass
 * list, NO_PROXY and `http.noProxy` go direct), not the representative probe used for stdio proxy variables. Found in
 * the 09-25 acceptance: a healthy http://127.0.0.1 server was probed through the system proxy and reported failing.
 */
export function diagnosisRoute(target: URL, input: { proxySupport: string; configuredProxy?: string; noProxy: readonly string[] }, resolve: (target: URL, configuredProxy?: string) => string | undefined): { proxy?: string; proxySupport: string } {
  if (input.proxySupport === 'off' || matchesNoProxy(target, input.noProxy.join(','))) return { proxySupport: input.proxySupport };
  const proxy = resolve(target, input.configuredProxy)?.replace(/\/$/, '');
  return proxy ? { proxy, proxySupport: input.proxySupport } : { proxySupport: input.proxySupport };
}

export const defaultDiagnosisDeps: DiagnosisDeps = {
  lookup: host => lookup(host),
  connect: (host, port, timeoutMs) => new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs, () => socket.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })));
    socket.once('connect', () => { socket.setTimeout(0); resolve(socket); });
    socket.once('error', reject);
  }),
  secure: (socket, servername, timeoutMs) => new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername, ALPNProtocols: ['http/1.1'] });
    secured.setTimeout(timeoutMs, () => secured.destroy(Object.assign(new Error('tls timeout'), { code: 'ETIMEDOUT' })));
    secured.once('secureConnect', () => { secured.setTimeout(0); resolve(secured); });
    secured.once('error', reject);
  }),
  request: (socket, lines, timeoutMs) => new Promise((resolve, reject) => {
    let data = '';
    socket.setTimeout(timeoutMs, () => socket.destroy(Object.assign(new Error('response timeout'), { code: 'ETIMEDOUT' })));
    const done = () => { socket.setTimeout(0); socket.removeAllListeners('data'); resolve(data.split('\r\n')[0] ?? ''); };
    socket.on('data', chunk => { data += chunk.toString('latin1'); if (data.includes('\r\n')) done(); });
    socket.once('error', reject);
    socket.once('end', () => { if (!data.includes('\r\n')) reject(Object.assign(new Error('closed'), { code: 'ECONNRESET' })); });
    socket.write(lines.join('\r\n') + '\r\n\r\n');
  }),
};

export async function diagnoseExternalMcp(address: string, route: { proxy?: string; proxySupport: string }, deps: DiagnosisDeps = defaultDiagnosisDeps): Promise<DiagnosisReport> {
  const url = new URL(address);
  const target = `${url.protocol}//${url.host}`;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const proxy = route.proxySupport === 'off' ? undefined : route.proxy;
  const proxyUrl = proxy ? new URL(proxy) : undefined;
  const socks = proxyUrl?.protocol.startsWith('socks');
  const routeText = route.proxySupport === 'off' ? '直连（http.proxySupport = off）' : proxyUrl ? `经代理 ${safeProxyLabel(proxy!)}` : '直连';
  const steps: DiagnosisStep[] = [{ stage: 'route', ok: true, detail: routeText }];
  const fail = (stage: DiagnosisStage, error: unknown): DiagnosisReport => {
    steps.push({ stage, ok: false, detail: classifyExternalMcpError(error).message });
    return { target, route: routeText, steps, ok: false };
  };
  if (socks) {
    steps.push({ stage: 'tcp', ok: false, detail: 'SOCKS 代理只能在实际连接中验证；请确认代理软件已开启，并检查「连接」类错误提示。' });
    return { target, route: routeText, steps, ok: false };
  }
  if (!proxyUrl) {
    try { await deps.lookup(url.hostname); steps.push({ stage: 'dns', ok: true, detail: `已解析 ${url.hostname}` }); }
    catch (error) { return fail('dns', error); }
  } else steps.push({ stage: 'dns', ok: true, detail: '由代理解析目标地址' });
  let socket: net.Socket | tls.TLSSocket | undefined;
  try {
    try { socket = await deps.connect(proxyUrl ? proxyUrl.hostname : url.hostname, proxyUrl ? Number(proxyUrl.port || 80) : port, TIMEOUT_MS); }
    catch (error) { return fail('tcp', error); }
    if (proxyUrl) {
      let status: string;
      // CONNECT carries no credential of the MCP server; proxy credentials (if any) are never sent by the diagnosis.
      try { status = await deps.request(socket, [`CONNECT ${url.hostname}:${port} HTTP/1.1`, `Host: ${url.hostname}:${port}`], TIMEOUT_MS); }
      catch (error) { return fail('tcp', error); }
      const code = Number(/^HTTP\/1\.[01] (\d{3})/.exec(status)?.[1]);
      if (code !== 200) return fail('tcp', code === 407 ? { status: 407 } : new Error(`Proxy response (${Number.isFinite(code) ? code : 0}) !== 200 when HTTP Tunneling`));
      steps.push({ stage: 'tcp', ok: true, detail: `代理隧道已建立（CONNECT ${url.host}）` });
    } else steps.push({ stage: 'tcp', ok: true, detail: `已连接 ${url.host}` });
    if (url.protocol === 'https:') {
      try { socket = await deps.secure(socket, url.hostname, TIMEOUT_MS); steps.push({ stage: 'tls', ok: true, detail: '证书校验通过' }); }
      catch (error) { return fail('tls', error); }
    }
    let line: string;
    try { line = await deps.request(socket, [`HEAD / HTTP/1.1`, `Host: ${url.host}`, 'User-Agent: ShunCode-MCP-Diagnosis', 'Connection: close'], TIMEOUT_MS); }
    catch (error) { return fail('http', error); }
    const code = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(line)?.[1];
    if (!code) return fail('http', { code: 'CLIENT_HTTP_UNEXPECTED_CONTENT' });
    steps.push({ stage: 'http', ok: true, detail: `服务器可达（HTTP ${code}；401/405 同样表示可达，诊断不带任何密钥）` });
    return { target, route: routeText, steps, ok: true };
  } finally { socket?.destroy(); }
}

export function formatDiagnosis(report: DiagnosisReport): string {
  const names: Record<DiagnosisStage, string> = { route: '路由', dns: 'DNS', tcp: '连接', tls: 'TLS', http: 'HTTP' };
  return [`目标：${report.target}`, ...report.steps.map(step => `${step.ok ? '✓' : '✗'} ${names[step.stage]}：${step.detail}`)].join('\n');
}
