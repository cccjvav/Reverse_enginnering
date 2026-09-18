# P1.1 设计记录：可信主体与生命周期

**状态：设计记录，未实现。** 本文回答 [NEXT_AUTHORIZATION.md](NEXT_AUTHORIZATION.md) P1.1 要求的三件事：谁是可信主体、生命周期在哪里结束、逐文件授权契约应当长什么样。**没有任何代码被接入，`authorization-integration` 门槛仍为 BLOCKED。**

阅读依据为工作树中的原件（`recovered/shuncode-extension/src/`）与原貌重建（`reconstructed/bridge-core/src/`）。行号对应本次提交时的字节；原件漂移后需重新核对，不要照抄行号。

## 1. 结论先行：三种"看起来像授权"的东西都不是逐文件授权

接手时最容易犯的错，是把下面任何一个当成文件权限已经存在。

| 机制 | 源码位置 | 实际语义 | 为什么不能当逐文件授权 |
|---|---|---|---|
| `BridgeAccessController` / `BridgeLicenseService` | `bridge-access-controller.ts:7`、`bridge-license-service.ts` | 商业可用性（登录、套餐、用量上报、`requireFeature("bridge")`） | 名字里有 Access，但判定的是"这个用户能不能用 Bridge 功能"，与"能不能读这个文件"无关。用户已授权移除自己的收费门槛，社区版已把它替换为恒可用策略 |
| HTTP bearer / 路由令牌 | `bridge-server.ts` 的 `ROUTE_TOKEN_SECRET`、`http-router.mjs` | 传输层准入：来的人能不能连上这个 MCP 端点 | 是"连接级"一次性凭据。持有令牌 = 可以调用工具，**不等于**每个文件都被批准。把 bearer 当文件许可，等于一次连接批准了整个工作区 |
| `commandOwnerId` | `managed-command-cancellation.js:5,23` | 受管终端命令的**归属作用域**：谁能查询/取消自己的命令 | 它是隔离标识，不是审批结果。`stateForOwner`（`ide-tool-broker.ts:1705`）只判断"这条命令是不是你的"，从不判断"这个路径可不可以读写" |

## 2. 可信主体：`commandOwnerId` 的真实来源

这是唯一贯穿调用链、且**不由模型参数决定**的身份，因此它是逐文件授权唯一可用的绑定锚点。三条产生路径：

```text
① 传统 MCP 会话（有 Mcp-Session-Id）
   transport.sessionId  →  bridgeManagedCommandOwnerId(sid)  →  "bridge:<sessionId>"
   bridge-mcp-transport.ts:678（tools/call）、:555（会话初始化）

② 现代 MCP 请求（2026-07-28，无 Mcp-Session-Id）
   modernCommandOwnerId(request, body)  →  "modern:<sha256(身份信封)>"
   bridge-mcp-modern.ts:36；摘要输入 = x-shuncode-client-id / -account / -workspace
   / authorization 头 + _meta 里的 clientInfo.name/version

③ 本机原生 Chat（非远程）
   NATIVE_MANAGED_COMMAND_OWNER_ID = "native-chat"
   managed-command-cancellation.js:5；dispatcher 在 extra.commandOwnerId 缺失时兜底
   bridge-tool-dispatcher.ts:176
```

三点必须记住：

1. **`bridgeManagedCommandOwnerId` 是 fail-closed 的**：空/空白 sessionId 直接抛 `MCP_SESSION_UNAVAILABLE`（`managed-command-cancellation.js:23-27`），不会产生一个匿名 owner。新策略应保持这个性质，不要为了"方便"补一个默认 owner。
2. **现代路径的 owner 是身份摘要，不是会话**。它把 `authorization` 头纳入摘要，因此换令牌就换 owner；但它**没有服务端会话生命周期**（每请求建服务器即弃，见 `bridge-mcp-modern.ts` 顶部注释）。所以"会话级授权"在现代路径上没有天然的失效点——这是设计必须显式处理的差异，不能两条路径共用一套假设。
3. **`native-chat` 是兜底常量**，不是经过认证的主体。给它的权限必须由宿主 UI 单独决定，不能因为"本机"就默认放行。

## 3. 生命周期：授权必须在哪些点失效

传统会话有明确的销毁汇聚点，这是撤销授权的正确挂载位置：

```text
BridgeSessionRegistry.onSessionDestroyed   bridge-mcp-transport.ts:207
  ├─ endRemoteConversation(bridge:<sid>)     清理 todos / 活动 owner
  └─ releaseCommandOwner(bridge:<sid>)       → ideToolBroker.releaseCommandOwner
                                               → terminalManager.releaseOwner
                                                 ide-tool-broker.ts:1780-1787
                                                 释放取消配额、丢弃该 owner 的命令状态、
                                                 回收空闲终端槽
```

触发销毁的三条路径：HTTP `DELETE`（`handleDelete`，:524，标记 reason=delete）、传输关闭（`transport.onclose`→`destroyClosedSession`，:576/:693）、空闲超时裁剪（`pruneSessions`→`SESSION_IDLE_TIMEOUT_MS`/`MAX_SESSIONS`，:691）。

取消信号来自 `tools/call` 的 `extra.signal`（:677），经 `dispatch` 透传（:179），在 facade 侧由 `cancellationFromAbortSignal` 桥接为 VS Code `CancellationToken`（`bridge-server.ts:198-201`）。文件执行器全都接收 `context.signal`。

**缺口（必须在 P1.2 设计里补）**：现代路径没有 `onSessionDestroyed`，也不调用 `releaseCommandOwner`。若把授权缓存成"会话级"，现代 owner 的授权将没有任何服务端撤销点，只能靠 TTL 过期。因此授权记录必须自带**有限有效期**，不能只依赖会话销毁事件。

## 4. 断线：原调用链根本没有权限入口（本轮再次核验）

```text
BridgeServer 构造 dispatcher                bridge-server.ts:197
  deps = { invokeIdeTool, workspaceRoots, skillsEnabled, log }   ← 无审批服务
        ↓
BridgeToolDispatcher.invokeFileTool(...)    bridge-tool-dispatcher.ts:309
  context = { workspaceRoots, signal }                           ← 无 checkPermission
        ↓
reconstructed/bridge-core/src/file-tool-registry.js 五个执行器
  applyPatch / findFiles / readFiles / readImage / searchFiles
  context = { workspaceRoots, signal }                           ← 无 checkPermission
```

底层执行器**本身支持**权限回调，且都写成"有则检查、无则放行"：

- `apply-patch.js:438`（新增）、`:460`（改/删源）、`:498`（移动目标）
- `read-files.js:224`、`read-image.js:251`
- `find-files.js:360,435`、`search-files.js:333,671`
- 注意 `find-files.js:372` 与 `search-files.js:534`：**没有** `checkPermission` 时会走"首选引擎"（ripgrep 等）；有回调时才降级为逐条过滤的 Node 实现。即接入策略会改变搜索执行路径与性能特征，必须在 P1.3 单独记录，不能当成纯粹的无副作用增强。

本轮用 `grep -rn "checkPermission" recovered/shuncode-extension/src/*.ts` 复核：**0 处命中**。原扩展 TS 侧从未构造过任何文件权限服务，所以"恢复原实现"在这里无从谈起——P1 的产物只能是**新维护设计**，不得标注为找回的原始 `d.ts`。

## 5. 逐文件授权契约（建议形状，待 P1.2 实现）

宿主拥有、依赖注入、默认拒绝。请求对象至少包含：

| 字段 | 来源 | 约束 |
|---|---|---|
| `ownerId` | §2 三条路径之一 | 只能由宿主侧注入；**绝不**从模型 args 读取 |
| `sessionKind` | `bridge` / `modern` / `native` | 决定可否使用会话级撤销；`modern` 只能依赖 TTL |
| `tool` | 规范化后的工具名 | 用 `normalizeFileToolName` 折叠别名后再判定 |
| `operation` | `read` / `create` / `modify` / `move` / `delete` | 见下方缺口说明 |
| `absolutePath` | 执行器解析后的真实路径 | 必须是 realpath 之后的值 |
| `workspaceRootsSnapshot` | 批准时的根集合 | 根变更即失效 |
| `expiresAt` | 宿主时钟 | 必须有限；现代路径唯一的失效手段 |
| `signal` | `extra.signal` | 审批等待期间取消即拒绝 |

判定规则：仅接受字面 `true`；异常/超时/关闭/非布尔一律拒绝；不同 ownerId 互相隔离，A 的批准不得被 B 复用；一次批准只覆盖"本次 owner + 工具 + 规范路径 + 操作"。

**已知契约缺口（不要假装它不存在）**：原回调签名只有 `checkPermission(absolutePath)`，**不携带操作类型**。维护调度器当前补到 `(absolutePath, toolName)`（`file-tool-dispatcher.mjs:45`）——但 `apply_patch` 一个工具内部就横跨新增/修改/移动/删除四种操作（§4 的三个检查点），仅凭工具名无法区分"允许读"和"允许删"。因此 P1.2 必须**新增宿主上下文**把 operation 传下去，这会偏离原件签名，属于有意的新设计，必须在 provenance 与文档中如实标注，不能写成"还原原行为"。

## 6. 下一步（P1.2 的输入）

1. 在 `community/` 新增宿主拥有的策略服务与请求类型，默认拒绝；测试用临时虚构文件与脚本化审批器，并写明这不是用户 GUI 审批。
2. 先覆盖 NEXT_AUTHORIZATION.md P1.4 表格中的拒绝路径：无策略/undefined/对象/字符串/false/抛错、args 伪造 owner 与 approved、审批期间取消与超时、A/B 双会话不串用。
3. 明确记录三项本设计**不解决**的问题：`read-files.mjs` 检查点到实际打开之间的 TOCTOU 窗口仍在；接入回调会改变 find/search 的引擎选择；现代路径缺少服务端撤销点，只能靠 TTL。
4. 构建整合（P1.3）留到策略与测试稳定之后，且必须作为独立实验变体，不改变默认 portable 产物的字节与哈希。
