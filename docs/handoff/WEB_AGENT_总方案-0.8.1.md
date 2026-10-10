# web_agent 可从 ShunCode 0.8.1 移植的全部事项 —— 总表

> **这是总入口。** 之前分两次给的两份方案（外部 MCP 一份、隧道/Skills/终端一份）
> 合并在这里，去重后共 **23 项**，每项都写清**好处**（不做会怎样、做了得到什么）。
>
> 配套源码包：`npm run build:webagent-0-8-1-package`
> → `.work/downloads/shuncode-0.8.1-webagent.zip`（**45 份源码 / 6 496 行，已含两份旧方案引用的全部文件**，
> 取代更早的 `shuncode-0.8.1-mcp-skills.zip`）。
>
> 对照对象：web_agent 分支 `arena/01a0e8ea-web-agent` @ `cf313c1`。
> 已按要求**排除支付/授权**（第六节单独说明为什么排除、以及唯一值得单独看的一条）。
>
> **本文只覆盖"补差距"这条线（你缺什么、ShunCode 有什么）。**
> 另有一条线是**从 ShunCode 的实现方法论出发、针对 web_agent 自己架构**的 8 项优化（N1–N8），
> 其中多数 ShunCode 并无对应功能——见 `方法论优化.md`。两条线互补，建议一起读。

---

## 一、总表（23 项，按"先做什么"排序）

**性质**一栏的含义：
- `连不上` = 不做就有一整类第三方服务 / 网络环境用不了
- `跑不起来` = 功能在部分用户机器上直接失败
- `诊断不了` = 能用，但出问题时用户和你都看不出原因
- `新能力` = 现在没有，做了是新增功能
- `预防` = 现在不受影响，等你加了某个功能才需要

| # | 事项 | **好处（不做会怎样 → 做了得到什么）** | 性质 | 成本 | 参考源码 |
|---|------|------|------|------|----------|
| **14** | Quick Tunnel 加 `--config` | 用户以前为别的服务配过 cloudflared → **隧道"启动成功"但所有请求 404**，且极难排查。加了之后用户的 `~/.cloudflared/config.yml` 完全不影响你 | 跑不起来 | **极小** | `bridge-quick-tunnel.ts` |
| **15** | Quick Tunnel 加 `--protocol auto` | 公司网/校园网挡 UDP 7844 → **直接失败且永不回退**。加了之后自动退到 TCP 上的 HTTP/2 | 跑不起来 | **极小** | 同上 |
| 1 | 出站 OAuth（DCR + PKCE + 刷新） | 现在只认手工粘贴的静态 token → **凡是要求 OAuth 的第三方 MCP 服务器一个都连不上**。做了之后这一整类服务可用 | 连不上 | 大 | `external-mcp-oauth-flow.ts` |
| 2 | 子进程环境白名单补 13 项 | 缺 `HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` → **npx/uvx/pip/git 系 MCP 服务器找不到缓存和配置而启动失败**。补上即可 | 跑不起来 | **很小** | `external-mcp-stdio-env.ts` |
| 3 | 传输协商与受限降级 | 服务器只支持 SSE 时连不上；盲目降级又会在认证/限流错误上误判。做了之后覆盖两类服务器且不误降级 | 连不上 | 小 | `external-mcp-connection.ts:31-33,88` |
| 4 | 自定义 CA 证书 | 企业自签根证书环境下 **全部 HTTPS 外部 MCP 不可用**。做了之后企业内网可用 | 连不上 | 小–中 | `external-mcp-network.ts` |
| **16** | 本地代理自动探测（14 个端口） | 用户挂着 Clash/v2rayN/sing-box 却要手填代理地址，填错就连不上模型端点。做了之后开箱即连，且记住哪个能用 | 连不上 | 中 | `extension-host-proxy.mts` |
| **17** | NO_PROXY 解析 | 内网地址被错误地走了代理 → 内网服务连不上。做了之后旁路规则正确（含 `host:port` 与 macOS 缩写网段） | 连不上 | 小 | `proxy-bypass.mts` |
| **18** | 隧道启动失败错误码 | 现在 `tunnel/` 只有一个 Node 自带 `ERR_`，失败只能看日志猜。做了之后 UI、日志、测试对齐到约 24 个稳定码 | 诊断不了 | 中 | `bridge-start-failure.ts` |
| **19** | ngrok 错误分类 | `ERR_NGROK_334`（端点已在线）被当成普通失败反复重试。做了之后区分可重试与不可重试 | 诊断不了 | **很小** | `bridge-ngrok-failure.js` |
| 5 | 网络错误九分类 | 现在按消息正则判**工具**错误，不覆盖网络层 → 用户只看到"连接失败"。做了之后能说出"你把 SOCKS 端口当 HTTP 用了" | 诊断不了 | 小 | `external-mcp-network-errors.js` |
| 6 | 分阶段网络诊断 | 出问题时无法定位卡在哪一层。做了之后 `route→dns→tcp→tls→http` 逐段报告，且**全程不带凭据** | 诊断不了 | 中 | `external-mcp-diagnose.ts` |
| 7 | 状态词表 4 → 8 | 缺 `needs-auth`/`proxy-error` → **用户该做的事完全不同却显示同一个状态** | 诊断不了 | **很小** | `external-mcp-status.ts` |
| 8 | 技能失败原因码 + 修复建议 | 技能不生效时没有原因码，用户不知道改什么 | 诊断不了 | **很小** | `custom-tool-skill.js` |
| 9 | 出站协议版本升到 `2025-06-18` | 停在 `2025-03-26` 拿不到受保护资源元数据（与 OAuth 发现直接相关）。**改一行** | 诊断不了 | **极小** | `external-mcp-oauth-flow.ts:188` |
| **23** | 模型 Base URL 归一化 | 用户粘贴带 `/chat/completions` 或重复 `/v1` 的地址 → 请求 404，用户以为是 key 错了。做了之后自动纠正（含 DeepSeek 特判） | 诊断不了 | **很小** | `model-endpoint-url.mts` |
| **20** | Skills 事务式导入 | 现在只能让用户手工把文件夹放进目录；没有导入、没有校验、没有回滚 | 新能力 | 大 | 11 个 `skill-*`/`global-skill-*` 模块 |
| **21** | 给模型的 shell 契约 | 模型会把命令再套一层 `bash -lc`/`-Command`，引号和 `$变量` 被重新解析而出错 | 新能力 | **很小** | `bridge-agent-instructions.js` |
| **22** | 无状态（modern）请求路径 | 无状态客户端（无 `Mcp-Session-Id`）跑不了长命令 | 新能力 | 中 | `bridge-mcp-modern.ts` |
| 10 | 保留头保护 | 等你支持自定义 header 后，用户填 `Host`/`Mcp-Session-Id` 会破坏会话，填 `Proxy-Authorization` 会把凭据泄漏给代理 | 预防 | 小 | `external-mcp-secret-fields.ts` |
| 11 | 字段数量与长度上限 | 同上，防止超大 header 拖垮连接 | 预防 | **很小** | 同上 |
| 12 | 确认令牌用随机 HMAC 密钥 | 若用"哈希输入"做确认令牌，而输入含凭据 → **令牌本身成了凭据预言机** | 预防 | 小 | `external-mcp-preview-token.ts` |
| 13 | 配置按引用传递 | 凭据在进程间以明文配置传来传去。改成内存引用（TTL 5 分钟、最多 10 条） | 预防 | 小 | `external-mcp-native-refs.ts` |

### 建议的执行顺序

1. **先做 14、15、2、9、7、19、23** —— 全是"极小/很小"成本，合计大概半天，但直接消灭几类"玄学故障"。
2. **再做 18、5** —— 把失败变成可读的码和话，后面所有排查都受益。
3. **然后 16、17、4** —— 网络环境适配，受益人群最大（国内用户 + 企业内网）。
4. **1（出站 OAuth）单独排期** —— 价值最高但工作量最大，建议独立一轮。
5. **3、6、22、20** —— 按你的产品节奏挑。
6. **10–13 等你真的加了自定义 header / 凭据 UI 再做**，现在做是提前优化。

---

## 二、明确不要动的 13 项（web_agent 已经比 ShunCode 强）

两轮反向搜证的结果。**提示词里也写进去了**，免得对方助手"顺手优化"掉。

| 能力 | web_agent | ShunCode 0.8.1 |
|------|-----------|----------------|
| 危险环境键黑名单（`LD_`/`NODE_`/`BASH_ENV`/`DYLD_`…） | 有 | **无**（只校验变量名形状，且用户 env always wins） |
| 技能分页读取（`expectedHash` 续读、`E_STALE_FILE`、文本扩展名白名单） | 有 | **无**（整文件读） |
| MCP resources | 有 | 无 |
| 预算 / 配额（`budget.js`） | 有 | 无 |
| 入站 OAuth 速率限制 | 有 | 无 |
| 操作员逐次审批（外部工具 `requiresApproval: true`） | 有 | 无 |
| SSRF 防护 | 有 | 无 |
| 会话头严格校验（1–512 可见 ASCII、禁逗号、拒合并串） | 有 | 无 |
| 256 KiB 上限 + `redirect:'error'` + `fatal:true` UTF-8 | 有 | 无 |
| **凭据走环境变量而非 argv**（`TUNNEL_TOKEN`，F100）+ 日志脱敏 | 有 | **无** |
| 隧道残留治理（`tunnelRegistry`/`tunnelCleanup`/`processIdentity`/`receiptProtection`/`residueNotice`） | 有（5 文件 425 行） | 部分（`bridge-tunnel-lease.ts` 只管租约） |
| 凭据脱敏覆盖面 | 19 个文件 | 5 个文件 |
| PowerShell 退出码语义与输出编码处理 | 有 | 不适用（ShunCode 统一用 Bash） |

---

## 三、两处"移植时必须连带的约束"

这两条是**抄的时候最容易漏、漏了就有害**的地方：

1. **抄环境白名单时，不要连 `COMSPEC` 一起抄。** ShunCode 的 25 项里有 `COMSPEC`，但 web_agent `stdioLaunch.js:18` 的保护正则是**故意**拦它的。建议只补 13 项，并**保留你自己的危险键黑名单**——ShunCode 没有这层防护，抄反了是降级。
2. **抄传输降级时，价值在约束不在降级。** ShunCode 只在 400/404/405/406/415 降级，源码注释原话：`never on authentication/rate-limit/server/network errors`。只抄"会降级"不抄"什么时候绝不降级"，会把认证失败误判成协议不兼容。

---

## 四、每项的详细说明在哪

本文件只给总表和好处。展开说明分别在：

| 内容 | 文件 |
|------|------|
| **另一条线：从 ShunCode 的「做法」提炼、针对 web_agent 架构的 8 项优化（N1–N8）** | **`WEB_AGENT_方法论优化-0.8.1.md`（随包，包内名 `方法论优化.md`）** |
| 第 1–13 项（外部 MCP 与 Skills）的逐项展开 | `WEB_AGENT_MCP_SKILLS_PLAN.md`（随包） |
| 第 14–23 项（隧道/代理/终端/无状态）的逐项展开 | `WEB_AGENT_0.8.1_整合方案.md`（随包） |
| 0.8.1 相对 0.7.4 的完整改动清单（含不适用于 web_agent 的部分） | `0.8.1-全部新增功能清单.md` |

---

## 五、给对方助手的提示词（总）

> 这段是**总入口**，连同 `shuncode-0.8.1-webagent.zip` 一起发。
> 包里另有两份逐项展开的方案，对方助手按需要自己翻。

## ✂️ 从这里开始复制 ✂️

我在 web_agent 项目上工作（分支 `arena/01a0e8ea-web-agent`）。另一个项目逆向恢复了 ShunCode 0.8.1
的源码，整理出 23 项本项目可以移植的改进。附件 `shuncode-0.8.1-webagent.zip` 里有：

- `总表.md` —— 23 项的优先级、好处、成本、对应参考文件（**先读这个**）
- `方案-外部MCP与Skills.md` —— 第 1–13 项的逐项展开
- `方案-隧道代理终端.md` —— 第 14–23 项的逐项展开
- `original-typescript/` —— 作者原始 TypeScript，类型和注释完整
- `recovered-from-bundle/` —— 编译产物，类型和注释已丢失、import 未接线，**只能读逻辑，不能运行**

请按 `总表.md` 里"建议的执行顺序"做，**每完成一组停下来让我确认**，不要一次做完。

第一组（成本极小，优先做完）：
- 第 14、15 项：`tunnel/cloudflared.js:228` 现在是
  `['tunnel','--url',target,'--no-autoupdate']`，缺 `--config` 和 `--protocol`。
  不传 `--config`，cloudflared 会读 `~/.cloudflared/config.yml`，用户给别的服务写的 ingress
  规则会接管地址，表现为**隧道启动成功但所有请求 404**；不传 `--protocol`，quick tunnel
  只走 QUIC（UDP 7844）**且永不回退**。参考 `original-typescript/bridge-quick-tunnel.ts`。
- 第 2 项：`mcp/stdioLaunch.js:10` 的 `BASE_ENV` 只有 11 项，补上
  `HOME USERPROFILE APPDATA LOCALAPPDATA HOMEDRIVE HOMEPATH PROGRAMDATA PROGRAMFILES`
  `PROGRAMFILES(X86) LOGNAME USER SHELL PROCESSOR_ARCHITECTURE` 共 13 项。
  **不要补 `COMSPEC`**（第 18 行的保护正则是故意拦它的），
  **也不要删掉你现有的危险键黑名单**——ShunCode 没有那层防护，抄反了是降级。
- 第 9 项：`mcp/externalClient.js:164` 出站协议版本 `2025-03-26` 改 `2025-06-18`。
- 第 7 项：状态词表从 4 个扩到 8 个，至少补 `needs-auth` 和 `proxy-error`。
- 第 19、23 项：见总表。

做完每一项请给出：改了哪些文件、怎么验证的、哪些没做到以及为什么。
不确定的地方直接说不确定，不要猜。

**另外有 13 项本项目已经比 ShunCode 做得好，明确不要改**（总表第二节有完整列表），
其中最容易被误"优化"掉的是：stdio 危险环境键黑名单、`cloudflared.js` 用 `TUNNEL_TOKEN`
环境变量而非 `--token` argv 传凭据、技能分页读取、隧道残留治理那一套。

参考源码里的常量和思路可以抄，但**不要直接复制文件**——它们来自 VS Code 分支，
import 的载体本项目没有。

## ✂️ 复制到这里结束 ✂️

---

## 六、为什么排除支付

你说过支付这块不需要，所以 23 项里没有它。补充两点，免得以后找不到：

- 支付/授权的完整分析在 `0.8.1-全部新增功能清单.md` 第五节，源码在
  `recovered/shuncode-0.8.1/src/bridge-payment-network.mts`、`bridge-license-network-policy.mts`、
  `bridge-license-service.ts`。那套东西是给 **ShunCode 自己收费**用的，web_agent 用不上。
- 唯一与 web_agent 有关、值得单独记一笔的是那条纪律：**读探测可以多路竞速，写操作（下单）
  只在胜出的那条发一次；结果不确定时宁可报"不确定"也不自动重发。** 这条适用于任何
  "重复执行会产生副作用"的请求，不限于支付。如果 web_agent 以后有这类操作，回头看
  `bridge-payment-network.mts` 的 `sendPaymentOnce`。
