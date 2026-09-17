# P1工作卡：把可信文件审批接进实际源码链

**当前：可开始实现；仅静态审计已完成。不是生产授权方案已上线。**

## 为什么优先做它

候选扩展可以构建并达到0个候选类型错误，但原路径没有传`checkPermission`。如果现在把维护调度器直接alias过去，缺回调会全部拒绝；若随手补`() => true`则权限形同虚设。两者都不是恢复成功。要从可信宿主入口设计策略，再把策略传到底层。

### 现在已经复现的调用图

```text
BridgeServer 构造 BridgeToolDispatcher
  deps = invokeIdeTool / workspaceRoots / skillsEnabled / log
       ↓
BridgeToolDispatcher 的 invokeFileTool(name, args, context)
  context = workspaceRoots / signal
       ↓
reconstructed/bridge-core/src/file-tool-registry.js
  applyPatch / findFiles / readFiles / readImage / searchFiles
  各执行器context = workspaceRoots / signal
```

原执行器有一些权限钩子，但上层未传，不能推断实际启用。另有`community/bridge-core/file-tool-dispatcher.mjs`强制可信`context.checkPermission`，只认布尔true，configByTool不来自客户端参数；当前portable输入图**没有**这个模块。

本次新增`tools/audit_authorization_wiring.mjs`：核验3个原件SHA，用TypeScript AST列出1个依赖接口、1个宿主构造上下文、1个文件入口上下文及5个执行器上下文，并重建portable图核对alias/inputs。证据在[authorization-wiring.json](../evidence/authorization-wiring.json)。

普通CMD：

```cmd
conda activate shuncode-recovery
call npm.cmd run audit:authorization-wiring
node --test tests/bridge-core-authorization-wiring.test.mjs
```

前者退出0仅表示审计运行成功，报告中的`authorizationIntegrationVerified:false`与`authorizedDispatcherBundled:false`才是当前事实。它不是全程序数据流分析/漏洞扫描，更不能证明运行时安全。遇原件哈希、对象spread或调用数量改变就停止并人工评审；不要自动重写原件证明文件。今后接入成功时保留“原件缺线”的观察，增加新变体观察/行为证据并有意更新回归，不为了让这个旧断言继续通过而隐瞒新连接。

## 按顺序实现：小步提交，而不是改原件

### P1.1 确认可信主体与生命周期（先形成设计记录）

- 跟读`bridge-server.ts`、`bridge-tool-dispatcher.ts`、`bridge-mcp-transport.ts`、`ide-tool-broker.ts`、`bridge-access-controller.ts`。区分商业访问、HTTP bearer、MCP session owner与**逐文件审批**；名称带Access不等于文件授权。
- 追踪`dispatch(...extra)`到文件路径时`commandOwnerId`的真实来源、无会话/现代路径行为、断连/删除/取消清理入口。不能使用用户args里的owner、approved、checkPermission或config来建立信任。
- 设计由宿主拥有的服务：请求绑定owner/session、工具名、规范路径、工作区快照/修订、有限有效期与取消信号；覆盖读和修改，明确一次/会话授权的范围与撤销。默认拒绝，审批错误/超时/关闭/非true均拒绝，隔离不同会话。
- 原工具回调只传路径，不能凭空假设原有操作类型字段。阅读applyPatch的新增/移动/删除检查点，设计能准确展示本次操作/内容摘要的额外宿主上下文，不把“允许读”复用为“允许删”。最终接口是新维护设计，不能标成找回原d.ts。

### P1.2 先做维护服务和边界测试

- 新增模块放`community/`；策略对象和只读配置由宿主依赖注入。测试使用临时虚构文件和脚本化审批器，明说这不是用户GUI审批。
- 保留工作区根、AbortSignal、规范化工具别名、允许的配置字段；支持本来存在的CLI/Skills入口时做独立边界说明，不因工具路由共享而自动给它们批准。
- 复用现有维护`invokeAuthorizedFileTool`与`read-files`检查点，不拷贝41个原模块来修改。不要扩大原工具写入范围或放宽路径验证。
- 不允许运行模型提供方、隧道或任意shell作为此阶段授权测试副作用；应用审批验证仍要在后续真实宿主完成。

### P1.3 可选构建整合，不改变默认原貌产物

- 参考`http_maintenance_inputs.mjs`/`portable_presentation_inputs.mjs`：provenance哈希核验、精确转换计数、原import字节保持；新增单独授权实验开关，组合portable+HTTP。
- Facade创建真实宿主审批服务→Dispatcher接收可信依赖→文件入口转发owner/signal→维护执行器调用策略。不能仅在单测里注入回调而扩展仍走原路径。
- 类型诊断和esbuild必须使用相同转换图；新接口来自实际消费与行为验证，不在公共vscode声明上“补丁式通过”。明确新变体与旧75-input portable各自哈希。
- 若宿主UI策略尚不能安全实现，停在默认拒绝的维护服务/测试，标PARTIAL，不把“deny-all已打包”描述成可用产品。

### P1.4 集成验收与下一步

从原TS Facade/Dispatcher实际构造路径开始，最少覆盖下表；然后转P2的真实传输调用。测试记录具体拒绝点及磁盘前后状态，不使用“无任何副作用”这种超出检查范围的表述。

| 样例 | 预期证据 |
|---|---|
| 无策略、undefined、对象、字符串、false、抛错 | 工具拒绝，不返回受保护内容；写测试文件哈希不变 |
| 单次true批准 | 仅指定owner、工具、规范路径与本次操作允许；不能跨请求/跨会话复用 |
| args塞approved/owner/config | 不能覆盖可信宿主配置或身份；原过滤规则保持 |
| 等待审批时取消/超时、会话关闭 | 不继续执行；队列/审批回调清理；过期true不得复活任务 |
| 根变更、符号链接/Windows junction、目录换位 | 检查点拒绝或明确仍残留的TOCTOU；Windows专项不能用Linux跳过代替 |
| read_files/read_image/find_files/search_files | 允许/拒绝、内容与目录元数据边界分别记录；逐工具测试不以文本读取代替其他四工具 |
| apply_patch新增/改/移/删、多文件部分批准 | 源/目标权限、取消和失败后的磁盘状态均核验；不能未经证明承诺事务原子性 |
| A/B两个会话 | B不能使用A审批或取消/查询A任务；不能仅断言owner字符串不同 |

**完成边界：**静态报告与类型0均不足以把authorization-integration改PASS。需要真实宿主审批、源构建入口、真实文件与生命周期正反向证据，并最终在隔离Windows GUI/MCP验证。任一关键条件不满足，继续NOT_READY。
