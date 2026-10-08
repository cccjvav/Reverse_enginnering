/**
 * Bridge 在扩展侧弹出的通知（R2 §8.4「扩展侧通知」，P7）。
 *
 * 内置扩展的 vscode.l10n 只读取语言包，ShunCode 没有为本扩展提供语言包，所以这里按与 workbench
 * localizeBridge 相同的规则选文案：显示语言为 zh-CN / zh-Hans 时用中文，其余用英文。
 * 通知不拼接英文原文；原文在 Bridge 页的「技术详情」和 ShunCode 输出通道里。
 */
import * as vscode from "vscode";
import type { BridgeAccessStopReason } from "./bridge-start-failure.js";

/** 与 workbench 的 AICustomizationManagementCommands.OpenEditor 一致；参数是 Bridge 页的分区 id。 */
export const OPEN_BRIDGE_PAGE_COMMAND = "aiCustomization.openManagementEditor";
const BRIDGE_PAGE_SECTION = "bridge";

type BridgeNoticeKey =
  | "licenseRenewFailed"
  | "accessLost"
  | "openBridgePage"
  | "showLog"
  | "installingCloudflared"
  | "cloudflaredReady"
  | "installed"
  | "providerFallback";

const TEXT: Readonly<Record<BridgeNoticeKey, readonly [zh: string, en: string]>> = {
  licenseRenewFailed: [
    "Bridge 已停止：授权续期失败。请打开 Bridge 页面刷新授权后再启动；若刚付款，请勿重复购买。",
    "Bridge stopped: its license could not be renewed. Open the Bridge page, refresh access, then start again. If you just paid, do not pay again.",
  ],
  accessLost: [
    "Bridge 已停止：当前账户没有有效授权。请打开 Bridge 页面查看账户与授权。",
    "Bridge stopped: this account has no active access. Open the Bridge page to check Account & Access.",
  ],
  openBridgePage: ["打开 Bridge 页面", "Open Bridge Page"],
  showLog: ["查看日志", "Show Log"],
  installingCloudflared: ["正在用 Winget 为 ShunCode Bridge 安装 cloudflared…", "Installing cloudflared for ShunCode Bridge…"],
  cloudflaredReady: ["cloudflared 已就绪：{0}", "cloudflared is ready: {0}"],
  installed: ["已安装", "installed"],
  providerFallback: [
    "另一个 ShunCode 窗口正在使用「{0}」隧道，本窗口这次改用 Cloudflare 快速隧道（临时地址）。设置里的隧道方式没有改变，那个窗口停止后再启动即可恢复。",
    "Another ShunCode window is using the \"{0}\" tunnel, so this window uses a Cloudflare Quick Tunnel (temporary address) this time. The tunnel setting is unchanged; start again after that window stops to use it.",
  ],
};

export function isBridgeNoticeChinese(language: string = vscode.env.language): boolean {
  const normalized = language.toLowerCase();
  return normalized === "zh-cn" || normalized === "zh-hans" || normalized.startsWith("zh-hans-");
}

export function bridgeNoticeText(key: BridgeNoticeKey, ...args: string[]): string {
  const [zh, en] = TEXT[key];
  return (isBridgeNoticeChinese() ? zh : en).replace(/\{(\d+)\}/g, (_match, index: string) => args[Number(index)] ?? "");
}

/** 访问控制停止 Bridge 后的通知：中文说明，附「打开 Bridge 页面」「查看日志」。不等待用户选择，不阻塞调用方。 */
export function showBridgeAccessStopNotice(reason: BridgeAccessStopReason, output: vscode.OutputChannel): void {
  const openPage = bridgeNoticeText("openBridgePage");
  const showLog = bridgeNoticeText("showLog");
  const message = bridgeNoticeText(reason === "license-renew-failed" ? "licenseRenewFailed" : "accessLost");
  void vscode.window.showWarningMessage(message, openPage, showLog).then(choice => {
    if (choice === openPage) void vscode.commands.executeCommand(OPEN_BRIDGE_PAGE_COMMAND, BRIDGE_PAGE_SECTION);
    else if (choice === showLog) output.show(true);
  });
}

/** 所选隧道方式被另一个窗口占用、本窗口临时改用快速隧道时的说明（信息级，只在本次启动生效）。 */
export function showBridgeProviderFallbackNotice(provider: string, output: vscode.OutputChannel): void {
  const openPage = bridgeNoticeText("openBridgePage");
  const showLog = bridgeNoticeText("showLog");
  void vscode.window.showInformationMessage(bridgeNoticeText("providerFallback", provider), openPage, showLog).then(choice => {
    if (choice === openPage) void vscode.commands.executeCommand(OPEN_BRIDGE_PAGE_COMMAND, BRIDGE_PAGE_SECTION);
    else if (choice === showLog) output.show(true);
  });
}
