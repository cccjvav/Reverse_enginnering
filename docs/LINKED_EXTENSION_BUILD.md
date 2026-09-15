# 从原TS入口实际连接构建：结果与未通过项

> **[普通CMD+conda：逐步验收手册](acceptance/README.md)**：宿主、原生资产、实际激活、GUI/MCP和安装/升级/卸载的操作、预期、失败处理及空白结果表。当前A可复现，A05仍59个类型错误，B/C/D尚阻塞；不是已完成验收报告。

本轮不再只检查“文件/导出存在”，而是让构建器从 `recovered/shuncode-extension/src/extension.ts` 出发，解析依赖、连接重建模块并生成新的CJS扩展bundle。

**结果：连接与打包成功；严格候选类型诊断仍有59个错误。完整软件、安装器和运行验收未完成。** 不把esbuild的成功输出当成TypeScript类型检查通过。

## 1. 具体构建了什么

- 73个自有/恢复层输入：32个保留扩展源码文件、41个重建模块。
- 31条实际出现的共享导入连接到重建文件，不再保留无法解析的 `../../../src/...` 运行时引用。
- 以维护层的两个TS文件替换商业服务与控制器；入口去掉旧商业烟雾测试绕过、旧登出关闭persistentMode的操作。
- 原51个扩展文件不覆盖；构建器读到的原件/重建文件均核对来源SHA。
- **不把旧 `dist/extension.js` 塞进新bundle**。输入审计禁止使用原dist文件，实际连接原TS/MTS和重建JS。
- 新bundle为1,673,367字节，位于 `.work/linked-extension/dist/extension.cjs`。它是实验产物，不是可直接替换安装目录的发布文件。

两个未进入入口依赖图的保留TS文件是旧商业配置和未被入口引用的codex-account-view。没有宣称全部34个TS都进入运行bundle；候选类型诊断则覆盖全部34个源码文件。

## 2. 第三方依赖不是被external掩盖的缺口

构建所需候选包已精确列入根package.json，并由package-lock锁定安装：

| 包 | 候选版本 | 本轮处理 |
|---|---|---|
| @modelcontextprotocol/server | 2.0.0 | 安装并打入bundle |
| @modelcontextprotocol/node | 2.0.0 | 安装并打入bundle |
| https-proxy-agent | 7.0.6 | 安装并打入bundle |
| supports-color | 8.1.1 | 显式补齐debug的可选依赖并打入bundle |

MCP server 2.0.0 tarball的多个分块文件名与原bundle来源标题匹配，是版本候选的实物依据；**不是已经证明原构建完整依赖树和字节身份完全相同**。proxy包同样是固定的重建候选，不冒称找回了原锁文件。

第一次仅查看源码external列表时，漏掉了依赖内部可选的supports-color。新增metafile输出审查后真实拒绝了这个未打包npm导入，才补充锁定版本并重新构建。现在metafile列出的静态external只允许vscode与Node内建模块。118个实际参与打包的依赖文件及SHA都记录在证据中。

这仍不涵盖动态require加载的Electron/PTY、Agent host子进程入口或原生文件资产。没有加载生成的扩展，没有以伪造vscode对象宣称激活成功。

第三方版权/许可保留，根锁文件不是原作者丢失的锁文件。本轮不将实验bundle作为正式发行物分发，未来打包还需整理完整第三方NOTICE。

## 3. ripgrep路径适配

独立ESM重建模块原先定位恢复仓库里的runtime/bin/rg.exe。连接为CJS产物时，构建器明确改成相对于输出dist目录的 `../runtime/bin/rg.exe`，避免把本机仓库绝对路径或无效import.meta留给最终CJS。

**这只是路径适配，不是补齐二进制。** PortableGit Bash、node-pty、隧道程序、ripgrep和Agent host运行内容仍需按最终宿主布局提供和验证，不能随便复制一个同名文件就算完成。

## 4. 真正运行了类型诊断：59错误，未通过

候选诊断配置：TypeScript5.9.3、strict/noEmit、NodeNext，allowJs:true、checkJs:false、skipLibCheck:true。后两个选项明确意味着没有全面检查重建JS和依赖声明。没有添加一堆any、空接口或关闭strict来消灭错误。

选取公开Code OSS候选提交 `df53daabb18cd157bdb08c7f01c34df936cf12f4` 的vscode.d.ts及7个proposed API声明，共8个文件，保留原MIT许可与逐文件SHA。它们不是原定制宿主的已确认声明。

| 类型诊断 | 数量 | 主要含义 |
|---|---:|---|
| TS2305 | 10 | 擦除的CustomToolManifest、状态、Skill结果等类型尚未恢复 |
| TS2339 | 14 | 包括JS推断联合类型缺字段，以及宿主ChatSimpleToolResultData缺少定制属性 |
| TS2353 | 1 | 候选宿主类型不接受presentationStyle |
| TS2558 | 2 | 原泛型类的类型参数未恢复 |
| TS2724 | 2 | 命令取消预览/目标类型未恢复 |
| TS2749 | 5 | 原类被打包成变量后，值存在但无法直接作类型使用 |
| TS7006 | 25 | 参数与回调失去原类型，出现隐式any |

完整59条位置、诊断码和消息见 [linked-type-diagnostics.json](evidence/linked-type-diagnostics.json)。例如宿主候选的ChatSimpleToolResultData缺少items、metrics、diffPreview、presentationKind等，说明“公开版本号一样”不能替代定制宿主接口恢复。

这些错误不是都无法修复：后续可基于实现和调用者重建维护用类型契约，但必须标明是重建而非原始类型，并验证实际宿主行为。不能仅补一个允许任意属性的接口让编译器闭嘴。

## 5. 普通CMD + conda操作

在源码根目录、已建立恢复环境后：

```cmd
conda activate shuncode-recovery
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run build:linked-extension
echo %ERRORLEVEL%
```

应返回0，在.work生成实验bundle和linkage.json；不会启动、安装或替换ShunCode。根npm依赖更新后必须重新npm ci，而不是只复制新工具脚本到旧node_modules旁边。

只在内存重新构建并核对已记录的构建证据：

```cmd
npm.cmd run check:linked-extension
```

运行候选类型诊断：

```cmd
npm.cmd run diagnose:linked-types
echo %ERRORLEVEL%
```

**当前该命令应返回1并报告59个错误。** 它不输出JS、不打开应用；会更新诊断JSON。不要把1改成0或删诊断来伪造通过。若数量变了，先比较源码、锁文件与声明版本。

```cmd
node --test tests\bridge-core-linked-extension.test.mjs
```

这4项回归测试通过，表示构建可重复、来源保护与边界检查生效、59个未解决诊断被如实记录；**不表示类型诊断本身通过**。

## 6. 距离完整交付还差什么

1. 从实现和调用者重建丢失类型，解决候选类型诊断，不冒称找回原类型。
2. 确认/恢复定制宿主接口与实际UI实现，不能只给类型追加字段。
3. 提供并验证Agent host、PTY、PortableGit、隧道与ripgrep资产及运行布局。
4. 完成真实扩展激活、MCP客户端、工具授权与已知文件竞态的安全整合。
5. 构建完整宿主和安装器，测试新装/升级/卸载及设置/凭证迁移。
6. 继续源码逐行教学；本轮没有把新工具自动算成已讲解。

旧社区ZIP保持原样；不要用这个实验bundle覆盖现有安装。原自有商业限制继续被替换，第三方模型认证、MCP令牌和其他安全机制没有作为“免费化”目标删除。


## 本轮跨平台证据

[运行34970685889](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34970685889) 的Windows2022、Ubuntu24.04和独立CMD+conda作业全部成功。测试代码提交fa6570ae6bb3ed5153e74cd6f56dcd87cd1d4e9f。回归在各平台比较同一bundle哈希与诊断记录；通过不等于59个类型错误已解决。

证据来自GitHub作业/步骤API，未获取逐项完整远端日志。详见 [extension-build-tests.json](evidence/extension-build-tests.json)。
