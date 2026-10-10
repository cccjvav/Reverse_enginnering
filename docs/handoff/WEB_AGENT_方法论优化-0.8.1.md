# 基于 ShunCode 实现方法论的 web_agent 优化提案

> 前面三份文档（总表 23 项）回答的是**"web_agent 缺什么、ShunCode 有什么"**——补差距。
>
> 这份不一样。它从 ShunCode 0.8.1 源码里反复出现的**做法本身**提炼方法，
> 再回到 web_agent 自己的架构上找落点。**这里的 8 项，ShunCode 大多没有对应功能**，
> 是把它的思路用在 web_agent 特有的问题上。
>
> 对照对象：web_agent 分支 `arena/01a0e8ea-web-agent` @ `cf313c1`。

---

## 零、先说 web_agent 已经做对的（这些是提案的地基，不是客套）

读完 `agent-host/src` 约 13 700 行之后，下面这些是**已经达到或超过 ShunCode 水平**的设计，
后面的提案都建立在它们之上：

| 已有设计 | 位置 | 评价 |
|---|---|---|
| `ProtocolError` / `ExecutionError` 双层错误，带 `layer`+`code`+`detail` | `mcp/errors.js` | 分层比 ShunCode 清楚 |
| **51 个 `E_` 稳定码** | 全项目 | 数量和粒度都够 |
| `atomicWriteText`（临时文件 + rename，exclusive 用 hard link）+ `withWriteLock` | `tools/patchEngine.js:22` | 单文件原子性到位 |
| `revisionKey()` 指纹（saves + 工作区根 + size/mtimeNs/inode） | `models/store.js:98-110` | 与 ShunCode 的设置指纹同级 |
| **约束式重试**：先把响应体分类，上下文溢出/密钥失效/模型不存在**不重试** | `agent/openai.js:303-307`（F103） | 与 ShunCode"绝不在认证/限流错误上降级"同一纪律 |
| `operatorQueue` 的硬上限（256 KiB 结果 / 32 KiB 输入 / 15 分钟 / 40 任务） | `utils/operatorQueue.js:6` | 有界设计 |
| 文档诚实标注能力边界（"不进行多文件事务""dryRun 不证明之后提交时文件仍未变"） | `tools/补丁与路径详解.md` | 这点比多数项目强 |

**提案不会动上面任何一条。**

---

## 一、提炼出的 8 条方法，和它们在 web_agent 的落点

| # | ShunCode 的方法 | web_agent 落点 | 价值 | 成本 |
|---|---|---|---|---|
| N1 | 错误码在**源头**产生，不在下游用消息正则反推 | `classifyToolError` 19 行里有 12 条消息正则 | **高** | 中（可渐进） |
| N2 | 给模型**显式**写明终端契约 | `run_command` 描述不说是哪个 shell，别名 `bash→run_command` 还会误导 | **高** | **极小** |
| N3 | 分阶段 + **凭据无关**的诊断 | 模型端点连不上时只有一个 HTTP 错 | 高 | 中 |
| N4 | 超时预算集中成**版本化冻结表** | 16 处散落的 timeout 字面量 | 中 | 小 |
| N5 | 多步变更用 **journal + 可恢复** | 明确"不进行多文件事务" | 中 | 大（可选） |
| N6 | 自带依赖，**缺失 = 打包错误**而非用户问题 | 依赖用户自行安装 cloudflared/ngrok | 中 | 中 |
| N7 | 日志**去重** + 只记安全字段 | 有脱敏（3 文件）但无去重 | 低 | **极小** |
| N8 | 指纹变化 → 失效**并重连**；需重启的单独提示 | 已有指纹，但只用于"提示重读" | 低 | 小 |

---

## N1. 错误码必须在源头产生（最值得做的结构性改进）

### ShunCode 的做法

两处独立体现同一条原则：

- `bridge-start-failure.ts` 开头就写明：错误码是**扩展与 workbench 之间的契约**，
  "页面只按 code / params 渲染中文；英文原文脱敏后只作「技术详情」"，
  而且 workbench 侧文案目录**必须覆盖这里每一个码，测试逐一核对**。
- `external-mcp-network-errors.js` 分九类，**依据是错误码集合**（`ENOTFOUND`、`UND_ERR_PROXY_TUNNEL`…），
  沿 `cause` 链找 4 层，**完全不看消息文本**。

共同点：**码由抛出点决定，不由读取点猜测。**

### web_agent 现状

好的一面已在第零节列过（51 个码、双层错误类）。问题在**两者之间的缝**：

- 全项目 **157 处** `throw new Error('文本')`——没有码。
- `mcp/errors.js` 的 `classifyToolError` 用 **12 条消息正则**把它们反推成码，函数总共才 19 行：

```js
if (/not found|No such file/i.test(msg))        return new ExecutionError('E_NOT_FOUND', msg);
if (/requires |required/i.test(msg))            return new ProtocolError('E_BAD_ARGS', msg);
if (/timeout|isTimeout/i.test(msg))             return new ExecutionError('E_TIMEOUT', msg);
if (/confirm_dangerous|confirm_overwrite/i...)  return new ProtocolError('E_BAD_ARGS', msg);
…
return new ExecutionError('E_INTERNAL', msg);   // 兜底
```

### 为什么值得改

这不是风格问题，是**三个具体故障模式**：

1. **改文案会静默改变分类。** 把 `'xxx requires yyy'` 改成 `'需要 yyy'`，
   `/requires |required/i` 就不匹配了，错误从 `E_BAD_ARGS` 悄悄变成 `E_INTERNAL`。
   没有任何测试会红——因为功能仍然"报错了"。
2. **中英混用让分类漂移。** 你的代码里中英文错误消息都有（`'模型ID缺失、重复或格式无效'` 与
   `'File already exists; choose a new name'` 并存）。正则只认英文，中文消息**一律落到 `E_INTERNAL`**。
3. **挡住 i18n。** 一旦要把错误消息本地化，整套分类立刻失效。

### 建议做法（可渐进，不需要大重构）

1. **把 `classifyToolError` 的 12 条正则降级为"兼容兜底"**，每命中一次就记一条带调用栈的
   warn 日志（只在开发/测试环境）。
2. **加一条测试断言：兜底命中数为 0。** 这样每修一处纯文本 Error，测试就前进一格；
   新增的纯文本 Error 会立刻让测试变红。这是 ShunCode"文案目录必须覆盖每一个码，测试逐一核对"的等价物。
3. **按文件优先级替换**，先改命中最多的几个：
   `mcp/externalClient.js`(26)、`mcp/stdioLaunch.js`(21)、`tools/workflows.js`(18)、
   `utils/operatorQueue.js`(15)、`agent/openai.js`(14)、`tools/fileOps.js`(12)。
   这 6 个文件占了 157 处里的 106 处。
4. 替换时顺手把**面向用户的中文**与**面向开发者的英文原文**分开：前者由 code 渲染，
   后者进 `detail`。这正是 ShunCode"英文原文脱敏后只作技术详情"的做法。

参考源码：`bridge-start-failure.ts`（码契约 + 纯模块）、`external-mcp-network-errors.js`（按码集合分类）。

---

## N2. 给模型写明终端契约（成本极小、立刻见效）

### ShunCode 的做法

`bridge-agent-instructions.js` 里专门有一段给模型的硬性说明：

> The independent run_command terminal is Bash, **NOT zsh, PowerShell or CMD**, on Linux, macOS and Windows.
> **Do not infer the shell from the host OS or the user login shell.**
> 不要把普通命令再套一层 `/bin/bash -c`、`bash -lc` 或别的 shell 字符串——多套一层会把
> 引号、`$变量`、`$()`、反引号重新解析一遍。

并且逐平台写明差异（macOS 是 bash 3.2，没有 `mapfile`/`declare -A`；BSD `sed -i` 要备份后缀）。

### web_agent 现状

`tools/index.js` 里 `run_command` 的描述全文是：

> Run a command and wait. For tests/builds that may exceed a few seconds, prefer start_command.
> Destructive commands need confirm_dangerous=true on local Chat; remote MCP rejects them even with
> that flag. Code mode only.

**一个字都没提这是哪个 shell。** 而实际上 `tools/executor.js:223` 是：

```js
const shell = win ? 'powershell.exe' : detectPosixShell(process.env);
```

更麻烦的是 `tools/index.js:578` 的别名提示里写着 `bash→run_command`——
模型看到这句，**会合理地认为自己在用 bash**，于是在 Windows 上生成 `ls -la`、`grep`、
`$(...)`、单引号包裹路径，而对面是 PowerShell。

### 建议做法

在 `run_command` / `start_command` 的 description 里按当前平台注入一段契约，例如 Windows：

> This terminal is **PowerShell (powershell.exe -Command)**, not bash, not CMD.
> Do not infer the shell from the OS. Do not wrap the command in `bash -lc` or another shell string.
> `-Command` exits with the status of the LAST statement. Use PowerShell cmdlets
> (`Get-ChildItem`, `Select-String`), not `ls -la` / `grep`. Quote paths with spaces.
> The `bash` alias maps to this tool but does **not** give you bash.

POSIX 侧同理写明是 `/bin/bash`。

**成本极小**（描述字符串 + 一个平台分支），但直接减少一整类"模型生成的命令在 Windows 上报错"的往返。

> 注意：这里**不是**建议你改成 Bash（ShunCode 自带 PortableGit 才敢那么说，成本很高）。
> 是建议你**把现状说清楚**。

---

## N3. 模型端点的分阶段、凭据无关诊断

### ShunCode 的做法

`external-mcp-diagnose.ts`：`route → dns → tcp → tls → http` 五阶段，逐段报告。三条纪律：

- **凭据无关**：不带 `Authorization`，不使用所存地址的 path/query，只输出 `protocol//host`；
- **任何 HTTP 状态（含 401/405）都算"可达"**——区分"网络到不了"和"到了但拒绝你"；
- 结果可以直接贴给用户看，不怕泄漏。

### web_agent 现状

web_agent 的核心功能就是调模型端点，但目前只有：

- `agent/providers.js:135` `listRemoteModels(baseUrl, apiKey)` —— **带 `Authorization: Bearer`**，
  一次性请求，成败两态；
- 失败后 `api/routes.js:898` 归为 `E_PROVIDER_PROBE`。

用户配一个端点连不上时，拿到的是一个 HTTP 错误或超时。**无法区分**：DNS 没解析出来 /
被代理挡了 / TLS 证书不被信任 / 地址对但 key 错 / 地址对 key 对但那个 model id 不存在。
这几种情况用户要做的事完全不同。

### 建议做法

加一个 `diagnoseEndpoint(baseUrl)`，**不接受 apiKey 参数**（这是设计约束，不是遗漏）：

| 阶段 | 做什么 | 失败时告诉用户 |
|---|---|---|
| `route` | 是否命中 NO_PROXY / 该走哪个代理 | 走了代理还是直连 |
| `dns` | 解析主机名 | 域名解析不了，查网络或代理的远程 DNS |
| `tcp` | 连端口 | 连不上，可能需要代理 |
| `tls` | 握手 + 证书链 | 证书不被信任（企业根证书没装） |
| `http` | 发一个**不带凭据**的请求 | **收到任何状态码（含 401）都算网络通**，问题在凭据或模型名 |

最后一行尤其重要：401 意味着"网络完全没问题，是你的 key"，这跟"连不上"是两回事，
而现在这两种在 UI 上长得一样。

输出里只放 `protocol//host`，不放 path、不放 query、不放任何 header——这样诊断结果可以让用户
直接截图发给你，不用担心泄漏。

参考源码：`external-mcp-diagnose.ts`、`external-mcp-network-errors.js`（九类错误的中文文案可以直接借用）。

---

## N4. 超时预算集中成版本化的冻结表

### ShunCode 的做法

`bridge-license-network-policy.mts`，29 行：

```ts
export const LICENSE_NETWORK_POLICY = Object.freeze({
  version: "license-network-budget-v3",
  query:              Object.freeze({ requestTimeoutMs:  9_000, attemptTimeoutMs:  6_000, probeTimeoutMs:  5_000 }),
  authorization:      Object.freeze({ requestTimeoutMs: 15_000, attemptTimeoutMs: 12_000, probeTimeoutMs:  5_000 }),
  manualAuthorization:Object.freeze({ requestTimeoutMs: 20_000, attemptTimeoutMs:  8_000, probeTimeoutMs:  5_000 }),
  singleSend:         Object.freeze({ requestTimeoutMs: 27_000, attemptTimeoutMs: 12_000, probeTimeoutMs: 12_000 }),
  payment:            Object.freeze({ requestTimeoutMs: 18_000, attemptTimeoutMs: 12_000, probeTimeoutMs:  5_000 }),
});
export function licenseRequestBudget(path: string, method = "GET") { … }
```

三个要点：**按操作分档**、**`Object.freeze` 防运行时改动**、**带 `version` 字段**（改预算 = 升版本号，
线上问题可以直接问"你跑的是 v2 还是 v3"）。

还有一句注释值得抄进脑子：`Transport deadlines never relax license verification.`
——传输层超时放宽，**不等于**校验可以放宽。

### web_agent 现状

16 处 timeout 字面量散落各处，其中：

```
MODEL_TIMEOUT_MS      = 300000     agent/openai.js
MODEL_IDLE_TIMEOUT_MS = 120000     agent/openai.js
DEFAULT_TIMEOUT_MS    = 120000
CONFIRM_TIMEOUT_MS    = 90000      tools/ptyJobs.js:11
armTimer(job, kind === 'run' ? CONFIRM_TIMEOUT_MS : 15000)   ← 裸字面量 tools/ptyJobs.js:80
timeout: 100 / 3000 / 4000 / 5000 / 8000 / 15000             ← 分散各处
```

`ptyJobs.js:80` 那行最典型：一个有名字的常量旁边就是一个裸的 `15000`，
说明"另一种任务的确认超时"这个概念**存在但没有名字**。

### 建议做法

一张 `budget.js`（注意别和已有的 `mcp/budget.js` 重名，那是配额不是超时）：

```js
const TIMEOUT_POLICY = Object.freeze({
  version: 'webagent-timeout-v1',
  modelRequest:   Object.freeze({ totalMs: 300_000, idleMs: 120_000 }),
  modelList:      Object.freeze({ totalMs:  15_000 }),
  confirmRun:     Object.freeze({ totalMs:  90_000 }),
  confirmOther:   Object.freeze({ totalMs:  15_000 }),   // 原来的裸 15000
  tunnelStart:    Object.freeze({ totalMs: 120_000 }),
  …
});
```

好处很实际：改超时只改一处；线上问题可以用 version 对齐；
新同学一眼看到全部时间预算而不用 grep。

---

## N5. 多文件变更的 journal 与回滚（可选，工作量大）

### ShunCode 的做法

Skill 导入是一条**事务流水线**：`prepare`（解包 + 校验 + 生成预览）→ 用户确认 →
`commit`（带 journal）。配套 `skill-import-journal.js`(130 行) 和
`skill-import-recovery.js`(54 行) —— **启动时清扫中断的导入**。
替换同名时"旧版本先备份，失败自动恢复"。

### web_agent 现状

你的文档写得很清楚，我直接引用：

> 不进行多文件事务。
> 实际写入之前没有与其他进程的最终 compare-and-swap，锁仅串行本进程。
> dryRun 不证明之后正式提交时文件仍未变。

单文件是原子的（`atomicWriteText`），这没问题。问题是**一个逻辑改动通常跨多个文件**：
改一个函数签名要同时改定义、调用方、测试。模型会连发 3 次 `apply_patch`，
如果第 2 次因为 `E_STALE_FILE` 或预算超限失败，**工作区停在半改状态**——
文件 1 已改、文件 2、3 未改，代码不可编译。模型下一步看到的是一个它没预料到的中间态。

### 建议做法（如果要做）

引入 change-set 概念，照搬 journal 模式：

1. `beginChangeSet()` → 返回 id，写一条 journal（含每个目标文件的 **原始 hash**）；
2. 每次 `apply_patch` 带上 changeSet id，写入前把原内容存进 journal 目录；
3. `commitChangeSet()` 清理 journal；
4. `rollbackChangeSet()` 按 journal 逆序还原；
5. **启动时 sweep**：发现未提交的 journal，提示用户"上次有 N 个文件改到一半，回滚还是保留？"

**这项成本最大**，放在最后。但如果你观察到"模型改到一半失败、然后越修越乱"这类问题，
它就是根因。

参考源码：`skill-import-journal.js`、`skill-import-recovery.js`、`skill-fs-retry.js`
（后者处理 Windows 文件锁重试，你在 Windows 上大概率也需要）。

---

## N6. 自带依赖 vs 依赖用户环境

ShunCode 的态度很明确，`bridge-agent-instructions.js` 原话：

> Windows uses product-bundled PortableGit bash.exe --noprofile --norc, with no PowerShell fallback.
> **A missing bundled Bash is a packaging/install error.**

同理，Quick Tunnel 永远传自己的 config 文件，不依赖用户的 `~/.cloudflared/config.yml`。

web_agent 目前依赖用户自行安装 cloudflared / ngrok，`tunnel/cloudflared.js:90` 给了很详细的
winget 安装提示（这段文案写得好，别丢）。

**建议的小步改进**（不要求你立刻自带二进制）：把这两类错误**在错误码上分开**：

- `E_NO_CLOUDFLARED` = 用户环境缺依赖 → 显示安装指引（现状，保持）；
- 将来若自带二进制，缺失则是 `E_PACKAGING` → 这是**你的 bug**，不该让用户看安装指引。

配合 N1 的码契约一起做，几乎零额外成本。

---

## N7. 日志去重与安全字段白名单（极小成本）

`cloudflare-edge-relay.ts` 里一段很实用的处理：

```js
const logged = new Set();
const log = line => {
  if (logged.has(line) || logged.size >= 24) return;  // cloudflared retries; each distinct line once is enough
  logged.add(line);
  options.log?.(`[bridge] Cloudflare edge relay: ${line}`);
};
```

理由写在注释里：**cloudflared 会疯狂重试**，不去重日志会被刷爆。
而且它明确只记"边缘主机名 + 代理的回答"，**绝不记代理地址或凭据**。

web_agent 同样要 spawn cloudflared / ngrok 并 observe 它们的 stdout/stderr
（`observeTunnel`），同样会遇到重试刷屏。你已经有 `createTokenRedactor` 做脱敏（很好），
**加一个 `logged` Set 即可**，十行以内。

---

## N8. 指纹变化 → 失效**并重连**

`external-mcp-network.ts` 的设置指纹：把 proxy / noProxy / proxySupport / proxyStrictSSL / CA
这些**影响连接**的设置折成一个指纹，变化就**主动重连**；而
`http.systemCertificates` 这种**必须重启**才生效的，单独给一条提示——不假装能热生效。

web_agent 的 `revisionKey()` 已经是同一个思路，而且注释很克制（"A key is only a hint to re-read;
it never replaces load()'s own validation"）。差别在于**用途**：现在只用于"提示重读"，
没有"变了就把在途连接断开重连"这一层。

**建议**：当用户改了 `baseUrl` / `apiKey` / 代理设置时，除了让缓存失效，
还应该主动中止并重建受影响的在途请求；对于确实需要重启进程才生效的设置（如果有），
明确告诉用户"此项需重启后生效"，而不是让他以为已经生效了。

---

## 二、建议顺序

| 顺序 | 项 | 理由 |
|---|---|---|
| 1 | **N2** 终端契约 | 改几行描述字符串，当天见效 |
| 2 | **N7** 日志去重 | 十行以内 |
| 3 | **N4** 预算表 | 纯整理，无行为变更，顺手把裸 15000 命名 |
| 4 | **N1** 错误码源头化 | 结构性收益最大；先加"兜底命中数 = 0"的测试，再逐文件推进 |
| 5 | **N3** 端点诊断 | 用户可感知的体验提升 |
| 6 | **N6 / N8** | 跟着 N1 / N4 顺手做 |
| 7 | **N5** change-set journal | 工作量最大，确认确实遇到"改到一半"问题再做 |

---

## 三、给对方助手的提示词

## ✂️ 从这里开始复制 ✂️

我在 web_agent 项目上工作（分支 `arena/01a0e8ea-web-agent`）。
这不是补功能，是**基于另一个项目（ShunCode 0.8.1）的实现方法论，对本项目架构的优化提案**。
附件包里 `方法论优化.md` 有完整论证，`original-typescript/` 和 `recovered-from-bundle/`
是被引用的参考源码。

先明确：下面这些本项目已经做得好，**不要动**——`ProtocolError`/`ExecutionError` 双层错误、
51 个 `E_` 码、`atomicWriteText` + `withWriteLock`、`models/store.js` 的 `revisionKey()` 指纹、
`agent/openai.js` 先分类再决定是否重试的 F103 逻辑、`operatorQueue` 的硬上限。

按这个顺序做，**每项做完停下来让我确认**：

**1）给模型写明终端契约（最优先，改动极小）**
`tools/index.js` 里 `run_command` / `start_command` 的 description 完全没说这是哪个 shell，
而 `tools/executor.js:223` 实际是 `win ? 'powershell.exe' : detectPosixShell(...)`。
更糟的是 `tools/index.js:578` 提到别名 `bash→run_command`，模型会以为自己在用 bash，
于是在 Windows 上生成 `ls -la`、`grep`、`$(...)`。
请按平台在 description 里注入明确契约：当前是 PowerShell（还是 /bin/bash）、
不要从操作系统推断、不要再套一层 shell 字符串、PowerShell `-Command` 以最后一条语句的状态退出、
别名不代表真的给你 bash。参考 `recovered-from-bundle/bridge-agent-instructions.js` 的写法，
但要改写成 PowerShell 口径，不要照抄它的 Bash 说法。

**2）隧道日志去重**
`tunnel/cloudflared.js` / `ngrok.js` 的 `observeTunnel` 在进程重试时会刷屏。
参考 `original-typescript/cloudflare-edge-relay.ts` 里的 `logged` Set：
同一行只记一次、最多 24 行。现有的 `createTokenRedactor` 脱敏保留不动。

**3）超时预算集中成一张冻结表**
现在有 16 处 timeout 字面量散落各处，`tools/ptyJobs.js:80` 甚至是
`armTimer(job, kind === 'run' ? CONFIRM_TIMEOUT_MS : 15000)`——有名字的常量旁边一个裸 15000。
参考 `original-typescript/bridge-license-network-policy.mts`：`Object.freeze` 的分档表 +
一个 `version` 字符串 + 一个按操作查表的函数。这一步只做整理，不要改任何现有数值。
注意新文件别和已有的 `mcp/budget.js` 混淆（那个是配额不是超时）。

**4）错误码源头化（结构性，渐进做）**
`mcp/errors.js` 的 `classifyToolError` 总共 19 行里有 12 条消息正则，
靠 `/not found|No such file/i`、`/requires |required/i` 这类把纯文本错误反推成码，
兜底是 `E_INTERNAL`。全项目有 157 处 `throw new Error('文本')`。
三个问题：改文案会静默改变分类且没有测试会红；中文错误消息一律落到 `E_INTERNAL`；
挡住 i18n。
请这样做：(a) 保留那 12 条正则作兼容兜底，但每命中一次在非生产环境打一条带栈的 warn；
(b) 新增测试断言"兜底命中数为 0"，让它先红，然后逐文件修到绿；
(c) 优先改这 6 个文件，它们占 157 处里的 106 处：`mcp/externalClient.js`(26)、
`mcp/stdioLaunch.js`(21)、`tools/workflows.js`(18)、`utils/operatorQueue.js`(15)、
`agent/openai.js`(14)、`tools/fileOps.js`(12)；
(d) 替换时把面向用户的中文（由 code 渲染）和面向开发者的英文原文（进 `detail`）分开。
参考 `original-typescript/bridge-start-failure.ts` 的码契约写法。

**5）模型端点的分阶段、凭据无关诊断**
现在 `agent/providers.js:135` 的 `listRemoteModels` 带 `Authorization` 发一次请求，成败两态；
失败统一归 `E_PROVIDER_PROBE`。用户分不清是 DNS、代理、证书、key 错还是模型名错。
请加一个 `diagnoseEndpoint(baseUrl)`，**签名里不要有 apiKey**（这是设计约束不是遗漏），
分 route / dns / tcp / tls / http 五阶段逐段报告，
**收到任何 HTTP 状态码（包括 401）都判定为"网络可达"**，并把"网络不通"与"凭据/模型名有问题"
在文案上彻底分开。输出只含 `protocol//host`，不含 path、query、header，
这样用户可以直接把结果截图发出来。
参考 `original-typescript/external-mcp-diagnose.ts`，
错误分类文案可借用 `recovered-from-bundle/external-mcp-network-errors.js`。

**6）两项小的，跟着上面顺手做**
- 把"用户环境缺依赖"（`E_NO_CLOUDFLARED`，显示安装指引，保持现状）和"自带依赖缺失=打包错误"
  在错误码上分开，后者不该给用户看安装指引。
- `models/store.js` 的 `revisionKey()` 现在只用于提示重读；改 `baseUrl`/`apiKey` 时
  还应主动中止并重建受影响的在途请求。确实需要重启才生效的设置要明说，别让用户以为已生效。

**7）最后再评估：多文件变更的 journal + 回滚**
`tools/补丁与路径详解.md` 明确写了"不进行多文件事务"。单文件原子没问题，
但一个逻辑改动常跨多个文件，第 2 个 patch 失败会把工作区停在半改、不可编译的状态。
如果你们确实遇到过"模型改到一半失败后越修越乱"，再做 change-set + journal + 启动时 sweep，
参考 `recovered-from-bundle/skill-import-journal.js`、`skill-import-recovery.js`、
`skill-fs-retry.js`。没遇到就先别做，这项成本最大。

做完每一项请给出：改了哪些文件、怎么验证的、哪些没做到以及为什么。
不确定的地方直接说不确定，不要猜。

## ✂️ 复制到这里结束 ✂️

---

## 四、复核方式

```bash
git clone https://github.com/cccjvav/web_agent.git /tmp/wa
cd /tmp/wa && git checkout origin/arena/01a0e8ea-web-agent
A=webagent-core/agent-host/src

grep -rhoE "throw new Error\(['\`]" $A --include=*.js | wc -l        # 157
grep -rhoE "'E_[A-Z_]+'" $A --include=*.js | sort -u | wc -l         # 51
sed -n '/function classifyToolError/,/^}/p' $A/mcp/errors.js | wc -l # 19 行
sed -n '/function classifyToolError/,/^}/p' $A/mcp/errors.js | grep -c 'test(msg)'  # 12 条正则
sed -n '223p' $A/tools/executor.js                                   # powershell.exe
sed -n '80p'  $A/tools/ptyJobs.js                                    # 裸 15000
grep -n 'Authorization' $A/agent/providers.js                        # 探测带凭据
sed -n '98,110p' $A/models/store.js                                  # revisionKey 指纹
```
