# 需要你提供什么,以及怎么收尾

这份文档回答两个问题:**哪些事只有你能做**,以及**做完之后项目算什么状态**。

写给非专业开发者。每一项都写明了:为什么需要它、没有它会怎样、怎么找。

---

## 一、先说结论:机械推导已经到头了

凡是能从你那个 `.exe` 里推导出来的,现在基本都推导完了:

| 已完成 | 结果 |
| --- | --- |
| 载体能否从源码重建 | **能**。CI 全绿:依赖安装 + 编译 0 错误 |
| Electron 44 剪贴板适配 | **恢复了你当年的原始解法**(逐字,非猜测) |
| B 层 41 个模块类型 | **398/398 声明有真类型**,经真实调用方检验 |
| 工程目录布局 | **从你的 tsconfig 恢复**,0 个未解析模块 |
| Chat 宿主 5 个字段形状 | **重建并验证**(你的代码原样编译通过) |

最后一条路也走完了:安装包里确实带了一份 `out/vscode-dts/vscode.d.ts`(742072 字节),我专门改了取证工具把它取出来——**结果它和公开版逐字节相同**,没有 `ChatSimpleToolResultData`,五个字段一个都没有。

这是个**有价值的否定结果**:说明你的 fork 只打包了稳定 API,proposed 声明是构建时输入、没进安装包。这条路不是"没试",是**试过了,确认此路不通**。

---

## 二、只有你能提供的东西(按重要性排序)

### 1. `vscode.proposed.chatParticipantAdditions.d.ts`(你 fork 里的那份)

**为什么需要**:骨架最后 11 个错误全来自它。你当年写 `NonNullable<vscode.ChatSimpleToolResultData["items"]>`,说明你的那份声明里有这个字段,公开版没有。

**没有它会怎样**:`tool-presentation.ts` 永远编译不过。我已经把 5 个字段的形状从你的代码里重建出来了(`docs/evidence/host-chat-shapes/`),**但我拒绝直接写进去**——那等于伪造宿主。你给了原件,我就能确认或纠正,然后 11 变 0。

**怎么找**:在你当年 Code OSS fork 的检出目录里,路径大约是
`vscode-main/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts`。
同目录下另外 6 个 `vscode.proposed.*.d.ts` 一并给最好(你的 tsconfig 列了 7 个)。

**如果找不到**:告诉我,我可以把重建结果标注为"候选声明"单独放在 `community/`(不碰公开命名空间),让工程能编译,同时保留"这是重建不是原件"的标记。这是次优解,但可行。

---

### 2. 那两个只剩 `.js` 的 B 层模块

你的 tsconfig 点名要 `../../src/file-tool-registry.ts` 和 `../../src/ide-tool-definitions.ts`,但安装包里只有编译后的 `.js`。

**影响**:比上一条小得多。我已经给它们写了 `.d.ts`,工程能编译。缺的只是**可编辑的原始 TypeScript**。

**怎么找**:同一个 fork 检出里的 `src/` 目录。顺带一提,那里应该还有其余 39 个模块的 `.ts` 原件——**如果整个 `src/` 目录还在,B 层就不用"重建"了,直接是原件**。

---

### 3. 决定"去收费"改造要走多远

这一项**不是找文件,是拍板**。

我目前只做了技术恢复,没动你的授权逻辑主线。`community/` 里有三份去商业化的 TS 基础(之前的工作),但还没合进主线。需要你明确:

- 是**完全去掉**登录/付费门槛,还是保留但默认放行?
- 模型提供方的 API key、隧道认证这些**第三方凭证必须保留**(我不会动),这点你确认一下。

---

## 三、剩下 7 项发布门槛,以及它们为什么还红着

`npm run check:release` 会退出 2,这是**预期的**——不是坏了。7 项 BLOCKED:

| 门槛 | 为什么还红 | 需要什么 |
| --- | --- | --- |
| `carrier-identity` | 你的载体自报 commit `09533f92`,上游不存在——是你自建的 fork | 你的 Code OSS fork 源码 |
| `host-chat-api` | 就是上面第 1 项 | proposed 声明 |
| `native-runtime` | 原生模块 ABI 没在真机验证过 | Windows 机器实测 |
| `authorization-integration` | **注意**:审计发现 0.7.4 里 `checkPermission` 根本没有生产者,逐文件授权从未启用过 | 你确认是否要新建这个能力 |
| `http-integration` | 适配器只做了源码链接,没跑过真实生命周期 | 真机验收 |
| `real-activation-gui-mcp` | 没做过真实桌面激活/GUI/隧道验收 | Windows 机器 + 真实客户端 |
| `source-built-installer` | 没产出过新安装包 | 前面几项齐了之后才能做 |

**我不会把这些硬改成 PASS。** 它们红着才是诚实的状态。

---

## 四、你现在可以怎么验收我的工作

不需要装任何东西,在仓库里跑这几条(Windows CMD 里先激活 conda):

```
npm install
npm test                      # 167 项应全过
npm run verify:btypes         # 37 个类型声明严格模式编译 + 故意写错的对照必须被拒
npm run check:btypes          # 171 个函数签名与实现逐一比对
npm run verify:host-shapes    # 你的代码对着重建形状编译 + 对照必须失败
npm run assemble:skeleton     # 拼出工程骨架
npm run diagnose:skeleton     # 应显示 0 unresolved / 14 errors
npm run check:release         # 应退出 2,7 项 BLOCKED —— 这是对的
```

每个验证工具都带**"故意写错的对照"**:如果那个对照居然通过了,说明检查本身失效,工具会直接报失败。这样你不用相信我说"它通过了",可以自己看它**能不能失败**。

---

## 五、如果你只想做一件事

**把你当年 Code OSS fork 的 `src/vscode-dts/` 整个目录找出来给我。**

那里面就是第 1 项要的 proposed 声明。拿到它,骨架从 11 个错误直接到 0,整个 A 层 + B 层就是一个**真正能编译的完整工程**——也就是你最初要的"能编辑、能重新编译"。

其余的(真机验收、打包安装器)都要你的 Windows 机器,而且必须在能编译之后才有意义。
