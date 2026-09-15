# 从现有更新包到 Windows 完整安装器

## 先分清三种产物

| 产物 | 当前状态 | 用途 |
|---|---|---|
| 0.7.4 社区 overlay ZIP | 已生成，真实包 8 个目标文件校验通过；未做 GUI 端到端验收 | 更新已有精确版本安装，不是完整安装器 |
| 独立 Bridge 核心模块 | 41 个 JS 模块可重建/测试；读写风险已记录 | 维护与恢复基础，不是完整扩展或 VSIX |
| 从源码生成的 ShunCode 社区安装器 | **尚未构建成功，完整工程尚未接齐** | 最终新安装、升级、卸载与长期维护 |

不能把重命名 ZIP、给补丁套一个 EXE 壳，或打包原安装目录称为“恢复完整源码构建”。

## A. 现在可以复现：制作已验证版本的更新 ZIP

在本仓库根目录，按 [CMD+conda指南](WINDOWS_CMD_CONDA.md) 激活恢复环境；使用普通CMD中的Node 22.13+、Python 3.10+：

```cmd
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run check:bridge-core
npm.cmd run audit:boundary -- --check
npm.cmd test
python -m unittest discover -s tests -q
npm.cmd run build:community
python tools/package_community.py
```

输出：`community/shuncode-community-0.7.4-overlay.zip`。

`build:community` 是对原 bundle 做哈希固定的定点修改，不是整套 TS 重编译。打包器检查 payload 哈希和 `community-validation.json` 中的已验证 manifest；不匹配就停止。不要把验证字段手工改成成功。

当前不必下载 241 MB 的 LFS 安装器即可重建相同 overlay：需要的文本证据已经在仓库。若修改 payload，则必须重新对原安装包解出的真实文件验证；现有 `.github/workflows/installer-forensics.yml` 执行该流程。不能拿旧验证报告为新内容背书。与打包相关的额外 applier/README 修改也应重跑测试和归档检查，不能仅凭 payload 记录替代验收。

用户应用和回退步骤见 [社区版用户教程](../community/MIGRATION_FOR_USERS.md)。不要把实验中的读写模块或维护候选顺手塞进 overlay；当前没有它们的应用集成验收。

## B. 完整工程的目标结构（规划，尚未全部存在）

```text
community-project/
  carrier/                 # 经验证的固定 Code OSS 底座
  shared/                  # 自有 Bridge / 工具 / Skills 模块与新类型声明
  extensions/shuncode/     # 原扩展源文件 + 去商业化维护代码
  carrier-patches/         # 原生 Chat / Workbench / Sessions 等宿主接入改动
  product/                 # 自有品牌、图标、安装/升级标识和服务配置
  tests/                   # 模块、宿主集成、Windows 安装/升级验收
  build/                   # 锁定工具链、构建与打包脚本
```

现有 `recovered/` 是原件证据区，不应直接被维护工作覆盖。未来工程会引用/复制经过确认的材料；新补写的类型和接入代码标为重建，不冒充原始 TS。

### 到完整编译前的阻塞项

1. **选定底座**：公开 1.132.0 只是候选；它的 Electron 42.7.1 与原包声明 44.2.0 不同。需要进一步对比宿主 API、未修改代码指纹、品牌配置与原生模块 ABI。
2. **补共享执行链**：此前5个Custom Tools/Skills目标已恢复JS；图片读取也已独立恢复。搜索/调度及barrel再导出也已恢复；下一步需真正接回原TS工程，提供原生资产并落实宿主授权，而不是以导出存在代替构建成功。
3. **接回 TS**：41 个独立 JS 模块不自动解决原工程的 32 处缺失导入；需要正确文件布局、类型、构建配置和锁定依赖，不能用一堆 `any`/空函数伪造通过。
4. **重建宿主接入**：7 个 proposed API 的声明存在仅是起点；还需核对内置扩展注册与指定扩展的 proposed API 允许配置，不能把修改 manifest 后打成普通 VSIX 当作完成迁移；Bridge 类片段不是可直接导入的 TS 模块，原生 Chat、Workbench/Sessions 注册点等还需对比迁移。
5. **处理读写风险**：已复现目录替换竞态；进入真实 MCP 前必须明确主机信任边界与文件系统隔离，不能靠再次 realpath 宣布彻底解决。
6. **品牌和发布配置**：从原包继续核对自有 product 配置、图标、用户数据目录、URL scheme、安装 GUID、用户/系统安装模式、升级与卸载标识；测试版先与生产版隔离，避免覆盖用户环境。
7. **运行时与许可**：PTY、keymap 等原生模块要匹配所选 Electron；检查第三方组件、NOTICE、更新源、隧道/模型服务条款，不复制私钥或用户凭证。

## C. 候选 Code OSS 的 Windows 构建入口：未执行模板

以下只用于说明**将来选定底座后**的流程，不是当前 ShunCode 的一键构建命令。

本轮已核实候选 `df53daab...` 的 `.nvmrc` 为 Node **24.18.0**、`.npmrc` 指定 Electron **42.7.1**。本恢复仓库测试使用 Node 22，**两者不能混为同一工具链**。在 Windows 独立工作目录取得固定源码，按该版本官方构建要求安装 C++ 构建工具、Windows SDK、Python 等；不要在本恢复仓库里运行下面的底座命令。

```cmd
REM 在未来独立的carrier源码目录；仅是候选底座调试入口
npm.cmd ci
npm.cmd run compile
.\scripts\code.bat

REM 核对该固定版本实际提供的打包任务
npm.cmd run gulp -- --tasks-simple
```

完整源码构建可能需要受信任的安装脚本编译原生依赖；不能照搬恢复工具安装时的 `--ignore-scripts` 并假定完整应用可用。以上命令尚未在本项目执行或验证，不保证未补齐配置的候选能直接生成应用。

先完成自有代码集成、品牌配置与未签名便携目录测试，再执行应用打包任务。应用目录需形成 `VSCode-win32-x64`（候选上游的默认约定；定制构建可另行调整）。其后才是安装器任务：

```cmd
REM 前提：应用目录已构建且验证，product和安装配置齐全
npm.cmd run gulp -- vscode-win32-x64-user-setup
REM 或系统级安装，按分发策略二选一
npm.cmd run gulp -- vscode-win32-x64-system-setup
```

这两个任务名来自候选的固定 `build/gulpfile.vscode.win32.ts`，内部调用依赖提供的 Inno Setup 与 `build/win32/code.iss`；默认安装器输出目录为 `.build/win32-x64/user-setup` 或 `system-setup`。不是让用户随便安装一个旧 Inno 版本再手写万能打包命令。**尚未实际生成 ShunCode EXE。** 应用目录的具体构建任务需在最终底座中核对，不能拿未经检查的旧教程任务名替代。

固定参考文件与哈希见 [upstream-build-reference.json](evidence/upstream-build-reference.json)，上游指南入口：[How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute)。

## D. 放行标准，而不是“编译成功就发布”

- 干净 Windows 环境中启动、窗口/工作区、扩展激活、原生 Chat、Workbench/Sessions 两个入口。
- Bridge 无商业账号可启动/停止；下单/激活码入口失效；模型自己的认证仍正常。
- 实际 MCP 客户端、会话隔离、工作区权限、工具操作、取消、异常和资源限制。
- 新装、同版/跨版升级、卸载、路径含空格/中文、用户/系统安装差异、受限权限。
- 设置/聊天/密钥存储迁移与回退；不触发旧自动更新覆盖社区版。
- 隐私与网络请求清单、第三方许可、可复现构建日志、SHA-256 和发布说明。
- 没有代码签名证书时明确标注未签名，不伪造签名，不要求用户关闭系统安全机制。正式签名需另行配置受保护的证书，不能放进仓库。

最终目标是可维护、可重新构建的社区工程；不需要逆向全部上游，但也不能把“找到了开源底座”误当成“定制已经迁移完成”。


未来完整Code OSS构建也应在普通CMD使用**独立conda环境**，不得直接覆盖学习环境。最终Node/Electron版本尚未确定；若conda渠道没有所需精确版本，先停止核对方案，不把版本要求随意放宽。当前environment-cmd.yml只保证恢复/教学工具的环境用途，不承诺满足完整宿主构建。
