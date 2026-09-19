# ShunCode Bridge 源码包 —— 给 web_agent 项目的移交说明

这是从 ShunCode 0.7.4 恢复出来的 **MCP Bridge 实现**,交给 web_agent 项目参考。

**先读第一节。** 里面有一条我一开始判断错、后来查证更正的事实。

---

## 一、关于 Chat:我最初的判断需要更正

我最初说"Chat 那半边做不成普通 VS Code 扩展"。**这对 ShunCode 的实现成立,
但作为一般结论是错的**——web_agent 已经做出来了。

| | ShunCode | web_agent 现有实现 |
| --- | --- | --- |
| `enabledApiProposals` | **7 个** proposed API | **无** |
| Chat API | `vscode.ChatParticipant` 等 proposed 类型 | `vscode.chat.createChatParticipant`(**稳定 API**) |
| 工具卡片 | `toolSpecificData` + 11 个分叉宿主字段 | `stream.markdown()` / `progress()` / `reference()` |
| 能否上 Marketplace | ❌ | ✅ |
| `engines.vscode` | `^1.132.0`(分叉) | `^1.90.0`(稳定版) |

核实过:web_agent 扩展里 `toolSpecificData`、`presentationKind`、`diffPreview`、
`metrics` 命中**全部为 0**,完全走稳定 API。

**准确的说法**:ShunCode 之所以要定制 IDE,是因为它**选择了 proposed API 来换取更精致的
卡片**。这是取舍,不是唯一解。web_agent 选了另一边——样式朴素,但能分发给普通用户。

**本包不含 Chat 实现**,原因是 ShunCode 那份依赖分叉宿主的 11 个自定义字段,
搬过去编译不过也渲染不出来;而 web_agent 现有方案本来就更适合其目标。

---

## 二、Bridge:纯 Node,可直接移植

核实过:**41 个核心模块里 `import vscode` 的有 0 个。** 扩展层 8 个文件里也有 6 个
完全不碰 `vscode`。

MCP 服务端、工具分发、会话管理、文件工具**可以整块搬进 agent-host**,
不必做成扩展。

---

## 三、包里有什么

```
bridge-core/            41 个模块,纯 Node,无 vscode 依赖
types/                  37 份 TypeScript 声明
bridge-extension-layer/ 8 个扩展层文件(作者原始 .ts)
```

### 与 web_agent 现状对照后,最值得看的四个

逐个 grep 确认过,以下是 ShunCode 有而 web_agent **确实没有**的:

| 模块 | 价值 |
| --- | --- |
| `bridge-session-registry.js` | 空闲驱逐 + 容量驱逐,**活跃会话永不驱逐**。web_agent 现在是 24h TTL 一刀切 |
| `adaptive-concurrency.js` | 按延迟/失败/排队自适应:出问题减半、恢复每次 +1 |
| `concurrency.js` | 信号量,带 AbortSignal |
| `jsonrpc-request-id-registry.js` | id 占用登记,全有或全无,防重复 id |

这四个**都不依赖 vscode,也不依赖 MCP SDK**,可直接拷用。

### 建议**不要**直接替换的

`file-tool-registry.js` / `apply-patch.js` 那套文件工具——web_agent 已有 dryRun/hash
保护和跨文件检查点,且与审批流程耦合。可对照,不建议整体换。

---

## 四、来源与可信度

| 部分 | 性质 | 可信度 |
| --- | --- | --- |
| `bridge-extension-layer/*.ts` | **原始源码**,安装器自带,哈希匹配 | 最高 |
| `bridge-core/*.js` | 从未混淆的 bundle 重建;函数体原文,ESM 连线重建 | 高 |
| `types/*.d.ts` | **手写重建,非原件** | 中——见下 |

- 每份 `.d.ts` 头部有 `PROVENANCE` 块,标明一手证据 / 行为推断
- 24 个模块能对上作者自己源码的引用(**一手**);另外 17 个模块**类型名是恢复时起的**,
  只有形状有依据
- 验证:`verify:btypes`(严格编译 + 故意写错的对照必须被拒)、
  `check:btypes`(171 个函数签名逐一比对实现)

**请以 `bridge-core/*.js` 的实际行为为准,不要把重建类型当权威接口定义。**

---

## 五、五个实测发现的坑

1. **`bridge-http-router.js` 有真实缺陷**:从 `request.headers` 读四个自定义头,
   Node 类型是 `string | string[] | undefined`(HTTP 允许同名头重复)。
   守卫只有 `if (!sessionId)`,**排除了 undefined 但排除不了数组**。
   发两个 `Mcp-Session-Id` 就会把数组传进只接受 `string` 的处理器。
   ShunCode 后来在维护层加了适配器返回 400。**照搬时请一并处理,也请检查自家代码有无同类问题。**

2. **`tool-input-validation.js` 只实现 JSON Schema 子集**:
   `$ref`、`oneOf`、`allOf`、`anyOf`、`pattern`、`format` **静默放过**。

3. **`concurrency.js` 的 `setLimit` 调低不回收已发许可**,`active` 可能合法大于 `limit`。

4. **`bridge-event-store.js` 全局有界而非按流有界**:繁忙的流会挤掉别的流的历史,
   断线重连是**尽力而为**。

5. **`deleteCustomTool` 的目录包含检查是安全边界**:manifest 必须在工具目录下且
   以 `.json` 结尾。别为方便放松。

---

## 六、MCP SDK 版本

基于 `@modelcontextprotocol/*` **2.0.0**,协议版本 `2025-11-25`
(成品 bundle、重建模块、npm 安装三方一致)。web_agent 是**手写 MCP**,无 SDK 依赖——
这是架构差异,不是谁对谁错。

---

## 七、边界

- 代码作者即本次恢复的委托人,授权方式由他决定
- 包内**无**密钥、令牌、私钥(已扫描)
- **授权/支付相关未包含**。打包时移除了 `bridge-access-controller.ts`——
  它 import `bridge-license-service`,给了也编译不过。
  已核实 `bridge-server.ts` **不依赖任何授权逻辑**,Bridge 可脱离收费独立运行
- 完整恢复状态见原仓库 `docs/handoff/STATUS_NOW.md`

## 八、不要误解

- 这**不是**能直接 `npm install` 的包,没有 `package.json`
- `bridge-core/*.js` **从未在 web_agent 环境运行过**,恢复项目只做到类型检查层面
- 恢复项目自身发布门槛仍为 **NOT_READY**(7 项 BLOCKED)
- **没有**为 web_agent 做任何适配,原样交付
