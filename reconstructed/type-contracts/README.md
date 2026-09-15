# 第一批可追溯的候选类型契约

这些是**新重建的声明**，不是找回原始.d.ts，更不是已经恢复完整宿主。只改变候选类型解析，不改41个提取JS模块、原51文件或实验bundle。原JavaScript依然未受TypeScript实现级检查，声明不能替代实现验证。

## 普通Windows CMD中运行

先按仓库CMD+conda指南激活环境、安装锁定依赖，在仓库根目录逐行运行：

```cmd
call npm.cmd run diagnose:linked-types
echo %ERRORLEVEL%
call npm.cmd run diagnose:contract-types
echo %ERRORLEVEL%
```

第一条是旧的JS推断基线：59错误、退出1；第二条启用四份候选声明：49错误、退出1。两者都没有通过产品类型门槛。新报告是docs/evidence/contract-type-diagnostics.json，不覆盖旧报告。不要因为错误减少就执行安装或开放Bridge。

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

provenance.json记录每份声明及对应实现的SHA256。诊断器先将实现哈希与原core来源清单交叉核对，再校验实际文件与声明哈希，然后仅对四个明确模块重定向解析；其他模块仍按旧方式解析。新增报告携带这份映射。

新增tests/bridge-core-type-contracts.test.mjs：

1. 复现49条剩余错误，并确认宿主字段错误仍存在。
2. 用strict、noEmit、**skipLibCheck:false**检查独立类型夹具和声明本身；@ts-expect-error负例必须真的出错，否则测试失败。包括错误构造参数、返回值错配、缺采样字段、null ID、不完整会话及未处理get缺失。
3. 直接调用提取JS，核对同步/异步泛型返回、释放幂等、决策、ID联合分支和会话删除回调的实际结果。

这三项只提供有限合同证据，不证明所有JS分支均符合声明；完整候选诊断仍沿用原strict/noEmit/allowJs/checkJs:false/skipLibCheck:true设置，不能把独立声明测试冒充全工程严格实现检查。

## 尚未解决

49条仍包含缺失CustomTool/Skill等接口、ActivityTracker泛型、EventStore实例类型、HTTP/日志回调，以及定制ChatSimpleToolResultData字段。逐文件权限回调丢失未修复；完整宿主、原生资产、真实激活/GUI/MCP和新安装器仍BLOCKED。
