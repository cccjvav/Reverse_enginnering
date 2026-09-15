# 文件执行链恢复与发布阻断项（2026-09-15）

## 本轮实质结果

核心由37模块/311声明增加到 **41模块/389声明/262904字节**。新增find-files、search-files、ripgrep-diagnostics和单独的打包资产路径模块，补全file-tool-registry中的invokeFileTool/dispatchFileTool。同时恢复custom-tools的三个兼容再导出：CUSTOM_TOOL_OUTPUT_SCHEMA、CUSTOM_TOOLS_DIR_NAME、executeCustomTool。

当前原extension.js中索引的38个共享src标签，其已发布顶层声明已全部纳入依赖闭合的重建；另外3个模块分别承载原构建元数据、SDK版本常量、原打包ripgrep路径的显式重定位。这不是所有bundle、所有宿主定制、原始TS类型或被tree-shaking删除源码的完整恢复。

静态运行时导入审计中的55个说明符现在均有对应模块导出。**只是导出已存在：原TS文件没有被改写接线，没有完成类型检查、宿主适配或完整扩展构建。** 三个barrel导出关系由现存TS调用者要求和原声明来源共同支持，provenance单独记录compatibilityReexports，不冒充它们是原custom-tools标签中的本地声明。

## ripgrep路径如何处理

原包有独立构建插件标签，生成：

```js
var rgPath = require("node:path").join(__dirname, "..", "runtime", "bin", "rg.exe");
```

以前仅识别src等来源标题，会把这个声明归入前面的find-files标签。本轮增加插件标签识别，并要求该声明的归属与完整文本精确匹配，才允许转换。

ESM版本使用import.meta.url定位仓库保留布局中的 `recovered/shuncode-extension/runtime/bin/rg.exe`。该文件**不随本轮恢复提交提供**，路径存在不等于二进制存在，更不是下载/验签。provenance标记runtimeAssetRewrite，并保留原声明范围和哈希。

原查找/搜索实现仍按显式配置、RIPGREP_PATH、打包路径、PATH中的rg尝试；不可用时可以走Node回退。直接传入checkPermission回调也会选择Node路径。未来打包必须重新明确资产位置、来源/版本与许可，不能把这个仓库布局当成完整宿主安装布局。

本轮没有下载或运行原rg.exe。原声明对照VM提供与原包布局一致的__dirname，并禁止child_process执行。回退测试通过spawn替身模拟ENOENT，验证调度路径确实回落Node，不执行用户PATH中碰巧存在的程序。

## 实际测试

新增7项测试，包括：

- 打包路径重定位及三个barrel导出的对象/函数身份一致。
- 临时目录中Node查找、搜索与隔离原声明的结果一致。
- 直接调用查找/搜索时，权限拒绝、提前取消及越界路径拒绝。
- invokeFileTool解析延迟提供的工作区根，执行文本读取、图片返回、临时文件补丁。
- 错误参数和未知工具转换为错误结果。
- 所有ripgrep候选不可用时，调度器查找和搜索走Node回退。
- 原调度器丢弃权限回调的行为复现。

测试只操作自建临时目录，不修改用户安装目录或真实项目。没有完整原生ripgrep集成、真实MCP客户端、GUI或安装器验收。

## 必须阻止误部署的权限边界

原dispatchFileTool调用底层时只传workspaceRoots和signal，**不转发checkPermission与自定义config**。因此给invokeFileTool传一个永远返回false的checkPermission，并不能阻止文件读取；本轮测试在临时文件上确认回调调用次数为0且读出了内容。

这不直接证明完整产品的宿主授权被绕过：上层可能有独立的工具授权。但它明确说明这个重建模块不能当作自带授权的远程服务公开。调用者必须先实现并验证完整授权边界；不能只增加一个从未被下传的回调就宣称安全。

同样，原读取/图片/补丁的检查与使用竞态、路径替换风险没有修复。查找/搜索中的原正则、glob、输出限制与资源开销也没有完整安全审计。模块恢复完整度不等于安全或功能验收完整度。

## 普通CMD + conda复现

源码根目录，已创建恢复环境后：

```cmd
conda activate shuncode-recovery
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run check:bridge-core
node tools\audit_extension_runtime.mjs --check
node --test tests\bridge-core-file-execution.test.mjs
npm.cmd test
```

重建器会核对原件/输出哈希，拒绝覆盖手工改过的重建文件。维护修改应放在community层。当前社区ZIP保持原样，不包含本轮新增执行模块或任何权限修复。
