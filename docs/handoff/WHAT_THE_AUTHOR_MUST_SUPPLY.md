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
| B 层 41 个模块类型 | **399/399 声明有真类型**,经真实调用方检验 |
| 工程目录布局 | **从你的 tsconfig 恢复**,0 个未解析模块 |
| Chat 宿主 5 个字段形状 | **重建并验证**(你的代码原样编译通过) |

最后一条路也走完了:安装包里确实带了一份 `out/vscode-dts/vscode.d.ts`(742072 字节),我专门改了取证工具把它取出来——**结果它和公开版逐字节相同**,没有 `ChatSimpleToolResultData`,五个字段一个都没有。

这是个**有价值的否定结果**:说明你的 fork 只打包了稳定 API,proposed 声明是构建时输入、没进安装包。这条路不是"没试",是**试过了,确认此路不通**。

---

## 二、只有你能提供的东西(按重要性排序)

### 1. `vscode.proposed.chatParticipantAdditions.d.ts`(你 fork 里的那份)

> **已不再阻塞(2026-09-19 更新)**:经你同意,重建结果已作为**标注清楚的候选声明**
> 发布在 `community/host-types/chat-surface.d.ts`,骨架现在 **`npm run assemble:skeleton-full`
> 编译到 0 错误**。下面这段保留,是因为拿到原件仍然更好——可以直接替换我的重建版。
>
> 顺带更正:缺的是 **11 个成员,不是 5 个**(TypeScript 对一个对象字面量只报第一个
> 多余属性,早先探针少数了)。多出的 6 个同样是纯展示字段,结论不变。

**为什么仍然值得找**:重建虽然经过验证(你的代码原样编译通过 + 三次篡改测试正确失败),
但它终究是**从用法反推**的。原件能确认或纠正它,尤其是 `presentationStyle`——
我只观察到一个取值 `"shuncode"`,真实取值域可能更宽,这条标的是**低置信**。

**怎么找**:在你当年 Code OSS fork 的检出目录里,路径大约是
`vscode-main/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts`。
同目录下另外 6 个 `vscode.proposed.*.d.ts` 一并给最好(你的 tsconfig 列了 7 个)。

**找不到也没关系**:上面那个候选声明已经顶上了,工程能完整编译。

---

### 2. 那两个只剩 `.js` 的 B 层模块

你的 tsconfig 点名要 `../../src/file-tool-registry.ts` 和 `../../src/ide-tool-definitions.ts`,但安装包里只有编译后的 `.js`。

**影响**:比上一条小得多。我已经给它们写了 `.d.ts`,工程能编译。缺的只是**可编辑的原始 TypeScript**。

**怎么找**:同一个 fork 检出里的 `src/` 目录。顺带一提,那里应该还有其余 39 个模块的 `.ts` 原件——**如果整个 `src/` 目录还在,B 层就不用"重建"了,直接是原件**。

---

### 3. 决定"去收费"改造要走多远

这一项**不是找文件,是拍板**。

> **已决定(2026-09-19)**:你选择**保留**收费逻辑,理由是那套实现可能移植到你别的项目。
> 已按此执行——授权逻辑原样未动,`community/` 里那三份去商业化改造**没有合入主线**。
> 支付架构的分析见 `PAYMENT_ARCHITECTURE_PROMPT.md`。

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

那里面就是第 1 项要的 proposed 声明。**注意:A 层 + B 层现在已经能完整编译到 0 错误了**
(用我重建的候选声明),所以你最初要的"能编辑、能重新编译"**已经达成**。找到原件的价值是
把重建版换成真品,消除那点不确定性——是锦上添花,不是解锁。

其余的(真机验收、打包安装器)都要你的 Windows 机器,而且必须在能编译之后才有意义。
