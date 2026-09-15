# 哪些是作者定制，哪些是 Code OSS？

## 结论：可以分离，但尚不能声称定制改动已全部找齐

现在不需要把整个 Code OSS 逆向回源码。正确目标是：**采用经核对的开源底座 + 独立的自有定制层 + 社区版维护补丁**。仓库已经按这个思路分层，后续以恢复可维护、功能等价的社区工程为目标；不承诺逐字找回删除前的源码和 Git 历史。

| 材料 | 位置 | 可证实的范围 | 不能据此声称 |
|---|---|---|---|
| 自有扩展边界 | `recovered/shuncode-extension/` | 原安装包的 `extensions/shuncode`，51 个文本文件，其中 34 个 TS/MTS；manifest 声明 first-party 集成 | 整个 bundle 都是作者独占原创；它也打包第三方库 |
| 共享业务逻辑 | `reconstructed/bridge-core/` | 41 个 ESM 模块，38 个共享路径标签加 3 个快照/资产定位模块；按声明记录来源 | 原始 TS 类型或完整共享工程已找回 |
| 定制 Bridge UI | `recovered/bridge-ui/`、`recovered/bridge-ui-sessions/` | 两个宿主各自的自定义 UI 类与常量，哈希定位 | Workbench/Sessions 整个文件都是定制；或只有这两处宿主修改 |
| 社区版维护 | `community/extension/src/`、`community/ui/` | 本次新写的收费门槛移除与 UI 改造 | 它属于原安装包原件 |
| 独立维护候选 | `community/bridge-core/` | 并发器修复、读取器有限检查点防护 | 已部署；或已彻底解决文件系统竞态 |
| Code OSS 宿主 | 原包 `resources/app/out/vs/` 等 | 包含上游代码与可能混入的修改；应对比源码底座 | 未经比较就把整个目录判为“纯上游” |
| 第三方依赖 | bundle 中 `node_modules/...`，Electron、原生模块等 | 有第三方路径/组件证据，应复用匹配版本并保留许可 | 都需要逆向，或都能按作者代码重新授权 |

这些是**功能和来源边界**，不是逐行版权判定。`src/...` 注释是候选定位线索，不能独自证明作者身份。定制中的原生 Chat、多模型、工作区共享、菜单/面板接入等还需继续核对宿主整合点。

## 新增可重复审计

```bash
npm run audit:boundary
npm run audit:boundary -- --check
```

[`custom-code-boundary.json`](evidence/custom-code-boundary.json) 核对原件/UI 哈希，使用 Acorn 的真实注释（不是字符串内的伪注释）索引各 bundle 来源，并将原 TS 缺失引用对应到现有 JS 重建。

- 三份 bundle 合并有 **43 个共享路径标签**；不是把全部依赖算成自有模块。
- 原 TS 有 **24 个不同的缺失相对目标 / 32 处引用**。
- 其中 **24 个目标已有某种 JS 重建对应**，但尚未接回原 TS 导入；不能把 24/24 当作工程完成百分比。
- `file-tool-registry` 仍只是部分声明：没有完整 dispatcher。
- 此前5个目标现已恢复已发布JS声明：`custom-tool-admin`、`custom-tool-migration`、`custom-tool-skill-import`、`custom-tool-skill`、`custom-tools`。
- 图片已独立恢复但未接入，搜索等仍是注册表缺失的传递依赖，不能因为不在上述 5 个直接缺失目标里就忽略它们。

## 找到了上游版本候选，但尚未确认底座

本轮通过 GitHub API 确认公开标签 **1.132.0** 指向：

`df53daabb18cd157bdb08c7f01c34df936cf12f4`

该候选包含扩展声明用到的 7 个 proposed API 声明文件，值得用于后续比较。但：

| 项目 | 原发行包声明 | 公开 1.132.0 候选 |
|---|---|---|
| 应用版本 | 1.132.0 | 1.132.0 |
| Electron 开发依赖 | 44.2.0 | 42.7.1 |
| 产品提交/源码提交 | 09533f921029d9d073c06e70f566ebe31e43cebc | df53daabb18cd157bdb08c7f01c34df936cf12f4 |

原产品提交此前在公开 `microsoft/vscode` 查询未找到。**版本号相同、声明文件存在，不代表实现或 ABI 相同。** 不能直接覆盖 Electron 版本、借用不匹配的 `.node` 模块，或宣称已锁定原始底座。

原始 API 查询结果摘要及固定源码链接见 [`upstream-build-reference.json`](evidence/upstream-build-reference.json)。此次只获取少量参考文件，没有克隆整个上游，也没有执行上游构建脚本。该候选不是本项目已经采用的构建依赖。

## 许可与分发

公开 Code OSS 源码的 [LICENSE.txt](https://github.com/microsoft/vscode/blob/df53daabb18cd157bdb08c7f01c34df936cf12f4/LICENSE.txt) 是 MIT。保留相应版权与许可文本；不要把 Code OSS 的许可等同于所有 Microsoft 品牌发行物、在线服务、Marketplace 扩展和捆绑组件都可任意重新分发。

作者可以授权自己的商业限制移除与补丁分发，但当前仓库尚未为自有代码指定新的通用开源许可证。`Community` 是版本定位，不自动等于 MIT/GPL。正式源码发行还需确定自有部分许可、品牌、第三方 NOTICE/许可和服务使用规则。

完整构建路径见 [WINDOWS_BUILD_GUIDE.md](WINDOWS_BUILD_GUIDE.md)。


最新运行时接线审计见 [extension-runtime-imports.json](evidence/extension-runtime-imports.json)：55个导出均存在，barrel再导出与invokeFileTool已恢复，但原TS未接线。全部24个路径有JS标签对应不等于所有类型/导出/执行链齐全。
