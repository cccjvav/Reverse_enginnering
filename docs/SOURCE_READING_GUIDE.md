# 已恢复源码阅读指南

> 后续范围更新：作者已明确要求去除自有商业收费门槛。`recovered/` 保持原件，修改版放在 `community/`，详见 [社区版改造记录](COMMUNITY_MIGRATION.md)。恢复事实与产品策略改动分开记录。

## 现在拿到了什么？

在 Windows 0.7.4 安装包中直接发现并原样取回 **34 个 `.ts` / `.mts` 源文件，共 682,862 字节**。这些是发行包附带的源码，不是从 JS 猜出来的 TypeScript；不能因此保证它们覆盖原工程全部文件，或一定与所有编译产物完全同步。

精简后的 `recovered/shuncode-extension/` 包含 **51 个文本文件，共 4,776,532 字节**。包括上述源码、扩展/运行时 JS、配置、前端资源、agent 提示文件和两份编译后的测试。全部文件的 SHA-256 已与远端提取清单核对一致。

## 建议的阅读顺序

以下路径都相对于 `recovered/shuncode-extension/`：

| 顺序 | 文件 | 学习重点 |
|---|---|---|
| 1 | `package.json` | 扩展名称、版本、入口、激活事件、命令、设置与 proposed API。先建立功能目录。 |
| 2 | `src/extension.ts` | `activate()` 创建和连接了哪些服务；命令如何注册；扩展怎样接入 VS Code。不要直接启动它。 |
| 3 | `src/config.ts`、`src/model-provider.ts` | 配置入口与模型提供者；与原生语言模型 API 的接口。 |
| 4 | `src/native-chat.ts`、`src/runtime-client.ts` | Chat 参与者与外部 agent 运行时之间的职责分工。 |
| 5 | `src/workspace-hub.ts`、`src/workspace-hub-store.ts` | 多工作区/多实例数据组织、记录持久化与并发操作。 |
| 6 | `media/workspace-hub.html`、`.css`、`.js` | Webview 的结构、样式以及与扩展端的消息交互。 |
| 7 | `src/bridge-server.ts`、`src/bridge-mcp-transport.ts`、`src/bridge-tool-dispatcher.ts` | Bridge 服务、传输协议与工具调度层如何分开。 |
| 8 | `src/ide-tool-broker.ts` | IDE 编辑、文件、终端等能力如何供上层调用。 |
| 9 | `src/bridge-license-service.ts`、`src/bridge-license-config.ts` | 客户端许可证校验与服务端边界。这里只包含客户端与公钥配置，不代表已恢复服务端或签名私钥。 |
| 10 | `dist/extension.js`、`runtime/agent-host.js`、`runtime/mcp-server.js` | 查看打包后的模块边界注释，对照哪些模块源码已经存在，哪些只能从产物继续恢复。 |

**区分两个 `src/`：** 扩展自己的 `extensions/shuncode/src/` 已有很多原始 TS；代码中 `../../../src/...` 指向原工程更上层的共享模块，并不在这个扩展目录中。不要把二者混成一个目录。

## 为什么还不能直接编译？

静态审计报告：[`evidence/source-completeness.json`](evidence/source-completeness.json)。

1. 发现 **32 处尚未解析的相对导入，涉及 24 个不同共享模块路径**，例如 `custom-tools`、`file-tool-registry`、Bridge 会话管理、并发与工具验证。这里是正则导入审计，不是完整 TypeScript 编译器诊断。
2. 原 `tsconfig.json` 引用了尚未恢复的 Code OSS API 声明、上层共享源码和原始测试 TS，共 10 个配置路径当前不存在。
3. 发行版扩展 `package.json` 没有 `scripts`、`dependencies`、`devDependencies`；原工作区的构建脚本和锁文件还没找回。
4. 扩展使用 7 个 proposed API。直接安装到任意标准 VS Code 不能视为兼容，必须核对对应的宿主和声明文件。
5. 主应用包声明 `1.132.0`、Electron 开发依赖 `44.2.0`，但不能仅凭这些字段自动取得精确上游基线。产品 commit 在公开 `microsoft/vscode` 查询未找到。
6. Bridge 许可服务端不在目前恢复材料中。不会尝试用客户端公钥推导私钥。后续按作者要求改为免费社区策略属于产品改造，不冒充服务端源码已恢复。

## 编译产物还能帮助补哪些缺口？

三个 bundle 保留了形如 `// src/bridge-session-registry.ts` 的模块来源注释，共识别到 **43 个不同的上层共享源码路径标签**。这提示部分缺失模块的运行逻辑已在包中，下一步可以依据这些边界整理其编译后 JavaScript。

但要注意：标签只证明打包产物中有对应模块的线索。它不是 source map，不能自动找回被擦除的 TypeScript 类型、注释或构建时裁剪掉的分支。任何由此整理出的代码都应标成“由编译产物重建”。

## source map 的真实情况

- 主安装树没有独立 `.map` 文件。
- 自定义扩展保留的 51 个文本文件未发现内嵌 source map。
- `node_modules.asar` 的目录头包含 **5,716 个文件，其中 1,208 个 `.map` 路径**；示例路径位于第三方依赖包中。尚未验证它们是否含 `sourcesContent`，更不能把它们算作 ShunCode 自有源码的恢复成果。

## 已做的验证与尚未做的验证

- 已做：原包哈希、解包退出码、51 个保留文件的原字节哈希、静态导入与配置审计。
- 已做：9 个 JS/CJS 文件通过 `node --check` 语法检查，见 [`evidence/javascript-syntax.json`](evidence/javascript-syntax.json)。此命令只解析，不激活扩展或执行应用。
- 未做：完整 TS 编译、恢复代码单元测试、扩展激活、Windows 实机启动、整套应用打包。

不要把“文件存在”“语法通过”“能编译”“功能正常”当成同一个验收标准。


## 新增阅读路径：独立 Bridge 核心重建层

先读 [`reconstructed/bridge-core/README.md`](../reconstructed/bridge-core/README.md)。建议按 `bridge-http-router → bridge-session-registry → jsonrpc-request-id-registry → bridge-event-store` 理解传输与状态，再看 `file-tool-input-compat → tool-input-validation → file-tool-registry`。最后阅读 `managed-command-cancellation` 中的会话归属和本地主机确认，不要把这些保护当成收费功能删掉。

对应 [`provenance.json`](../reconstructed/bridge-core/provenance.json) 的 `start/end` 可定位到原 bundle 的 UTF-16 字符位置；不是文件字节偏移。`sourceLabelIndex` 同时列出尚未重建的模块声明和外部引用。当前 bundle 有 38 个共享标签，三份 bundle 合并原统计为 43。

同一个 `// src/xxx.ts` 可能出现两次，第一次只有构建信息初始化。不能用正则截第一段就声称模块完整；新工具从真实注释定位来源，再使用 AST 顶层声明和词法自由变量分析建立依赖闭包。

`file-tool-registry` 特别标注为部分重建，没有文件执行器。校验器也不是完整 JSON Schema 实现，更不能代替工作区安全检查。原貌层保留原行为；修复候选见 [`community/bridge-core`](../community/bridge-core/README.md)。


## 第二组：实际文件读取与路径边界

新增 [`FILE_READER.md`](../reconstructed/bridge-core/FILE_READER.md)。按 `workspace-paths → resolveSafePath → readSingleFile → readTextRange → readFiles` 阅读，并对照 `tests/bridge-core-files.test.mjs`。原注册表仍只有目录/解析，独立读文件函数已经有真实临时文件测试，二者不要混淆。

特别注意权限确认是异步的：保存一个已经检查过的路径字符串，不等于固定了它稍后指向的文件。测试分别复现原貌风险和验证维护层再次核对路径的检查点；后者仍不是原子打开，也不是完整防竞态方案。输出预算同样不等于总 I/O 或内存限额。


## 第三组：写入前检查、提交与回滚

按 `parsePatch → preflight → withFileLocks → preflight → commitPlans → rollbackPlans` 阅读新恢复的 `apply-patch.js`，并对照 `tests/bridge-core-patch.test.mjs`。显示 diff 在 `canonical-diff.js`。先读 [PATCH_WRITER.md](../reconstructed/bridge-core/PATCH_WRITER.md) 的风险与非原子边界，不要因为函数叫 rollback 或结果写着 staged 就假定所有操作可安全恢复。
