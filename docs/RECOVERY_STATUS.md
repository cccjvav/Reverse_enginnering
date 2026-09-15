# 工程恢复汇总：仍未达到完整交付

**结论：NOT_READY。不能如实报告“所有剩余项目已完成”。** 本轮继续完成了两个类型契约、两个维护运行时模块及可重复的发布门槛检查，但完整宿主适配和实机产品验收仍未完成。没有用关闭检查或预填PASS满足“一次完成”的要求。

## 已实际交付什么

| 工作 | 当前成果 | 不等于什么 |
|---|---|---|
| 自有模块恢复 | 41个原貌JS模块、来源哈希与回归 | 完整Code OSS工程 |
| 实验扩展连接 | 从原TS/重建JS可重复连接CJS，未改原件 | 已激活的完整扩展 |
| 类型恢复 | 累计14模块；候选诊断59→49→39→18→14 | 原始类型和原宿主均找回 |
| 取消命令契约 | 生命周期、owner、risk、预约确认、nullable退出状态 | 已运行真实PTY/终端 |
| 文件结果契约 | text/image联合、可选content、错误/结构化结果 | 已消除文件系统竞态 |
| 维护文件调度 | 缺策略拒绝，向5种文件工具转发回调与配置；读取复用检查点候选 | 已接入宿主审批与已发布版本 |
| 原Agent Host有限运行 | 空HOME、阻断网络/后续子进程，实际stdio hello/ping/list/无运行取消/未知方法通过 | 新源码运行时、模型执行、Electron/PTY或真实扩展激活 |
| 维护HTTP边界 | 拒绝数组头/重复头，保留令牌路由与合法请求 | 真实MCP/OAuth/隧道已验收 |
| 发布门槛工具 | 重新构建/诊断、观察运行文件、列出阻断项，未就绪退出2 | 自动修好所有阻断项 |

## 仍剩下哪些项目

| 目标 | 状态 | 缺的具体证据/实现 |
|---|---|---|
| 原宿主身份与完整载体 | BLOCKED | 原commit尚未确认，公开候选声明不能代替原定制宿主；候选/原包Electron版本不同 |
| 定制Chat原生展示 | FAIL/BLOCKED | 11条字段诊断：items、metrics、diffPreview、presentationKind/presentationStyle等；需核对实际扩展宿主/Workbench协议与渲染，而非单独补module augmentation |
| HTTP在应用中的整合 | BLOCKED | 3条原调用边界诊断仍保留；维护适配器已测，但未纳入原扩展构建/生命周期 |
| 文件权限在应用中的整合 | BLOCKED | 新入口需要会话绑定的宿主授权策略，原消费者没有传；不能默认允许来绕过 |
| 原生运行资产 | BLOCKED | 本仓库有旧agent-host.js/mcp-server.js；旧Agent Host已通过Node下有限stdio检查，但新源码重建/新宿主启动未通过；提取目录未含PortableGit bash、rg候选资产，PTY ABI未验证 |
| 真实扩展激活、双宿主GUI | BLOCKED | 没有完整新载体和真实桌面操作记录，静态UI实验不能替代 |
| 真实MCP与远程客户端 | BLOCKED | 完整候选、授权整合、会话归属/停止/轮换、真实客户端尚待验证 |
| 从源码构建Windows安装器 | BLOCKED | 未产生新完整安装包；品牌/升级/数据/卸载和签名验收未完成 |

当前原安装器路径观察到134字节Git LFS指针，不是240MB原EXE；旧取证报告记录的是此前真实提取结果。这不表示原包永远无法重新取得，但不能拿当前指针运行安装测试。当前环境也没有git-lfs命令。未下载或运行不明替代安装器。原包即使重新取得，也不是新源码构建的安装器。

## 本轮类型重建的关键细节

- 取消状态来自原CommandState五个状态，强停结果仍可能未退出，exitCode可null。保留owner拒绝和高风险预约确认，不删除这些安全措施。
- 原NATIVE_MANAGED_COMMAND_OWNER_ID是var字符串。初版声明写成字面量导致原方法默认参数被误窄化，出现“string不能赋给native-chat”；已改为string，保留其他Bridge owner调用。
- ToolContentBlock当前只覆盖原工具返回的text/image两种；content可选，消费者必须保留文本回退。
- 类型检查仍是候选消费者检查，checkJs:false/skipLibCheck:true；独立声明负例使用skipLibCheck:false，不代表全工程JS都通过严格检查。

## 维护模块实测范围

新测试对虚构临时目录执行5种工具的拒绝检查，确认文件未被修改；另测明确批准的补丁、图片结果、read_files单行预算、非布尔“yes”拒绝、策略异常拒绝。没有读取生产目录或接入真实账号。

取消测试只操作内存目标，不执行命令。第一次错误地用rm字符串预期高取消风险；对照实现后确认该分类器判断的是“中途强停风险”，不是危险命令总分类器，改用它明确识别的npm install字符串夹具。另一处实测发现文本内容保留行号“1: alpha”，修正了测试预期，没有改实现抹掉输出。

HTTP测试实际发送重复请求头到仅回环监听、无工具功能的Node服务器，得到400且处理器调用次数0；错误令牌404、合法单值头正常。不声称真实ShunCode服务被测试。

## 普通Windows CMD中的复现入口

仍先按WINDOWS_CMD_CONDA.md激活conda，进入源码根目录并安装锁定依赖；每次一行：

```cmd
call npm.cmd run diagnose:contract-types
echo %ERRORLEVEL%
node --test tests/bridge-core-maintenance-boundaries.test.mjs tests/bridge-core-type-contracts.test.mjs
echo %ERRORLEVEL%
call npm.cmd run check:release
echo %ERRORLEVEL%
```

预期：类型14条/退出1；专项15项通过/退出0；发布检查NOT_READY/退出2。退出2表示工程尚未达到发布门槛，不表示要你关闭安全软件或换管理员运行。

发布检查只读检查并在内存重建实验bundle。技术执行方可用 `node tools/check_release_readiness.mjs --write` 保存当前观察到docs/evidence/release-readiness.json；它不会启动应用、打开公网服务或运行安装器。编辑报告为PASS不能代替修复和验收。

后续实机操作规程仍见[验收手册](acceptance/README.md)。在没有合格候选之前，不把实验bundle或本目录维护模块覆盖到主力安装。


## 原Agent Host：新增的有限运行证据

本轮不再只检查runtime文件存在。对哈希核验后的原agent-host.js，在空临时HOME、最小环境中启动独立Node子进程；预加载JS守卫阻断HTTP/TCP/TLS/UDP、fetch和后续子进程入口，且只发送五种固定元数据请求。不调用agent/run、不运行文件工具、不提供模型账号或隧道配置。守卫不是操作系统安全沙箱。

实际得到protocolVersion=8、runtime/ping正常、tools/list与hello一致、不存在任务取消返回not_running、未知方法返回-32601，关闭stdin后正常退出。原文件SHA和本地平台证据保存为docs/evidence/agent-metadata-smoke.json。

这证明原有bundle在测试Node下能启动并响应这些请求，不是恢复出新的Agent Host源工程，也不证明新载体注入、Electron ABI、Git Bash、模型请求或GUI已通过。发布门槛仍为NOT_READY。


## 本轮最终回归结果

- 本地Node：133项通过；Python：31项通过、3项Windows专属本地跳过。
- 提交dcbd8efe73a0da3b7426575de92f289ff1fd8941的[CI运行35034730553](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/35034730553)：Ubuntu、Windows2022、普通CMD+conda三作业全部成功。
- 作业/步骤API证据在docs/evidence/maintenance-recovery-tests.json。另尝试下载完整远端日志，归档端点返回EOF，未获得逐项完整日志；没有把此失败改记成功或保存临时签名URL。
- Agent Host的tools/list是内部stdio方法，不是Bridge MCP端点握手；不能据此放行MCP。
- 原51个文件、既有overlay、实验bundle均保持字节一致。维护适配器仍未进入应用构建。

**以上成果已完成并验证，但“所有剩余项目完成”仍不成立。** 已知14条类型/边界错误与上述宿主、授权整合、原生资产、GUI/MCP、安装器门槛必须继续以实际实现和实机证据关闭，不能靠这份报告代替。
