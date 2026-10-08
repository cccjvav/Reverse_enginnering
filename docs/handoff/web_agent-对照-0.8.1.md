# web_agent 能从 ShunCode 0.8.1 学到什么

对照对象：
- web_agent `arena/01a0e8ea-web-agent`（提交 `eb1c195`），342 个源码文件 / 103540 行
- ShunCode 0.8.1 恢复出的源码 `recovered/shuncode-0.8.1/` + `reconstructed/carrier-0.8.1/`

**结论先说**：外部 MCP 上两边水平相当，各有胜负；技能系统上 ShunCode 明显更完整。
一共找出 **3 个值得移植的点**和 **1 个不建议动的地方**。

---

## 一、规模对比

| | web_agent | ShunCode 0.8.1 |
|---|---|---|
| 外部 MCP | 2545 行（14 个模块） | 2858 行（17 个扩展文件 + 4 个载体模块） |
| 技能系统 | 198 行（`tools/skills.js`） | 1311 行（2 个扩展文件 + 9 个载体模块） |

外部 MCP 规模接近，所以**不是谁更完整的问题，是各自补齐了不同的洞**。

---

## 二、外部 MCP：web_agent 已经做得很好的部分

先说清楚，免得误导：web_agent 的 MCP 出站实现相当扎实，这些地方**不需要改**。

| 已有能力 | 位置 |
|---|---|
| Streamable HTTP（POST + `Accept: application/json, text/event-stream`，按响应类型分支） | `externalClient.js` |
| 手写 SSE 帧解析，正确处理 `\r\n` 跨 chunk 边界 | `externalClient.js:29-55` |
| `Mcp-Session-Id` 校验**比协议更严**（1–512 可见 ASCII、禁逗号，拒绝合并串） | `externalClient.js` |
| SSRF 防护（拒绝注册自身端口、拒绝自己的隧道源、`localhost`→`127.0.0.1` 不走 DNS） | `externalClient.js:14-24` |
| 256 KiB 响应上限、`redirect:'error'`、严格 UTF-8（`fatal:true`） | `externalClient.js` |
| OAuth 完整：DCR 动态注册、PKCE、令牌刷新、**速率限制** | `oauth.js`（682 行） |
| 预算/配额、请求取消链、MCP resources | `budget.js`、`requestLifecycle.js`、`resources.js` |
| **操作员审批队列** | `operatorQueue`，`externalClient.js:190` |

后三项 **ShunCode 0.8.1 完全没有**（我在 0.8.1 全部扩展+载体源码里搜 `resources/list`、
`rateLimit`、`budget`，三项全部未命中；`approval` 在 external-mcp 各文件中也无命中）。
所以别把 ShunCode 当成全面更优的参照物。

---

## 三、值得移植的 3 个点

### ① 传输自动协商与降级 —— 优先级最高

**现状**：web_agent 出站只走 Streamable HTTP 一种。
它自己的**入站**服务端明确拒绝旧式 HTTP+SSE（`server.js:513` 返回 405，
附言 "Legacy HTTP+SSE is not supported"），这对自家服务端是合理的；
但**出站**连别人的服务器时，对方如果只会旧式 SSE，就直接连不上。

**ShunCode 的做法**（`external-mcp-connection.ts:31-33, 88`）：

```ts
const mode = config.httpTransport ?? 'streamable-http';
const attempts = config.transport === 'stdio' ? ['stdio']
  : mode === 'auto' ? ['streamable-http', 'sse'] : [mode];
...
// 只在这些状态码上降级，绝不在认证/限流/服务端/网络错误上降级
if (mode === 'auto' && attempt === 'streamable-http'
    && probeStatus !== undefined
    && [400, 404, 405, 406, 415].includes(probeStatus)) continue;
```

**为什么这个设计值得抄**：降级条件被刻意收窄了。它只在"对方听不懂这个协议"
（400/404/405/406/415）时退回 SSE；遇到 401/403/429/5xx/网络错误**一律不降级**。
源码注释写得很明白：`never on authentication/rate-limit/server/network errors`。
这避免了"认证失败 → 误以为协议不对 → 换个协议再撞一次"的放大效应。

**移植成本**：小。web_agent 的 `rpc()` 已经能解析 SSE 帧了，缺的是
一个 `httpTransport: 'auto'|'streamable-http'|'sse'` 配置项，和失败后换一次传输重连。

### ② 自定义 CA 证书 —— 企业环境下的硬需求

**现状**：web_agent 全仓搜不到 `NODE_EXTRA_CA_CERTS`、`caCert`、`createSecureContext`。
在有 TLS 中间人（公司代理、自签证书）的网络里，连外部 MCP 服务器会直接证书校验失败，
而且**没有配置项可以绕过**。

**ShunCode 0.8.1** 新增了设置项 `shuncode.mcp.extraCaCertificates`，
实现分布在 `external-mcp-network.ts` 与 `external-mcp-stdio-env.ts`
（后者负责把证书路径注入 stdio 子进程的环境变量——这点容易漏，
HTTP 和 stdio 两条路都要管）。

**移植成本**：小到中。要注意的是 stdio 子进程那一半。

### ③ 技能加载失败的结构化原因码 + 修复建议

**现状**：web_agent 技能读不出来时，`describeSkill` 设 `ready:false`，
把异常消息塞进 `preview`（`skills.js:93`）。模型和用户看到的是一句原始错误。

**ShunCode 的做法**（`custom-tool-skill.js`、`skill-center.ts:243-251`）：
给每种失败一个**机器可读的原因码**和**一个建议动作**：

```js
SKILL_LOAD_REASONS = { "no-skill-md": "目录下缺少 SKILL.md。",
                       "invalid-frontmatter": "SKILL.md 的 frontmatter 不完整。",
                       "entry-configured-missing": "SKILL.md 里声明的 entry 文件不存在。" }
SKILL_LOAD_FIXES   = { ... fix: "open-folder" }
```

判定还有明确的优先级（`skill-center.ts:244` 注释）：
**总开关 → 同名遮蔽 → 加载器检查**。同名遮蔽会给出 `duplicate-name` + `open-folder`。

**为什么值得抄**：web_agent 已经有遮蔽检测（`entry.shadowed`）了，但没把它
变成可操作的提示。原因码还能让模型自己判断"这个技能坏了，别再试了"，
而不是反复读一个读不出来的文件。

**移植成本**：很小，纯粹是把现有的失败分支整理成码表。

---

## 四、不建议移植的

### 技能的分页读取：web_agent 这边更强，别换

ShunCode 没有技能分页。web_agent 的 `loadSkill()` 有一套做得很细的方案：

- 续读必须带 `expectedHash`，否则 `E_BAD_ARGS`
- 文件中途变了返回 `E_STALE_FILE`，强制从 offset 0 重来
- 只允许读文本扩展名，脚本是 `source-only`（"A script being bundled or
  named run.py/run.sh grants no execution permission"）
- `offset` 越界检查

这比 ShunCode 的整文件读取安全得多。**保持现状。**

### 压缩包导入 / 目录迁移 / 技能→工具：先别做

ShunCode 有这些（`skill-archive`、`global-skill-migration`、`generateSkillRunner` +
`skill-tool.json` sidecar），但它们服务的是**桌面 IDE 的终端用户**——
要有界面让人点"导入 zip"，要处理用户换目录后的迁移。

web_agent 是无界面的 agent-host，技能就是往 `.webagent/skills/` 放个文件夹。
在没有对应 UI 的前提下移植这些，只会增加没人用的代码路径。
**除非你打算给 web_agent 做技能管理界面，否则跳过。**

---

## 五、建议顺序

| 顺序 | 事项 | 成本 | 理由 |
|---|---|---|---|
| 1 | 传输自动协商（含"只在协议错误上降级"这条约束） | 小 | 直接决定能不能连上第三方服务器 |
| 2 | 技能失败原因码 + fix 建议 | 很小 | 纯整理，立刻改善模型与用户体验 |
| 3 | 自定义 CA 证书（HTTP + stdio 两条路） | 小–中 | 企业网络下的阻断性问题 |
| — | 其余 | — | 要么 web_agent 已更优，要么缺对应 UI |

---

## 六、复核方式

```cmd
REM 本仓库这边
type recovered\shuncode-0.8.1\src\external-mcp-connection.ts
type reconstructed\carrier-0.8.1\src\custom-tool-skill.js

REM web_agent 那边
git clone --branch arena/01a0e8ea-web-agent https://github.com/cccjvav/web_agent.git
type web_agent\webagent-core\agent-host\src\mcp\externalClient.js
type web_agent\webagent-core\agent-host\src\tools\skills.js
```

> 过程中我更正过自己一次：最初用 SDK 类名 `StreamableHTTPClientTransport` 去 grep，
> 得出"web_agent 没有 Streamable HTTP"的错误结论。实际上它是手写的传输层，
> 靠 `Accept: application/json, text/event-stream` + POST 实现，功能完全具备。
> 按类名搜第三方实现会误判，要看行为。
