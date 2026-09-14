# Bridge 核心维护候选（未部署）

此目录与 `reconstructed/bridge-core/` 的原貌重建层分开。当前包含 `concurrency.mjs` 与 `read-files.mjs` 两个独立候选，**不包含在已发布的 0.7.4 overlay ZIP 中**，也没有改动原安装包。

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

完整复现、局限与进一步工作见 [文件读取恢复说明](../../reconstructed/bridge-core/FILE_READER.md)。原貌代码仍在 `reconstructed/`；两个候选均未纳入 overlay，也未改动已安装应用。
