# 看过 web_agent 的扩展之后:我上一轮的结论要修正

我读了 `webagent-core/extension/`(7 个 JS 文件)和 `agent-host/src/mcp/`(2222 行)。

**结论变了一处,而且是重要的一处。**

---

## 一、先更正我自己:Chat 扩展**是**做得成的

上一轮我说"Chat 那半边做不成普通扩展"。**这话对 ShunCode 的实现成立,但作为一般结论是错的**——
web_agent 已经做出来了。

| | ShunCode | web_agent |
| --- | --- | --- |
| `enabledApiProposals` | **7 个** proposed API | **无**(null) |
| Chat API | `vscode.ChatParticipant` 等 proposed 类型 | `vscode.chat.createChatParticipant`(**稳定 API**) |
| 工具卡片 | `toolSpecificData` + 11 个分叉宿主字段 | `stream.markdown()` / `stream.progress()` / `stream.reference()` |
| 能否上 Marketplace | ❌ 不能 | ✅ 能 |
| `engines.vscode` | `^1.132.0`(你的分叉) | `^1.90.0`(普通稳定版) |

我核实过:他们的扩展里 `toolSpecificData`、`presentationKind`、`diffPreview`、`metrics`
**出现次数全部为 0**。他们完全走稳定 API。

**代价是卡片样式**:他们用 markdown 流式输出 + `stream.reference()` 做可点击引用,
拿不到 ShunCode 那种带图标、统计标签、彩色 diff 的原生卡片。但**功能一个不少**,
而且**普通用户装得上**。

所以准确的说法应该是:

> ShunCode 的 Chat 之所以要定制 IDE,是因为**它选择了 proposed API 换取更精致的卡片**。
> 这是一个**取舍**,不是唯一解。web_agent 选了另一边:样式朴素,但能分发。

---

## 二、他们的架构和你的设想其实一致

```
VS Code 扩展(瘦客户端,7 个文件)
      │  HTTP → 127.0.0.1:48271
      ▼
agent-host(引擎:MCP 服务端、工具、会话)
```

扩展里**没有**内嵌任何 MCP 实现——我查过,`modelcontextprotocol`、`jsonrpc`、
`StreamableHTTP` 在扩展侧命中为 0。引擎全在 agent-host。

**这正是你想要的形态**:载体是普通 VS Code,不用自己做 IDE。
而且这也意味着——**Bridge 源码包该给的不是扩展,是 agent-host**。

---

## 三、那 Bridge 包还有用吗?有,但用法和我上一轮说的不同

他们的 MCP 是**手写的**(`package.json` 里没有 `@modelcontextprotocol/*` 依赖),
`server.js` 466 行。ShunCode 用的是**官方 SDK 2.0.0**。

对比下来,ShunCode 有而他们**确实没有**的东西(我逐个 grep 确认过):

| 能力 | web_agent | ShunCode |
| --- | --- | --- |
| 自适应并发 | **无** | `adaptive-concurrency.js`:按延迟/失败/排队自动调整,出问题减半、恢复每次 +1 |
| 信号量限流 | **无** | `concurrency.js`:带 AbortSignal,调低上限不回收已发许可 |
| 事件缓冲/断线重放 | **无** | `bridge-event-store.js`:支持 `lastEventId` 续传 |
| 会话驱逐策略 | 只有 **24 小时 TTL** | 空闲驱逐 + 容量驱逐,**活跃会话永不驱逐** |
| JSON-RPC id 占用登记 | 无 | `jsonrpc-request-id-registry.js`:全有或全无,防重复 id |

**特别值得他们看的是会话驱逐**。他们现在是 `SESSION_TTL_MS = 24 小时` 一刀切,
ShunCode 的 `bridge-session-registry.js` 区分"空闲"和"活跃"——**有请求在飞或有流开着的
会话永不驱逐**,只在容量不足时淘汰最老的非活跃会话。长任务场景下这个差别很实际。

反过来,**他们有而 ShunCode 没有的**:OAuth(`oauth.js` 573 行)、
外部 MCP 出站客户端、审批/审计控制。这些别动。

---

## 四、修正后的建议

**不要**建议他们把 Bridge 整块换进去——他们的 MCP 服务端已经能跑,而且和他们的
审批/审计体系长在一起。整体替换是高风险低收益。

**建议按模块挑**,优先级从高到低:

1. **`bridge-session-registry.js`** —— 驱逐策略明显更成熟,且是独立模块,好移植
2. **`adaptive-concurrency.js`** + **`concurrency.js`** —— 他们完全没有,纯 Node 无依赖
3. **`bridge-event-store.js`** —— 只有当他们要支持断线重连时才需要
4. **`jsonrpc-request-id-registry.js`** —— 小而有用,防客户端重复 id

这四个**都不依赖 vscode,也不依赖 MCP SDK**,可以直接拷进 agent-host。

`file-tool-registry.js` / `apply-patch.js` 那套文件工具**可以对照但不建议直接换**——
他们已有 dryRun/hash 保护和跨文件检查点,而且和他们的审批流程耦合。

---

## 五、给对方助手的提示词(修正版)

替换上一轮那份。复制 `✂️` 之间的内容。

## ✂️ 从这里开始复制 ✂️

我提供一份从我旧项目 ShunCode 0.7.4 恢复出来的 **MCP Bridge 源码包**
(`shuncode-bridge-source.zip`)。**我不是要你整体替换我们现有的实现**——
我已经看过我们的 `agent-host/src/mcp/`,它能跑,而且和审批/审计体系耦合。

我想请你**按模块评估是否值得挑选性借鉴**。

### 已核实的对照事实

我们的扩展走**稳定 Chat API**(`vscode.chat.createChatParticipant`,无
`enabledApiProposals`),ShunCode 走的是 **7 个 proposed API** + 分叉宿主。
**我们的路线是对的**——能上 Marketplace,普通用户装得上。这点不需要改。

我们的 MCP 是**手写**的(无 `@modelcontextprotocol` 依赖),ShunCode 用**官方 SDK 2.0.0**,
协议版本 `2025-11-25`。

逐个 grep 确认,ShunCode 有而我们**没有**的:

| 能力 | 我们 | ShunCode 模块 |
| --- | --- | --- |
| 自适应并发 | 无 | `adaptive-concurrency.js` |
| 信号量限流 | 无 | `concurrency.js` |
| 事件缓冲/断线重放 | 无 | `bridge-event-store.js` |
| 会话驱逐 | 仅 24h TTL 一刀切 | `bridge-session-registry.js`(空闲+容量驱逐,活跃永不驱逐) |
| JSON-RPC id 占用登记 | 无 | `jsonrpc-request-id-registry.js` |

### 请你回答

1. **会话驱逐**:我们 `agent-host/src/mcp/session.js` 现在是
   `SESSION_TTL_MS = 24h` + `pruneSessions()` 一刀切。ShunCode 区分活跃/空闲,
   **有请求在飞或有流开着的会话永不驱逐**。我们的长任务场景会不会因为 TTL 被切?
   值得换吗?

2. **自适应并发**:`adaptive-concurrency.js` 按延迟/失败/排队自动调整
   (出问题减半、恢复每次 +1,窗口满才决策)。我们现在有没有等价机制?
   在我们的负载下有意义吗?

3. **哪些不该动**:我认为文件工具那套(`file-tool-registry.js`、`apply-patch.js`)
   **不该直接替换**,因为我们已有 dryRun/hash 保护和跨文件检查点,且与审批流程耦合。
   请确认或反驳。

4. **已知缺陷**:包里 README 第五节列了 5 个实测发现的问题,其中
   `bridge-http-router.js` 有**真实缺陷**——`if (!sessionId)` 排除得了 `undefined`
   但排除不了 `string[]`(HTTP 允许同名头重复),客户端发两个 `Mcp-Session-Id`
   就会把数组传进只接受 `string` 的处理器。
   **请检查我们的 `server.js` 有没有同类问题。**

5. **如果都不值得用,请直接说。** 这是我自己的旧代码,但那不是采用它的理由。

### 边界

- 授权/支付代码**未包含**,也不要为此设计
- 类型声明是**手写重建的,不是原件**:17 个模块的类型名是恢复过程中起的,
  只有形状有依据。以 `bridge-core/*.js` 的实际行为为准
- 这些代码**从未在我们环境里运行过**,恢复项目只做到类型检查层面
- 包里没有 `package.json`,不能直接 `npm install`

## ✂️ 复制到这里结束 ✂️
