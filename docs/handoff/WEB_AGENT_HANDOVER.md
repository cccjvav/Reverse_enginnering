# 转交 web_agent 项目:Bridge 源码包

下载:`shuncode-bridge-source.zip`(87 个文件)

内容哈希 `8dd74e29241437c405188751eec93ea59ebcd30ac6576800c096652f0245fa10`(重建后稳定;
压缩包本身的 sha256 每次不同,因为 zip 条目带时间戳)。
由 `python3 tools/build_bridge_package.py` 可重复生成。

> **重要更正**:我最初判断"Chat 做不成普通扩展"。看过你们现有扩展后确认
> **这话作为一般结论是错的**——你们已经用稳定 API 做出来了。
> 详见 [WEB_AGENT_EXTENSION_REVIEW.md](WEB_AGENT_EXTENSION_REVIEW.md),
> **那份里的提示词才是最终版**,本文的提示词已过时。

---

## 先说结论:你的设想一半可行,一半不可行

你说"没必要专门做个软件当载体,做成 VS Code 扩展单独安装"。我查了代码:

| | 能不能做成普通扩展 | 为什么 |
| --- | --- | --- |
| **Bridge** | ✅ **能,而且约束极少** | 41 个核心模块里 **0 个** import `vscode`,纯 Node |
| **Chat** | ❌ **不能** | 依赖 7 个 proposed API + 分叉宿主的 11 个自定义字段 |

**Chat 那半边不是代码问题,是 VS Code 的平台限制。** proposed API 只能在 Insiders 里
用 `--enable-proposed-api` 启动,**不能发布到 Marketplace**,普通用户装不了。

这恰恰解释了**你当年为什么必须自带一个定制 IDE**——不是你想复杂,是 Chat 这半边
做不成普通扩展。

所以包里**只有 Bridge**。给 Chat 也没用,只会让对方白忙。

---

## Bridge 为什么值得他们看

核实过的事实:**41 个核心模块无一 import `vscode`**。扩展层 9 个文件里也有 6 个
完全不碰 `vscode`,真正依赖的只有最外层启动胶水。

意味着:MCP 服务端、工具分发、会话管理、文件工具,**可以整块搬进他们的 agent-host**,
甚至不一定要做成扩展。

而 web_agent 的 README 里写着他们已经有:
- 认证 Bridge(外部 MCP 客户端入站)
- 文件补丁的 dryRun/hash 保护
- 出站外部 MCP(本机 HTTP、stdio、公网 HTTPS)

这三块 ShunCode 都有成熟实现,可以直接对照。

---

## 我在包里写明了 5 个坑

都是实测发现的,不是猜的:

1. **HTTP 头有个潜在缺陷**:`if (!sessionId)` 排除了 undefined 但**排除不了数组**。
   客户端发两个 `Mcp-Session-Id` 就会把 `string[]` 传进只接受 `string` 的处理器。
   (ShunCode 后来在维护层修了,照搬时要一并处理。)
2. **JSON Schema 校验只实现了子集**:`$ref`/`oneOf`/`allOf`/`anyOf`/`pattern`/`format`
   **静默放过**。别以为它做了完整校验。
3. **信号量 `setLimit` 调低不回收已发许可**,`active` 可能合法大于 `limit`。
4. **事件缓冲是全局有界不是按流有界**,断线重连是尽力而为。
5. **`deleteCustomTool` 的目录检查是安全边界**,别为方便放松。

---

## 来源可信度,我分了三档

| 部分 | 性质 |
| --- | --- |
| `bridge-extension-layer/*.ts` | **原始源码**,安装器自带,哈希匹配 |
| `bridge-core/*.js` | 从未混淆的 bundle 重建;函数体是原文,ESM 连线是重建的 |
| `types/*.d.ts` | **手写重建,非原件**。24 个模块有一手证据,17 个**类型名是我起的** |

每份 `.d.ts` 头部都有 `PROVENANCE` 块说明证据等级。**我不想让他们把重建的类型
当成你当年写的。**

---

## 已排除的内容

- **授权/支付相关全部未包含**(你选择保留)。打包时移除了 `bridge-access-controller.ts`
  ——它 import `bridge-license-service`,给了也编译不过。
  已核实 **`bridge-server.ts` 本身不依赖任何授权逻辑**,Bridge 能完全脱离收费独立跑。
- 扫描确认**无密钥、令牌、私钥**。

---

## 给对方助手的提示词

复制 `✂️` 之间的内容,连同 zip 一起转交。

## ✂️ 从这里开始复制 ✂️

我提供一份从我自己的旧项目 ShunCode 0.7.4 里恢复出来的 **MCP Bridge 源码包**
(`shuncode-bridge-source.zip`),想请你评估能否用于我们当前的 web_agent 项目。

**请先读包里的 `README.md`,尤其第一节。** 那里有一个会直接影响可行性的硬约束。

### 背景

我原本设想"把 Bridge 和 Chat 做成 VS Code 扩展单独安装",但恢复过程中确认:

- **Bridge 可以**:41 个核心模块**无一 import `vscode`**,纯 Node.js
- **Chat 不行**:依赖 7 个 proposed API(`defaultChatParticipant`、
  `chatParticipantAdditions` 等)和一个**分叉 Code OSS** 才有的 11 个自定义字段。
  proposed API 无法发布到 Marketplace,普通用户装不了。

所以包里**只有 Bridge**。

### 包内容

```
bridge-core/            41 个模块,纯 Node,无 vscode 依赖
types/                  37 份 TypeScript 声明
bridge-extension-layer/ 8 个扩展层文件(原始 .ts,哈希匹配安装包)
```

基于 `@modelcontextprotocol/*` **2.0.0**,协议版本 `2025-11-25`。

### 我想请你回答

1. **可复用性**:我们已有认证 Bridge、文件补丁 dryRun/hash 保护、出站外部 MCP。
   这份实现里哪些部分**值得替换或补强**我们现有的?哪些是重复造轮子、不该动?

2. **架构对照**:重点看
   `bridge-http-router.js`(Streamable HTTP 路由)、
   `bridge-session-registry.js`(空闲+容量驱逐,活跃会话永不驱逐)、
   `adaptive-concurrency.js`(按延迟/失败/排队自适应:出问题减半,恢复每次+1)、
   `jsonrpc-request-id-registry.js`(id 占用登记,全有或全无)。
   跟我们现有做法比,各有什么取舍?

3. **已知缺陷**:README 第五节列了 5 个实测发现的坑,其中 HTTP 头那个是**真实缺陷**
   (`if (!sessionId)` 排除不了 `string[]`)。请确认你理解这些,并在评估里说明
   我们现有代码**是否有同类问题**。

4. **来源可信度**:类型声明是**手写重建的,不是原件**——17 个模块的类型名是恢复过程中
   起的,只有形状有依据。请**不要把它们当权威接口定义**,以 `bridge-core/*.js` 的
   实际行为为准。

5. **如果不值得用**,请直接说,并说明理由。我不希望因为"这是我自己的旧代码"就
   强行塞进项目。

### 边界

- 授权/支付相关代码**未包含**,也不要为此设计——那部分我单独保留
- 这些代码**从未在 web_agent 环境里运行过**,恢复项目只做到类型检查层面
- 不要假设它能直接 `npm install`,包里没有 `package.json`

## ✂️ 复制到这里结束 ✂️
