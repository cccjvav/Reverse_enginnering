import * as vscode from 'vscode';
import { EXTERNAL_MCP_OAUTH_PATH, EXTERNAL_MCP_OAUTH_PORT, parseExternalMcpOAuth } from '../../../src/external-mcp-oauth-config.js';
import type { ExternalMcpCatalog } from './external-mcp-catalog.js';
import { ExternalMcpOAuth } from './external-mcp-oauth.js';
import { OAuthActionError } from './external-mcp-oauth-flow.js';
import { validateSecretValue } from './external-mcp-secret-fields.js';

/** Local UI commands only. No browser/login tool is exposed to remote MCP callers. */
export function createExternalMcpOAuth(catalog: ExternalMcpCatalog, changed: () => void): { oauth: ExternalMcpOAuth; disposables: vscode.Disposable[] } {
  const oauth = new ExternalMcpOAuth(catalog, {
    trusted: () => vscode.workspace.isTrusted,
    changed,
    openAuthorization: async (url, resource) => {
      if (!vscode.workspace.isTrusted) return false;
      const scope = (url.searchParams.get('scope') ?? '由服务请求').slice(0, 1000);
      const confirm = await vscode.window.showInformationMessage(`为 MCP ${resource.origin} 打开 OAuth 授权页面？`,
        { modal: true, detail: `认证站点：${url.origin}\n请求权限：${scope}\n授权凭据将由本机编辑器与已启用的 Bridge 共用。请自行完成浏览器登录，不要把授权码或令牌粘贴给智能体。` }, '打开浏览器授权');
      return confirm === '打开浏览器授权' && vscode.workspace.isTrusted && await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
    },
  });
  const disposables: vscode.Disposable[] = [oauth];
  const command = (name: string, fn: (...args: unknown[]) => unknown) => disposables.push(vscode.commands.registerCommand(name, fn));
  const idOf = (id: unknown) => { if (typeof id !== 'string') throw new Error('MCP 服务 ID 无效。'); return id; };

  command('shuncode.mcp.oauth.authorize', async input => {
    const id = idOf(input);
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'MCP OAuth：请在本机浏览器完成授权', cancellable: true }, async (_progress, cancellation) => {
      const controller = new AbortController();
      const subscription = cancellation.onCancellationRequested(() => controller.abort());
      if (cancellation.isCancellationRequested) controller.abort();
      try { return await oauth.authorize(id, controller.signal); }
      catch (error) {
        if (error instanceof OAuthActionError && error.code === 'OAUTH_CANCELLED') return { cancelled: true, authorized: false };
        throw error;
      } finally { subscription.dispose(); }
    });
  });
  command('shuncode.mcp.oauth.cancel', id => { oauth.cancel(idOf(id)); return { cancelled: true }; });
  command('shuncode.mcp.oauth.logout', async input => {
    const id = idOf(input);
    const answer = await vscode.window.showWarningMessage('退出此 MCP 的本机 OAuth 授权？', { modal: true, detail: '编辑器与 Bridge 都将停止使用本机保存的令牌；不会自动撤销认证服务端的授权。如需彻底撤销，请同时前往该服务的账号设置。' }, '退出本机授权');
    if (answer !== '退出本机授权') return { cancelled: true };
    await oauth.logout(id); return { signedOut: true };
  });
  command('shuncode.mcp.oauth.configure', async input => {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任工作区。');
    const id = idOf(input), server = catalog.snapshot().servers.find(item => item.id === id);
    if (!server || server.transport !== 'http') throw new Error('请选择 HTTP/SSE MCP 服务。');
    const clientId = await vscode.window.showInputBox({ title: 'OAuth Client ID（可选）', prompt: '留空使用服务端动态客户端注册；不支持自动注册时需填写服务提供的 Client ID。', value: server.oauth?.clientId ?? '', ignoreFocusOut: true });
    if (clientId === undefined) return { cancelled: true };
    const scope = await vscode.window.showInputBox({ title: 'OAuth Scope（可选）', prompt: '以空格分隔；留空采用服务端公布的权限。', value: server.oauth?.scope ?? '', ignoreFocusOut: true });
    if (scope === undefined) return { cancelled: true };
    const port = await vscode.window.showInputBox({ title: 'OAuth 本机回调端口', prompt: `回调地址为 http://127.0.0.1:端口${EXTERNAL_MCP_OAUTH_PATH}；手动注册客户端时须登记这个地址。`, value: String(server.oauth?.redirectPort ?? EXTERNAL_MCP_OAUTH_PORT), ignoreFocusOut: true });
    if (port === undefined) return { cancelled: true };
    let clientSecret: string | undefined;
    if (clientId.trim()) {
      const secret = await vscode.window.showInputBox({ title: 'OAuth Client Secret（可选）', prompt: '公共客户端留空；同一 Client ID 留空会保留已配置的密钥。密钥只进入系统安全存储。', password: true, ignoreFocusOut: true });
      if (secret === undefined) return { cancelled: true };
      if (secret) clientSecret = validateSecretValue('header', secret);
    }
    const parsed = parseExternalMcpOAuth({ authType: 'oauth', oauth: { clientId, scope, redirectPort: port }, ...(clientSecret ? { oauthClientSecret: clientSecret } : {}) });
    await oauth.configure(id, parsed.options!, clientSecret);
    return { configured: true, needsAuthorization: true };
  });
  // Unguessable per-launch capability + exact resource + current workspace/catalog permissions are all required.
  // Neither server IDs nor SecretStorage keys are accepted. This command is not contributed to the command palette.
  command('_shuncode.mcp.oauthToken', (handle, resource, staleStamp) => oauth.editorToken(handle, resource, staleStamp));
  return { oauth, disposables };
}
