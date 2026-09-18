# Bridge 核心维护候选（未部署）

此目录与 `reconstructed/bridge-core/` 的原貌重建层分开。当前包含 `concurrency.mjs`、`read-files.mjs`、`file-tool-dispatcher.mjs`、`http-router.mjs` 四个维护候选，**不包含在已发布的 0.7.4 overlay ZIP 中**，也没有改动原安装包。

## 修复候选：动态降低并发上限

原 `Semaphore.release()` 在归还一个许可后无条件放行队列中的下一个任务。若先持有 2 个许可、又有任务排队，再将上限从 2 调为 1，首次归还许可仍会放行新任务，使活动数继续为 2。它不是撤销已有任务的问题，而是本该等待的新任务过早进入。

修改仅一处：

```diff
- const next = this.queue.shift();
+ const next = this.current < this.max ? this.queue.shift() : undefined;
```

保留原队列、取消信号、单次归还、异常释放和上限上调行为。正在运行的任务不会被杀掉；只是等活动数真正低于新上限才放行排队者。

`tests/bridge-core-state.test.mjs` 复现原行为；`tests/bridge-core-reconstruction.test.mjs` 验证维护候选、取消/重复归还，以及除这一处条件外代码与基线一致。后续将结合工具执行链做集成测试后再决定接入构建，不把当前单元测试说成 Windows 应用验收。


## 读取器检查点候选：不是完整竞态修复

`read-files.mjs` 在主机确认权限后再次取 realpath，与原核准根及原核准目标比较。可拒绝等待确认期间被换到外部的目录/junction，也会拒绝在内部换成另一个未确认目标。临时文件测试验证了这些情形及正常行为。

**检查后到实际打开文件之间仍有竞态，且探测与流读取使用不同打开操作。** 因而这里只称为检查点防护候选，不宣称安全原子读取，也不建议直接挂到不可信会话。

完整复现、局限与进一步工作见 [文件读取恢复说明](../../reconstructed/bridge-core/FILE_READER.md)。原貌代码仍在 `reconstructed/`；维护候选均未纳入 overlay，也未改动已安装应用。


## 文件授权调度与HTTP拒绝候选（未接入原扩展）

`file-tool-dispatcher.mjs`新增invokeAuthorizedFileTool，必须由可信宿主传入checkPermission；缺失时直接返回PERMISSION_POLICY_REQUIRED，只有字面值true表示允许。向五种文件工具传递权限回调和按工具区分的configByTool；read_files复用本目录的读取检查点候选。允许/拒绝、预期配置、失败抛错、图片内容和虚构补丁都有模块测试。错误信息不再一概声称“没有读写发生”。

configByTool是可信宿主配置，不是模型输入。权限回调必须绑定当前会话和用户确认，不应固定返回true。新的入口不会替你实现宿主UI、会话所有权、审批存储或操作系统沙箱。

## P1.2 宿主文件授权策略（新增，仍未接入扩展）

`file-authorization-policy.mjs`与`authorized-file-tools.mjs`是**本次恢复新写的维护设计，不是找回的原实现**。原扩展TS中`checkPermission`命中0处，原回调签名也只有`(absolutePath)`，因此不能标成还原的原始d.ts。

与既有`file-tool-dispatcher.mjs`的区别：那一层只要求"宿主必须传回调"，这一层回答"回调该怎么判"。策略由宿主持有并注入`approve`，请求携带owner、sessionKind、工具、**操作类型**、规范路径、工作区根快照、有效期与取消信号；只有字面`true`放行，false/真值非布尔/抛错/超时/取消/关闭一律拒绝。

三点必须照实说明：

- **操作类型是新增字段，且由本模块自行派生。** `apply_patch`内部横跨新增/修改/移动/删除四个检查点，仅凭工具名无法区分"允许读"与"允许删"。操作类型不接受调用方声明：`derivePatchPlan()`用原件导出的`parsePatch`/`resolveExistingPath`/`resolveNewPath`自己解析补丁得出每个路径的真实操作。理由是让调用方声明既脆弱（路径拼写须与执行器解析完全一致，曾导致Windows专属缺陷）又不安全（可把`Delete File`声明成`update`，骗过只授予修改权限的宿主）。无法分类的路径直接拒绝，不猜测默认操作。这是有意偏离原签名的新设计。
- **授权会被缓存到owner+工具+操作+路径。** 因为`applyPatch`会跑两次preflight（先收集锁、再在锁内重跑），不缓存就会重复打扰宿主。代价是授权在TTL内可复用，因此必须有有限TTL，并在会话销毁时`revokeOwner`。现代MCP路径没有服务端销毁事件，只能靠TTL过期。
- **传入权限回调会改变搜索执行路径。** `find-files.js:372`与`search-files.js:534`在有回调时从首选引擎（ripgrep）降级为逐条过滤的Node实现，行为与性能都会变，不是纯增强。

`tests/bridge-core-file-authorization.test.mjs`共17项，使用临时虚构文件与**脚本化审批器**，覆盖拒绝矩阵、双会话隔离、取消/过期/根变更/撤销、逐工具与apply_patch四种操作的正反向，并核验被拒时磁盘内容不变。已用8种变异验证断言有效（放宽为真值、丢弃操作、丢弃owner、去掉await后取消复查、永不过期、忽略根变更、撤销空转、去掉关闭前拦截各有测试失败）。

**这不是用户GUI审批，不是OS沙箱，也不关闭TOCTOU窗口。** 两个模块均未进入portable/HTTP实验包（bundle仍75输入、SHA仍635190e6…），`authorization-integration`门槛保持BLOCKED。

`http-router.mjs`在正确端点拒绝数组型/重复协议请求头，并检查rawHeaders，覆盖Node已经把重复头合成字符串的情况。错误返回400，不回显令牌或具体头值；错误令牌仍走原404路由。测试使用本机回环HTTP和空处理器，不连接真实MCP、隧道或GUI。没有改变原CORS、OAuth或文件授权机制。

默认旧实验bundle和已发布overlay仍不含这两模块。新增HTTP专用实验变体已接入http-router.mjs，file-tool-dispatcher.mjs仍未接入；见[HTTP接入说明](../../docs/HTTP_EXTENSION_INTEGRATION.md)。原扩展没有传入新入口需要的宿主权限策略，因此不能靠修改一条import就宣布整合完成。现有图像/搜索/写入竞态与非OS隔离限制仍存在，read_files检查点也不能关闭所有TOCTOU窗口。

## P1.3 第一步：补丁计划改为自行派生（仍未接入扩展）

`invokeFileToolWithPolicy`**不再接受`patchPlan`参数**。计划由`derivePatchPlan()`在模块内部用原件解析器派生，调用方无法影响操作分类。`createPermissionCallback`仍保留该参数，仅供单测直接注入。

解析或路径解析失败时fail-closed：计划为空Map，所有路径无法分类而被拒绝，权威错误交由执行器重新解析后报出。

`move`会同时授权源路径与目标路径，二者都必须获批，否则整次调用被拒且两端文件均不变。

已实测：调用方递交Delete File补丁却声明为`update`时，策略看到的仍是`delete`，调用报错，文件完好。详见`docs/evidence/file-authorization-policy.json`的`planDerivation`与`mutationTesting.round3`（含两个**等价变异**的差分证明）。

