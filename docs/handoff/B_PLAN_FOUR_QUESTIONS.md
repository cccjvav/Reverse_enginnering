# 关于 B 方案的四个问题（作者提问，2026-09-18）

作者选择倾向 B，并问了四个问题。本文逐一回答，先给短答案，再给证据。

| 问题 | 短答案 |
|---|---|
| 1. 安装是不是很方便 | **是，但分两种情况**。给已装 ShunCode 的老用户：装一个扩展包即可。给新用户：仍需完整安装器。 |
| 2. B 会丢功能吗 | **功能不丢，位置会变**。85 个方法的业务逻辑全部可搬；**唯一真实损失是"界面嵌在哪"**。 |
| 3. 能单独给 VS Code 用吗 | **不能直接用**（会报错），**但可以改造到能用**，代价是砍掉部分 Chat 集成。 |
| 4. 上游升级是什么意思 | 微软发布 VS Code 新版本，你的底座要不要跟进。**A 跟进很痛，B 基本无感。** |

---

## 问题 1：安装是不是很方便？

比现在方便很多，但要分清两类用户。

### 老用户（已经装了 ShunCode 0.7.4）

**很方便。** 扩展就是一个 `.vsix` 文件（本质是压缩包），装法两种：

- 界面：扩展面板 → 右上角 `...` → 从 VSIX 安装
- 命令行：`code --install-extension shuncode-0.7.5.vsix`

体积参考：现在的 `dist/extension.js` 是 1670771 字节（约 1.6 MB），加上 webview 的 HTML/CSS/JS，整包大概**两三兆**（`.vsix` 会压缩，实际更小）。对比重装 240 MB 的 EXE，差了两个数量级。

### 新用户（机器上什么都没有）

**仍然需要完整安装器。** 因为扩展得有个"宿主"才能跑。

但这里有个 B 独有的好处：**你可以先只做扩展、先给老用户用起来**，完整安装器慢慢做。走 A 的话做不到——A 的界面在内核里，不重新编译整个软件就没法给任何人。

### 一个重要前提

老用户装扩展的前提是**新扩展能在 0.7.4 里跑起来**。0.7.4 是你自建的底座（`engines: ^1.132.0`），扩展装进去应该没问题——但这需要在真机验证，我在 Linux 沙箱里做不了。**这条算"待验证"，不是"已确认"。**

---

## 问题 2：Bridge 在内核里，B 复现会丢功能吗？

这是四个问题里最重要的。我的答案是：**业务功能一个都不丢，丢的是"界面嵌在什么位置"。**

### 为什么功能不丢

关键在于那个内核类**本身不实现任何功能**。它是个遥控器：

```
内核里的 UI 类（12 万字节）          你的扩展（真正干活的）
├─ 画按钮、画卡片                    ├─ 启动/停止 Bridge
├─ 收集用户输入          ──命令──▶   ├─ 管理隧道
└─ 显示状态                          ├─ Skills 导入/诊断
                                     └─ MCP 服务
```

证据：这个类里 14 次 `commandService.executeCommand` 调的全是 `shuncode.bridge.*`、`shuncode.skills.*`——**全是你扩展自己注册的命令**。启动 Bridge 的真实代码在 `src/bridge-server.ts`（82642 字节），不在 UI 类里。

所以 webview 里放一个按钮，点击时 `vscode.commands.executeCommand('shuncode.bridge.start')` —— **调用的是同一个后端，行为完全一致**。

同理，85 个方法里的：

- Skills 管理（导入、诊断、生成 runner、开关）→ 全是命令调用，照搬
- 隧道配置（Cloudflare / ngrok / 命名隧道）→ 读写配置 + 命令，照搬
- 快捷链接、复制提示词、工作区范围开关 → 读写配置，照搬
- 状态刷新、错误显示 → 命令返回值渲染，照搬

### 真正会损失的东西（说清楚，不含糊）

**唯一的实质损失是界面的"嵌入位置"。**

原来的 Bridge UI 是内核注册的，能嵌在工作台的特定位置（和编辑器深度融合的那种）。扩展做不到完全一样，但有两个可选位置，**都是你已经在用的**：

| 方式 | 你的先例 | 效果 |
|---|---|---|
| `WebviewPanel`（标签页） | `workspace-hub.ts` 第 268 行 | 像打开一个文件标签页 |
| `WebviewView`（侧边栏可停靠） | `codex-account-view.ts` 第 14 行 | 停在侧边栏，接近原版观感 |

**推荐 `WebviewView`**，它能停靠在侧边栏，和原版位置最接近。

其余的差异：

- **视觉细节**：字体、边距、滚动条会有肉眼可见的差别（前文说的 90–95%）
- **主题跟随**：webview 需要自己读 VS Code 的 CSS 变量来配色，能做到跟随明暗主题，但不是自动的，要写
- **启动瞬间**：webview 是独立页面，首次打开可能比内核界面慢一点点（几十毫秒级，基本无感）

### 一句话总结

> **功能 = 不丢。位置和观感 = 会变。**

---

## 问题 3：这个扩展能单独给 VS Code 用吗？

**直接拿去用：不行，会报错。改造一下：可以，但要砍功能。**

### 为什么不行

`package.json` 里声明了 **7 个 proposed API**（微软的实验性接口）：

```
defaultChatParticipant      chatParticipantAdditions
chatParticipantPrivate      chatReferenceBinaryData
chatPromptFiles             chatProvider
languageModelThinkingPart
```

**proposed API 的规则是：只有微软官方商店发布的扩展、或开了特殊开关的开发模式才能用。** 普通用户在正式版 VS Code 里装你的扩展，这些 API 会直接不可用，扩展激活就失败。

你的 ShunCode 能用，正是因为它是你**自己编译的底座**，你在里面放行了这些 API。

### 那哪些功能依赖这些 API

这 7 个全是 **Chat 相关**的——就是把你的模型接进 VS Code 原生聊天窗口那套：

- `chatParticipants`（聊天参与者）
- `languageModelChatProviders`（模型提供方）
- `languageModelTools`（聊天里的工具调用）

### 改造方案（如果你想要）

砍掉 Chat 集成，保留其余部分，做一个「VS Code 通用版」：

| 功能 | 能不能保留 |
|---|---|
| MCP Bridge 服务（启动/停止/隧道） | ✅ 能 |
| Skills 管理 | ✅ 能 |
| 文件工具（apply_patch / read / search） | ✅ 能 |
| Workspace Hub | ✅ 能 |
| Bridge webview 界面 | ✅ 能 |
| **原生 Chat 集成** | ❌ 不能（要 proposed API） |
| **模型提供方注册** | ❌ 不能 |

也就是说：**作为一个"MCP Bridge 工具扩展"能装进任何 VS Code；作为"完整 AI 编程助手"不行。**

这其实挺有价值——外面的人可以先用你的 Bridge，想要完整体验再装 ShunCode。

**注意：这是额外工作，不在当前计划里。** 要做的话应作为独立任务排期，别和 B 的主线混在一起。

---

## 问题 4：上游升级是什么意思

「上游」= 微软的 VS Code 官方仓库。你的 ShunCode 是从它 1.132.0 那个版本分出来改的。

**上游升级**，就是微软发了 1.133、1.134…（现在已经到 1.138 了），你要不要把你的底座也跟上去。

### 为什么要跟

- 安全补丁
- 新功能、新 API
- 不跟的话，越拖差距越大，将来想跟会更难

### A 和 B 在这件事上的差别，这是本质区别

**走 A（补丁内核）：**

你的 Bridge UI 代码是**插在 Code OSS 源码文件中间**的。微软改了同一个文件 → 你的补丁打不上去（叫「冲突」）→ 得人工一行行看怎么合并。

你这个 UI 有 12 万字节、85 个方法，而且**存在于两个宿主**（`workbench` 和 `sessions`），意味着**两份补丁**。每次升级都要来一遍。

> 打个比方：你在别人写的书里插了 200 页自己的内容。作者出第二版、改了排版，你得重新找位置把 200 页插回去。

**走 B（扩展）：**

扩展通过**公开 API** 和 VS Code 打交道。微软对公开 API 有兼容承诺，不会随便改。你的扩展代码和 VS Code 源码**是分开的两个东西**，升级底座通常什么都不用做。

> 比方：你的内容是一本独立的小册子，夹在书里。书出新版，小册子照样能夹。

### 一个必须说清的例外

上面说的是**公开 API**。你现在用的那 7 个 **proposed API 不在兼容承诺范围内**——微软可能在任何版本改掉它们。

所以 B 也不是完全免疫：**Chat 那部分仍然会受上游影响**，需要跟。但影响面从「整个 UI 的两份补丁」缩小到「7 个 Chat 接口」，量级差很多。

---

## 结论与下一步

四个问题合起来看，B 依然是更好的选择，而且理由更充分了：

1. 安装确实方便（老用户装 2–3 MB 扩展 vs 重装 240 MB）
2. 功能不丢，只是界面位置和观感变化
3. 顺带解锁了「能给普通 VS Code 用」的可能（需额外工作）
4. 上游升级的负担从「两份内核补丁」降到「7 个 Chat 接口」

**建议仍然是先做 Skills 卡片原型**——先看到实际效果，再决定要不要全量迁移。

### 待验证项（我不能在当前环境确认的）

- 新扩展能否在真实 ShunCode 0.7.4 里正常安装激活（需 Windows 真机）
- webview 实际观感与原版的差距（需 GUI 对比）
- 90–95% 还原度是估计，不是实测

---

## 附：复核命令

```cmd
REM proposed API 声明
type recovered\shuncode-extension\package.json

REM 作者已有的两种 webview 用法
findstr /N "createWebviewPanel" recovered\shuncode-extension\src\workspace-hub.ts
findstr /N "WebviewViewProvider" recovered\shuncode-extension\src\codex-account-view.ts

REM UI 类只调命令、不实现功能
findstr /C:"commandService.executeCommand" recovered\bridge-ui\bridge-ui-1.js.txt

REM 真正的 Bridge 逻辑在扩展源码里
dir recovered\shuncode-extension\src\bridge-server.ts
```
