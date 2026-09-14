# 自有定制功能优先：Bridge 去商业化改造记录

## 目标与边界

作者明确调整目标：恢复 MCP Bridge、工具、相关 UI 等自有定制内容，不逆向整套 VS Code；同时停止“先登录/付费再解锁”的商业化方案。以下改动是作者授权的产品策略调整，与原样恢复证据分开保存。

**删除商业门槛 ≠ 删除安全认证。** 路由令牌、工具输入/路径验证、工作区范围、隧道令牌、模型提供商账号是不同层次，不能用全局搜索替换 `auth`/`token`/`licensed` 的方式一起删掉。

## 1. 收费链路调查

从 `recovered/shuncode-extension/src/extension.ts` 的 `activate()` 开始：

```text
activate()
 ├─ BridgeLicenseService.initialize()
 │   ├─ 预加载套餐
 │   └─ 恢复 pending 支付订单轮询
 ├─ authorizeBridgeStart → requireFeature("bridge")
 └─ BridgeAccessController
     ├─ start → BridgeManager.start（在建立监听器/隧道前调用授权回调）
     ├─ 每 15 分钟复验商业许可证
     ├─ 复验失败 → 停止 Bridge
     └─ 上报待结算工具调用数量

自定义 Bridge Widget
 ├─ 读取 shuncode.bridge.access.getStatus
 ├─ 登录 GitHub/Gitee、刷新账号、兑换激活码
 ├─ 获取套餐 → 支付宝下单 → 查看支付结果
 └─ 启动/自动启动前的界面侧许可检查
```

因此只改 `requireFeature()` 会漏掉计时器、订单轮询、界面报错及购买入口。只把按钮隐藏，也不会解决实际启动授权失败。

## 2. 寻找自定义界面，而不是复制 VS Code

第一轮 AST 捕获以“类里面包含 `shuncode.bridge.payment...` 字符串”为条件，结果没有匹配类。原因是命令字符串被提升到独立常量，如 `BRIDGE_PAYMENT_CREATE_ORDER`，类内部只引用常量。

修正为两步：

1. 找到包含目标命令字符串的 `VariableDeclarator`，记录变量名。
2. 在 AST 中寻找引用这些变量的 class，提取该 class 的原始文本和哈希。

脚本：`tools/capture_bridge_ui.mjs`。第一轮运行 `34853693739` 说明直接查字面量不足；第二轮运行 `34854138442` 通过引用找到了 **122,966 字节的 Bridge UI 类**。结果在 `recovered/bridge-ui/`，并非整个 36 MB Workbench bundle。

这个类包含 Bridge 控制、账户/购买面板、JSON 工具、Skills、隧道配置和快捷链接方法。它是**编译后的类表达式片段**，不是原始 TS 模块，独立运行会缺少宿主提供的 UI 组件。

## 3. 新的本地社区策略

新实现放在 `community/extension/src/`：

- 保留历史 `BridgeLicenseService` 类名作为兼容接口，但实现只返回本地可用性，不调用 OAuth、授权服务器或支付接口。
- `edition=community`、`available=true`、`requiresAccount=false`、`requiresPayment=false`、`signedIn=false`，不伪造用户身份。
- `licensed=true` 只是兼容旧调用方的可用字段，**不是签名许可证或付款证明**。新 UI 依据 `edition/available` 判断，不靠伪装成付费用户。
- 旧登录/刷新调用变成本地状态返回；下单/激活码调用明确拒绝，不会创建订单。
- 新控制器不建立授权复验计时器，不上报商业用量；退出原商业账号不会停止免费 Bridge，也不会关闭用户的自动启动设置。
- 原 API Key、Codex 登录、隧道认证和历史支付记录不动。

## 4. 为什么修改编译产物，而不假装完整源码已能重编译？

已恢复的源码仍有 24 个共享模块路径和部分宿主 API 声明缺口。直接宣称“源码完整可构建”不成立。

现阶段采用可复现的过渡方案：

1. 对照 `docs/evidence/custom-extension.json` 校验原始 bundle 哈希。
2. 使用固定版本 `esbuild` 将**新写的两个 TS 服务**转换为 JS。
3. 使用模块标签与 AST 范围，替换原 bundle 中对应的商业模块，保留其他打包代码。
4. 修正入口的授权回调和退出商业账号处理；输出对应 TS 改动，避免只剩无法维护的黑盒补丁。
5. 移除命令面板中的 Bridge 商业登录/兑换入口，但保留 Codex 登录和模型 API Key 设置。
6. 再次解析 JS，并对 8 组安全/提供商模块的每个片段核对哈希不变。

原始 `recovered/` 文件不会被覆盖。构建输出位于 `.work/community-overlay/`；源码修改和工具存入 Git。

## 5. 界面改动与双宿主问题

对自定义 Widget：

- 账户/套餐/付款/激活码区域替换为社区版说明卡片，不是只设置 `display:none`。
- 删除不再需要的支付/登录方法和控件状态更新。
- 免费且未登录时可以启动；如果界面已更新但扩展尚未更新，明确提示组件不匹配，不虚报成功。
- 自动启动保持由用户选择，不主动替用户开启。
- 隧道配置检查、工具/Skills UI、MCP 地址安全提醒保持。
- 73 个无关 UI 方法逐字节保持不变（以 Workbench 捕获结果计）。

**真实包验证发现的问题：** 运行 `34855093775` 的校验拒绝了 Sessions 宿主，报 `Expected exactly one custom UI class in sessions.desktop.main.js`。Workbench 与 Sessions 包含相似 UI，但编译文本不完全相同。输入哈希检查和匹配数量检查在写文件前阻止了不完整更新，没有强行全局替换。

修正方案：分别捕获两个宿主自己的类片段、分别生成补丁；不假定它们字节相同。其余宿主代码不修改。后续结果由 `docs/evidence/community-validation.json` 记录。

## 6. 验证层次

- Python：文件哈希、路径越界/符号链接拒绝、只读预检、自动备份、失败回滚、拒绝覆盖后续更新。
- Node：仅对新写的社区服务和经过审查的 UI 方法做隔离测试；外部网络/计时器/账号存储用禁止调用的 mock 验证。没有激活完整原扩展。
- 行为：免费且未登录用户可启动；商业登录、刷新、退出不收费、不停机；未知能力仍拒绝；隧道配置不全仍拒绝。
- 不变量：8 组安全/提供商模块与大量 UI 方法内容不变。
- 真实包：在 runner 上验证所有目标文件哈希、准确替换次数，并对合成的完整 JS 执行只解析的语法检查。
- **尚未做：Windows 实机 UI、实际 MCP 客户端连接、完整扩展激活、完整 Windows 安装包构建。** 不能把这些单元/静态测试当成端到端验收。

开发中测试还发现两处补丁工具自身的问题：方法映射直接读取继承的 `constructor` 属性导致编辑范围重叠；主构建脚本顶层 await 与动态导入循环导致等待无法完成。分别通过 `Object.hasOwn` 和拆分公共 AST 工具解决。它们说明修改工具本身也需要测试，而不是只检查目标程序。

## 7. 发布与后台下线

实验性 overlay 只支持作者上传的精确 0.7.4 构建，预检通过后才写入 8 个文件并保存备份，不触碰用户设置/凭证。不同版本和已经修改的文件应拒绝，而不是“尽力覆盖”。

关闭客户端收费入口**不会自动停掉远端商户收款**。旧用户、旧官网和旧客户端仍可能访问原支付后台。后台停售、订单对账/退款与服务下线属于运营迁移，目前没有执行；必须保留必要的历史订单和支付通知处理。详见 `community/README.md` 的待办。

下一阶段继续恢复自有共享工具模块与可维护构建工程，而非还原整个 VS Code。社区补丁是过渡产物，不代替完整工程恢复。

### 双宿主真实验证结果

运行 [34855446553](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34855446553) 成功：8 个目标文件全部匹配原始哈希；合成后的扩展、Workbench、Sessions 三个 JS 都通过只解析语法检查。报告记录了输入/输出哈希和完整 overlay manifest 的哈希。包生成器必须匹配这一 manifest 才允许生成测试包。

进一步对比两个 UI 片段，差异来自 `container3` / `container2` 等编译期变量重命名。逻辑相近不代表可以用同一原始字节片段去替换两个文件；这是上一轮匹配检查拒绝 Sessions 的直接原因。两个版本各有 73 个无关方法保持各自原字节不变。

本地测试：23 项 Python 测试通过；14 项 Node 隔离测试通过（含新增的 Sessions 独立片段检查）。原 51 个扩展文件仍与来源清单哈希一致。生成的实验包大小/哈希见 `docs/evidence/community-package.json`。这仍不等于 Windows UI 和真实远程工具调用已经验收。


## 后续审查发现：原文件读取器的路径竞态

共享模块恢复阶段，在原声明和重建代码上复现了“检查路径后、等待权限确认期间目录被替换”的读取越界风险。此前 overlay 保留原路径检查代码，只表示未删除这些机制，**不表示原实现已经通过完整安全审计**。已发布 ZIP 未修改，也不包含这次的再次核对路径候选。

详情、受控夹具与防护局限见 [文件读取恢复说明](../reconstructed/bridge-core/FILE_READER.md)。候选只增加确认后的检查点，尚未解决所有检查/打开竞态。不要据此将原版本或候选直接视为可安全处理恶意并发工作区的隔离工具；MCP 令牌、主机权限和工具作用域仍需保留。
