# web_agent 外部 MCP 与 Skills 优化方案（基于 ShunCode 0.8.1 源码）

对照对象：
- web_agent `arena/01a0e8ea-web-agent`，提交 `eb1c195`
- ShunCode 0.8.1 原始 TypeScript `recovered/shuncode-0.8.1/src/`
  + 从 bundle 取回的载体模块 `reconstructed/carrier-0.8.1/src/`

配套源码包：`npm run build:mcp-skills-package`
→ `.work/downloads/shuncode-0.8.1-mcp-skills.zip`（18 文件 / 2587 行，
contentSha256 `7fb978c9b59df55ecd51ddbd52bc741267c65a72c081860599365f7ebc47c7e4`）

---

## 先说一句重话

**上一份对照报告里我说"web_agent OAuth 完整：DCR、PKCE、令牌刷新、速率限制"——
这句话用错了方向，必须更正。**

那 682 行 `mcp/oauth.js` 是 **入站** OAuth **服务端**：9 条 express 路由，
对外提供 `/.well-known/oauth-authorization-server`、`/oauth/authorize`，
自己**发出** `WWW-Authenticate`。它让别人（Claude Desktop 之类）认证**到** web_agent。

**出站方向**——web_agent 去连第三方 MCP 服务器时——`externalClient.js:134`
只接受一个手工粘贴的静态 token：

```js
const { name, url, token = '', publicHttps = false, confirmedPublic = false } = input;
```

全仓搜 `authorization_endpoint`、`.well-known/oauth-protected-resource`、
`code_challenge` 作为**客户端**用途，命中为 0。

**结论：web_agent 今天连不上任何需要 OAuth 的第三方 MCP 服务器。** 这是第一优先级。

---

## 优先级总表

| # | 事项 | 性质 | 成本 | ShunCode 参考 |
|---|---|---|---|---|
| 1 | 出站 OAuth（DCR + PKCE + 刷新） | **连不上** | 大 | `external-mcp-oauth-flow.ts` |
| 2 | 子进程环境白名单补 14 项 | **跑不起来** | 很小 | `external-mcp-stdio-env.ts` |
| 3 | 传输协商与受限降级 | **连不上** | 小 | `external-mcp-connection.ts:31-33,88` |
| 4 | 自定义 CA 证书 | **连不上** | 小–中 | `external-mcp-network.ts` |
| 5 | 网络错误九分类 | 诊断不了 | 小 | `external-mcp-network-errors.js` |
| 6 | 分阶段网络诊断 | 诊断不了 | 中 | `external-mcp-diagnose.ts` |
| 7 | 状态词表 4→8 | 诊断不了 | 很小 | `external-mcp-status.ts` |
| 8 | 技能失败原因码 + fix | 诊断不了 | 很小 | `custom-tool-skill.js` |
| 9 | 出站协议版本 2025-03-26 → 2025-06-18 | 一行 | 极小 | `external-mcp-oauth-flow.ts:188` |
| 10–13 | 加自定义 header / 凭据 UI 时的加固 | 预防 | 视情况 | 见第四节 |

---

## 一、阻断级（现在就连不上 / 跑不起来）

### 1. 出站 OAuth —— 最高优先级

**ShunCode 的实现**（`external-mcp-oauth-flow.ts`）：

```ts
clientMetadata: {
  client_name: 'ShunCode',
  redirect_uris: [redirectUri],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  application_type: 'native',
  token_endpoint_auth_method: record.clientSecret ? 'client_secret_basic' : 'none',
  ...(options.scope ? { scope: options.scope } : {}),
}
```

四个值得照抄的细节：

1. **强制校验 PKCE**（`:198`）——不只是发出 `code_challenge`，回调时还要核对
   `code_challenge_method === 'S256'`、`state` 匹配、`redirect_uri` 一致，
   任一不符直接 `OAuth PKCE/回调校验失败`。
2. **刷新令牌保留**（`:153`）——很多服务刷新时不返回新的 `refresh_token`：

   ```ts
   record.tokens = { ...tokens, ...(!tokens.refresh_token && previous?.refresh_token
     ? { refresh_token: previous.refresh_token } : {}) };
   ```

   不这么写，刷新一次之后就再也刷不动了。
3. **不支持 DCR 时给出可操作提示**（`:162`）——服务端没有 `registration_endpoint`
   就抛 `OAUTH_CLIENT_REQUIRED`，告诉用户"请填写服务提供的 Client ID"，
   而不是一句"注册失败"。
4. **RFC 8707 resource indicator**（`:218,227`）——`resource` / `resourceIndicator`
   参与刷新校验，令牌不会被跨资源误用。

**web_agent 怎么落地**：保留现有静态 token 作为 `auth: 'bearer'`，
新增 `auth: 'oauth'`。401 响应里读 `WWW-Authenticate` 的 `resource_metadata`
→ 取 `/.well-known/oauth-protected-resource` → 找授权服务器 → DCR 或用户填的
Client ID → PKCE 授权码 → 存 token。回环回调可以复用你现有的
`127.0.0.1` 机制。

> 注意：web_agent 是 headless 的 agent-host，没有 IDE 的 `openExternal`。
> 授权链接需要通过现有 HTTP 接口交给操作员在浏览器里打开，
> 这一步 ShunCode 帮不上，要自己设计。

### 2. 子进程环境白名单 —— 成本最小、收益立竿见影

`stdioLaunch.js:10` 的 `BASE_ENV` 只有 **11** 项：

```js
['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE']
```

ShunCode 的两张表合计 **25** 项（`MANAGED_STDIO_WINDOWS_ENV` 17 +
`MANAGED_STDIO_POSIX_ENV` 11）。web_agent 现有的 11 项**全部**在 ShunCode 表里，
ShunCode 多出这 14 项：

```
APPDATA  COMSPEC  HOME  HOMEDRIVE  HOMEPATH  LOCALAPPDATA  LOGNAME
PROCESSOR_ARCHITECTURE  PROGRAMDATA  PROGRAMFILES  PROGRAMFILES(X86)
SHELL  USER  USERPROFILE
```

**为什么这是阻断级**：缺 `HOME`（POSIX）和 `APPDATA`/`LOCALAPPDATA`/`USERPROFILE`
（Windows），`npx`、`uvx`、`pip`、`git` 系的 MCP 服务器找不到自己的缓存目录和
配置文件，会直接启动失败或行为异常。这些都是最常见的 MCP 服务器形态。

**但有一条必须保留**：`COMSPEC` 在 web_agent 里是**故意**被拦的
（`stdioLaunch.js:18` 的保护正则含 `COMSPEC$`）。是否放开要你自己判断，
其余 13 项建议直接加。

**反过来，ShunCode 该学 web_agent 的**：ShunCode **没有**危险键黑名单，
它的 `ENV_NAME` 正则（`external-mcp-secret-fields.ts:16`）只校验名字形状
`/^[A-Za-z_][A-Za-z0-9_]*$/`，而且文档明说"the user's own env always wins"——
意味着用户能设 `LD_PRELOAD`、`NODE_OPTIONS`。web_agent 的
`^(WEBAGENT_|NODE_|PYTHONPATH$|PYTHONHOME$|LD_|DYLD_|BASH_ENV$|ENV$|COMSPEC$|PSMODULEPATH$)`
**比 ShunCode 安全，务必保留**。ShunCode 的威胁模型是"用户配置自己的机器"，
web_agent 是 agent-host，模型可能影响配置，不是一回事。

### 3. 传输协商与"受限降级"

web_agent 出站只走 Streamable HTTP。它的**入站**服务端明确拒绝旧式 HTTP+SSE
（`server.js:513` 返 405），对自家服务合理；但**出站**遇到只会旧式 SSE 的服务器
就连不上。

ShunCode（`external-mcp-connection.ts:31-33`）：

```ts
const mode = config.httpTransport ?? 'streamable-http';
const attempts = config.transport === 'stdio' ? ['stdio']
  : mode === 'auto' ? ['streamable-http', 'sse'] : [mode];
```

降级条件（`:88`）被刻意收窄：

```ts
if (mode === 'auto' && attempt === 'streamable-http' && probeStatus !== undefined
    && [400, 404, 405, 406, 415].includes(probeStatus)) continue;
```

源码注释写死了：`never on authentication/rate-limit/server/network errors`。
**真正的价值在这个约束**，不在"有降级"。只在"对方听不懂这个协议"时换；
遇到 401/403/429/5xx/网络错误一律不换，否则认证失败会被误判成协议不对、
换个协议再撞一次，把一次失败放大成两次。

web_agent 的 `rpc()` 已经能解析 SSE 帧了，缺的只是一个
`httpTransport: 'auto'|'streamable-http'|'sse'` 配置项和一次换传输重连。

### 4. 自定义 CA 证书

web_agent 全仓搜不到 `NODE_EXTRA_CA_CERTS`、`caCert`、`createSecureContext`。
有 TLS 中间人的网络（公司代理、自签证书）里连外部 MCP 会证书校验失败，
且**没有任何配置项可以处理**。

ShunCode 的 `shuncode.mcp.extraCaCertificates` 分两处落地，
**两条路都要管**，只做一半等于没做：

- HTTP 出站：`external-mcp-network.ts`
- stdio 子进程：`external-mcp-stdio-env.ts` —— 把证书路径注入子进程环境

---

## 二、可诊断性（连不上时用户不知道为什么）

### 5. 网络错误九分类

web_agent 现在的外部 MCP 失败是 `External MCP HTTP 500`（`externalClient.js:83`）
或一个原始 fetch 错误。`errors.js` 的 `classifyToolError` 是**按消息文本正则**
判**工具**错误，不覆盖网络层。

ShunCode（`external-mcp-network-errors.js`）按**错误码集合**分类，
并沿 `cause` 链向上找 **4 层**，还从 `error.status` / `error.data.status` /
`error.cause.status` 三处取 HTTP 状态：

| 类别 | 触发码（节选） | 给用户的话 |
|---|---|---|
| `dns` | ENOTFOUND, EAI_AGAIN, EAI_FAIL, EAI_NONAME | 无法解析服务器地址；请检查网络或代理的远程 DNS |
| `connect` | ECONNREFUSED, ECONNRESET, EHOSTUNREACH, ENETUNREACH, EPIPE, UND_ERR_SOCKET | 无法连接服务器；如需代理请开启系统代理或设置 http.proxy |
| `timeout` | ETIMEDOUT, UND_ERR_CONNECT_TIMEOUT, UND_ERR_HEADERS_TIMEOUT, UND_ERR_BODY_TIMEOUT | 连接超时 |
| `proxy-auth` | （HTTP 407） | 代理需要认证；请在 http.proxy 中提供凭据 |
| `proxy-protocol` | EPROTO, ERR_SSL_WRONG_VERSION_NUMBER, ERR_SSL_PACKET_LENGTH_TOO_LONG, HPE_INVALID_CONSTANT, UND_ERR_PROXY_TUNNEL | **代理端口的协议或模式不符（例如把 SOCKS 端口当作 HTTP 端口）** |
| `certificate` | UNABLE_TO_VERIFY_LEAF_SIGNATURE, SELF_SIGNED_CERT_IN_CHAIN, DEPTH_ZERO_SELF_SIGNED_CERT, CERT_HAS_EXPIRED, UNABLE_TO_GET_ISSUER_CERT_LOCALLY, ERR_TLS_CERT_ALTNAME_INVALID, CERT_NOT_YET_VALID | 证书校验失败；企业网络请确认根证书已装入系统 |
| `auth` | HTTP 401/403 | 需要设置密钥：上游拒绝了当前凭据 |
| `http` | 其他 4xx/5xx | 上游返回了错误状态 |
| `protocol` | CLIENT_HTTP_UNEXPECTED_CONTENT, INVALID_RESULT, NOT_INITIALIZED, ERA_NEGOTIATION_FAILED, CLIENT_HTTP_NOT_IMPLEMENTED | **地址可达，但不是 Streamable HTTP MCP 服务** |

最后两行尤其值钱：`proxy-protocol` 能直接说出"你把 SOCKS 端口填成 HTTP 了"，
`protocol` 能区分"连得上但不是 MCP 服务"——这两种情况用户自己几乎排查不出来。

按码集合判比按消息正则判稳得多：错误消息会随 Node/undici 版本变，错误码不会。

### 6. 分阶段网络诊断

`external-mcp-diagnose.ts`：`route → dns → tcp（或代理 CONNECT）→ tls → http`，
每阶段一个 `{stage, ok, detail}`。

两个设计点值得抄：

- **凭据无关（credential-free by design）**：不带 Authorization，
  不使用存储地址里的 path 和 query，结果里只出现 `protocol//host`。
  诊断报告是会被复制粘贴到聊天里求助的，这条很重要。
- **任何 HTTP 状态都算"可达"**，401/405 也算。诊断要回答的是
  "网络通不通"，不是"认证过不过"。

### 7. 状态词表 4 → 8

web_agent 现有：`connecting, discovered, online, stopped`。

ShunCode（`external-mcp-status.ts`）：

```
disabled | stopped | connecting | reconnecting | running | needs-auth | proxy-error | failed
```

另有引用状态 `ExternalMcpRefState: ok | missing-secret | broken`。

缺 `needs-auth` 和 `proxy-error` 最要命：这两种状态下用户要做的事完全不同
（去认证 vs 去改代理设置），现在都被压成 `stopped`，用户只能盲猜。

### 8. 技能失败原因码 + 修复建议

web_agent 现在是把异常消息塞进 `preview`（`skills.js:93` `entry.ready = false`）。

ShunCode（`custom-tool-skill.js`）给每种失败一个机器可读码和一个建议动作：

```js
SKILL_LOAD_REASONS = {
  "no-skill-md": "目录下缺少 SKILL.md。",
  "invalid-frontmatter": "SKILL.md 的 frontmatter 不完整。",
  "entry-configured-missing": "SKILL.md 里声明的 entry 文件不存在。" }
SKILL_LOAD_FIXES = { ... fix: "open-folder" }
```

判定顺序也定死了（`skill-center.ts:244` 注释）：**总开关 → 同名遮蔽 → 加载器检查**。
同名遮蔽给 `duplicate-name` + `open-folder`。

web_agent **已经有**遮蔽检测（`skills.js` 的 `entry.shadowed`），
只是没变成可操作提示。原因码还能让模型自己判断"这个技能坏了，别再试"，
而不是反复去读一个读不出来的文件。这条成本最低，建议先做。

### 9. 出站协议版本

`externalClient.js:164` 硬编码 `protocolVersion: '2025-03-26'`，
但 web_agent **入站**支持到 `2025-06-18`（`server.js:25`
`SUPPORTED_PROTOCOL = ['2024-11-05','2025-03-26','2025-06-18']`）。
ShunCode 出站用 `2025-06-18`。

出站声明旧版本可能导致服务端不advertise 新版才有的受保护资源元数据
（与第 1 项的 OAuth 发现直接相关）。改一行。

---

## 三、web_agent 已经更强的地方（**不要动**）

| 能力 | web_agent | ShunCode 0.8.1 |
|---|---|---|
| 危险环境键黑名单（LD_/NODE_/BASH_ENV/DYLD_…） | 有 | **无** |
| 技能分页读取（`expectedHash` 续读、`E_STALE_FILE`、文本扩展名白名单） | 有 | **无**（整文件读） |
| MCP resources | 有 | **无** |
| 预算 / 配额（`budget.js`） | 有 | **无** |
| OAuth 速率限制（入站） | 有 | **无** |
| 操作员逐次审批（`operatorQueue`，外部工具 `requiresApproval: true`） | 有 | **无** |
| SSRF 防护（拒注册自身端口 / 自身隧道源、localhost→127.0.0.1 不走 DNS） | 有 | 部分 |
| 会话头策略比协议更严（1–512 可见 ASCII、禁逗号、拒合并串） | 有 | 未见 |
| 256 KiB 响应上限、`redirect:'error'`、严格 UTF-8（`fatal:true`） | 有 | 未见 |

**ShunCode 不是全面更优的参照物。** 我在 0.8.1 全部源码（扩展 + 载体）里搜过
`resources/list`、`rateLimit`、`budget`、`approval`，前三项全部零命中。

---

## 四、只在"加功能"时才需要的加固

如果以后给 web_agent 加自定义 header、凭据管理界面，这四条要提前知道：

**10. 保留头黑名单**（`external-mcp-secret-fields.ts:11-13`）。
用户自定义 header 时这些必须禁止覆盖：

```
Host  Content-Length  Transfer-Encoding  Connection
Mcp-Session-Id  MCP-Protocol-Version  Proxy-Authorization
```

理由写在注释里：用户值会**破坏会话**（`Mcp-Session-Id`）或**泄漏给代理**
（`Proxy-Authorization`）。web_agent 现在没有自定义 header，暂时不需要，
但加之前务必先有这张表。

**11. 凭据字段上限**：最多 40 个字段、单值 4096 字节；
header 名 `/^[A-Za-z][A-Za-z0-9_-]*$/`，env 名 `/^[A-Za-z_][A-Za-z0-9_]*$/`。
原则是"UI 只看见名字，值只走一次（密码框 → 凭据存储），
永不回显、不记日志、不写进配置 JSON"。

**12. 确认令牌不拿输入做哈希**（`external-mcp-preview-token.ts`）：

```ts
const KEY = randomBytes(32);  // 每个进程随机，不持久化
export function externalMcpPreviewToken(revision: string, input: string): string {
  return createHmac('sha256', KEY).update(revision).update('\0').update(input).digest('hex');
}
```

注释点明了理由：要把确认绑定到"配置版本 + 确切输入"，但**不能直接哈希输入**，
因为输入里可能含凭据——哈希会变成一个凭据预言机。用随机密钥的 HMAC 解决。
这个思路在任何"确认框防篡改"的场景都通用。

**13. 配置按引用传递**（`external-mcp-native-refs.ts`）：
含凭据的原始配置只在内存里存 **5 分钟**、最多 **10 条**，
页面拿到的是脱敏视图，导入时按引用取——凭据从不进入文本框。

另外 `external-mcp-network.ts` 有一个**设置指纹**机制：
`http.proxy`/`http.noProxy`/`http.proxySupport`/`http.proxyStrictSSL`/CA 文件
任一变化都会改变指纹，指纹是每个服务器定义版本的一部分，
于是所有连接自动重连；而需要重启窗口的设置（`http.systemCertificates`）
单独给重启提示。web_agent 目前改了代理配置不会重连。

---

## 五、建议执行顺序

```
第一批（能连上）   ② 环境白名单补 13 项   ← 半小时，马上见效
                   ⑨ 协议版本改一行
                   ③ 传输协商 + 受限降级
第二批（看得懂）   ⑧ 技能原因码
                   ⑦ 状态词表 4→8
                   ⑤ 网络错误九分类
第三批（大工程）   ① 出站 OAuth
                   ④ 自定义 CA（HTTP + stdio 两条路）
                   ⑥ 分阶段诊断
以后再说           ⑩–⑬ 加自定义 header / 凭据 UI 时
不要做             第三节整张表
```

---

## 六、给 web_agent 助手的提示词（可直接粘贴）

> 下面这段连同 `shuncode-0.8.1-mcp-skills.zip` 一起给对方助手。

## ✂️ 从这里开始复制 ✂️

我在 web_agent 项目上工作。另一个项目逆向恢复了 ShunCode 0.8.1 的源码，
从中整理出一份针对本项目外部 MCP 与 Skills 的优化清单。
附件 `shuncode-0.8.1-mcp-skills.zip` 是相关参考源码。

**先读 README.txt**。压缩包里两类文件性质不同，不能混为一谈：
`original-typescript/` 是作者原始 TypeScript（随安装包发布，类型完整）；
`recovered-from-bundle/` 是从打包产物切出来的编译输出——逻辑和命名是真的，
但**类型标注和绝大部分注释已被编译器抹掉，import 也没有重新接线，只能读不能跑**。

**这不是一个可以直接引入的库。** ShunCode 是 VS Code 分支，这些文件 import 的载体
在本项目不存在。请抄思路和常量表，不要抄文件。

请按下面的顺序做，每项都要先在本仓库确认现状，不要相信我的描述：

**第一批**

1. `webagent-core/agent-host/src/mcp/stdioLaunch.js` 的 `BASE_ENV` 现在是 11 项。
   参考 `original-typescript/external-mcp-stdio-env.ts` 的
   `MANAGED_STDIO_WINDOWS_ENV` 与 `MANAGED_STDIO_POSIX_ENV`，补入
   `HOME USERPROFILE APPDATA LOCALAPPDATA PROGRAMDATA PROGRAMFILES
   PROGRAMFILES(X86) HOMEDRIVE HOMEPATH PROCESSOR_ARCHITECTURE SHELL USER LOGNAME`。
   **不要加 `COMSPEC`**，本项目第 18 行的保护正则是故意拦它的。
   **务必保留**现有的 `^(WEBAGENT_|NODE_|PYTHONPATH$|PYTHONHOME$|LD_|DYLD_|BASH_ENV$|ENV$|COMSPEC$|PSMODULEPATH$)`
   黑名单——ShunCode 没有这层防护，这里本项目更安全。
   加完请验证一个 `npx` 形态的 stdio MCP 服务器能正常启动。

2. `externalClient.js` 出站 `initialize` 的 `protocolVersion` 从 `'2025-03-26'`
   改为 `'2025-06-18'`（本项目入站 `server.js` 的 `SUPPORTED_PROTOCOL` 已含该版本）。

3. 出站 HTTP 加 `httpTransport: 'auto' | 'streamable-http' | 'sse'` 配置。
   `auto` 时先试 Streamable HTTP，**仅当**响应状态是 400/404/405/406/415
   才换 SSE 重连一次。**绝不**在 401/403/429/5xx 或网络错误上降级——
   参考 `original-typescript/external-mcp-connection.ts` 第 31–33 行和第 88 行，
   以及它第 27 行那句注释。本项目 `rpc()` 已能解析 SSE 帧，复用即可。

**第二批**

4. `tools/skills.js` 的 `describeSkill` 现在失败时只设 `ready:false` 并把异常消息
   放进 `preview`。改成结构化：`reasonCode` + `fix`。参考
   `recovered-from-bundle/custom-tool-skill.js` 的 `SKILL_LOAD_REASONS` /
   `SKILL_LOAD_FIXES`。判定顺序用：总开关 → 同名遮蔽 → 加载器检查。
   本项目已有 `entry.shadowed`，把它变成 `duplicate-name` + `open-folder`。

5. 外部 MCP 服务器状态从现在的 `connecting/discovered/online/stopped` 扩成
   `original-typescript/external-mcp-status.ts` 那 8 个。最关键的是把现在被压成
   `stopped` 的两种情况分出来：`needs-auth`（去认证）和 `proxy-error`（去改代理）。

6. 新增网络错误分类器。照 `recovered-from-bundle/external-mcp-network-errors.js`
   的**错误码集合**（不要照消息正则——本项目 `errors.js` 现在是按消息文本判，
   Node/undici 一升级就失效）。要沿 `error.cause` 向上找 4 层，
   并从 `error`/`error.data`/`error.cause` 三处取 HTTP 状态。
   九个类别：dns / connect / timeout / proxy-auth / proxy-protocol /
   certificate / auth / http / protocol。
   务必保留 `proxy-protocol`（能识别"SOCKS 端口当 HTTP 端口用"）和
   `protocol`（"地址可达但不是 MCP 服务"）这两类——用户自己排查不出来。

**第三批**（工作量大，确认前两批稳定后再做）

7. 出站 OAuth。现在 `externalClient.js:134` 只接受手工粘贴的静态 bearer token，
   所以连不上任何要 OAuth 的第三方服务器。注意本项目 `mcp/oauth.js` 是**入站**
   OAuth 服务端，方向相反，不能复用。参考
   `original-typescript/external-mcp-oauth-flow.ts`，四个细节不要漏：
   回调时校验 `code_challenge_method === 'S256'` 与 `state`、`redirect_uri`（第 198 行）；
   服务端不返回新 refresh_token 时保留旧的（第 153 行）；
   无 `registration_endpoint` 时提示用户手填 Client ID 而不是报"注册失败"（第 162 行）；
   带上 RFC 8707 resource indicator（第 218、227 行）。
   本项目是 headless，没有 IDE 的 `openExternal`，授权链接怎么交给操作员
   需要你自己设计，ShunCode 在这点上帮不上。

8. 自定义 CA 证书支持。本项目全仓没有 `NODE_EXTRA_CA_CERTS`/`caCert`/
   `createSecureContext`。**HTTP 出站和 stdio 子进程两条路都要管**
   （ShunCode 分别在 `external-mcp-network.ts` 和 `external-mcp-stdio-env.ts`），
   只做一半等于没做。

**明确不要做的**

- 不要动技能分页读取。本项目的 `expectedHash` 续读 + `E_STALE_FILE` +
  文本扩展名白名单比 ShunCode 的整文件读更安全。
- 不要引入 ShunCode 的压缩包导入 / 目录迁移 / 技能→工具 sidecar。
  那些服务于桌面 IDE 的终端用户界面，本项目是 headless agent-host，没有对应 UI。
- 不要移除或削弱：预算配额、入站 OAuth 速率限制、MCP resources、
  操作员审批队列、SSRF 防护、会话头严格校验、256 KiB 上限。
  这些 ShunCode **都没有**。

做完每一项请给出：改了哪些文件、怎么验证的、哪些没做到以及为什么。
不确定的地方直接说不确定，不要猜。

## ✂️ 复制到这里结束 ✂️

---

## 七、复核方式

```cmd
REM 生成参考源码包
npm run build:mcp-skills-package

REM 本仓库这边的依据
type recovered\shuncode-0.8.1\src\external-mcp-connection.ts
type recovered\shuncode-0.8.1\src\external-mcp-stdio-env.ts
type reconstructed\carrier-0.8.1\src\external-mcp-network-errors.js

REM web_agent 那边的现状
git clone --branch arena/01a0e8ea-web-agent https://github.com/cccjvav/web_agent.git
type web_agent\webagent-core\agent-host\src\mcp\stdioLaunch.js
type web_agent\webagent-core\agent-host\src\mcp\externalClient.js
```

> 本文档纠正了上一份对照报告的一处方向性错误（把入站 OAuth 服务端
> 当成了出站 OAuth 客户端）。上一份里"web_agent OAuth 完整"那句以此为准。
