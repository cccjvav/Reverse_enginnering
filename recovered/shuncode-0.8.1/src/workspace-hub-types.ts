/** Local application-data protocol, not a public MCP API. */
export interface HubWorkspace {
  id: string;
  name: string;
  uri?: string;
  kind: "folder" | "workspace" | "empty";
  folders: string[];
}
export interface HubWindow {
  version: 1;
  windowId: string;
  workspace: HubWorkspace;
  updatedAt: number;
  bridge: {
    state: "stopped" | "starting" | "running" | "error";
    provider: "cloudflare" | "cloudflare-named" | "ngrok";
    domain: string;
    localPort?: number;
    connected: boolean;
    todos: Array<{ id: string; title: string; status: "pending" | "in_progress" | "completed" }>;
  };
  activeChats: string[];
  syncError?: string;
  /** macOS multi-instance: which `--user-data-dir` process published this window.
   * `windows/` doubles as the instance registry; no separate `instances/` folder.
   */
  instanceId?: string;
  userDataDir?: string;
  pid?: number;
}
export interface HubChatFrame {
  sessionId: string;
  sessionResource: string;
  serialized: string;
  sequence: number;
  generation?: string;
}
export interface HubChat {
  version: 1;
  key: string;
  workspace: HubWorkspace;
  sessionId: string;
  sessionResource: string;
  ownerWindowId: string;
  revision: number;
  sourceSequence: number;
  generation?: string;
  active: boolean;
  deleted: boolean;
  updatedAt: number;
  lastMessageAt: number;
  title: string;
  data: Record<string, unknown> | null;
}
export interface HubChatSummary extends Omit<HubChat, "data"> {
  status: "running" | "idle" | "interrupted";
}
export interface HubOpenRequest {
  version: 1;
  id: string;
  /** `continue` (default) opens a shared chat in its owning workspace.
   * macOS multi-instance additions, always addressed to one live window:
   * `focus` raises that window's process; `copy-address` asks the window that
   * owns a Bridge (and therefore its route token) to copy its full MCP URL.
   */
  kind?: "continue" | "focus" | "copy-address";
  chatKey: string;
  workspaceId: string;
  targetWindowId?: string;
  createdAt: number;
}
export const HUB_WINDOW_TTL_MS = 20_000;
export const HUB_REQUEST_TTL_MS = 120_000;
export const HUB_MAX_CHAT_BYTES = 32 * 1024 * 1024;
