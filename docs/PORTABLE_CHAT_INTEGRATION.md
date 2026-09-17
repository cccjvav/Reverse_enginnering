# Chat 公共字段回退：可维护实验，不是原生富卡片复原

## 本轮解决什么

原工具结果格式化器把摘要、文件、计数、diff等写入自定义Chat字段；锁定的公共Code OSS候选声明只有字符串`input`和`output`。给公共声明强行补字段只能让编译器闭嘴，不能让界面画出这些内容。

新增**独立可选实验模式**：内部继续使用本地`ShunCodeToolResultData`模型，到宿主边界才转成公开的`input/output`。它自动包含上一轮HTTP维护适配器，不改变默认构建、原51个文件或已有用户overlay。

| 模式 | 类型命令后缀 | 错误/退出码 |
|---|---|---|
| 原推断基线 | `diagnose:linked-types` | 59 / 1 |
| 原路由+14份候选契约 | `diagnose:contract-types` | 14 / 1 |
| HTTP维护实验 | `diagnose:http-types` | 11 / 1 |
| HTTP+公共Chat文本回退 | `diagnose:portable-types` | **0 / 0** |

0条是候选消费者检查通过，不是找回原始类型、原宿主或检查全部原JS实现。构建报告仍明确`fullTypecheckPassed:false`、`extensionLoaded:false`、`customHostCardsRestored:false`。

## 文件如何配合（阅读顺序）

1. `community/extension/src/portable-tool-presentation.ts`：顶部类型只描述我们自己的数据，不扩展`vscode`命名空间。`import type`不产生运行时宿主加载。联合类型要求新增行有`newLine`、删除行有`oldLine`，避免随便塞对象。
2. 同文件转换函数：先排列错误状态、摘要、条目及增删数、指标、耗时、终端ID、diff，再附技术输出。最终只返回两个公共字符串字段；空结果给出完成/运行中的文本。
3. `boundedTechnicalText`复用原`chat-history.mts`的有界文本/脱敏规则，并再次处理**整个最终输出**，避免只脱敏原始输出却泄露解析后的路径或摘要。输出上限12000字符，超长内容截断；规则不是任意秘密识别器，真实凭证仍不能用于测试。
4. `community/extension/portable-presentation.provenance.json`记录维护文件和原文件SHA；`tools/portable_presentation_inputs.mjs`核验来源及转换边界，只改已知格式化器的内部类型引用与返回边界。匹配异常立即失败，不模糊修改原文件。
5. `tools/build_linked_extension.mjs`负责内存转换和受限别名；`tools/diagnose_linked_types.mjs`使用同一转换，避免测试一份源码却打包另一份。
6. `tests/bridge-core-portable-chat.test.mjs`直接执行由原格式化器生成的夹具，另以真实锁定声明做严格正反类型测试。负例使用`@ts-expect-error`，如果错误约束意外消失，测试也会失败。

### 有意降级的界面行为

即使调用者传`useShunCodeStyle:true`，此变体也只返回公共文本字段。文件名/终端ID保留为文字，不提供原卡片样式、资源点击跳转、交互diff或终端按钮。受大小限制，不保证显示全部条目/完整diff/完整技术输出。这是避免自定义字段被公共宿主忽略的源码适配方案，**尚未在桌面宿主确认实际显示效果**。需要保留原富卡片行为时，不要把这个变体当恢复完成版安装。

## 普通 Windows CMD 复现

在仓库根目录，先按[普通CMD环境说明](../README.md)准备并激活项目conda环境（不是Anaconda Prompt）。以下命令不运行安装器或Electron：

```cmd
call npm.cmd ci --ignore-scripts --no-audit --no-fund
call npm.cmd run build:portable-extension
call npm.cmd run check:portable-extension
call npm.cmd run diagnose:portable-types
echo %ERRORLEVEL%
node --test tests/bridge-core-portable-chat.test.mjs
echo %ERRORLEVEL%
call npm.cmd run check:release
echo %ERRORLEVEL%
```

依次预期：生成`.work/portable-linked-extension/dist/extension.cjs`；确定性核验通过；类型0条/退出0；专项5项通过/退出0；最后**NOT_READY/退出2**。退出2是发布门槛未关闭，不要为它关闭安全功能、改成管理员执行或把报告手改PASS。

`docs/evidence/portable-linked-extension.json`记录75个输入、31个共享别名、2个去商业化策略替换、1677498字节及哈希；`portable-type-diagnostics.json`记录候选类型0条。`release-readiness.json`现在检查这个最新可选变体：源码连接和候选类型PASS，其余7项BLOCKED。原HTTP11条报告保留，不篡改历史。

## 验证范围与后续门槛

本地Node全套143项通过；Python31项通过、3项Windows专属本地跳过。学习清单166文件31232行，人工完整讲解仍仅6文件363行，不等于每行均已讲完。CI结果另存`docs/evidence/portable-integration-tests.json`（生成后才代表远端证据）。

格式化测试的`vscode`是空冻结替身，未传workspaceRoot，没有运行URI、GUI或真实扩展激活。公共声明的严格检查不是公共宿主运行时证明。HTTP协议夹具仍是本机真实候选SDK+惰性工具替身，不是实际文件/命令/模型授权验收。

原宿主身份/富Chat卡片、原生资产和ABI、真实文件授权接入、完整HTTP运行环境、扩展激活/GUI/MCP及新Windows安装器仍需实现和实机证据。继续按[逐步验收手册](acceptance/README.md)推进，不能把此CJS直接覆盖主力安装。
