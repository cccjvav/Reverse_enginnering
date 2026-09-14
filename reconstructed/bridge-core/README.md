# 第一组 Bridge 核心重建模块

这是从 Windows 0.7.4 已发布扩展 bundle 中恢复的 **JavaScript 逻辑 + 重新建立的 ESM 依赖关系**。它不是原始 TypeScript，不是完整扩展，也不是新的 Windows 安装包。没有部署到此前的社区版 overlay。

## 已经做到什么

- **24 个可独立加载的模块 / 130 个声明 / 96,503 字节 JS**。
- 其中 **22 个自有源码标签**：21 个标签的已发布顶层声明全部纳入，`file-tool-registry` 仅纳入工具目录和输入解析；另外 2 个文件是原构建元数据、SDK 版本常量。
- 依赖闭合：每个非内建自由变量都有显式模块来源；运行这些模块不需要安装 npm 运行时依赖，仅使用 Node 内建模块。
- 原函数/类声明不重写；主要新增 `import/export`，把静态 Node `require` 改接为 ESM，并把构建元数据显式化。
- [`provenance.json`](provenance.json) 记录原 bundle SHA-256、每个声明的 UTF-16 位置与哈希、输出哈希、模块依赖、完整/部分范围，以及该 bundle **38 个共享源码标签**的索引。此前的 43 是三个 bundle 合并统计，不是这里漏掉了 5 个。

| 领域 | 文件/范围 |
|---|---|
| HTTP 路由 | `bridge-http-router`：令牌路径、健康检查、方法/会话头、SSE 模式、请求体上限；实际 MCP 回调由宿主提供 |
| 会话和事件 | `bridge-session-registry`、`bridge-event-store`、`jsonrpc-request-id-registry` |
| 工具输入 | `tool-input-validation`、`file-tool-input-compat`、`bridge-tool-name`、`bridge-coordination-validation` |
| 工具目录 | 5 个文件工具 + 8 个 IDE 工具；`wait` 仍不对 Bridge 暴露 |
| 运行状态 | 活动历史、纯本地计数、并发/自适应并发、命令 ID、保留期和终端空闲管理 |
| 命令取消 | 原会话归属、限流、强制取消预留与本地主机确认要求，以及命令风险分类 |

**重要限制：** `file-tool-registry.js` 没有 `dispatchFileTool` / `invokeFileTool`，不能执行读写、搜索或补丁操作。路径输入能解析并不代表路径安全；工作区/符号链接隔离属于尚未接齐的执行层。IDE 工具仍需 VS Code API 和原宿主执行器。输入校验器实现的是 JSON Schema 的一个子集，不是完整标准验证器。

## 如何复现（仓库根目录，Node 22.13+）

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check:bridge-core
npm test
```

如需重新生成：

```bash
npm run build:bridge-core
```

生成器只解析原 bundle，不运行整个扩展。它拒绝源哈希改变、未解析变量、跨来源 AST 声明、第三方可执行依赖和初始化循环；若重建文件被手工修改，会拒绝覆盖。请把后续维护修改放到独立的 `community/` 层，而不是改动原证据或静默覆盖重建基线。

测试会执行审查过的重建模块和隔离的原声明闭包进行对照。HTTP 测试只在临时回环端口调用桩回调，不启动真实工具执行器、不创建公网隧道、不运行安装器或整个扩展。VM 是对照工具，不宣称是安全沙箱。

## 不能混淆的身份与缺陷

- `snapshot-build-metadata.js` 保留的是**原 0.7.4 发行构建**的 `version/gitSha/builtAt/release`；`getBuildInfo()` 返回该快照身份，不代表本重建包是官方发行版。本包自身版本是 `0.0.0-reconstructed.1`，且禁止 npm 发布。
- `snapshot-sdk-versions.js` 是原 SDK 中的版本常量证据；原代码宣称的协议支持不等于经过标准兼容性认证。
- 原 `Semaphore` 动态降低上限时会过早放行排队任务。测试已复现，基线保持原貌。单独的[社区维护候选](../../community/bridge-core/README.md)增加放行条件，已有回归测试，**尚未接入安装包或 overlay**。
- 本地用量计数只是进程内数字，不重新接入收费服务；现有社区版取消商业授权的改造不受影响。
- 所有顶层声明被纳入也不等于找回原模块的全部类型、原始导出表、被 tree-shaking 删除的代码或测试。这里导出已选声明（含部分私有辅助函数），是明确的重建 API，不冒充原作者完整公共 API。
- 不改变或新增原软件/第三方材料的开源许可；发布权和署名仍需保留审查。

测试状态及 Windows runner 验证以 [`docs/evidence/bridge-core-tests.json`](../../docs/evidence/bridge-core-tests.json) 为准。下一阶段优先恢复实际文件工具执行链及工作区路径保护，再接回扩展入口和构建配置。
