# web_agent 可用的 ShunCode 0.8.1 新能力 —— 整合方案

> 配套源码包：`npm run build:webagent-0-8-1-package` → `.work/downloads/shuncode-0.8.1-webagent.zip`
>
> 对照对象：web_agent 分支 `arena/01a0e8ea-web-agent` @ `cf313c1`（该仓库 `main` 是另一套较新的脚手架，
> 只有 2 次提交、`mcp/` 下仅 `server.js`，不是本方案的对照目标）。
>
> 已按用户要求**排除支付/授权**。本文只讲 web_agent 真正能用上的东西。

---

## 零、先给结论

0.8.1 的六条新产品线里，和 web_agent **正面重合**的是三条，其中第一条带确凿的"对方已中招"证据：

| 优先级 | 主题 | web_agent 现状 | 判断 |
|--------|------|----------------|------|
| **P0** | cloudflared Quick Tunnel 两个坑 | **两个都中** | 立刻修，改动极小 |
| **P1** | 出站代理可达性 | **完全没有** | 国内用户常见阻塞 |
| **P1** | 隧道启动失败错误码 | 几乎没有分类 | 可诊断性 |
| **P2** | Skills 导入（事务式） | **无导入能力** | 新增能力，想做再做 |
| **P2** | 终端 shell 契约 | Windows 走 powershell | 看你要不要统一 |
| **P3** | 无状态（modern）请求路径 | 仅 session 亲和 | 架构参考 |

另有 **4 项 web_agent 已经做得比 ShunCode 好，不要动**（见第七节）。

---

## 一、P0：cloudflared Quick Tunnel 的两个坑（web_agent 两个都中）

### 证据

web_agent `webagent-core/agent-host/src/tunnel/cloudflared.js:228`：

```js
const args = ['tunnel', '--url', target, '--no-autoupdate'];
```

ShunCode 在 0.7.7 之后踩过这两个坑，0.8.1 用 `bridge-quick-tunnel.ts` 修掉，注释里标为 "T1/T2"。

### T1：不传 `--config`，用户的 `~/.cloudflared/config.yml` 会接管你的地址

ShunCode 原话：

> without `--config`, cloudflared reads `~/.cloudflared/config.yml`. Ingress rules or a tunnel ID written
> there for another service then take over the Bridge address, and **every request is answered with 404**.

也就是说：用户只要以前为别的服务配过 cloudflared，你的隧道就会**全部 404**，而且现象极难排查——隧道"启动成功"了，URL 也拿到了，就是什么都访问不到。

web_agent 当前对 `~/.cloudflared/` 零处理（全仓库只有一处提到它，是安装提示文案）。

**修法**（ShunCode 的做法）：永远传自己的配置文件。

```
tunnel --config <自己的 yml> --no-autoupdate --url http://127.0.0.1:<port>
```

配置文件内容可以极简，ShunCode 的 `QUICK_TUNNEL_CONFIG_TEXT` 就两行有效内容：

```yaml
# Written by ShunCode for the Bridge Quick Tunnel. cloudflared is started with --config pointing here, so
# ~/.cloudflared/config.yml (ingress rules, tunnel IDs, protocol) does not apply to the Bridge address.
no-autoupdate: true
```

### T2：不传 `--protocol`，quick tunnel 只走 QUIC 且永不回退

ShunCode 原话：

> without `--protocol`, cloudflared runs quick tunnels over **QUIC only (UDP 7844) and never falls back**.

UDP 7844 在很多公司网络、校园网和部分家宽是被挡的。不回退就意味着**直接失败**，而不是慢一点。

**修法**：`--protocol auto`（QUIC 失败回退 HTTP/2 over TCP 7844）。一个参数的事。

> 注：命名隧道路径（`cloudflared.js:149`）用 `TUNNEL_TOKEN` 环境变量跑 `tunnel run`，
> 凭据来自 dashboard，T1 的 ingress 问题不适用；但 `--protocol` 同样值得加。

### 落地顺序建议

这两条加起来不到 20 行改动，**建议第一个做**，因为它们解释了一类"隧道起来了但用不了"的玄学故障。

参考文件：`original-typescript/bridge-quick-tunnel.ts`（56 行，纯函数、无 I/O、无 vscode 依赖，可以直接读懂照抄）。

---

## 二、P1：出站代理可达性（web_agent 完全没有）

web_agent 全仓库搜不到 `HTTPS_PROXY` / `HttpsProxyAgent` / `socksProxy` 的使用。ShunCode 0.8.1 在这块投了 **800+ 行**。

### 2.1 本机代理软件自动探测

`extension-host-proxy.mts`（291 → 1 107 行）里有一张表，14 个端口，每个标了客户端名：

| 端口 | 客户端 | 端口 | 客户端 |
|------|--------|------|--------|
| 7890 | Clash / Clash for Windows (mixed) | 10808 | v2rayN / sing-box SOCKS5 |
| 7897 | Clash Verge Rev / Mihomo Party | 1080 | Shadowsocks SOCKS5 |
| 10809 | v2rayN HTTP | 20809 / 20808 | NekoRay HTTP / SOCKS5 |
| 2080 | sing-box mixed | 6152 / 6153 | Surge HTTP / SOCKS5 |
| 12450 | SakuraCat HTTP | 8118 | Privoxy |
| 8888 | Fiddler / Charles | 8080 | 标准 HTTP 代理 |

配套 `detectActiveLocalProxyPorts`（并发探活）、`getCachedWorkingProxy` / `setCachedWorkingProxy`（记住哪个能用，避免每次重扫）、`shouldBypassProxy`。

**对 web_agent 的价值**：你的用户要连 OpenAI / Anthropic 一类的模型端点，国内基本都挂着上面某一个客户端。自动探测 + 记忆，比让用户手填代理地址体验好一个量级。

### 2.2 cloudflared 走代理：本地 CONNECT 中继

这是 0.8.1 最硬核的一块。问题是：**cloudflared 自己不会用 HTTP 代理连边缘节点**（原话 `cloudflared cannot use an HTTP proxy for its edge connection`）。

ShunCode 的解法（`cloudflare-edge-relay.ts`，171 行）：

1. 本地 `127.0.0.1` 起一个 TCP 服务，把 cloudflared 用 `--edge 127.0.0.1:<port>` 指过来；
2. 每条进来的连接，用 HTTP `CONNECT` 穿过用户的代理，送到 Cloudflare 边缘；
3. 目标列表先用区域名（让代理自己解析），再用两个 Cloudflare 公布的 IP 兜底——**应对那些 DNS 或域名规则会 misroute 的代理**：

```js
["region1.v2.argotunnel.com:7844", "region2.v2.argotunnel.com:7844",
 "198.41.192.7:7844", "198.41.200.53:7844"]
```

4. 启动参数配合 `--protocol http2` 且 `--edge` **写两遍**（注释解释：cloudflared 按索引把静态边缘地址拆成两个 region）。

三个值得照抄的细节：

- **只搬字节，不读内容**：`TLS still terminates at the edge and cloudflared's pinned certificates still decide`。中继不碰加密，不降低安全性。
- **日志只写边缘主机名和代理的回答，绝不写代理地址或凭据**；同一行只记一次、最多 24 行（cloudflared 会疯狂重试，否则日志会炸）。
- **区分"代理接受了 CONNECT"和"边缘真的回话了"**：代理可以接受 CONNECT 却没有到 7844 的路由，连接会在边缘回应前静默关闭。ShunCode 为这种情况单独给一句人话：
  > The HTTP proxy accepted CONNECT …, but the connection closed before the Cloudflare edge answered; the proxy's route to port 7844 is probably blocked.

### 2.3 NO_PROXY 解析

`proxy-bypass.mts`（89 行）。两个少见但正确的点：支持 `host:port` 形式；**macOS 系统旁路列表会把 IPv4 网段缩写**（`169.254/16`、`10/8`），缺的字节按 0 补。

---

## 三、P1：隧道启动失败的稳定错误码

web_agent 的 `tunnel/` 里只有一个 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`（还是 Node 自带的），失败基本靠文本。

ShunCode `bridge-start-failure.ts`（243 行）把启动失败做成**扩展与 UI 之间的契约**，约 24 个稳定码：

```
cloudflared-missing        cloudflared-install-failed   edge-unreachable
local-port-in-use          local-health-failed          network-failed
named-config-invalid       named-config-missing         named-route-mismatch
named-token-invalid        ngrok-config-invalid         ngrok-domain-invalid
ngrok-domain-missing       license-renew-failed         access-lost
cleanup-in-progress        device-unavailable           cancelled   …
```

设计纪律有三条值得抄：

1. **页面只按 `code` + `params` 渲染中文，英文原文脱敏后只作"技术详情"**——不把英文原文拼进用户文案。
2. **纯模块**：不 import vscode、不做 I/O，所以可以直接单测。
3. **有测试锁死覆盖**：文案目录必须覆盖这里每一个码，测试逐一核对。

web_agent 已经有不错的中文文案（例如 cloudflared 未安装时给出 winget 命令），**缺的是把它们挂到稳定码上**，这样 UI、日志、测试才能对齐。

另外 `bridge-ngrok-failure.js`（载体层，28 行）识别 `ERR_NGROK_334` / "endpoint is already online"，区分可重试与不可重试——web_agent 同样用 ngrok，可以直接拿。

---

## 四、P2：Skills 事务式导入（web_agent 目前没有导入）

web_agent `tools/skills.js`（198 行）只做**读取**：零 zip / extract / import / journal / migrate / backup / rollback，全仓库也没有解包实现。Skill 得用户自己放到目录里。

如果你想让 web_agent 支持"导入一个 Skill 包"，ShunCode 0.8.1 新增的 **11 个载体模块 + 1 个 UI 编排**是一套完整参考：

| 模块 | 行 | 职责 |
|------|-----|------|
| `skill-import-journal.js` | 130 | **事务日志**：导入中途崩溃可回滚 / 续做 |
| `skill-archive.js` | 123 | worker 线程解包 |
| `global-skill-import.js` | 83 | prepare → 预览 → commit 三段式 |
| `global-skill-migration.js` | 64 | 切目录时逐个校验搬迁 |
| `global-skill-paths.js` | 63 | 目录定位 + 版本化 |
| `skill-import-recovery.js` | 54 | 启动时清扫中断的导入 |
| `global-skill-catalog.js` | 34 | 加载 + 诊断 |
| `skill-fs-retry.js` | 33 | 文件操作重试（Windows 锁文件） |
| `global-skill-settings.js` | 32 | 跨工作区共享位置 |
| `skill-archive-limits.js` | 26 | **解包炸弹防护** |
| `skill-archive-detect.js` | 20 | 包格式识别 |

**三条设计纪律**（`skill-center.ts` 注释，标为 R2 §5.2）：

1. **导入是事务**：prepare（解包 + 校验 + 生成预览）→ 用户确认 → commit（带日志）。替换同名时"旧版本先备份，失败自动恢复"。**包内任何东西都不执行**（`Nothing in the package is executed`）。
2. **原目录永不修改**：迁移是事务复制 + 逐个校验，旧目录文件完好保留，新目录同名不覆盖。
3. **跨窗口竞态**：提交前后两次核对目标目录，发现另一进程改了位置就中止并提示，而不是写到错的地方。

还有两处安全细节直接可用：选目录时**拒绝工作区内部和 macOS `.app` 内部**；导入前明确告知"Skill 脚本具有当前用户权限，请仅导入信任的来源"。

> 注意：这 11 个模块是**编译产物**（类型和注释已丢失、import 未接线），只能读逻辑不能直接跑。
> 只有 `skill-center.ts` / `skill-list-tool.ts` 是作者原始 TypeScript。

---

## 五、P2：终端 shell 契约

web_agent `tools/executor.js:223`：

```js
const shell = win ? 'powershell.exe' : detectPosixShell(process.env);
```

即 **Windows 走 PowerShell，POSIX 走 bash**。这本身不错（而且 web_agent 对 PowerShell 的退出码语义、UTF-8 输出编码都写了注释，处理得很细）。

ShunCode 0.8.1 选了相反的路线：**三平台统一 Bash**，Windows 用产品自带的 PortableGit `bash.exe` + ConPTY（`managed-bash-protocol.ts`）。配套给模型的契约文字写得很硬（`bridge-agent-instructions.js`）：

> The independent run_command terminal is Bash, **NOT zsh, PowerShell or CMD**, on Linux, macOS and Windows.
> **Do not infer the shell from the host OS or the user login shell.**
> 不要把普通命令再套一层 `/bin/bash -c`、`bash -lc` 或别的 shell 字符串——多套一层会把引号、`$变量`、`$()`、反引号重新解析一遍。

**这条对 web_agent 的真正价值不在"换成 bash"**（那是大改动，且你自带 PortableGit 的成本很高），而在**那段给模型的提示词**：明确告诉模型当前是哪个 shell、不要自己套壳、不要从操作系统推断。即使你继续用 PowerShell，把这段契约按 PowerShell 改写一遍同样有用。

另外两个可以直接参考的常量：
- `bridge-task-store.js`（256 行）：任务/待办存储，上限 32 任务、8 条历史、终态保留 8 条 / 24 小时 TTL。
- `ide-tool-output.js`（55 行）：`run_command` / `get_command_output` / `cancel_command` / `send_command_input` 四个工具的结构化输出标签。

---

## 六、P3：无状态（modern）请求路径

web_agent 入站 MCP 是 session 亲和的：`mcp/server.js:101` 要求 `Mcp-Session-Id` 恰好一个 token，`:133` 没有 session 就报 `-32001`。

ShunCode 0.8.1 并行引入了一条"2026-07-28（modern）"无状态路径（`bridge-mcp-modern.ts`）：

> 2025 连接用发起方的 MCP session；**无状态的 2026 请求**改用稳定的"凭据 / 客户端 / 工作区"三元组身份，
> 于是后续请求凭同一身份仍能轮询、送输入、取消。

- 身份摘要：`sha256(JSON.stringify(identity))`，前缀 `modern:` / `task-modern:` 区分命令 owner 与任务 owner。
- 新错误码 `COMMAND_NOT_ACCESSIBLE`：句柄对该 owner 不可用，**不要绕过作用域，也不要盲目重跑命令**。
- `timeout_ms` 返回 `status=running` **不杀进程**，继续用 `get_command_output` + `next_offset` 拉。

**这条优先级最低**，因为它是架构选择不是缺陷修复。但如果你以后要支持"无状态客户端也能跑长命令"，这是现成的设计。

---

## 七、web_agent 已经更强 / 不要动的 4 项

上一轮我犯过"先假设对方缺失再找证据"的错，这次先反向核过：

1. **凭据走环境变量而非 argv**（`cloudflared.js:146-149`，标注 F100）——token 用 `TUNNEL_TOKEN` 传，注释写明原因：`--token <tok>` 会被本机任何用户在 ps / tasklist / 任务管理器里看到，还会过一遍 `cmd.exe` 解析。配套 `createTokenRedactor` 对 stdout/stderr 脱敏。**ShunCode 没有这层考虑，这点 web_agent 做得更好。**
2. **隧道残留治理**：`tunnelRegistry.js`(160) + `tunnelCleanup.js`(111) + `processIdentity.js`(62) + `receiptProtection.js`(50) + `residueNotice.js`(42)，还有 `.ps1` / `.cs` 辅助。ShunCode 有 `bridge-tunnel-lease.ts`(511) 做跨窗口租约和 `reclaimStaleTunnelOwner`，但**残留进程的识别与清理没有 web_agent 这么系统**。
3. **凭据脱敏覆盖面**：web_agent 19 个文件涉及脱敏，ShunCode 5 个。
4. **PowerShell 细节处理**：退出码语义（`-Command` 以最后一条语句的状态退出）、输出编码，`executor.js` 都写了注释处理过。

---

## 八、给对方助手的提示词

> 连同 `shuncode-0.8.1-webagent.zip` 一起发给 web_agent 项目的助手。

## ✂️ 从这里开始复制 ✂️

我在 web_agent 项目上工作（分支 `arena/01a0e8ea-web-agent`）。另一个项目逆向恢复了 ShunCode 0.8.1
的源码，从中整理出一份本项目可用的优化清单。附件 `shuncode-0.8.1-webagent.zip` 是相关参考源码，
分 `original-typescript/`（作者原始 TypeScript，类型和注释完整）和 `recovered-from-bundle/`
（编译产物，类型和注释已丢失、import 未接线，**只能读逻辑，不能直接运行**）两个目录。

请按下面的顺序做，每做完一项停下来让我确认。

**第 1 项（最优先，改动很小）：修 cloudflared Quick Tunnel 的两个已知坑。**
当前 `webagent-core/agent-host/src/tunnel/cloudflared.js:228` 是：
`const args = ['tunnel', '--url', target, '--no-autoupdate'];`
两个问题：
(a) 不传 `--config`，cloudflared 会读 `~/.cloudflared/config.yml`，用户以前为别的服务写的 ingress
规则或 tunnel ID 会接管这个地址，表现为**隧道启动成功但所有请求 404**。修法：生成并始终传入我们
自己的最小配置文件（内容可只有 `no-autoupdate: true`）。
(b) 不传 `--protocol`，quick tunnel 只走 QUIC（UDP 7844）且**永不回退**，在屏蔽 UDP 的网络下直接失败。
修法：加 `--protocol auto`。
参考 `original-typescript/bridge-quick-tunnel.ts`（纯函数，56 行，含 `quickTunnelArgs`
和配置文件模板）。命名隧道路径（:149）也建议加 `--protocol`。

**第 2 项：隧道启动失败的稳定错误码。**
现在 `tunnel/` 基本没有错误分类。参考 `original-typescript/bridge-start-failure.ts`，
给启动失败定义一组稳定码（如 `cloudflared-missing` / `edge-unreachable` / `local-port-in-use` /
`ngrok-domain-invalid` / `cleanup-in-progress`），要求：纯模块不做 I/O 便于单测；UI 只按 code 渲染
中文；英文原文脱敏后只放"技术详情"。现有的中文提示文案不要丢，挂到对应 code 上即可。
ngrok 侧可参考 `recovered-from-bundle/bridge-ngrok-failure.js`（识别 `ERR_NGROK_334` /
"endpoint is already online"，区分可重试与不可重试）。

**第 3 项：出站代理支持。** 本项目目前完全没有代理处理。
(a) 本机代理自动探测：参考 `original-typescript/extension-host-proxy.mts` 里的
`CANDIDATE_LOCAL_PROXY_PORTS`（14 个端口，覆盖 Clash 7890/7897、v2rayN 10809/10808、
sing-box 2080、NekoRay 20809/20808、Surge 6152/6153、Privoxy 8118 等），并发探活 + 缓存可用项。
(b) NO_PROXY 解析参考 `original-typescript/proxy-bypass.mts`（注意它支持 `host:port`，
并处理 macOS 的缩写网段写法如 `169.254/16`）。
(c) 如果要让 cloudflared 也能走代理：cloudflared 自身不支持 HTTP 代理连边缘，参考
`original-typescript/cloudflare-edge-relay.ts` 的本地 CONNECT 中继方案（`--protocol http2` +
`--edge 127.0.0.1:<port>` 写两遍）。这一项工作量较大，可以放到 (a)(b) 之后再评估。

**第 4 项（可选，新增能力）：Skills 事务式导入。**
当前 `tools/skills.js` 只有读取，没有导入/解包。如果要加，参考 `recovered-from-bundle/` 下的
`skill-import-journal.js`、`skill-archive.js`、`skill-archive-limits.js`、
`global-skill-import.js`、`skill-import-recovery.js`、`skill-fs-retry.js` 等，核心纪律三条：
导入是事务（prepare → 用户确认 → 带日志的 commit，替换时旧版先备份、失败自动恢复）；
原目录永不修改；**包内任何东西都不执行**。另注意解包炸弹防护和"拒绝把全局目录选在工作区内部”。

**第 5 项（可选）：给模型的 shell 契约提示词。**
参考 `recovered-from-bundle/bridge-agent-instructions.js`。要点：明确告诉模型当前终端是哪个 shell、
不要从操作系统推断、不要把普通命令再套一层 `bash -lc` / `-Command` 字符串（会重新解析引号和变量）。
本项目 Windows 用 PowerShell，所以照抄时要改写成 PowerShell 口径，不要直接套用它的 Bash 说法。

**明确不要动的（这些地方本项目已经比 ShunCode 更好）：**
- `cloudflared.js` 用 `TUNNEL_TOKEN` 环境变量传凭据而不是 `--token` argv，以及 `createTokenRedactor`
  日志脱敏 —— 保持现状，ShunCode 没有这层防护。
- `tunnelRegistry.js` / `tunnelCleanup.js` / `processIdentity.js` / `receiptProtection.js` /
  `residueNotice.js` 这套隧道残留治理 —— 比 ShunCode 系统，保持现状。
- `executor.js` 里 PowerShell 退出码语义和输出编码的处理 —— 保持现状。

做完每一项请给出：改了哪些文件、怎么验证的、哪些没做到以及为什么。
不确定的地方直接说不确定，不要猜。参考源码里的常量和思路可以抄，但**不要直接复制文件**——
它们来自 VS Code 分支，import 的载体本项目没有。

## ✂️ 复制到这里结束 ✂️

---

## 九、复核方式

```bash
# 本文对 web_agent 的每条断言都可复现（需先克隆对方仓库）
git clone https://github.com/cccjvav/web_agent.git /tmp/wa
cd /tmp/wa && git checkout origin/arena/01a0e8ea-web-agent
S=webagent-core/agent-host/src

sed -n '228p' $S/tunnel/cloudflared.js          # 缺 --config / --protocol
grep -rc "zip\|extract" $S/tools/skills.js      # 0 → 无导入能力
grep -rl "HTTPS_PROXY\|HttpsProxyAgent" $S/     # 空 → 无代理支持
sed -n '223p' $S/tools/executor.js              # Windows 走 powershell
sed -n '146,149p' $S/tunnel/cloudflared.js      # F100 token 走 env（做得比 ShunCode 好）

# ShunCode 侧
R=/path/to/Reverse_enginnering_of_shun/recovered/shuncode-0.8.1/src
sed -n '1,12p' $R/bridge-quick-tunnel.ts        # T1/T2 原文
grep -A16 CANDIDATE_LOCAL_PROXY_PORTS $R/extension-host-proxy.mts
```
