import * as vscode from 'vscode';
import type { ExternalMcpCatalog } from './external-mcp-catalog.js';
import { clearAllSecrets, clearSecret, getSecretRefs, replaceArgs, replaceUrl, setProxyMode, setSecret } from './external-mcp-secret-admin.js';

/**
 * Credential commands behind the Skill page's 「密钥…」 menu (R2 §6.1-4). Names and counts go to the page; values only
 * come in. Each change is followed by `onChanged` so the Bridge reconnects with the new credentials.
 */
export function registerExternalMcpSecretCommands(catalog: ExternalMcpCatalog, onChanged: () => void): vscode.Disposable[] {
  const changing = (run: (...args: unknown[]) => Promise<void>) => async (...args: unknown[]): Promise<{ updated: true }> => {
    await run(...args);
    onChanged();
    return { updated: true };
  };
  return [
    vscode.commands.registerCommand('shuncode.mcp.getSecretRefs', (id: unknown) => getSecretRefs(catalog, id)),
    vscode.commands.registerCommand('shuncode.mcp.setSecret', changing((id, kind, name, value) => setSecret(catalog, id, kind, name, value))),
    vscode.commands.registerCommand('shuncode.mcp.clearSecret', changing((id, kind, name) => clearSecret(catalog, id, kind, name))),
    vscode.commands.registerCommand('shuncode.mcp.clearAllSecrets', changing(id => clearAllSecrets(catalog, id))),
    vscode.commands.registerCommand('shuncode.mcp.replaceUrl', changing((id, url) => replaceUrl(catalog, id, url))),
    vscode.commands.registerCommand('shuncode.mcp.replaceArgs', changing((id, args) => replaceArgs(catalog, id, args))),
    vscode.commands.registerCommand('shuncode.mcp.setProxyMode', changing((id, mode, proxy) => setProxyMode(catalog, id, mode, proxy))),
  ];
}
