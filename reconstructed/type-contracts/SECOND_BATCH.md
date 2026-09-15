# 第二批：活动记录、事件存储与HTTP路由

本轮不修改提取JS、原扩展TS或实验bundle。新增3份候选声明，累计7模块；原始声明依然未找回，完整宿主依然未就绪。

## 操作顺序与证据

1. 读取bridge-activity-tracker.js、bridge-event-store.js、bridge-http-router.js的实际函数体。
2. 对照原bridge-constants.ts的BridgeActivity、bridge-tool-dispatcher.ts的pushActivity/finishActivity，以及bridge-mcp-transport.ts的事件存储工厂、HTTP处理函数。
3. 对照锁定的@modelcontextprotocol/server 2.0.0导出的EventStore/JSONRPCMessage。这里只证明与该候选SDK兼容，不证明它就是原软件依赖版本。
4. 写独立.d.ts，加入原实现和声明SHA清单，再运行合同模式诊断。没有删除原调用点来消除错误。
5. 扩充strict/noEmit/skipLibCheck:false类型夹具，再调用原JS验证有限行为。

## 三份声明怎样读

### bridge-activity-tracker.d.ts

- `T`代表UI presentation数据。类和输入、输出共用T，所以传入的具体展示结构不会丢成any。
- `BridgeActivityInput`来自原消费者：tool/status必需，message/phase/percent/todo等可选；不是靠任意字符串索引接收所有字段。
- `BridgeActivityRecord`在输入上增加生成的id/at。readonly表示消费者不应直接修改记录，不表示运行时Object.freeze或深拷贝。
- `snapshot`返回统计与时间线。尚无调用时lastTool/lastToolAt为undefined；`clear`只保留running并重置统计，返回移除数量；`reset`返回状态是否变化。
- `finish`在原扩展中只接收completed/error。原JS对重复finish仍返回true，但只有先前状态为running时才累加完成统计；因此不能把返回true解释成“首次完成”。

### bridge-event-store.d.ts

- message使用锁定SDK的JSONRPCMessage，storeEvent/replayEventsAfter为异步方法。
- send必须返回Promise<void>，与该SDK EventStore一致；严格夹具验证类实例能赋给该SDK接口。
- 这些类型约束合法调用者，不意味着JS存储函数会验证JSON-RPC结构。原实现只是保存传入对象。
- 缺失/已逐出的游标返回空字符串，不会重放全部事件；重放只包含游标所属stream的后续消息。
- send被await，失败会向调用者传播；测试不只看函数是否存在。
- SDK的getStreamIdForEventId是可选方法，原实现没有，不能为了“看起来完整”虚构一个。

### bridge-http-router.d.ts

- 参数使用Node IncomingMessage/ServerResponse，JSON正文是unknown，调用者必须做结构判断。
- Node请求头的公共类型包含string、string[]、undefined。原路由直接取headers字段，并未做统一转字符串。
- POST允许缺失sessionId（初始化场景）；GET/DELETE检查缺失，但truthy检查不能排除数组。因此三个回调的声明不能全写成string。
- 原消费者恰好要求string或string|undefined。这一不一致产生3条TS2345，位置在原bridge-mcp-transport.ts第381—383行。
- 合成EventEmitter请求对象测试了数组被POST/GET/DELETE原样转发。真实Node网络解析可能合并重复请求头；本测试**不是**真实网络攻击、鉴权绕过或可利用漏洞证明。后续需确定候选入口的拒绝/规范化规则并测试，而不是随便取数组第一个值。

## 诊断如何比较

| 模式/阶段 | 错误数 | 含义 |
|---|---:|---|
| 原JS推断基线 | 59 | `diagnose:linked-types`，保持不变 |
| 第一批4声明 | 49 | 历史提交3586853记录 |
| 当前7声明 | 39 | `diagnose:contract-types`，仍退出1 |

第二批消除13条旧诊断：1个缺失ActivitySnapshot导出、1个ActivityTracker泛型、1个EventStore实例类型、10个HTTP回调隐式any；同时暴露3个请求头实参不匹配。净减少10条，不是“13处运行时问题已修复”。

当前分类：TS2305=9、TS2339=14、TS2345=3、TS2353=1、TS2724=2、TS7006=10。报告在docs/evidence/contract-type-diagnostics.json，按固定来源哈希复现。

## 小白在普通CMD里怎么复现

先按根文档激活conda，进入仓库根目录并安装依赖。每次输入一行：

```cmd
call npm.cmd run diagnose:contract-types
echo %ERRORLEVEL%
node --test tests/bridge-core-type-contracts.test.mjs
echo %ERRORLEVEL%
```

第一条诊断应为39、false、退出1；第二条专项回归应6项通过、退出0。二者不矛盾：回归检查“如实记录尚有39条错误”，并不把类型门槛改成通过。

完整候选仍checkJs:false/skipLibCheck:true；独立声明夹具的skipLibCheck:false不覆盖整个应用实现。剩余CustomTool/Skill、取消命令、工具结果、日志回调、宿主Chat与HTTP边界继续待恢复；逐文件权限调度未修复。不能安装实验bundle或公开Bridge。

## 本轮自动CI结果

提交7c5c20fa17b195b7fa6393efc24db7d72637c592的[运行34980025558](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34980025558)已完成：Ubuntu、Windows2022、普通CMD+conda三个作业全部成功。作业/步骤API证据保存于docs/evidence/type-contract-tests.json；没有归档远端逐条完整日志。39条类型诊断仍失败，不代表实际扩展或安装器已通过。
