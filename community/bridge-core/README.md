# Bridge 核心维护候选（未部署）

此目录与 `reconstructed/bridge-core/` 的原貌重建层分开。当前只有 `concurrency.mjs`，**不包含在已发布的 0.7.4 overlay ZIP 中**，也没有改动原安装包。

## 修复候选：动态降低并发上限

原 `Semaphore.release()` 在归还一个许可后无条件放行队列中的下一个任务。若先持有 2 个许可、又有任务排队，再将上限从 2 调为 1，首次归还许可仍会放行新任务，使活动数继续为 2。它不是撤销已有任务的问题，而是本该等待的新任务过早进入。

修改仅一处：

```diff
- const next = this.queue.shift();
+ const next = this.current < this.max ? this.queue.shift() : undefined;
```

保留原队列、取消信号、单次归还、异常释放和上限上调行为。正在运行的任务不会被杀掉；只是等活动数真正低于新上限才放行排队者。

`tests/bridge-core-state.test.mjs` 复现原行为；`tests/bridge-core-reconstruction.test.mjs` 验证维护候选、取消/重复归还，以及除这一处条件外代码与基线一致。后续将结合工具执行链做集成测试后再决定接入构建，不把当前单元测试说成 Windows 应用验收。
