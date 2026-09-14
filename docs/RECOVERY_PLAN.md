# 恢复与移植记录

## 2026-09-14：初始调查

初始仓库仅包含标题 README，没有可供恢复的源码或构建配置。Release API 可访问，发现唯一的 Linux amd64 Debian 安装包，元数据已固定在恢复脚本中。

下载尝试：

- `gh release download` 两次，重定向到 GitHub Release 资源域名后返回 EOF。
- `curl -fL --retry 3 --retry-all-errors`，同一域名返回 `SSL_ERROR_SYSCALL`。
- 检查该域名解析出的四个 IPv4 地址，TLS 均失败。
- `api.github.com` 正常响应，可以读取 asset 大小和 digest；无认证失败迹象。

结论：当前环境无法取得包体。未读取或执行应用代码；不能据此判断其 Electron/VS Code 版本、是否有 ASAR、是否包含 source map 或哪些功能经过定制。最直接的解除方式是通过会话上传原始 `.deb`，或恢复环境对 `release-assets.githubusercontent.com:443` 的访问。无需提供 GitHub 密码或令牌。

## 2026-09-14：改为 Windows 优先

作者找到了旧 Windows 安装包，并查看更新记录后反馈两平台版本差异不大，明确要求直接针对 Windows 包开展恢复。后续以该 Windows 包为主，Linux 包留作备用，不再要求先分析 Linux 包。版本差异尚未通过包内代码验证。

当前 Release API 仍只列出 Linux 包，尚未取得 Windows 包。Windows 本地工具现阶段只为 EXE/MSI 生成文件名、大小、SHA-256，不会执行或解包它们。下一阶段需识别实际安装器格式，再选择固定版本的静态解包工具，分析 Windows 应用资源并重建工程。不要把文件指纹报告当作安装器识别结果。

## 分阶段路线

### 1. 原包取证

- 校验原包 SHA-256，静态解包，保存文件级清单。
- 从 `resources/app`、`app.asar`、`package.json`、`product.json`、许可证和二进制元数据定位准确版本。
- 若有 ASAR，再使用固定版本的 ASAR 工具提取；保留原档。
- 识别自定义扩展、品牌资源、业务脚本以及与平台相关的依赖。

### 2. 恢复可维护源码

- 优先提取 source map 中 `sourcesContent`，保留路径来源及产物哈希，校验路径防止目录穿越。
- 没有 source map 的 JS 只能格式化、整理和人工重建，不能宣称恢复了原始 TypeScript、注释或变量名。
- 根据确认的 Code OSS 版本获取对应上游代码，对比定制修改；不要直接用最新版替代。
- 将“原样提取”“上游原版”“人工重建”分别记录。先检查敏感信息和第三方许可证，再将必要的小体积源码纳入 Git。
- 大型运行时和原包留在 Release 或忽略目录，不提交整个 VS Code/Electron 安装目录。

### 3. Windows 构建恢复（架构待样本确认）

具体构建方案必须等待应用结构确认，不能先假定普通 electron-builder 项目即可处理 VS Code 分支。

- 重建匹配的 Node/Electron/Code OSS 工具链与锁定依赖。
- 优先保留并识别现有 Windows 依赖，核对 `.node`、终端/PTY、搜索工具、文件监控等组件与 Electron ABI 的匹配；若后续引入 Linux 版代码，再处理平台差异。
- 修复 shell 调用、路径分隔符、文件权限、环境变量、安装路径和更新机制。
- 补齐 Windows 图标、应用标识、协议/文件关联及打包配置。
- 在 Windows runner 构建并保存日志；先生成测试便携包，再考虑安装程序。
- 未获得签名证书前不承诺已签名发行包；不购买付费服务，不把签名凭证放入仓库。

### 4. 验收

- 启动、打开目录、编辑保存、搜索、终端、Git、扩展加载。
- 定制功能逐项核对；服务端组件若未随包发布，需要另外恢复或重建。
- 核对更新源，避免恢复版意外升级为其他产品。
- Windows 实机或虚拟机验证后再标记可用；Linux 上打包成功不等于 Windows 验收通过。

## 已验证与未验证

- 已验证：7 项模拟单元测试通过，覆盖 Linux 清单、Debian/ASAR 分析、Windows 文件指纹、路径检查及截断档案拒绝。
- 未验证：Windows 实机运行与真实 Windows 安装器提取。
- 未验证：真实包的校验、解包和端到端分析；任何源码恢复或 Windows 构建结果。

## Windows 包已上传到分支（2026-09-14）

已同步作者提交 `13bd182`，发现 `ShunCode-0.7.4-win32-x64-Setup.exe`。注意其文件名版本为 0.7.4，现有 Linux Release 文件名版本为 0.7.3；不能仅按“旧 Windows 版”的描述认定其代码更早。

- 文件通过 Git LFS 保存，Git 中是 134 字节指针，不是实际 EXE。
- LFS 声明大小：240,559,253 字节。
- LFS 声明 SHA-256：`fdc2328b2520a128fd3449ed2015a7383e2b7dafaae05c3892d5a4c11a671272`。
- Git fetch 成功；GitHub LFS batch API 也成功返回下载地址。
- 实际下载域名 `github-cloud.githubusercontent.com` 的 TLS 连接失败；另试 `media.githubusercontent.com` 同样失败。因此本地仍未取得或校验安装包实体。

新增 `.github/workflows/windows-static-probe.yml`，尝试在 GitHub Windows runner 上下载 LFS 文件，核对完整哈希并使用预装 7-Zip 仅列出安装包结构。不运行安装器，不安装软件，不自动恢复源码。报告限制大小并写回当前会话分支 `docs/evidence/windows-package.json`，避免再次通过大文件下载域名传递结果。

工作流只在本分支的指定工具/包文件更新时触发，不会因报告提交循环运行。GitHub Actions 必须可用且允许工作流写入仓库；若权限、额度或 LFS 下载失败，需要查看实际日志，不代表取证成功。此方案尚待远端运行确认。

### 远端首轮结果：下载通道已打通

GitHub Actions 运行 `34849979254` 成功完成，报告由机器人提交 `69c773a` 写回本分支，现已同步到本地。

- **GitHub Windows runner 已取得完整安装包并校验通过**：240,559,253 字节，SHA-256 与 LFS 指针完全一致。
- 文件具有 `MZ` 头。
- **7-Zip 列表操作失败，退出码 2**，未获得内部文件列表。任务整体成功只代表报告生成成功，不代表解包成功。
- 后续需进一步静态识别安装器格式，再选择对应提取器；目前不能认定具体是 NSIS 或 Inno Setup。
- 本地沙箱仍不能直接下载包体，但可通过 GitHub runner 分析、将小报告写回分支的方式推进，无需作者重复上传。

报告：`docs/evidence/windows-package.json`。

## 已跨过下载和安装器障碍，开始源码完整性分析

最新证据与教学过程见 `REVERSE_ENGINEERING_JOURNAL.md`，不要只依据前面的历史状态判断当前进度：

- 已确认 Inno 数据版本 6.4.0.1，并用固定提交构建的 innoextract 成功解出 9,875 文件。
- 自定义扩展直接附带 34 个 TS/MTS 源文件，已原样取回，连同编译产物与界面等精简为 51 文件 / 4,776,532 字节。
- 安装树无独立 `.map`，但 `node_modules.asar` 内有 1,208 个 map 路径；尚未把它们解析为自有源码。
- 51 文件哈希一致；9 个 JS/CJS 语法检查通过。恢复工具的 16 项模拟测试通过。
- 仍有共享模块、VS Code 类型声明与构建依赖缺口；尚未编译完整工程、激活扩展或生成新 Windows 安装包。

## 主线范围与社区策略更新

作者明确要求优先恢复自有 MCP Bridge、工具和 UI，不逆向整个 VS Code；同时要求去除自有付费门槛。原证据不改，新策略代码和实验性更新包在 `community/`。

- 已定位 Workbench / Sessions 内的自定义 Bridge 类片段。
- 已移除商业授权/支付服务实现与购买界面，安全/工具/第三方登录模块保持。
- 真实包 8 个目标文件校验通过，三个合成 JS 语法检查通过（运行 34855446553）。
- 仍未完成完整源码重编译或 Windows 实机功能验收；旧商户后台与历史订单另需运营下线处理。
- 详见 `COMMUNITY_MIGRATION.md` 与 `community/README.md`。


## 2026-09-14：共享核心第一组可执行重建

完成从扩展主 bundle 到 24 个 ESM JavaScript 文件的可重复重建：22 个自有标签（21 个标签的已发布顶层声明齐全、1 个工具注册表为子集），加 2 个快照元数据模块。不是原始 TypeScript 工程。来源、缺口、依赖和复现命令见 [模块说明](../reconstructed/bridge-core/README.md)。

本地 40 项 Node 与 23 项 Python 测试通过。新增 Windows/Linux Node CI，不运行安装器或完整扩展；远端状态另见 [测试证据](evidence/bridge-core-tests.json)。原始文件哈希仍一致，原来源树的 32 处未解析相对导入不会因另建 ESM 包而自动消失。

后续顺序：补齐 `workspace-paths` 与实际文件读写/搜索/补丁执行依赖；针对越界路径、符号链接、并发写入和版本冲突补测试；然后接回扩展 TS 入口、宿主声明和构建配置。完整 Windows 安装器与 GUI 验收仍是后续阶段。


## 2026-09-14：独立读文件执行与风险复现

新增 `read-files`、`workspace-paths` 两个自有模块、22 个声明，当前重建共 26 模块 / 152 声明 / 113,420 字节。读文件可在临时工作区实际执行，搜索/写补丁/完整 MCP 调度仍未恢复。本地 68 Node + 23 Python 通过。

已复现原读取器在确认期间目录替换的 TOCTOU 风险，并提供单独检查点防护候选；不将再次 realpath 说成完整防竞态方案。见 [说明](../reconstructed/bridge-core/FILE_READER.md) 和 [本轮跨平台证据](evidence/bridge-read-tests.json)。后续需明确文件系统威胁模型与句柄/隔离策略，再推进写入执行，不能仅凭静态越界测试就认定安全。
