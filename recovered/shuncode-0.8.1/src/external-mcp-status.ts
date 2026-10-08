import type { ExternalMcpHealth } from './external-mcp-registry.js';

/**
 * One status vocabulary for a shared MCP server (R2 §6.2). The Skill page defines the same list in
 * shunCodeMcpStatus.ts (no shared types across the extension/workbench boundary); a contract test keeps them equal.
 */
export type ExternalMcpStatus = 'disabled' | 'stopped' | 'connecting' | 'reconnecting' | 'running' | 'needs-auth' | 'proxy-error' | 'failed';
export const EXTERNAL_MCP_STATUSES: readonly ExternalMcpStatus[] = ['disabled', 'stopped', 'connecting', 'reconnecting', 'running', 'needs-auth', 'proxy-error', 'failed'];

/** Result of checking a server's SecretStorage references without handing any value to the page. */
export type ExternalMcpRefState = 'ok' | 'missing-secret' | 'broken';
export type ExternalMcpEditorState = 'restricted' | 'disabled' | 'needs-auth' | 'failed' | 'published';
export interface ExternalMcpBridgeView { status: ExternalMcpStatus; toolCount: number; reason?: string }

const MISSING_SECRET = '密钥缺失或不完整；请点「密钥…」补充。';
const BROKEN = '配置或凭据缺失，请重新导入。';

export function bridgeStatusOf(server: { enabled: boolean; bridgeEnabled: boolean }, context: { bridgeRunning: boolean; refs: ExternalMcpRefState; health?: ExternalMcpHealth }): ExternalMcpBridgeView {
  if (!server.enabled || !server.bridgeEnabled) return { status: 'disabled', toolCount: 0 };
  if (context.refs === 'missing-secret') return { status: 'needs-auth', toolCount: 0, reason: MISSING_SECRET };
  if (context.refs === 'broken') return { status: 'failed', toolCount: 0, reason: BROKEN };
  const health = context.health;
  if (!context.bridgeRunning || !health || health.state === 'off') return { status: 'stopped', toolCount: 0 };
  if (health.state === 'connecting') return { status: health.reconnecting ? 'reconnecting' : 'connecting', toolCount: 0 };
  if (health.state === 'ready') return { status: 'running', toolCount: health.toolCount };
  return { status: health.status ?? 'failed', toolCount: 0, reason: health.error };
}

/** The editor connects on demand inside the workbench; the page combines this with the native connection state. */
export function editorStateOf(server: { enabled: boolean; editorEnabled: boolean }, context: { trusted: boolean; refs: ExternalMcpRefState; health?: ExternalMcpHealth }): ExternalMcpEditorState {
  if (!context.trusted) return 'restricted';
  if (!server.enabled || !server.editorEnabled) return 'disabled';
  if (context.refs === 'missing-secret' || context.health?.status === 'needs-auth') return 'needs-auth';
  if (context.refs === 'broken') return 'failed';
  return 'published';
}

/** Legacy one-line text kept for older pages and logs. */
export function legacyEditorStatus(state: ExternalMcpEditorState): string {
  switch (state) {
    case 'restricted': return '受限';
    case 'disabled': return '未启用';
    case 'needs-auth': return MISSING_SECRET;
    case 'failed': return '配置或凭据缺失，请重新导入';
    case 'published': return '已发布给编辑器（按需连接）';
  }
}
