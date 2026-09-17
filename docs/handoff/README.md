# ShunCode恢复项目交接入口

**更新：2026-09-17。当前结论：NOT_READY。** 这是给下一位助手/开发者的操作交接，不需要先读完整聊天。路线图见[ROADMAP.md](ROADMAP.md)，第一项工作详案见[NEXT_AUTHORIZATION.md](NEXT_AUTHORIZATION.md)，机器可读快照见[STATE.json](STATE.json)。

## 1. 接手后先纠正三个容易误判的事实

1. **以仓库/远端提交和实际证据为准，不以聊天最后一条为准。** 本次交接发现远端已到`b77a9e5`，比聊天中`97099c5`多了公共Chat文本回退及CI；已经核验并快进同步，没有重复“修复11条错误”。`b77a9e5`是本交接开始时的基线，不是今后永远的最新提交。
2. **当前可选portable变体候选类型为0错误，但产品仍不可放行。** 它只用公共`input/output`显示文本，原富卡片、点击跳转和交互diff没有因此恢复。不要给公共vscode命名空间补假字段来宣称原宿主已实现。
3. **下一项优先工作是授权整合，不是再刷类型错误数。** 维护文件调度器缺策略时会拒绝，但它尚未进入实验扩展；当前应用图仍使用不转发逐文件权限的原调度器。

## 2. 用户目标与已确定边界

- 用户是原软件作者，误删定制工程；优先Windows 0.7.4，聚焦MCP Bridge、工具、Skills和定制UI。Code OSS应复用，不重复逆向整个底座；Linux不是前置条件。
- 已授权去除**自己的**登录/支付宝/收费门槛；必须保留模型提供方、隧道等第三方认证，令牌、权限、文件安全及许可义务。
- 最终要可维护工程、完整Windows构建/安装器，以及已有用户可自行应用和回退的教程。现有overlay是固定旧版补丁，不是新源码完整安装器。
- 用户不是专业开发者。终端固定**普通Windows CMD中激活conda**，不是Anaconda Prompt或PowerShell。教学要细致、如实记录操作和失败。
- 用户要求成果推送分支，不能只给聊天附件；不需要让用户反复决定技术工具，也不要求提供真实密钥/密码/证书私钥。
- 工作固定在`arena/01a09d2c-reverse-enginnering-of-shun`。不得强推、切到main、创建另一个工作分支或覆盖他人的更新。保留原件，新增维护层。

## 3. 四种模式与默认门槛

| 模式 | 类型脚本 | 结果/退出码 | 构建含义 |
|---|---|---|---|
| 原推断 | diagnose:linked-types | 59 / 1 | 原共享JS推断基线 |
| 原路由+14份契约 | diagnose:contract-types | 14 / 1 | 原Chat+原HTTP边界保留 |
| HTTP维护 | diagnose:http-types | 11 / 1 | HTTP实际适配器接入，仍原Chat |
| portable文本回退 | diagnose:portable-types | 0 / 0 | HTTP接入+公共Chat文本降级；最新可选实验 |

`check:release`当前检查portable变体：源码连接、候选类型PASS，**7项发布门槛BLOCKED**，总NOT_READY，退出2。完整实现级typecheck、真实扩展激活、原宿主身份、原生ABI与新安装器均未获证明。原JS仍checkJs:false，主诊断skipLibCheck:true；独立声明/适配器有更严格专项，不能混成全工程严格通过。

## 4. 重要路径：按这个顺序读

| 路径 | 用途 |
|---|---|
| docs/RECOVERY_STATUS.md | 汇总入口；历史段落可能保留旧数字，要优先看顶部最新变体 |
| docs/PORTABLE_CHAT_INTEGRATION.md | 公共文本回退、明确降级、0错误的范围 |
| docs/HTTP_EXTENSION_INTEGRATION.md | 原传输层+真实SDK本机协议测试、惰性工具限制 |
| docs/evidence/portable-{linked-extension,type-diagnostics,integration-tests}.json | 当前portable构建、诊断、历史CI证据（这里是三个文件） |
| tools/build_linked_extension.mjs / diagnose_linked_types.mjs | 受限源映射/转换与同源类型检查；默认模式不要破坏 |
| tools/{http_maintenance_inputs,portable_presentation_inputs}.mjs | 原件、维护代码和声明哈希/转换边界核验 |
| reconstructed/bridge-core/ | 41个原貌JS模块与来源，不直接改它们 |
| reconstructed/type-contracts/ | 14份候选类型契约；不是原始d.ts |
| community/bridge-core/ | 并发、读取检查点、强制授权调度、HTTP维护模块；接入状态各不相同 |
| community/extension/src/ | 去商业化政策与portable Chat转换 |
| recovered/shuncode-extension/ | 51份不可覆盖原件，包括TS、旧dist、两个旧runtime JS |
| recovered/bridge-ui/、bridge-ui-sessions/ | 两宿主Bridge提取片段；不是完整Workbench源码 |
| reference/vscode-types/ | 固定公开候选声明与许可；不是原定制宿主 |
| docs/acceptance/ | CMD验收步骤、MCP、安装器、空白结果表；不预填用户PASS |
| docs/REVERSE_ENGINEERING_JOURNAL.md | 详细历史操作、失败、边界；最近章节优先 |

`.work`是可重建工作区，不是交付物；`dist/node_modules`可能不随会话保存。不要把缺少缓存误认为源码删除。原EXE在当前工作区可能只是134字节LFS指针；真实原包SHA/大小在取证报告，原包存在也不证明新构建完成。

## 5. 接手第一小时：只复现，不部署

在正确仓库中先执行：

```cmd
git status --short
git branch --show-current
git log -5 --oneline
git fetch origin arena/01a09d2c-reverse-enginnering-of-shun
```

有本地改动或远端新增提交，先核对差异。**不要复制历史日志里的reset/rebase作为通用修复命令。** 本次只有核验所有文件与97099c5一致（除会话未保存的六个dist）后才恢复本地索引并快进；这不是允许丢弃下一位助手的改动。若分支干净且可快进，用`git merge --ff-only FETCH_HEAD`；不能快进就先分析，禁止强推。

普通CMD中：

```cmd
conda activate shuncode-recovery
call npm.cmd ci --ignore-scripts --no-audit --no-fund
call npm.cmd run check:bridge-core
call npm.cmd run build:portable-extension
call npm.cmd run check:portable-extension
call npm.cmd run diagnose:portable-types
echo %ERRORLEVEL%
call tools\run-learning.cmd
echo %ERRORLEVEL%
call npm.cmd run check:release
echo %ERRORLEVEL%
```

预期依次通过；portable类型0；学习/回归总入口0；发布检查2/NOT_READY。逐行输入并在失败处停，不把预期失败的59/14/11基线命令串入必须全部退出0的流水线。conda环境创建与故障详见[CMD指南](../WINDOWS_CMD_CONDA.md)。

Linux助手环境可以复现npm和Python测试，但不能把3项Windows专属跳过算作Windows通过；不要用它冒充用户的CMD或GUI操作。构建工具Node22与候选Code OSS构建工具链不是同一个环境。

## 6. 证据等级与不可跨越的边界

- Node回归包括：原件/构建/类型、模拟UI、维护模块、本机HTTP+真实SDK但惰性工具、旧Agent Host固定stdio元数据。
- portable格式化器测试使用空冻结vscode替身，未测试真实URI跳转/桌面渲染。
- 旧Agent Host测试校验SHA、空HOME、最小环境、JS网络/子进程守卫；不调用agent/run，不是OS沙箱，也不是新源码Agent Host验收。
- MCP两会话测试确认初始化/清单/owner标记/删除/停止，不代表真实任务隔离或文件审批通过。
- 之前CI全部绿色不代表当前代码通过；始终记录被测headSha与run ID。API作业/步骤证据不等于归档了逐条完整日志。
- 工作区scope不是设备沙箱；双数据目录不是全局账号隔离。B/C/D需可恢复Windows VM、虚构资料、无生产账号及磁盘共享。

### 本交接版本实际验证结果

- 授权审计/回归代码提交：`2d26aca5e9578ca1fbb950235ccb9351294b3ea6`。随后仅补证据文档，不把文档提交冒称被该次CI测试。
- 本轮Linux：144项Node通过；Python运行34项，31通过、3项Windows专属跳过；portable类型0；发布仍退出2。
- [CI 35232127826](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/35232127826)：Ubuntu、Windows 2022、**普通CMD+conda**三个作业全部成功。保存[作业/步骤证据](../evidence/handoff-integration-tests.json)，没有冒称已归档完整逐条远端日志。
- 原件/旧overlay未改，portable bundle SHA仍`635190e62a2874fa9f07bad049e5da0944ef33f04456bb96da7fae5d823d2aaa`。学习覆盖更新为168文件/31303行，仍仅6文件363行已人工解释。
- 授权审计是本轮新增工程成果；宿主策略实现尚未开始。CI通过不改变7项发布BLOCKED。

## 7. 已知风险与不要重试的捷径

- 原文件调度器不转发checkPermission/config；维护入口只有字面值true允许，不能接一个固定true回调来“恢复功能”。
- 读取检查点仍有检查到打开之间的竞态；图片/搜索/写入、归档/Skills和任意命令需要单独安全评审。不要宣称realpath一次检查就是OS沙箱。
- 原取消风险分类器判断中途强停损坏风险，不是通用危险命令检测器；不得拿normal当允许执行。
- 产品内部受管终端依赖PortableGit Bash，缺失时实际抛错；外部CMD不能替代，过时PowerShell回退注释不能当证据。
- 原宿主身份未确认；公开候选Electron42.7.1与原包声明44.2.0不同。不要只复制.node模块或把Node加载成功当Electron ABI成功。
- 文件名/版本号、成功parse CJS、旧EXE、overlay或静默安装外壳都不能证明新源码安装器完成。
- 历史下载有EOF/TLS失败，手动Actions dispatch曾403；自动push触发后来成功。遇认证错误检查Arena GitHub连接，不索要用户token，不关闭TLS。
- 安装器取证workflow可能向同一分支自动提交报告。push被拒绝应fetch核对后整合，不force push、不覆盖自动报告。

## 8. 每次交接结束必须更新

更新STATE.json中的实际代码基线/验证范围/结果、ROADMAP任务状态和下一项；在工作日志记录命令、失败修正与未测试范围。新增或改源码后运行learn:build/learn:check，再跑相关回归、原件/ZIP哈希与CRLF感知diff检查。

提交与推送本分支，保留CI被测SHA；交接文档提交本身的SHA不需要写进自身制造循环。禁止将秘密、完整MCP令牌URL、私有测试配置、巨大解包目录和临时依赖入库。

### 可复制给接手助手的任务说明

> 请先读docs/handoff/README.md、STATE.json、ROADMAP.md和NEXT_AUTHORIZATION.md，核验本分支最新提交及工作树后复现portable候选。当前0错误来自公共文本回退，不是原富卡片恢复；发布NOT_READY。优先推进可信宿主文件授权到实际构建链，按路线图补会话/取消/拒绝和虚构文件测试；保护recovered与原overlay，不默认允许、不模拟原生宿主、不提前部署。继续用普通Windows CMD+conda写用户步骤，记录实际证据，成果推送当前固定分支。
