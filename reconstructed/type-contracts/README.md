# 可追溯的候选类型契约（累计14模块）

> 最新 [HTTP接入实验](../../docs/HTTP_EXTENSION_INTEGRATION.md)使用已实现并单独严格检查的维护路由契约，诊断11条；下面的14条指保留原路由的合同模式，两者都未通过完整门槛。

这些是**新重建的声明**，不是找回原始.d.ts，更不是已经恢复完整宿主。只改变候选类型解析，不改41个提取JS模块、原51文件或实验bundle。原JavaScript依然未受TypeScript实现级检查，声明不能替代实现验证。

## 普通Windows CMD中运行

先按仓库CMD+conda指南激活环境、安装锁定依赖，在仓库根目录逐行运行：

```cmd
call npm.cmd run diagnose:linked-types
echo %ERRORLEVEL%
call npm.cmd run diagnose:contract-types
echo %ERRORLEVEL%
```

第一条是旧的JS推断基线：59错误、退出1；第二条启用十四份候选声明：14错误、退出1。两者都没有通过产品类型门槛。新报告是docs/evidence/contract-type-diagnostics.json，不覆盖旧报告。不要因为错误减少就执行安装或开放Bridge。

第二批新增活动记录、事件存储和HTTP路由，详细依据、测试及新发现见 [第二批恢复记录](SECOND_BATCH.md)。第一批从59降到49，第二批消除13条旧诊断并暴露3条新诊断，净降到39。

第三批新增CustomTool facade、Skill诊断/导入、管理操作、名称解析，见 [第三批恢复记录](THIRD_BATCH.md)。候选目前18条错误，39是第二批历史结果。

最新恢复了取消命令和文件结果契约，18→14；新增维护运行时模块及完整状态见 [工程恢复汇总](../../docs/RECOVERY_STATUS.md)。独立修复候选不等于已部署到应用。

## 为什么能这样重建

| 声明 | 实现证据 | 原扩展调用证据 | 恢复的约束 |
|---|---|---|---|
| concurrency.d.ts | bridge-core/src/concurrency.js的run/acquire及返回release函数 | bridge-tool-dispatcher.ts的toolGate | Semaphore可作实例类型，run保留T并等待异步结果，signal可选 |
| adaptive-concurrency.d.ts | adaptive-concurrency.js的record窗口判断和返回对象 | bridge-tool-dispatcher.ts的adaptive.record | 明确durationMs/queued/failed输入和hold/grow/shrink决策 |
| jsonrpc-request-id-registry.d.ts | requestIdOf只接受string/number；claim的两个返回分支 | bridge-mcp-transport.ts的McpSession.requestIds | 输入unknown经过筛选，claim是可缩窄联合类型，不接受null ID |
| bridge-session-registry.d.ts | isActive/prune所读三个字段、get缺失分支和destroy回调 | bridge-mcp-transport.ts的BridgeSessionRegistry<McpSession> | 泛型必须含活动状态；get可能undefined；回调保留完整会话类型 |

会话销毁reason有已知内部字符串，但destroy接受调用者传入的其他字符串，因此没有武断限制成封闭枚举。destroyAfter等待action，但不使用其结果，故允许unknown返回值。并发上限必须正整数的条件只能在运行时验证，number类型本身不保证正整数。

声明只描述当前消费者需要的公共契约，不为提取产物里的内部字段设计随意可写接口。没有新增any、通配索引签名或虚构宿主字段。

## 来源保护与测试

provenance.json记录每份声明及对应实现的SHA256。诊断器先将实现哈希与原core来源清单交叉核对，再校验实际文件与声明哈希，然后仅对十四个明确模块重定向解析；其他模块仍按旧方式解析。新增报告携带这份映射。

tests/bridge-core-type-contracts.test.mjs现有9项：

1. 复现14条剩余错误（含3条新暴露HTTP边界错误），并确认宿主字段错误仍存在。
2. 用strict、noEmit、**skipLibCheck:false**检查独立类型夹具和声明本身；@ts-expect-error负例必须真的出错，否则测试失败。包括错误构造参数、返回值错配、缺采样字段、null ID、不完整会话及未处理get缺失。
3. 直接调用提取JS，核对同步/异步泛型返回、释放幂等、决策、ID联合分支和会话删除回调的实际结果。
4. 活动记录保留presentation、统计和重复finish的实际语义。
5. 事件存储仅重放同stream，等待send，传播send失败，逐出旧游标。
6. 合成请求对象的数组请求头被路由原样转发（不冒称远程漏洞）。
7. CustomTool/Skill发现与诊断区分失败、未找到和未启用。
8. Skill导入/runner生成区分重名、已存在和新生成；不执行生成脚本。
9. 预先取消的自定义工具调用不会启动子进程，日志回调实际不被调用；名称解析不能代替授权。

这些测试只提供有限合同证据，不证明所有JS分支均符合声明；完整候选诊断仍沿用原strict/noEmit/allowJs/checkJs:false/skipLibCheck:true设置，不能把独立声明测试冒充全工程严格实现检查。

## 尚未解决

当前剩14条：11条定制ChatSimpleToolResultData字段、3条HTTP请求头边界。取消命令和文件工具结果类型已补出，但权限策略和维护HTTP适配器仍未接入原扩展。当前候选中的TS7006隐式any回调诊断已清零，不代表原代码所有显式any或未检查JS都已消除。逐文件权限回调丢失未修复；完整宿主、原生资产、真实激活/GUI/MCP和新安装器仍BLOCKED。
