# 候选宿主声明(重建,非原件)

## 这是什么

ShunCode 0.7.4 构建在一个**分叉过的 Code OSS** 上。那个 fork 的
`vscode.proposed.chatParticipantAdditions.d.ts` 给 `ChatSimpleToolResultData`
声明了 **11 个公开 API 没有的成员**。这些声明是构建时输入,**没有打包进安装包**
——我专门改了取证工具、跑了一次 CI 确认:安装包里那份 `vscode.d.ts` 和公开版
**逐字节相同**,一个自定义成员都没有。

所以这份声明是**从作者自己的代码里重建的**,不是恢复出来的原件。

## 为什么放在 `community/` 而不是 `reference/`

`reference/vscode-types/` 存放的是**固定的公开候选声明**,必须保持原样。往那里
加字段等于伪造宿主——让 11 个诚实的错误变绿,却什么也没恢复。仓库里有测试专门
锁住那些文件不许被改。

这份放在 `community/`,是**维护层**:明确标注为重建、与原件物理隔离、谁引用谁
自己知道它的来历。

## 证据强度

| 成员 | 依据 | 置信度 |
| --- | --- | --- |
| `items` | 作者在 `tool-presentation.ts:129,153` 显式写出元素类型 | **高** |
| `metrics` | 五处内联构造,始终 `{label, value}` 两个字符串 | **高** |
| `diffPreview` | 作者三层索引 `["diffPreview"][number]["hunks"][number]`,行字面量给出判别联合 | **高** |
| `presentationKind` | 函数返回类型声明 + 7 个返回值穷举 | **高** |
| `summary` `terminalId` `diff` | 作者自己的 `ParsedPresentation` 接口(第 14-23 行)同名同类型 | **高** |
| `isError` | `Boolean(...)` 构造,必为 boolean | **高** |
| `durationMs` | 全代码统一 `number \| undefined` | **高** |
| `detailsLabel` | 仅见一处字面量 `"Technical details"` | **中**(类型是 string,但域未知) |
| `presentationStyle` | 仅见一处 `"shuncode"` | **低**(真实取值域可能更宽) |

## 验证方式

```
npm run verify:host-shapes
```

把作者的真实代码原样编译到这份声明上。这个检查**带一个故意写错的对照**,
如果对照居然通过,工具会直接报失败——所以你验证的不只是"它通过了",
而是"它真的在检查"。

另外做过三次篡改测试,全部正确失败:删掉 `items.description`、
少一个 `presentationKind` 成员、把 diff 的 `kind` 拼错。

## 怎么用

编译骨架时把 `community/host-types/` 加入 `typeRoots` 或直接引用
`chat-surface.d.ts`。它用 `declare module 'vscode'` 做**接口合并**,不修改
`reference/` 下任何文件。

## 已知未解决

发布 bundle 里有第二份 `parseUnifiedDiffPreview`,构造的是
`{ oldPath, newPath, hunks }` 而不是 `{ path, hunks }`。可能宿主两种都接受,
也可能两份代码漂移了。**如实记录,没有强行抹平。**

## 如果你找到了原件

拿你 fork 里真正的 `vscode.proposed.chatParticipantAdditions.d.ts` 替换即可。
这份重建的价值到此为止——它是**在找不到原件时的可用替代**,不是等价物。
