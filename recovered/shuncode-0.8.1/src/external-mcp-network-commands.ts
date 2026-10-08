import * as vscode from 'vscode';
import type { ExternalMcpCatalog } from './external-mcp-catalog.js';
import { diagnoseExternalMcp, formatDiagnosis } from './external-mcp-diagnose.js';
import type { ExternalMcpNetwork } from './external-mcp-network.js';

/**
 * 「网络诊断」 behind the Skill page's row button (R2 §7.3.2): asks first, probes without credentials, shows the result
 * in Chinese and logs only the stages, never the address path, query, headers or proxy credentials.
 */
export function registerExternalMcpNetworkCommands(catalog: ExternalMcpCatalog, network: ExternalMcpNetwork, output: vscode.OutputChannel): vscode.Disposable[] {
  return [vscode.commands.registerCommand('shuncode.mcp.diagnose', async (id: unknown) => {
    const server = typeof id === 'string' ? catalog.snapshot().servers.find(item => item.id === id) : undefined;
    if (!server) throw new Error('MCP 服务已变化，请刷新。');
    if (server.transport !== 'http') {
      void vscode.window.showInformationMessage(`「${server.label}」是本机 stdio 服务，不经网络连接；请检查启动命令，或在「密钥…」→「网络代理…」中调整它访问网络时使用的代理。`);
      return { cancelled: true };
    }
    const runtime = await catalog.resolve(server);
    const target = new URL(runtime.url!);
    const origin = `${target.protocol}//${target.host}`;
    const consent = await vscode.window.showWarningMessage(`对 ${origin} 做网络诊断？`, { modal: true, detail: '依次检查路由、DNS、连接（或代理隧道）、TLS 和 HTTP 可达性。只访问 协议//主机，不发送任何密钥、路径或查询参数。' }, '开始诊断');
    if (consent !== '开始诊断') return { cancelled: true };
    // The diagnosed address decides the route, as for real connections (loopback, system bypass, http.noProxy: direct).
    const report = await diagnoseExternalMcp(origin, network.routeFor(target));
    output.appendLine(`[external-mcp] ${server.id}: diagnosis ${report.steps.map(step => `${step.stage}=${step.ok ? 'ok' : 'fail'}`).join(' ')}`);
    await vscode.window.showInformationMessage(report.ok ? `网络诊断完成：${origin} 可达` : `网络诊断发现问题：${origin}`, { modal: true, detail: formatDiagnosis(report) });
    return { report };
  })];
}
