import os from 'node:os';
import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { externalMcpTimeout } from '../../../src/external-mcp-import.js';
import type { ResolvedExternalMcpServer } from './external-mcp-catalog.js';
import type { ExternalMcpConnection, ExternalMcpTool } from './external-mcp-registry.js';
import { managedStdioEnvironment } from './external-mcp-stdio-env.js';

const DEFAULT_TIMEOUTS = { connect: 5_000, list: 3_000, call: 20_000 } as const;
/** Explicit timeout is in seconds in the form/catalog and milliseconds at the transport boundary. */
export function externalMcpTimeoutMs(config: Pick<ResolvedExternalMcpServer, 'timeout'>, phase: keyof typeof DEFAULT_TIMEOUTS): number {
  const seconds = externalMcpTimeout(config.timeout);
  return seconds === undefined ? DEFAULT_TIMEOUTS[phase] : Math.round(seconds * 1000);
}

async function connectWithin(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('upstream connection timed out'), { name: 'TimeoutError' })), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * The only SDK construction point. Auto probes Streamable HTTP first and only falls back on a transport-mismatch
 * status, never on authentication/rate-limit/server/network errors. Each attempt owns a fresh client. SSE GET and
 * message POST share the same headers and redirect/origin guard. Shared OAuth credentials are resolved per request.
 */
export async function connectExternalMcp(config: ResolvedExternalMcpServer, onChanged: () => void, onClosed: () => void, bundledBinDir?: string, firstConnectTimeoutMs?: number): Promise<ExternalMcpConnection> {
  const mode = config.httpTransport ?? 'streamable-http'; // Existing catalogs retain their explicit HTTP behavior.
  const attempts = config.transport === 'stdio' ? ['stdio'] as const
    : mode === 'auto' ? ['streamable-http', 'sse'] as const : [mode];
  for (const attempt of attempts) {
    const client = new Client({ name: 'shuncode-bridge-upstream', version: '1.0.0' }, {
      capabilities: {}, listChanged: { tools: { onChanged: () => onChanged() } },
    });
    let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | undefined;
    let probeStatus: number | undefined;
    try {
      if (attempt === 'stdio') {
        if (!config.command) throw new Error('missing command');
        const stdio = new StdioClientTransport({
          command: config.command, args: config.args ?? [], env: managedStdioEnvironment(config.env, process.env, process.platform, bundledBinDir),
          cwd: config.cwd ?? os.homedir(), stderr: 'pipe',
        });
        stdio.stderr?.on('data', () => undefined); // Drain without logging possible credentials.
        transport = stdio;
      } else {
        if (!config.url) throw new Error('missing URL');
        const endpoint = new URL(config.url);
        const guardedFetch: typeof fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.origin !== endpoint.origin || url.username || url.password || url.hash) {
            throw new Error('MCP endpoint must stay on the configured origin');
          }
          const authorization = await config.oauth?.token();
          const headers = new Headers(init?.headers ?? config.headers);
          if (authorization) headers.set('Authorization', `Bearer ${authorization.token}`);
          let response = await fetch(input, { ...init, headers, redirect: 'error' });
          // Retry exactly once on a rejected token, never widen scope or open a browser on background traffic.
          if (response.status === 401 && authorization && config.oauth) {
            await response.body?.cancel().catch(() => undefined);
            const renewed = await config.oauth.token(authorization.stamp);
            headers.set('Authorization', `Bearer ${renewed.token}`);
            response = await fetch(input, { ...init, headers, redirect: 'error' });
          }
          if (attempt === 'streamable-http' && probeStatus === undefined && (init?.method ?? 'GET').toUpperCase() === 'POST') probeStatus = response.status;
          return response;
        };
        const options = { requestInit: { headers: config.headers }, fetch: guardedFetch };
        transport = attempt === 'sse'
          ? new SSEClientTransport(endpoint, options)
          : new StreamableHTTPClientTransport(endpoint, options);
      }
      const timeout = firstConnectTimeoutMs ?? externalMcpTimeoutMs(config, 'connect');
      await connectWithin(client.connect(transport, { timeout }), timeout);
      client.onclose = onClosed;
      client.onerror = () => onClosed();
      return {
        list: async signal => (await client.listTools(undefined, { signal, timeout: externalMcpTimeoutMs(config, 'list') })).tools as ExternalMcpTool[],
        call: (name, args, signal) => client.callTool({ name, arguments: args }, { signal, timeout: externalMcpTimeoutMs(config, 'call') }),
        close: () => client.close(),
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      await transport?.close().catch(() => undefined);
      if (mode === 'auto' && attempt === 'streamable-http' && probeStatus !== undefined && [400, 404, 405, 406, 415].includes(probeStatus)) continue;
      throw error;
    }
  }
  throw new Error('MCP transport unavailable');
}
