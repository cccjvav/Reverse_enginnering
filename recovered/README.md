# 从发行包提取的材料

`shuncode-extension/` 是从 Windows 0.7.4 原始安装包中**原样提取的已发布扩展文本文件**，不是重新编写或反编译声称得到的完整原始工程。

- 原始路径：`code$GetDestDir/resources/app/extensions/shuncode/`。
- 原包 SHA-256、提取工具版本：见 `../docs/evidence/windows-extraction.json`。
- 每个保留文件的原始 SHA-256、大小及遗漏记录：见 `../docs/evidence/custom-extension.json`。
- 仅保留允许的文本格式，不复制 Git/Electron/第三方依赖或大型二进制资源。
- 发布前进行了常见凭证形式的启发式检测，命中文件不发布。这不是完整安全审计。
- 不要对这些文件直接执行 `npm install`、扩展激活或脚本命令。先审查入口、网络访问、依赖和配置。
- 提取文件保持原字节；学习用格式化或重建代码应该另建目录，不直接覆盖原件。
- 安装器中的 `code$GetDestDir` 等名字是 Inno 的运行时路径常量，静态提取器不会执行安装器代码来求值。它们不是原始工程目录名。

现阶段提取的原文件仍受各自原有许可证约束；本仓库不擅自重新许可第三方代码。
