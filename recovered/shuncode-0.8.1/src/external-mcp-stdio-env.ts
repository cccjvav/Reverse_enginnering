/**
 * One environment for managed stdio MCP servers on both surfaces (R2 §7.3.3). The base is the fork's whitelist
 * (vscode-main/src/vs/workbench/api/node/shunCodeManagedMcpEnvironment.ts, compared by a contract test); the proxy part
 * follows ShunCode's proxy decision per server; the user's own env (from SecretStorage) always wins.
 * Editor and Bridge use the same filtered base + optional bundled PATH + proxy/user overrides; the fork rechecks trust.
 */
export const MANAGED_STDIO_WINDOWS_ENV: readonly string[] = ['APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT',
  'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR'];
export const MANAGED_STDIO_POSIX_ENV: readonly string[] = ['HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TEMP', 'TMP', 'TMPDIR', 'USER'];

export type ExternalMcpProxyMode = 'inherit' | 'none' | 'custom';
export interface StdioProxyInput {
  mode: ExternalMcpProxyMode;
  /** `http.proxySupport`: 'off' means direct only. */
  proxySupport: string;
  /** ShunCode's decision for a representative HTTPS target (resolveExtensionHostProxy), undefined = direct. */
  resolvedProxy?: string;
  /** The system uses a PAC script, which environment variables cannot express. */
  pac?: boolean;
  /** Mode `custom`: the user's proxy URL (credentials allowed, it is explicit). */
  customProxy?: string;
  /** `http.noProxy` entries. */
  noProxy?: readonly string[];
  /** Optional PEM bundle appended by Node (NODE_EXTRA_CA_CERTS); a path, not a secret. */
  extraCaCertificates?: string;
}

const canonical = (name: string, platform: NodeJS.Platform): string => platform === 'win32' ? name.toUpperCase() : name;

export function managedStdioBaseEnvironment(host: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const allowed = new Set(platform === 'win32' ? MANAGED_STDIO_WINDOWS_ENV : MANAGED_STDIO_POSIX_ENV);
  const selected: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(host)) {
    const key = canonical(name, platform);
    if (allowed.has(key) && typeof value === 'string') selected[key] = value;
  }
  return selected;
}

function hasCredentials(proxy: string): boolean {
  try { const url = new URL(proxy); return !!(url.username || url.password); } catch { return true; }
}

/** Proxy variables for one server; a notice explains why nothing was injected when the user must choose. */
export function stdioProxyEnvironment(input: StdioProxyInput): { env: Record<string, string>; notice?: string } {
  const env: Record<string, string> = Object.create(null);
  if (input.extraCaCertificates?.trim()) env.NODE_EXTRA_CA_CERTS = input.extraCaCertificates.trim();
  if (input.mode === 'none') return { env };
  let proxy: string | undefined;
  if (input.mode === 'custom') {
    proxy = input.customProxy;
    if (!proxy) return { env, notice: '已选择自定义代理，但尚未填写代理地址。' };
  } else {
    if (input.proxySupport === 'off') return { env };
    if (input.pac && !input.resolvedProxy) return { env, notice: '系统使用 PAC 自动代理，无法写入环境变量；如需代理，请在「网络代理」中选择自定义。' };
    proxy = input.resolvedProxy;
    if (!proxy) return { env };
    if (hasCredentials(proxy)) return { env, notice: '当前代理含用户名或密码，未自动传给 stdio 服务；如需代理，请在「网络代理」中选择自定义。' };
  }
  let url: URL;
  try { url = new URL(proxy); } catch { return { env, notice: '代理地址无效，未注入。' }; }
  if (url.protocol.startsWith('socks')) {
    const socks = `socks5h://${url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''}${url.host}`;
    env.ALL_PROXY = env.all_proxy = socks;
  } else {
    env.HTTP_PROXY = env.HTTPS_PROXY = env.http_proxy = env.https_proxy = proxy;
    env.NODE_USE_ENV_PROXY = '1';
  }
  const bypass = ['localhost', '127.0.0.1', '::1', '.local', ...(input.noProxy ?? []).map(entry => entry.trim()).filter(entry => /^[A-Za-z0-9.*:_\-[\]/]+$/.test(entry))];
  env.NO_PROXY = env.no_proxy = [...new Set(bypass)].join(',');
  return { env };
}

/** Shared process environment for both managed surfaces; explicit server values remain authoritative. */
export function managedStdioEnvironment(serverEnv: Record<string, string> | undefined, host: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, bundledBinDir?: string): Record<string, string> {
  const env = managedStdioBaseEnvironment(host, platform);
  // The bundled directory is part of the default search path, not a forced
  // suffix on an explicit server PATH (including an intentionally empty one).
  const explicitPath = Object.keys(serverEnv ?? {}).some(name => canonical(name, platform) === 'PATH');
  if (bundledBinDir && !explicitPath) {
    const sep = platform === 'win32' ? ';' : ':';
    const identity = (value: string) => {
      const unquoted = value.replace(/^"(.*)"$/, '$1');
      return (platform === 'win32' ? unquoted.replace(/\\/g, '/').toLowerCase() : unquoted).replace(/\/+$/, '');
    };
    const existing = env.PATH;
    if (!existing || !existing.split(sep).some(entry => identity(entry) === identity(bundledBinDir))) {
      env.PATH = existing ? `${existing}${sep}${bundledBinDir}` : bundledBinDir;
    }
  }
  for (const [name, value] of Object.entries(serverEnv ?? {})) {
    // Windows keys are case-insensitive: canonical upper case avoids Path/PATH duplicates, as the fork does.
    const key = canonical(name, platform);
    // The catalog already resolves user-vs-proxy precedence case-insensitively.
    // Do not drop a user value supplied only under a lowercase Windows spelling.
    env[key] = value;
  }
  return env;
}
