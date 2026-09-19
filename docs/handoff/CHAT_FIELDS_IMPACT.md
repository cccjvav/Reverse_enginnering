# 那 5 个 Chat 字段到底影响什么

一句话:**只影响聊天窗口里工具卡片长什么样,不影响任何功能。**

下面是查证过程,不是感觉。

---

## 它们走到哪一步

```
tool-presentation.ts  createToolPresentation()
        │  生成 { title, data }
        ▼
native-chat.ts:555    new vscode.ChatToolInvocationPart(...)
                      part.invocationMessage = presentation.title
                      part.toolSpecificData  = presentation.data   ← 五个字段在这里
        ▼
            VS Code 聊天窗口渲染那张工具卡片
```

整条链路只有**一个出口**:`part.toolSpecificData`。这是 VS Code 用来画"工具调用卡片"的数据。

## 证据:它们不参与任何逻辑

我做了两项检查:

| 检查 | 结果 |
| --- | --- |
| 除 `tool-presentation.ts` 外,是否有别处读 `.items` / `.metrics` / `.diffPreview` / `.presentationKind` / `.presentationStyle` | **空** |
| B 层 41 个模块是否依赖这些字段 | **空** |

也就是说:**它们只被构造、被交给 VS Code 渲染,没有任何代码根据它们做判断**。纯展示层,而且集中在一个文件里。

---

## 具体影响什么(用大白话)

这五个字段决定聊天里那张卡片的"精致程度":

| 字段 | 没有它,你会失去 |
| --- | --- |
| `items` | 文件/搜索结果的**可点击列表**(点一下跳到那个文件那一行) |
| `metrics` | 卡片上的**统计小标签**,比如 "Matches 12"、"Files 3"、耗时 |
| `diffPreview` | 改动的**彩色 diff 预览**(带 +/- 行号、折叠) |
| `presentationKind` | 按工具类型换**图标/版式**(文件、搜索、编辑、终端、诊断、LSP、通用) |
| `presentationStyle` | ShunCode 自己的**卡片皮肤**(你那个 `shuncode.chat.bridgeStyleUI` 开关) |

**不受影响的**:工具照跑、文件照读照写、命令照执行、patch 照打、MCP 桥照连、模型照回答。

打个比方:这就像一个 App 的**图标和排版配色**丢了,功能按钮全在、全能点。

---

## 关键细节:代码本身就有降级路径

`createToolPresentation` 最后那个 `return`(第 438 行起)里写着:

```ts
input: options.isError || kind === "generic" ? technicalInput : "",
output: options.isError ? rawOutput : presentation.output ?? (kind === "generic" ? rawOutput : ""),
```

`input` 和 `output` 是**公开 API 本来就有的两个字段**。也就是说:哪怕五个自定义字段全没有,卡片仍然有内容可显示——就是朴素的"输入/输出"文本,而不是漂亮的列表和 diff。

**你的老用户完全不受影响**:他们装的是编译好的成品,里面宿主和扩展是配套的,卡片该怎么显示还怎么显示。这个缺口只存在于"用公开 Code OSS 重新编译"这条路上。

---

## 所以这 11 个错误的真实含义

不是"功能缺失",是**"我们手上的 vscode.d.ts 比你当年用的那份少了几行声明"**。

- 编译器说"这个字段不存在" → 因为公开声明里确实没写
- 但运行时它真实存在 → 你的 fork 里有,发布 bundle 里也确实在构造它们(`items` 出现 53 次)

三个选择:

1. **你找到 proposed 声明** → 11 变 0,一切原样
2. **我发布"候选声明"到 `community/`**(标注为重建,不碰公开命名空间)→ 11 变 0,功能完整,只是那份声明是我重建的而非原件
3. **什么都不做** → 工程仍然可编译除 `tool-presentation.ts` 外的全部;真要打包,把这一个文件的五个字段去掉就能编过,代价是卡片退化成朴素文本

我个人建议 **2**:形状已经用你自己的代码验证过了(你的代码原样编译通过,三次篡改测试都正确失败),而且明确标注来源,不会冒充原件。
