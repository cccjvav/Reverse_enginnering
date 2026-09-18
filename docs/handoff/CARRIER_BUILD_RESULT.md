# 第 1 步结果：底座能不能自己编译出来（2026-09-18）

这是"能否重新打包完整 ShunCode"的总开关。在 GitHub 的 Windows 机器上真跑了一遍。

**证据文件**：`docs/evidence/carrier-build-probe.json`（CI 自动提交，含完整日志尾部）
**CI run**：`35365439853`

---

## 一、结论先说

**好消息占大头：卡点只剩 11 个编译错误，而且原因明确、可修。**

| 阶段 | 结果 | 耗时 |
|---|---|---|
| 拉上游 1.132.0 源码 | ✅ 成功，commit 与记录的 `df53daab` 一致 | 14 秒 |
| 把 Electron 改成 44.2.0 | ✅ 成功（只动这一个依赖，其余 103 个不变） | — |
| **`npm install` 装全部依赖** | **✅ 成功** | **11 分钟** |
| `npm run compile` 编译 | ❌ **11 个 TypeScript 错误** | 1.4 分钟 |

**最关键的一条：依赖安装成功了。** 这说明 Electron 44.2.0 和 Code OSS 1.132.0 在依赖层面是兼容的——所有原生模块（node-pty、sqlite3、watcher 等二十来个）都针对 Electron 44 重新编译成功了。这原本是最可能卡死的一关。

---

## 二、那 11 个错误是什么

全部集中在 3 个文件，而且**全是 Electron 自己的 API 在 42→44 之间改了**：

| 文件 | 错误数 |
|---|---:|
| `src/vs/platform/native/electron-main/nativeHostMainService.ts` | 9 |
| `src/vs/platform/browserView/electron-main/browserViewMainService.ts` | 1 |
| `src/vs/platform/native/electron-main/auth.ts` | 1 |

具体内容：

```
行1008  Property 'readImage' does not exist on type 'Clipboard'
行1016  Property 'readFindText' does not exist on type 'Clipboard'
行1020  Property 'writeFindText' does not exist on type 'Clipboard'
行1024  Property 'writeBuffer' does not exist on type 'Clipboard'
行1028  Property 'readBuffer' does not exist on type 'Clipboard'
行996   Expected 0 arguments, but got 1
行997   Property 'length' does not exist on type 'Promise<string>'
行1012  Expected 1 arguments, but got 2
行1032  Expected 1 arguments, but got 2
行535   'text' does not exist in type 'ClipboardItem[]'
行24    Interface 'ElectronAuthenticationResponseDetails' incorrectly extends
```

**11 个里有 6 个是剪贴板（Clipboard）API。** 其余是认证响应接口和一个参数个数变化。

### 为什么这是好消息

1. **数量很少**——11 个，不是几百个
2. **高度集中**——3 个文件，其中 9 个在同一个文件里
3. **原因单一**——Electron 44 改了 clipboard 和 auth 的类型签名
4. **不涉及你的定制代码**——全是 Code OSS 本体适配 Electron 新版的问题
5. **纯类型错误**——不是逻辑错误，是签名对不上

### 一个重要的推论

**你当初一定也解决过这 11 个错误**——否则你的 0.7.4 编译不出来。也就是说，这 11 处修改**本来就是你定制内容的一部分**，只是我们还没恢复出来。

这反过来是个线索：可以拿已安装的 ShunCode 里编译后的 `main.js` 去比对，看你当初怎么改的。

---

## 三、这对整个项目意味着什么

| 之前的判断 | 现在 |
|---|---|
| 「能不能自建底座」完全未知 | **基本可行，卡点已定位到 11 个具体错误** |
| `source-built-installer` 门槛遥远 | 仍 BLOCKED，但路径清晰了 |
| 不知道 Electron 44 行不行 | **依赖层面已验证可行** |

**"重新打包完整 ShunCode"这条路是通的**，不需要换方案。

---

## 四、过程中我自己犯的错（如实记录）

第一次 CI 运行报告 `npm-install` 失败。**但那是我的脚本有 bug，不是真实结果**：

- 报告里 `npm` 版本是 `null`、退出码 `None`、耗时 `0.0s`、日志写着 `executable not found`
- 原因：Windows 上 npm 是 `npm.cmd`，Python 的 `subprocess` 不带 `shell=True` 时不会套用 `PATHEXT`

如果我不细看，就会得出"Electron 44 装不上"这个**完全错误**的结论。

修复后加了两道防线，防止同类错误再伪装成结论：

1. 缺 node/npm/git 时直接报 `harnessError` + **INCONCLUSIVE**，不归咎于构建
2. 安装失败会分类：只有网络错误（ECONNRESET 等）→ 报 INCONCLUSIVE；出现 ERESOLVE/ETARGET → 才判定 Electron 版本真的不兼容

本地跑验证了第 2 条确实生效（沙箱连不上 `electronjs.org`，正确报了 INCONCLUSIVE 而非诬告 Electron 44）。

---

## 五、下一步建议

**第 1 步已完成，可以进入下一步。** 两个选择：

- **A（推荐）：先修这 11 个错误，把底座编译通过。** 收获是一个**确实能编译出来的 ShunCode 底座**，这是后面一切的地基。而且修的过程可能反推出你当初的改法。
- **B：先补 B 层 41 个模块的 TypeScript 类型。** 让共享模块可编辑。

我倾向 A，因为它把"能不能造出来"变成"已经造出来了"，风险最先归零。

---

## 六、边界

- 编译通过 ≠ 能运行。后面还要验证启动、打包、安装器。
- 这次没有应用任何你的定制，是纯上游 + 换 Electron。
- 11 个错误的修法我还没试，不保证都是一行能改完的。
- `check:release` 仍退出 2，`source-built-installer` 仍 BLOCKED——**没有因为这次进展就调门槛**。

---

## 附：自己复核

```cmd
REM 完整报告(含日志)
type docs\evidence\carrier-build-probe.json

REM 只看结论
python -c "import json;d=json.load(open('docs/evidence/carrier-build-probe.json'));print(d['conclusion']);[print(s['stage'],s['ok'],s['exit_code']) for s in d['stages']]"
```
