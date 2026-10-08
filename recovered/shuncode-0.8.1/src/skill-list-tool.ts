/** Read-only discovery of installed Skills for remote MCP clients. */
export interface AgentSkillItem {
  name: string;
  title: string;
  description: string;
  scope: "global" | "workspace";
  directory: string;
  skillFile: string | null;
  /** Whether the root instruction file exists; NOT MCP registration status. */
  loaded: boolean;
  enabled: boolean;
  reason?: string;
  reasonCode?: string;
}
export interface AgentSkillListing {
  directory: string;
  enabled: boolean;
  skills: AgentSkillItem[];
}

export const LIST_SKILLS_TOOL = {
  name: "list_skills",
  title: "List Installed Skills",
  description: "Discover installed Skills and their absolute directory and skillFile paths on the connected host. Skills are folders of instructions and resources, NOT MCP tools. Read the returned SKILL.md / skill.md file, then relevant referenced files as needed; do not invoke the Skill name as a tool. Read-only: does not execute, install or modify Skills. A failed listing does not mean no Skills are installed.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object", required: ["directory", "enabled", "skills"], additionalProperties: false,
    properties: {
      directory: { type: "string", description: "Configured global skill directory." },
      enabled: { type: "boolean", description: "Effective Skill master switch." },
      skills: { type: "array", items: {
        type: "object", required: ["name", "title", "description", "scope", "directory", "skillFile", "loaded", "enabled"], additionalProperties: false,
        properties: {
          name: { type: "string", description: "Skill identifier, not an MCP tool name." },
          title: { type: "string" }, description: { type: "string" },
          scope: { type: "string", enum: ["global", "workspace"] },
          directory: { type: "string", description: "Absolute Skill directory on the connected host." },
          skillFile: { type: ["string", "null"], description: "Actual root instruction file path, or null if missing." },
          loaded: { type: "boolean", description: "Root instruction file found; not tool availability." }, enabled: { type: "boolean" },
          reason: { type: "string" }, reasonCode: { type: "string" },
        },
      } },
    },
  },
  annotations: { title: "List Installed Skills", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
} as const;

export function formatSkillListing(listing: AgentSkillListing): string {
  const lines = [`已安装 Skills：共 ${listing.skills.length} 个。总开关：${listing.enabled ? "开" : "关"}。`, `全局目录：${listing.directory}`];
  if (!listing.skills.length) lines.push("当前没有已安装的 Skill；无需为了查看清单而创建技能草稿。");
  else lines.push("Skill 不是 MCP 工具。请先读取下列说明文件，再按需读取目录内的参考资料、资源或脚本；不要把 Skill 名称当作工具调用。路径属于所连接的主机，不是聊天沙箱。");
  for (const skill of listing.skills) {
    lines.push(`- ${skill.name || skill.title} [${skill.scope === "global" ? "全局" : "项目"}·${skill.loaded ? "已加载" : "未加载"}]${skill.reason ? ` ${skill.reason}` : ""}`);
    lines.push(`  目录：${skill.directory}`, `  说明文件：${skill.skillFile ?? "缺少根目录 skill.md / SKILL.md"}`);
    const description = skill.description.replace(/\s+/g, " ").trim();
    if (description) lines.push(`  说明：${description.slice(0, 300)}${description.length > 300 ? "…" : ""}`);
  }
  return lines.join("\n");
}
