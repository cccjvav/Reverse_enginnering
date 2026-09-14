# ShunCode Windows 源码恢复

目标：优先从作者保留的 Windows 安装包恢复可维护的应用代码，并重建可发布的 Windows 版本。根据作者反馈，Linux 与 Windows 版本差异不大；Linux 包仅作备用参考，不再是主线前置条件。

**当前状态：Windows 本地报告工具已准备，但对 Windows 安装包目前仅记录文件指纹，不解包。尚未取得 Windows 样本、恢复应用源码或构建新版本。**

## Windows 用户从这里开始

1. 在本仓库选择分支 `arena/01a09d2c-reverse-enginnering-of-shun`（不是 `main`）。
2. 打开 [`windows-inspection-kit.zip`](windows-inspection-kit.zip)，使用 GitHub 的下载按钮下载；也可以用 Code → Download ZIP 下载整个分支。
3. 解压工具包，按照 [Windows 使用说明](docs/WINDOWS_QUICKSTART.md) 双击运行 `inspect-windows.cmd`，选择 **Windows 安装包**。需要 Python 3.10+。
4. 将生成的小体积 JSON 报告提供给助手，同时告知版本号（如果知道）。不要将大安装包或整个安装目录提交到 Git。

下一步需确定安装器类型（如 NSIS、Inno Setup、MSI 等），再准备对应的静态提取工具。文件名和哈希报告本身不足以判断安装器类型或恢复代码。

独立的 SVG/CSS 动画在 [`pelican-cycle.html`](pelican-cycle.html)，可下载后用浏览器离线打开。

## 备用 Linux 材料

- 仓库：`cccjvav/Reverse_enginnering_of_shun`
- Release：[`upload`](https://github.com/cccjvav/Reverse_enginnering_of_shun/releases/tag/upload)
- 文件：`shuncode_0.7.3_Lunix_amd64.deb`（名称中的 `Lunix` 为原文件拼写）
- 大小：216,372,268 bytes
- GitHub asset ID：562131453
- GitHub API 提供的 SHA-256：`6dab4779cb393f2fc1795ed0e45bb99cb59682bb92d0def276043ef718fd89b4`

以上为 Release 元数据，不代表已对下载文件实测。

## 备用 Linux 恢复工具

需要 Linux 或 WSL、Python 3、`dpkg-deb`；自动下载还需要已配置的 GitHub CLI (`gh`)。无第三方 Python 依赖。不需要 sudo，也不要运行包内程序或安装脚本。

```bash
# 自动下载、校验、解包、生成静态清单
python3 tools/recover.py

# 如果已通过浏览器下载了原始安装包
python3 tools/recover.py --package /path/to/shuncode_0.7.3_Lunix_amd64.deb

# 单元测试（不需要下载包）
python3 -m unittest discover -s tests -v
```

输出保存在 `.work/`，不进入 Git：

- `downloads/`：自动下载的原始包；校验通过后才保留。
- `extracted/`：通过 `dpkg-deb --extract` 解包，不运行维护脚本。
- `control.txt`：Debian 包信息。
- `inventory.json`：文件路径、哈希、应用元数据、source map、ASAR、原生二进制线索。

已有提取目录时工具拒绝覆盖；可使用 `--work .work/attempt-2` 保存另一轮分析。工具目前只定位 ASAR，不解包 ASAR；只统计 source map 中的内嵌源码，不把统计误当成源码恢复完成。不要直接公开整个提取目录：应用内可能含私有服务地址、密钥或第三方资源，需先审查。

后续路线和环境阻塞记录见 [docs/RECOVERY_PLAN.md](docs/RECOVERY_PLAN.md)。

## Windows 本地分析（无需上传大包）

下载并解压 `windows-inspection-kit.zip`，按 [Windows 使用说明](docs/WINDOWS_QUICKSTART.md) 操作。需要 Python 3.10+；只生成小体积 JSON 报告。旧 Windows 安装包目前只做文件指纹记录。解析逻辑通过模拟测试，尚未在 Windows 实机或真实安装包上验证。
