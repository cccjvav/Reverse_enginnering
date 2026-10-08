import { randomUUID } from 'node:crypto';

/**
 * "开放已有服务给 Bridge…" (R2 §6.1-3, B4): the native configuration (headers, env, args) reaches the extension only as
 * a command argument and waits here, in memory, for at most five minutes. The page shows a redacted view and imports
 * by reference, so no credential is ever placed in the textarea.
 */
export const NATIVE_REF_TTL_MS = 5 * 60 * 1000;
const MAX_REFS = 10;
const refs = new Map<string, { raw: string; expires: number }>();

function sweep(now: number): void {
  for (const [ref, entry] of refs) if (entry.expires <= now) refs.delete(ref);
}

export function rememberNativeConfig(raw: string, now = Date.now()): string {
  sweep(now);
  while (refs.size >= MAX_REFS) refs.delete(refs.keys().next().value!);
  const ref = `native-${randomUUID()}`;
  refs.set(ref, { raw, expires: now + NATIVE_REF_TTL_MS });
  return ref;
}

export function recallNativeConfig(ref: unknown, now = Date.now()): string {
  sweep(now);
  const entry = typeof ref === 'string' ? refs.get(ref) : undefined;
  if (!entry) throw new Error('原生配置的暂存已过期（5 分钟）或无效，请重新选择「开放已有服务给 Bridge…」。');
  return entry.raw;
}

export function forgetNativeConfig(ref: string): void { refs.delete(ref); }

/** Read-only view for the page: structure and names only, every value hidden. */
export function redactedNativeView(servers: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(servers)) {
    const config = (value && typeof value === 'object' ? value : {}) as { type?: unknown; command?: unknown; args?: unknown; url?: unknown; env?: unknown; headers?: unknown };
    lines.push(`${name}：`);
    if (typeof config.url === 'string') {
      let origin = '(无效地址)';
      try { const url = new URL(config.url); origin = `${url.protocol}//${url.host}`; } catch { /* shown as invalid */ }
      lines.push(`  Streamable HTTP · ${origin}（完整地址按敏感值保存）`);
    } else {
      lines.push(`  stdio · ${typeof config.command === 'string' ? config.command : '(无命令)'}`);
      lines.push(`  ${Array.isArray(config.args) ? config.args.length : 0} 个参数（敏感值不显示）`);
    }
    for (const [label, map] of [['Header', config.headers], ['环境变量', config.env]] as const) {
      if (map && typeof map === 'object') for (const key of Object.keys(map)) lines.push(`  ${label} ${key}：（来自原生配置，已隐藏）`);
    }
  }
  return lines.join('\n');
}
