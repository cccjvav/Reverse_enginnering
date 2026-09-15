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

`http-router.mjs`在正确端点拒绝数组型/重复协议请求头，并检查rawHeaders，覆盖Node已经把重复头合成字符串的情况。错误返回400，不回显令牌或具体头值；错误令牌仍走原404路由。测试使用本机回环HTTP和空处理器，不连接真实MCP、隧道或GUI。没有改变原CORS、OAuth或文件授权机制。

默认旧实验bundle和已发布overlay仍不含这两模块。新增HTTP专用实验变体已接入http-router.mjs，file-tool-dispatcher.mjs仍未接入；见[HTTP接入说明](../../docs/HTTP_EXTENSION_INTEGRATION.md)。原扩展没有传入新入口需要的宿主权限策略，因此不能靠修改一条import就宣布整合完成。现有图像/搜索/写入竞态与非OS隔离限制仍存在，read_files检查点也不能关闭所有TOCTOU窗口。
