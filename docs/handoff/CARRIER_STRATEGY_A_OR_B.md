# 载体走 A 还是 B：给作者的决策说明

作者反馈：不熟悉 Code OSS 和 webview，需要知道两条路具体差在哪。

本文先用大白话讲清概念，再给基于**实测数据**的对比和我的建议。所有数字都附复核命令。

---

## 〇、三十秒版本

我原本以为这是个艰难的取舍。**查完实际代码后，结论比预想的清楚得多：建议走 B。**

决定性证据：你的 Bridge 界面虽然长在 Code OSS 内核里，但它**几乎不依赖内核的特殊能力**——它只是"画界面 + 调用你自己扩展里的命令"。而且**你自己在同一个扩展里已经用 webview 写过一个功能完整的界面了**（Workspace Hub）。

换句话说：B 不是让你去学一套新东西，而是**沿用你已经在用的做法**。

---

## 一、先搞清两个词

### Code OSS 是什么

VS Code 的开源版本。你的 ShunCode 就是拿它改的——`product.json` 里写着 `1.132.0`，改了名字叫 ShunCode。

它分两层，这个区分是理解 A/B 的关键：

```
┌─────────────────────────────────────────────┐
│  内核（Code OSS 本体）                        │
│  编辑器、菜单、侧边栏、窗口布局                  │
│  → 改这里要重新编译整个软件（几十分钟起）         │
├─────────────────────────────────────────────┤
│  扩展（像插件）                               │
│  你的 shuncode 扩展就在这层                    │
│  → 改这里只要重新打包扩展（几秒到几十秒）         │
└─────────────────────────────────────────────┘
```

**你的 Bridge 界面现在在"内核"那一层**，所以每次改一个按钮都要重编译整个 ShunCode。

### webview 是什么

扩展想画一个复杂界面时，VS Code 给的一块"画布"——**本质就是一个内嵌的浏览器页面**，你用 HTML/CSS/JS 写，和写网页一样。

**你已经在用了。** `recovered/shuncode-extension/media/workspace-hub.html` + `.css` + `.js`，加上 `src/workspace-hub.ts`，一共 49679 字节——这就是你自己写的一个 webview 界面，有 16 个 div、7 个按钮、2 个分区，通过 `postMessage` 和扩展通信。

> 复核：`type recovered\shuncode-extension\media\workspace-hub.html`

---

## 二、两条路分别是什么

### A：补丁 Code OSS 源码树

把你原来那个内核类（12 万字节、85 个方法）作为补丁打回 Code OSS 源码，重新编译。

- 界面和原版**一模一样**
- 但你从此要维护一份"补丁集"。上游每次升级，补丁可能打不上，要人工改

### B：扩展 + webview 重写

把界面改用 HTML/CSS/JS 写在扩展里，装进你已有的 shuncode 扩展。

- 界面**能做到很像，但不会逐像素相同**
- 改界面不用重编译内核；上游升级基本不影响你

---

## 三、关键实测：这个界面到底有多"依赖内核"

这是决定性的一步。我拆了那 12 万字节的类，看它真正用到了什么。

### 3.1 它用的内核服务，全都有公开替代品

| 它用的内核服务 | 用了几次 | 扩展层的公开替代 | 能替代吗 |
|---|---:|---|---|
| `commandService.executeCommand` | 14 | `vscode.commands.executeCommand` | ✅ |
| `configurationService.getValue/updateValue` | 16 | `vscode.workspace.getConfiguration` | ✅ |
| `dialogService`（对话框） | 9 | `vscode.window.showInformationMessage` 等 | ✅ |
| `clipboardService`（剪贴板） | 2 | `vscode.env.clipboard` | ✅ |
| `openerService`（打开链接） | 2 | `vscode.env.openExternal` | ✅ |
| `fileDialogService`（选文件） | 1 | `vscode.window.showOpenDialog` | ✅ |

**总共只有 44 次内核服务调用，全部有一对一的公开替代。**

### 3.2 真正的"重活"其实是画界面

| 内容 | 次数 |
|---|---:|
| `append(...)` 建 DOM 元素 | 169 |
| `$(...)` 创建元素 | 216 |

**385 次里绝大多数是在拼 HTML 结构。** 这些在 webview 里就是写 HTML——不但能做，而且更好写、更好改。

### 3.3 最关键：它没有碰任何"换不掉"的深层能力

我专门查了 webview 做不到的那些内核能力：

| 深层内核能力 | 命中次数 |
|---|---:|
| 编辑器内部 `ICodeEditor` | **0** |
| 工作台布局 `layoutService` | **0** |
| 视图注册 `viewsRegistry` | **0** |
| 快捷键 `keybindingService` | **0** |
| 主题 `themeService` | **0** |
| 存储 `storageService` | **0** |
| 通知 `notificationService` | **0** |

**全是 0。** 这说明：这个界面长在内核里，很可能只是因为当初那样写方便，**不是因为非那样不可**。

> 复核命令都在文末。

### 3.4 界面和业务逻辑本来就是分开的

它调用的 14 个命令，全是你自己扩展注册的（`shuncode.bridge.*`）：

```
shuncode.bridge.getStatus        shuncode.bridge.openSession
shuncode.bridge.access.getStatus shuncode.skills.diagnose
shuncode.skills.generateRunner   shuncode.skills.import
...
```

**真正的功能（启动 Bridge、隧道、Skills 管理）全在扩展里，内核类只是个"遥控器"。** 换掉遥控器的外壳，不影响里面的机器。

---

## 四、对比表

| | A：补丁 Code OSS | B：扩展 + webview |
|---|---|---|
| 界面还原度 | 100% 逐像素 | 约 90–95%，布局功能一致，细节字体间距会有差 |
| 改一个按钮要多久 | 重编译整个 ShunCode，**几十分钟** | 重打包扩展，**几秒** |
| 上游升级 1.132 → 1.14x | 补丁可能冲突，**每次都要人工修** | 基本不受影响 |
| 你能不能自己维护 | 难（要会 Code OSS 构建） | **较容易（就是改网页）** |
| 出安装器 | 必须完整编译 Code OSS | 可以先只发扩展，装在现有 ShunCode 上 |
| 用户安装方式 | 必须装新的完整 EXE（240MB） | **可以只更新扩展**，也能出完整 EXE |
| 和你现有做法 | 是你原来的做法 | **也是你的做法**（Workspace Hub 就是这么写的） |
| 85 个方法的迁移 | 不用动 | 逻辑可照搬，DOM 部分改写成 HTML |
| 界面存在于两个宿主 | 要维护**两份**补丁 | 一份 webview **同时服务两处** |
| 风险 | 上游升级时反复返工 | 首次重写要花时间，细节要调 |

---

## 五、我的建议：B，但分两步走

### 为什么是 B

1. **技术上没有障碍**——0 个深层内核依赖，44 次服务调用全有替代。
2. **你已经会了**——Workspace Hub 就是你自己写的 webview，同一个扩展里。
3. **可维护性差距巨大**——这是你这次的核心诉求（"可维护工程"）。A 会让你每次上游升级都被绑住。
4. **用户升级成本低得多**——B 可以只发一个扩展包，不必让用户重装 240MB 的 EXE。
5. **不妨碍以后出完整安装器**——B 做完照样能打包进 EXE，两者不冲突。

### 但有一件事必须说清楚（B 的真实代价）

**界面不会和原来一模一样。** 原版用的是 VS Code 内部的样式系统，webview 里要自己写 CSS 去贴近。我的估计是能做到 90–95% 像——布局、按钮位置、功能分区都能一致，但字体渲染、边距、滚动条这些细节会有肉眼可辨的差别。

如果你的要求是"必须和原来分毫不差"，那只能选 A，并接受长期维护成本。

### 建议的两步走

- **第一步：先做一个 Skills 卡片的 webview 原型。** 不动其他任何东西，就把 85 个方法里 Skills 那一块（约 20 个方法）做出来，你看效果。**满意再继续，不满意就止损**，损失很小。
- **第二步：满意后再迁移其余部分。**

这样你不用现在就赌一个大决定。

---

## 六、需要你回答的

只有一个问题：

> **界面必须和原版分毫不差吗？**
>
> - **不必须，像就行** → 走 B，我先做 Skills 卡片原型给你看
> - **必须一模一样** → 走 A，我会先做上游构建可行性验证
> - **不确定** → 我先做 B 的原型，你看了实际效果再定（推荐）

---

## 附：复核命令

```cmd
REM 1. UI 类的 85 个方法
python -c "import json;print(len(json.load(open('docs/evidence/bridge-ui.json'))['classes'][0]['methods']))"

REM 2. 它依赖的内核服务（构造函数第一行）
more recovered\bridge-ui\bridge-ui-1.js.txt

REM 3. 你自己已有的 webview 界面
dir recovered\shuncode-extension\media

REM 4. 这些 BRIDGE_* 命令是扩展注册的
type recovered\shuncode-extension\package.json
```

深层内核依赖的 0 命中，可用 `findstr` 自行验证：

```cmd
findstr /C:"layoutService" /C:"viewsRegistry" /C:"themeService" recovered\bridge-ui\bridge-ui-1.js.txt
REM 无输出 = 确实没有依赖
```

---

## 七、本文的边界

- 90–95% 还原度是我的**估计**，不是实测。要确认只能做原型。
- 我没有运行过原版 GUI，对比基于静态代码分析。
- "0 个深层依赖"两个 UI 类我都查了：`bridge-ui`（长在 `workbench.desktop.main.js`）和 `bridge-ui-sessions`（长在 `sessions.desktop.main.js`）。两者各 85 个方法、同为 122966 字节，但**字节不同**（SHA `da0171ca…` vs `c47df110…`），是同一界面在两个宿主里的两份构建。深层内核依赖均为 0。
- 迁移工作量我没有给工时估计——我无法可靠估计，给了也是编的。
- 一个已知增量：原版界面存在于**两个宿主**，走 B 时一份 webview 实现即可同时服务两处，这反而是 B 的额外好处；走 A 则要维护两份补丁。
