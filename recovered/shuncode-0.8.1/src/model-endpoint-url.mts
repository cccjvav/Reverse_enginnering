/** Standard OpenAI-compatible hosts accept /v1; keep custom proxy routes and
 * the official DeepSeek root (which already serves /chat/completions) intact. */
export function normalizeOpenAIBaseUrl(value: string, preserveUnversioned = false): string {
  // Both Responses and Chat Completions resolve against this same canonical
  // base. A pasted endpoint (or an accidentally repeated /v1) is not a new
  // prefix: strip it before adding exactly one endpoint path.
  const base = value.trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|models)\/?$/i, '').replace(/(?:\/v1){2,}$/i, '/v1');
  if (!base) throw new Error('ShunCode model Base URL is empty.');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ShunCode model Base URL must use HTTP or HTTPS.');
  if (!preserveUnversioned && !url.search && !url.hash && (url.pathname === '/' || url.pathname === '/api') && url.hostname.toLowerCase() !== 'api.deepseek.com') {
    return `${base}/v1`;
  }
  return base;
}

export function normalizeOpenAIModelsUrl(value: string, preserveUnversioned = false): string {
  return `${normalizeOpenAIBaseUrl(value, preserveUnversioned)}/models`;
}

/** Keep route diagnostics useful without printing URL credentials or query-string API keys. */
export function redactModelEndpointForLog(value: string): string {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/');
    const path = parts.map((part, index) => {
      const decoded = decodeURIComponent(part);
      return /^(?:sk[-_]|key[-_]|token[-_])/i.test(decoded)
        || /^[a-z0-9_-]{32,}$/i.test(decoded)
        || /^(?:key|token|secret)$/i.test(parts[index - 1] ?? '')
        ? '[redacted]' : part;
    }).join('/');
    return `${url.origin}${path}`;
  } catch {
    return '<invalid URL>';
  }
}

/** The provider form's Test button checks /models, not a chat completion. */
export async function testOpenAIModelsEndpoint(
  value: string,
  apiKey: string,
  protocol: unknown,
  onFailure: (diagnostic: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  let modelsUrl: string | undefined;
  let response: Response | undefined;
  const logFailure = () => {
    const endpoint = modelsUrl ? redactModelEndpointForLog(modelsUrl) : '<unresolved>';
    const redirected = response?.url && response.url !== modelsUrl ? ` redirected=${redactModelEndpointForLog(response.url)}` : '';
    onFailure(`[api-test] endpoint=${endpoint}${redirected} status=${response?.status ?? 'n/a'} content-type=${response?.headers.get('content-type')?.slice(0, 120) ?? '(none)'}`);
  };
  try {
    modelsUrl = normalizeOpenAIModelsUrl(value, protocol === 'auto');
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    response = await fetchImpl(modelsUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      logFailure();
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    const payload: unknown = await response.json();
    const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>).data : undefined;
    const models = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
    return { ok: true, count: models.length };
  } catch (error) {
    logFailure();
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
