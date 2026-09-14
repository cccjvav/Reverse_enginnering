# ShunCode Windows 源码恢复

优先恢复作者自己的 MCP Bridge、工具、定制 UI 等内容；VS Code 只作为运行载体，不追求完整逆向本体。后续目标是建立可维护的定制工程和 Windows 社区版。所有工作在 `arena/01a09d2c-reverse-enginnering-of-shun` 分支进行。

## 新进展：免费社区版测试补丁

按作者的新要求，已将自有 Bridge 改为无需商业账号、付款或激活码的本地可用模式，移除收费 UI、支付轮询、商业授权复验与用量上报；保留 MCP 访问令牌、工具/路径校验、隧道凭证和第三方模型登录。

- **[社区版说明与操作步骤](community/README.md)**
- **[下载实验性 0.7.4 更新包（约 467 KB）](community/shuncode-community-0.7.4-overlay.zip)**：GitHub 文件页面使用 Download raw file；需已安装的精确 0.7.4 构建和 Python 3.10+，不是完整安装器。
- [改造记录与安全边界](docs/COMMUNITY_MIGRATION.md)
- [真实包文件验证结果](docs/evidence/community-validation.json)：8 个目标文件已验证，修改后的扩展、Workbench 和 Sessions 完整 JS 通过只解析检查。

更新工具先验哈希，自动备份，失败尝试回滚；建议先在测试副本上使用。**尚未做 Windows 实机端到端验收。** 旧商业服务的停售、历史订单和退款仍需另行处理；客户端修改不会自动关闭远端收款。

## 新进展：可测试的 Bridge 核心模块

从原扩展 bundle 拆出 **28 个 JavaScript 模块 / 206 个声明**，约 151.3 KB，重新接齐模块依赖。覆盖路由、会话、事件、命令取消保护、工具目录、输入解析与独立文件读取/补丁写入；不是找回了原始 TS 类型，也不是完整 MCP 服务。

- **[重建模块与复现方法](reconstructed/bridge-core/README.md)**、[逐声明来源及依赖图](reconstructed/bridge-core/provenance.json)
- 本地 **84 项 Node 测试 + 23 项 Python 回归测试通过**；本轮新增 16 项补丁写入测试，使用临时文件，不运行安装器。
- [本轮 Windows / Linux 验证状态](docs/evidence/bridge-patch-tests.json)。包含真实临时文件和目录链接测试，不是 Windows 图形界面验收。
- 发现并复现原并发器的动态降上限问题；提供[独立修复候选](community/bridge-core/README.md)，尚未纳入已发布 overlay。

原件不变。文件读取已可独立运行，但发现并复现了确认期间目录替换的风险；[读取说明与防护局限](reconstructed/bridge-core/FILE_READER.md)明确记录。补丁写入也已独立恢复，且复现了同类路径替换风险；[写入验证与局限](reconstructed/bridge-core/PATCH_WRITER.md)。搜索、图片、MCP 执行调度与完整扩展构建仍待恢复。

## 当前恢复成果

**已成功静态解包，并直接取回发行包附带的 34 个 TypeScript / MTS 源文件。尚未恢复完整工程或构建新安装包。**

- 原包：`ShunCode-0.7.4-win32-x64-Setup.exe`，240,559,253 字节，通过 Git LFS 保存。
- SHA-256：`fdc2328b2520a128fd3449ed2015a7383e2b7dafaae05c3892d5a4c11a671272`，远端已实测校验。
- 安装器：Inno Setup 数据版本 `6.4.0.1`，使用固定上游提交构建的 innoextract 成功提取。
- 解包结果：9,875 文件 / 1,032,221,550 字节；不把整套运行时重复提交 Git。
- [恢复材料](recovered/shuncode-extension/)：51 个定制相关文本文件，约 4.78 MB，包含 34 个源码文件、JS 编译产物、配置、前端资源和编译后测试。
- [完整性审计](docs/evidence/source-completeness.json)：保留文件哈希一致；仍有共享源码、API 声明和构建配置缺口。
- 9 个 JS/CJS 文件通过只解析不执行的语法检查；尚未验证完整构建、功能或 Windows 实机运行。

## 想学习这次逆向工程？

1. **[逆向恢复操作日志（教学版）](docs/REVERSE_ENGINEERING_JOURNAL.md)**：按实验顺序记录命令、原理、证据、失败和修正。
2. **[源码阅读指南](docs/SOURCE_READING_GUIDE.md)**：从哪里开始读、功能模块如何分工、哪些东西还没有找回。
3. **[恢复材料说明](recovered/README.md)**：原件、来源哈希、筛选范围与安全边界。
4. [原始阶段记录](docs/RECOVERY_PLAN.md) 和 [机器可读证据](docs/evidence/)。

## 下载与复现

在 GitHub 选择本工作分支，可用 Code → Download ZIP 下载源码/工具。注意 ZIP 中的 EXE 可能仍是 LFS 指针；不应把小指针误当成完整安装器。

当前无需作者在本机重复上传或分析大包。沙箱无法直连 GitHub 大文件域名，因此使用 GitHub Actions 下载 LFS 原包并静态解包，报告和小体积定制源码写回本分支。

- 工作流：`.github/workflows/installer-forensics.yml`
- 格式识别与提取：`tools/installer_forensics.py`
- 固定工具构建与诊断：`tools/build_extractor.py`
- 定制文件提取与凭证启发式筛查：`tools/recover_custom_extension.py`
- 本地来源/缺口审计：`python3 tools/audit_recovered_extension.py`
- 恢复工具测试：`python3 -m unittest discover -s tests -v`

工作流只在指定分析工具变更时自动触发，不会因报告提交循环执行；若需在 GitHub 手动重跑，可打开已有运行记录使用 Re-run jobs。它不运行安装器、应用或恢复代码的 npm scripts。提取器是工具本身，由源码编译执行。

## 保留的辅助材料

- [Windows 本地小报告工具包](windows-inspection-kit.zip) 与 [使用说明](docs/WINDOWS_QUICKSTART.md)：备用，仅对 Windows EXE/MSI 记录指纹，不是当前远端完整解包工具。
- `tools/recover.py`：备用 Linux Debian 静态分析工具。原始 Linux Release `upload` 中为 `shuncode_0.7.3_Lunix_amd64.deb`；现主线不依赖它。
- [鹈鹕骑行 SVG/CSS 动画](pelican-cycle.html)：独立任务，单文件、无 JavaScript，可离线打开。

## 恢复边界

“原包中取回的源码”与“根据编译产物重建的源码”分别标注。不承诺百分之百找回原始工程。保留源码中的许可证和署名；启发式凭证扫描不是安全审计。客户端配置、公钥不等于服务端源码或签名私钥。不要在完成审查前直接运行恢复代码。
