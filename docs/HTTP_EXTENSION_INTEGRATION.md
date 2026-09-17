# HTTP维护适配器：从孤立模块接到实验扩展

**当前总状态仍NOT_READY。** 本轮完成的是HTTP边界的源码接入和本机隔离协议验证，不是GUI、真实文件授权、远程客户端或完整Windows安装器验收。

> 后续新增[公共Chat文本回退变体](PORTABLE_CHAT_INTEGRATION.md)：单独模式候选类型0条，不改变本文HTTP模式11条结论。最新发布审计选择该回退变体，整体仍NOT_READY。

## 1. 三种检查模式，不再混为一谈

| 模式 | 命令 | 当前类型结果 | 原因 |
|---|---|---:|---|
| 原JS推断基线 | `npm.cmd run diagnose:linked-types` | 59错误 | 保留历史推断基线 |
| 原路由+14份候选契约 | `npm.cmd run diagnose:contract-types` | 14错误 | 11条Chat字段+3条原HTTP边界 |
| HTTP维护接入实验 | `npm.cmd run diagnose:http-types` | 11错误 | 三条HTTP边界由实际适配器解决，Chat宿主仍待确认 |

三者当前都退出1。不是删除原报错源文件或给公共宿主声明乱加字段。

## 2. 实际接入了哪里

原`bridge-mcp-transport.ts`引用`../../../src/bridge-http-router.js`。默认构建继续映射到原貌重建路由。HTTP维护模式只改变这个明确的共享导入目标，使它指向`community/bridge-core/http-router.mjs`。

维护适配器调用原路由，但在请求入口检查重复/数组协议头，并在真正调用POST/GET/DELETE处理函数时再次检查参数是否是单值字符串。第二次检查避免仅靠初次读取作类型承诺。

对应新声明`http-router.d.mts`只承诺实际已实现的单值边界，JSDoc和`http-router-types.d.ts`描述回调形状。独立测试用strict、checkJs:true、skipLibCheck:false检查**维护适配器的JS函数体及声明**；原路由以已有候选声明作边界，不冒称整个原JS工程已严格检查。

共同来源清单记录维护JS、两份声明和原路由SHA。构建和诊断都调用`http_maintenance_inputs.mjs`，先核对精确文件白名单、哈希及原core来源，再解析。这避免“类型检查用修正版、打包却仍用原版”的错位。

未修改原51文件、原路由JS、锁定SDK版本、去商业化策略或已发布overlay。新的文件授权调度器尚未接入，不顺手默认放开权限。

## 3. 两份扩展实验产物分开保存

| 项目 | 原实验构建 | HTTP维护变体 |
|---|---|---|
| 输出 | `.work/linked-extension/dist/extension.cjs` | `.work/http-linked-extension/dist/extension.cjs` |
| 一方输入数 | 73 | 74（新增维护路由） |
| 共享连接 | 31 | 31，其中HTTP导入改向维护路由 |
| 商业策略替换 | 2 | 2，不变 |
| 字节数 | 1,673,367 | 1,675,648 |
| 证据 | linked-extension.json | http-linked-extension.json |

两份都不是完整扩展包或安装器，均不得覆盖主力安装。原实验哈希仍为c97853579b4b9fab7f27f3647f41b19bdfb32c4f424af6be22db3b5378703a00。新变体哈希见同提交的docs/evidence/http-linked-extension.json；应比对完整64位SHA，不只看文件大小。

## 4. 本轮协议测试到底运行了什么

测试调用同一个构建器，从原`BridgeMcpTransport`源文件生成独立传输层夹具，使用同一HTTP接入方式、原注册逻辑和锁定`@modelcontextprotocol/server`/`node` 2.0.0。不是手写一个总返回成功的HTTP假服务器，也没有加载完整VS Code扩展。

夹具绑定回环地址、不创建公网隧道；宿主日志/会话回调只在内存记录，`dispatchToolCall`是明确的惰性替身，固定返回INERT_FIXTURE_NO_FILE_ACCESS，**不会读取文件或执行命令**。客户端是测试内Node HTTP协议请求，不是Inspector或第三方远端客户端。

已实际验证传统MCP协议2025-11-25：

1. initialize协商成功，真实SDK返回shuncode-bridge身份和会话头。
2. initialized通知、tools/list成功，清单来自原工具注册逻辑。
3. 重复协议头400，错误路由令牌404；两者都没有到达工具替身。
4. 合法tools/call经原传输层到达替身，收到绑定该会话的`bridge:` owner。
5. 建立第二会话，两个owner不同；删除第一会话后，它的旧ID请求404，第二会话仍可列工具。
6. 关闭监听和全部会话后，状态回到非监听、无端口、会话数0。

没有验证真实文件权限、任务ID归属、模型响应、现代无状态协议、公网隧道、令牌轮换、GUI与双宿主激活。不能直接拿这些组件结果填写完整产品C阶段PASS。

另有合成请求测试：初次读取session头为字符串、后续变成数组时，最终回调检查仍拒绝，不把这个合成边界测试说成真实网络漏洞。

## 5. 小白按普通CMD复现

先按WINDOWS_CMD_CONDA.md激活conda，进入仓库根目录并安装锁定依赖。每次一行：

```cmd
call npm.cmd run build:http-extension
echo %ERRORLEVEL%
call npm.cmd run check:http-extension
echo %ERRORLEVEL%
call npm.cmd run diagnose:http-types
echo %ERRORLEVEL%
node --test tests/bridge-core-http-linkage.test.mjs
echo %ERRORLEVEL%
call npm.cmd run check:release
echo %ERRORLEVEL%
```

预期：构建/一致性检查0；类型11条、退出1；HTTP专项5项通过、退出0；发布门槛NOT_READY、退出2。测试只在本机临时启动回环服务，结束后清理；不要求配置账号、模型Key、隧道或主力应用。

构建器另外支持测试专用的transportOnly API，用来运行上述独立传输层，不作为用户安装产物。该API必须同时启用HTTP维护模式，否则明确拒绝。扩展变体的`extensionLoaded:false`不能因为传输夹具运行成功而改成true。

## 6. 下一道真实门槛

- 新HTTP变体剩11条定制Chat字段诊断，不能用模拟宿主字段冒充原Workbench已实现。
- 文件授权调度器仍需接入当前会话和宿主确认，不能把惰性工具测试换成任意允许。
- 原生资产/ABI、真实扩展激活、GUI/MCP和安装器仍需完整候选及实机证据。

发布检查现在审核HTTP维护变体，记录httpSourceIntegrated:true，但HTTP的整机验收门槛仍BLOCKED；源码接入与产品验收是两件事。

## 本轮最终回归

本地Node138项通过、Python31项通过（另3项Windows专属本地跳过）。提交7680b458db21eb5efd84eacd97d141e5b50d5a11的[运行35036955654](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/35036955654)中，Ubuntu、Windows2022、普通CMD+conda三个作业全部成功。作业/步骤API证据在docs/evidence/http-integration-tests.json，未归档完整远端逐项日志。CI绿色不改变11条类型失败和NOT_READY的产品结论。
