# 验收规程依据及验证等级

编写日期：2026-09-15。环境基准：Windows普通CMD中激活conda。

## 本项目依据

- `docs/evidence/extension-build-tests.json`：上一轮代码的Windows/Linux及CMD+conda构建回归，不能作为手工验收证据。
- `docs/evidence/linked-extension.json`：当前实验bundle哈希、输入与外部运行要求。
- `docs/evidence/linked-type-diagnostics.json`：当前59个候选类型错误，检查未通过。
- `recovered/shuncode-extension/src/instance-launcher.ts`：ShunCode.exe命名/多实例数据隔离的线索；不代表所有候选都支持任意CLI参数。
- `recovered/shuncode-extension/src/ide-tool-broker.ts`：node-pty、PortableGit Bash的实际加载位置。源码某处旧注释声称缺失时回退PowerShell，但当前managedShellSpec实际会抛错；验收按可执行逻辑，不按过期注释判定。
- `recovered/shuncode-extension/src/runtime-client.ts`：Agent host入口解析与启动。
- `reconstructed/bridge-core/FILE_EXECUTION.md`：调度器不转发逐文件权限回调的已复现限制；阻止直接公开服务。
- `reconstructed/bridge-core/FILE_READER.md`、`PATCH_WRITER.md`、`CUSTOM_TOOLS.md`：读写竞态、自定义脚本不具OS沙箱等限制。
- `docs/WINDOWS_BUILD_GUIDE.md`：完整宿主和安装器尚未完成，安装器命令不可当成已实测。

## Inspector固定版本依据

本规程选择 `@modelcontextprotocol/inspector@2.6.0`，不是仓库运行依赖，也未加入根package.json。它是将来验收时单独安装的客户端。

通过npm元数据查询得到：Node要求>=22.19.0，bin为mcp-inspector，发布gitHead为 `795b1bb30ac845b7baa7cb3df8ec0b693882ca1d`。

固定提交的官方资料：

- [MCP server configuration](https://github.com/modelcontextprotocol/inspector/blob/795b1bb30ac845b7baa7cb3df8ec0b693882ca1d/docs/mcp-server-configuration.md)：--config只读、--catalog可写、显式服务器选择、protocolEra与超时字段。
- [CLI smoke testing](https://github.com/modelcontextprotocol/inspector/blob/795b1bb30ac845b7baa7cb3df8ec0b693882ca1d/docs/cli-smoke-testing.md)：initialize、tools/list、tools/call、JSON参数、退出码、stored-auth-only。
- [Web client](https://github.com/modelcontextprotocol/inspector/blob/795b1bb30ac845b7baa7cb3df8ec0b693882ca1d/clients/web/README.md)：本机绑定、origin/CSRF保护、GUI职责。

实际执行范围：在当前Linux工具环境用ignore-scripts安装该固定npm包，运行发布的launcher `--cli --help` 成功，核对本文使用的CLI选项。没有运行带真实MCP目标的命令，没有Windows Inspector客户端操作验收，也没有产品GUI/隧道/安装器验收。安装中有server-legacy弃用警告，已记录，未建议放宽安全设置或切回旧协议。

手册的Windows启动/安装/界面观察步骤属于未来候选验收规程。菜单译名、产品品牌和安装选项以候选实际交付为准；文档要求找不到时记BLOCKED，不伪造截图或把预期写成实测结果。

## 维护规则

更换Inspector版本、候选构建、Node工具链、协议默认值或安装标识时，重新核对命令与结果表。不要引用latest后继续沿用2.6.0的选项/退出码。

本次文档内部检查包括：相对链接目标存在、MCP示例JSON可解析且不含真实地址、结果编号不重复、结果表没有预填PASS、CMD示例不混入PowerShell/Unix命令语法。该检查只证明材料一致性，不是手工验收通过。
