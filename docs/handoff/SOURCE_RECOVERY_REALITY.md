# 源码恢复实况：你到底拿回了多少（2026-09-18）

> **2026-09-19 更正**：本文第 75 行说 B 层"丢失的只有 TypeScript 类型标注"——
> **这些类型现已补回**。41 个模块共 399/399 个导出声明都有真实类型，
> 且经真实调用方链接验证（`npm run verify:btypes`、`npm run check:btypes`）。
> 第 77 行说 C 层"尚未重建"仍然成立。
> 当前完整状态见 [STATUS_NOW.md](STATUS_NOW.md)。

作者纠正了我的方向误解。本文重新按**真实目标**盘点。

## 〇、我之前理解错了什么

作者的目标是：**拿回源码本身**——能改、能重新打包成完整 ShunCode、能拿来学习自己当初做了什么。

我之前答的是"怎么把界面做得好维护、怎么发扩展给老用户"。那是**发布方式**的问题，不是**源码恢复**的问题。老用户装扩展这个思路确实很怪——他们本来就有全部功能。

**A/B 那个选择本身没有作废，但它的位置变了**：它不是"要不要做扩展"，而是"恢复完源码后，那个内核界面用哪种方式重建"。这是最后一步的问题，不是现在的主线。

---

## 一、好消息：情况比想象的好很多

我查了已发布的 bundle，有一个决定性的事实：

> **你当初打包时没有开压缩混淆（minify）。**

| 指标 | 实测值 | 说明 |
|---|---|---|
| `extension.js` 每行平均字节 | **40** | 混淆过的代码通常每行几千到几万 |
| `mcp-server.js` 每行平均字节 | **39** | 同上 |
| `extension.js` 中 JSDoc 注释块 | **221 处** | 混淆会删掉全部注释 |
| `mcp-server.js` 中 JSDoc 注释块 | **133 处** | 同上 |

这意味着：**变量名、函数名、类名、注释，全都还在。**

举个实例，从 bundle 里重建出来的并发模块长这样：

```js
/**
 * Change the permit ceiling at runtime.
 *
 * Raising it admits queued waiters immediately. Lowering it never revokes a
 * permit already held — in-flight work runs to completion and the ceiling
 * takes effect as those permits are returned, so a shrink can leave `active`
 * temporarily above `limit`.
 */
setLimit(next) { ... }
```

**这是你当初写的注释，原样还在。** 拿这个去问 AI"这个模块怎么实现的"，它能答得很清楚。

---

## 二、精确盘点：三个层次

### A 层：原始 TypeScript，100% 原件

**34 个文件，682,862 字节。** 这不是反编译出来的，是**安装器里直接带的你的源码**，哈希全部匹配。

包括你想改的收费部分：

| 文件 | 字节 | 用途 |
|---|---:|---|
| `bridge-license-service.ts` | 42,603 | 授权/登录/续期 |
| `bridge-access-controller.ts` | 4,538 | 访问控制、用量上报 |
| `bridge-license-config.ts` | 1,012 | 授权配置 |
| `bridge-server.ts` | 82,642 | Bridge 主逻辑 |
| `ide-tool-broker.ts` | 92,279 | IDE 工具代理 |
| `model-provider.ts` | 79,339 | 模型提供方 |
| `native-chat.ts` | 44,808 | 原生 Chat 集成 |
| ...共 34 个 | | |

**这一层可以直接编辑、直接学习、直接重新编译。**

### B 层：已重建为可读 JS，41 个模块 262,904 字节

这 24 个共享模块（`src/file-tool-registry.ts`、`src/apply-patch.ts`、`src/custom-tools.ts` 等）的**原始 TS 没有随安装器发布**——它们在你原项目的 `src/` 目录下，不在扩展目录里。

但因为没混淆，已经从 bundle 里重建成了**带注释的可读 JS**。

**丢失的只有 TypeScript 类型标注**（`: string`、`interface` 这些）。逻辑、注释、结构全在。

### C 层：只有编译产物，尚未重建

**内核 Bridge UI 两份，共 245,932 字节。** 这是 A/B 讨论的那个界面，目前只是从 36MB 的 workbench bundle 里切出来的代码片段。

---

## 三、所以"能不能重新打包完整 ShunCode"

**能，但需要补三样东西。** 按缺口从小到大：

| 缺口 | 现状 | 难度 |
|---|---|---|
| 1. 扩展源码 | ✅ A 层 34 个文件已在手 | 无 |
| 2. 共享模块 | ⚠️ B 层是 JS 不是 TS，需补类型或改用 JS 编译 | 中 |
| 3. Code OSS 底座 | ❌ 需要自建 1.132.0 + Electron 44.2.0 | 高，但可试 |
| 4. 内核 UI | ❌ C 层需重建（这才是 A/B 的位置） | 中高 |

**去收费这件事，A 层就够了。** `bridge-license-service.ts` 等三个文件都是原始 TS，`community/` 目录里已经有改造版本了。

---

## 四、修正后的路线

原路线图把"文件授权"当唯一优先项，那是错的（见 `PROJECT_AUDIT_2026-09-18.md`）。按你的真实目标，应该是：

| 顺序 | 任务 | 为什么 |
|---|---|---|
| **1** | **验证能否自建底座**（CI 试编译 1.132.0 + Electron 44.2.0） | 这是"能不能重新打包"的总开关。失败则整条路要重设计 |
| **2** | **把 B 层 41 个模块补回 TypeScript** | 让共享模块也能编辑和学习，不只是能读 |
| **3** | **建立可编译的完整工程骨架** | 把 A 层 + B 层拼成一个真能 `npm run compile` 的项目 |
| **4** | 去收费改造合入主线 | 已有 `community/` 基础 |
| **5** | 重建内核 UI（A/B 在此登场） | 最后一块 |

**第 1 步最关键也最容易被忽略**：如果自建底座这条路走不通，那"重新打包完整 ShunCode"就得换方案（比如只发扩展 + 让用户用官方 VS Code）。**这个答案应该尽早拿到，纯 CI 任务，不需要你的机器。**

---

## 五、关于"拿 exe 问 AI 也问不出来"

这个痛点现在已经基本解决了，而且比你预期的好：

- **A 层 34 个文件**：直接就是你写的 TypeScript，AI 能完整解读
- **B 层 41 个模块**：带原始注释的可读 JS，AI 也能解读
- 仓库里还有 `docs/learning/` 逐行讲解（目前 6 个文件 363 行，其余待补）

**换句话说：你现在拿仓库里的源码去问任何 AI，它都能告诉你某个功能是怎么实现的。** 不需要再对着 exe 猜。

---

## 六、待确认

- 自建底座能否成功编译（**第 1 步要验证的**）
- B 层补 TS 类型的工作量（要试了才知道）
- 内核 UI 重建的还原度（要做原型才知道）

---

## 附：自己复核

```cmd
REM 原始 TS 源码
dir recovered\shuncode-extension\src

REM 没有混淆的证据:看行数和字节数的比值
REM 40 字节/行 = 正常代码; 几千字节/行 = 混淆
find /c /v "" recovered\shuncode-extension\dist\extension.js

REM 注释还在
findstr /C:"/**" recovered\shuncode-extension\dist\extension.js

REM 重建模块的可读性
type reconstructed\bridge-core\src\concurrency.js
```
