/**
 * Bridge 启动失败的稳定错误码（R2 §8.3，P7）。
 *
 * 纯模块：不 import vscode，不做 I/O，可以直接单测。门面（Windows 的 bridge-server.ts）只经这里产生错误码：
 *   - BridgeStartError：门面在自己的抛错点直接带上错误码，message 保持原有英文，lastError 不变；
 *   - classifyBridgeStartFailure：其余错误（授权、隧道输出、健康检查、遗留进程、本地端口与本地健康检查）按启动阶段和
 *     已知输出标记兜底归类，最后才归为 unknown。
 * 页面只按 code / params 渲染中文；英文原文脱敏后只作「技术详情」。
 *
 * 错误码是扩展与 workbench 之间的契约：workbench 侧文案目录 shunCodeBridgeStartupFailureCatalog.ts
 * 必须覆盖这里的每一个码，tests/bridge-startup-failure.test.mjs 逐一核对。
 */

export const BRIDGE_START_FAILURE_CODES = [
  "not-licensed",
  "device-unavailable",
  "signed-out",
  "no-workspace",
  "cleanup-in-progress",
  "disposed",
  "cancelled",
  "ngrok-domain-missing",
  "ngrok-domain-invalid",
  "named-config-missing",
  "named-config-invalid",
  "named-token-invalid",
  "cloudflared-missing",
  "cloudflared-install-failed",
  "ngrok-missing",
  "ngrok-config-invalid",
  "stale-tunnel",
  "local-port-in-use",
  "local-health-failed",
  "ngrok-proxy-rejected",
  "ngrok-endpoint-busy",
  "ngrok-start-failed",
  "edge-unreachable",
  "quick-tunnel-api-failed",
  "tunnel-exited",
  "named-route-mismatch",
  "public-health-unreachable",
  "public-health-timeout",
  "network-failed",
  "tunnel-retrying",
  "reconnecting",
  "license-renew-failed",
  "access-lost",
  "unknown",
] as const;

export type BridgeStartFailureCode = typeof BRIDGE_START_FAILURE_CODES[number];

export type BridgeStartFailureStage =
  | "precheck"
  | "access"
  | "tunnel-client"
  | "lease"
  | "local"
  | "tunnel"
  | "public-health"
  | "reconnect";

/** 渲染文案需要的少量参数：端口、pid、主机名、Service URL、重试与重连次数。不含令牌与私有地址。 */
export type BridgeStartFailureParams = Readonly<Record<string, string | number>>;

/** 访问控制停止 Bridge 的原因，只用于展示（R2 §8.3）。 */
export type BridgeAccessStopReason = "license-renew-failed" | "access-lost";

export interface BridgeStartFailure {
  readonly code: BridgeStartFailureCode;
  readonly stage: BridgeStartFailureStage;
  readonly params?: BridgeStartFailureParams;
  /** 英文原文，已脱敏，只用于「技术详情」。 */
  readonly detail?: string;
  /** 发生时间（毫秒时间戳）。 */
  readonly at: number;
}

/** 门面就地抛出的启动错误。按 failureCode 鸭子类型识别：vm 测试里的跨 realm 错误不能用 instanceof。 */
export class BridgeStartError extends Error {
  constructor(
    readonly failureCode: BridgeStartFailureCode,
    message: string,
    readonly params?: BridgeStartFailureParams,
  ) {
    super(message);
    this.name = "BridgeStartError";
  }
}

export interface BridgeStartFailureContext {
  /** 失败发生的启动阶段（门面按启动时序维护）。 */
  readonly stage: BridgeStartFailureStage;
  /** 门面按当前配置给出的安全参数，例如命名隧道的端口、主机名与 Service URL。 */
  readonly params?: BridgeStartFailureParams;
  readonly now?: number;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(BRIDGE_START_FAILURE_CODES);
const MAX_DETAIL_CHARS = 4_000;

/** 授权阶段：区分设备、登录与未开通三类，其余一律按未开通处理。 */
const ACCESS_RULES: ReadonlyArray<readonly [BridgeStartFailureCode, RegExp]> = [
  // Fail-closed licensing: the license server could not be reached/verified, so Bridge is denied even with a cached license.
  ["license-renew-failed", /could not be verified with the license server/i],
  ["device-unavailable", /installation.*(?:revoked|limit)|device.*(?:revoked|limit)/i],
  ["signed-out", /sign in|signed out|unauthori[sz]ed|session.*expired|\b401\b/i],
];

/**
 * 其余阶段的已知输出标记，按顺序匹配，先到先得。标记来自本仓库真实的抛错文本（bridge-server.ts 的启动、
 * 隧道、健康检查与遗留进程回收，bridge-mcp-transport.ts 的本地监听）和隧道程序的错误码；改动那些文本时，
 * 契约测试会提示同步这里。
 */
const MESSAGE_RULES: ReadonlyArray<readonly [BridgeStartFailureCode, RegExp]> = [
  ["cancelled", /startup (?:was )?cancelled|cancelled by stop/i],
  ["cleanup-in-progress", /cleanup is in progress|Bridge is stopping; refusing|tunnel process is still active; wait for it to exit/i],
  ["disposed", /Bridge has been disposed/i],
  ["no-workspace", /Open a workspace folder|No workspace folder is open/i],
  ["ngrok-domain-missing", /ngrok reserved domain is required/i],
  ["ngrok-domain-invalid", /ngrok reserved domain (?:is not a valid hostname|must use HTTPS)|Enter only the ngrok reserved domain/i],
  ["named-config-missing", /Named Tunnel (?:Token|hostname) is not configured|Named Tunnel hostname is required/i],
  ["named-config-invalid", /Named Tunnel local port must be|Named Tunnel hostname (?:is not a valid hostname|must use HTTPS)|Enter only the cloudflare named tunnel hostname/i],
  ["named-token-invalid", /Named Tunnel authentication failed|invalid tunnel token|failed to parse token/i],
  ["cloudflared-install-failed", /cloudflared installation (?:failed|completed, but)|One-click cloudflared installation is currently supported/i],
  ["cloudflared-missing", /cloudflared was not found|cloudflare(?:-named)? tunnel client is not installed/i],
  ["ngrok-missing", /ngrok was not found|ngrok tunnel client is not installed/i],
  ["stale-tunnel", /tunnel \(pid \d+\) is still running and could not be stopped|did not exit after graceful termination and force kill/i],
  ["local-port-in-use", /local port \d+ is already in use|EADDRINUSE|address already in use/i],
  ["local-health-failed", /Bridge local HTTP (?:health check|port is unavailable)/i],
  ["ngrok-endpoint-busy", /ERR_NGROK_334\b|endpoint is already online|still held by another agent session/i],
  ["ngrok-proxy-rejected", /ERR_NGROK_9009\b/i],
  ["ngrok-config-invalid", /ngrok config check failed|ngrok tunnel configuration is invalid|ERR_NGROK_(?:105|107|4018)\b/i],
  ["ngrok-start-failed", /ngrok failed to establish|ERR_NGROK_\d+/i],
  ["named-route-mismatch", /Named Tunnel connected, but [\s\S]* could not reach Bridge/i],
  ["public-health-unreachable", /Public Bridge health endpoint unreachable/i],
  ["public-health-timeout", /Public Bridge health check timed out/i],
  ["quick-tunnel-api-failed", /failed to request quick tunnel/i],
  ["edge-unreachable", /did not provide a trycloudflare\.com URL|did not register a Cloudflare edge connection|could not reach the Cloudflare edge|connectivity pre-check failed/i],
  ["tunnel-exited", /tunnel exited during startup|exited before the public Bridge health endpoint|exited unexpectedly|tunnel changed before health verification/i],
  ["network-failed", /timed? ?out|timeout|network|fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|\bTLS\b|proxy|quic|unable to establish/i],
];

/** 公网健康检查发生在隧道运行时内部，门面只知道处于隧道阶段；这几类按错误码改记为 public-health。 */
const PUBLIC_HEALTH_CODES: ReadonlySet<BridgeStartFailureCode> = new Set<BridgeStartFailureCode>([
  "named-route-mismatch",
  "public-health-unreachable",
  "public-health-timeout",
]);

/** 每个错误码允许携带的参数；其余参数一律丢弃，避免把无关配置带进状态。 */
const PARAM_KEYS: Partial<Record<BridgeStartFailureCode, readonly string[]>> = {
  "local-port-in-use": ["port", "serviceUrl"],
  "stale-tunnel": ["pid"],
  "named-route-mismatch": ["domain", "serviceUrl"],
  "tunnel-retrying": ["attempt", "total", "seconds"],
  "reconnecting": ["attempt"],
};

export function isBridgeStartFailureCode(value: unknown): value is BridgeStartFailureCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

export function classifyBridgeStartFailure(error: unknown, context: BridgeStartFailureContext): BridgeStartFailure {
  const message = messageOf(error);
  const record = error && typeof error === "object" ? error as { failureCode?: unknown; params?: unknown; code?: unknown } : {};
  const code = isBridgeStartFailureCode(record.failureCode)
    ? record.failureCode
    : context.stage === "access"
      ? firstMatch(ACCESS_RULES, message) ?? "not-licensed"
      : record.code === "EADDRINUSE"
        ? "local-port-in-use"
        : firstMatch(MESSAGE_RULES, message) ?? "unknown";
  const params = pickParams(code, [
    asParams(record.params),
    code === "local-port-in-use" ? portFromMessage(message) : undefined,
    code === "stale-tunnel" ? pidFromMessage(message) : undefined,
    context.params,
  ]);
  const detail = redactBridgeFailureDetail(message);
  return {
    code,
    stage: PUBLIC_HEALTH_CODES.has(code) ? "public-health" : context.stage,
    ...(params ? { params } : {}),
    ...(detail ? { detail } : {}),
    at: context.now ?? Date.now(),
  };
}

/**
 * 技术详情脱敏：MCP / 健康检查路径里的路由令牌、Bearer、各类 token/secret 赋值、URL 里的账号密码、
 * JWT 与隧道令牌样式的长串。页面展示前还会再脱敏一次（纵深防御）。
 */
export function redactBridgeFailureDetail(text: string): string {
  return text
    .replace(/(\/(?:mcp|healthz)\/)[^\s/?#"'<>)]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/((?:auth[_-]?token|access[_-]?token|tunnel[_-]?token|token|password|secret|authorization)\s*[=:]\s*)[^\s,;&]+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\beyJ[A-Za-z0-9_+/=-]{16,}(?:\.[A-Za-z0-9_+/=-]+){0,2}/g, "[redacted]")
    .replace(/[A-Za-z0-9_+=-]{48,}/g, "[redacted]")
    .slice(0, MAX_DETAIL_CHARS);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : String(error ?? "");
}

function firstMatch(rules: ReadonlyArray<readonly [BridgeStartFailureCode, RegExp]>, message: string): BridgeStartFailureCode | undefined {
  return rules.find(([, pattern]) => pattern.test(message))?.[0];
}

function portFromMessage(message: string): BridgeStartFailureParams | undefined {
  const match = /\bport (\d{2,5})\b/i.exec(message);
  return match ? { port: Number(match[1]) } : undefined;
}

function pidFromMessage(message: string): BridgeStartFailureParams | undefined {
  const match = /\(pid (\d+)\)/i.exec(message);
  return match ? { pid: Number(match[1]) } : undefined;
}

function asParams(value: unknown): BridgeStartFailureParams | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as BridgeStartFailureParams : undefined;
}

function pickParams(code: BridgeStartFailureCode, sources: ReadonlyArray<BridgeStartFailureParams | undefined>): BridgeStartFailureParams | undefined {
  const keys = PARAM_KEYS[code];
  if (!keys) return undefined;
  const picked: Record<string, string | number> = {};
  for (const key of keys) {
    for (const source of sources) {
      const value = source?.[key];
      if ((typeof value === "string" && value) || (typeof value === "number" && Number.isFinite(value))) {
        picked[key] = value;
        break;
      }
    }
  }
  return Object.keys(picked).length ? picked : undefined;
}
