# C阶段：真实MCP验收（普通CMD + conda）

先读 [总手册](README.md)。**当前本阶段BLOCKED**：完整候选与授权整合尚未放行。这里给出到时可按行执行的规程，不代表已经做过真实MCP验收。

## C00 必须先满足的条件

- B阶段的正确候选、真实激活、测试数据隔离已通过；A05类型门槛及已知权限问题已有明确解决/批准方案。
- Windows虚拟机无生产账号/文件/磁盘映射；仅开放本次必需的网络。测试前快照。
- 已说明工具作用域、读/写/命令确认规则、会话归属、令牌轮换和预期网络请求。工作区scope设置不是操作系统隔离。
- 明确候选使用的MCP协议版本与传输。原实现支持路径令牌和Streamable HTTP；不是随意的HTTP JSON接口。
- 若Bridge启动会自动建立公网隧道，必须事先批准该步骤；不要误以为点击Start只开本地端口。

未满足任何一项：记录BLOCKED，不继续。不能为了测试把所有权限默认设为允许、删除令牌或关闭TLS检查。

## C01 建立只含虚构文件的工作区

使用总手册同一个RUN；这里只会写验收目录里的固定文件。RUN必须是新轮次，不是主力项目。

```cmd
python -c "import os,base64; from pathlib import Path; r=Path(os.environ['RUN']); (r/'workspace'/'allowed.txt').write_text('alpha\n',encoding='utf-8'); (r/'workspace'/'pixel.gif').write_bytes(base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')); (r/'outside'/'do-not-touch.txt').write_text('OUTSIDE_FIXTURE_ONLY\n',encoding='utf-8')"
type "%RUN%\workspace\allowed.txt"
certutil -hashfile "%RUN%\outside\do-not-touch.txt" SHA256 > "%RUN%\logs\C01-outside-before.txt"
```

预期allowed.txt只有alpha一行，pixel.gif为1×1测试GIF，外部文件只是用于拒绝检查的虚构文本。打开候选应用时只打开RUN\workspace，不打开整个RUN；否则outside也会被纳入工作区，测试前提就错了。

## C02 准备独立Inspector客户端

本规程固定 **@modelcontextprotocol/inspector 2.6.0**，不是随时间变化的latest；要求Node **>=22.19.0**。恢复环境的最低要求22.13不能直接代替Inspector要求。先 `node --version` 核对。

可继续用满足要求的现有conda环境；如果不满足，建立独立验收环境（只需一次，不覆盖恢复环境）：

```cmd
conda create -n shuncode-mcp-acceptance -c conda-forge python=3.12 "nodejs>=22.19,<23" tk
conda activate shuncode-mcp-acceptance
node --version
```

同名环境已存在时先核对用途，不删掉旧环境。仍是普通CMD，不是Anaconda Prompt。

将Inspector装在本轮目录，不改恢复工程的依赖锁：

```cmd
call npm.cmd install --prefix "%RUN%\inspector" --save-exact @modelcontextprotocol/inspector@2.6.0 --ignore-scripts --no-audit --no-fund
set "INSPECT=%RUN%\inspector\node_modules\.bin\mcp-inspector.cmd"
call "%INSPECT%" --cli --help
```

预期有Usage与--config、--server、--method等选项。安装/帮助失败就停止，不删--ignore-scripts猜着继续；记录Node版本、错误和包版本。该步骤会联网下载客户端，不连接ShunCode。

本次写文档时已在Linux工具环境安装此固定版本并执行--cli --help成功，**没有声称已在Windows或真实ShunCode连接上验证Inspector**。安装出现server-legacy弃用警告，不能把它当作建议切回旧SSE传输。公开文档版本依据见 [来源与验证范围](SOURCES.md)。

## C03 从正确的测试Bridge取得地址

1. 进入候选Bridge页面，确认显示的是测试工作区，并确认当前未登录自有商业账号。
2. 按已批准的网络方案配置提供商；用测试隧道凭证，不用生产凭证。
3. 点击Start（或F1里的ShunCode: Start Bridge）。预期无自有付款/激活码步骤，但缺真实隧道配置时应明确拒绝。
4. 等到实际健康/运行信息就绪，复制当前MCP地址。若30秒仍无结果，先记FAIL并查看错误，不反复点击产生多个隧道。

**完整MCP地址含令牌，按密码保管。** 不贴到聊天、命令行参数、共享截图或公开日志里。不手工拼一个“看起来对”的地址；停止/重启/轮换后地址可能变化。

## C04 用私有只读配置指定唯一目标

```cmd
copy /-Y "%SOURCE%\docs\acceptance\mcp-config.example.json" "%RUN%\private\mcp.json"
notepad "%RUN%\private\mcp.json"
```

在记事本中只把url的示例占位内容换成刚复制的**测试Bridge完整地址**，保留双引号和逗号，保存。确认文件是mcp.json，不是mcp.json.txt。不要把生产服务加进这个文件。

示例使用type:streamable-http、protocolEra:legacy，先测试传统initialize握手；不是声称候选只支持legacy。现代协议另按C11测试。

隔离Inspector状态：

```cmd
set "MCP_STORAGE_DIR=%RUN%\private\inspector-storage"
set "MCP_INSPECTOR_OAUTH_STATE_PATH=%RUN%\private\inspector-storage\oauth.json"
```

使用--config而不是--catalog：前者读取指定文件、不创建样例服务器列表。所有命令显式选择--server acceptance，避免误测官方示例或自己的旧服务。--stored-auth-only禁止意外弹出交互OAuth，不代表已经验证令牌安全。

## C05 只握手，不先调用工具

```cmd
call "%INSPECT%" --cli --config "%RUN%\private\mcp.json" --server acceptance --method initialize --connect-timeout 15000 --stored-auth-only --format json > "%RUN%\private\C05-connect.json" 2> "%RUN%\private\C05-error.txt"
echo %ERRORLEVEL% > "%RUN%\logs\C05-exit.txt"
notepad "%RUN%\private\C05-connect.json"
```

**PASS：** 退出0，返回serverInfo、protocolVersion和capabilities等有效MCP信息；服务器名称/版本与候选相符。只得到网页、健康ok:true、TCP连接成功或空响应，都不能算MCP握手成功。

退出码参考（此固定客户端）：0成功；1用法/意外错误；3要求认证；4连接失败/超时；5工具错误；6严格schema可移植性问题。2是“未找到MCP App”等特定探测结果，不是本流程成功。必须同时看响应与错误文本，不能只凭数字猜原因。

路径令牌不等于OAuth。认证失败先核对当前测试地址/候选规则，不删除认证或改用无保护地址。没有用户配置的测试OAuth时，不临时登录生产账号。

## C06 列工具，核对测的是正确服务

```cmd
call "%INSPECT%" --cli --config "%RUN%\private\mcp.json" --server acceptance --method tools/list --connect-timeout 15000 --stored-auth-only --format json > "%RUN%\private\C06-tools.json" 2> "%RUN%\private\C06-error.txt"
echo %ERRORLEVEL% > "%RUN%\logs\C06-exit.txt"
notepad "%RUN%\private\C06-tools.json"
```

PASS：退出0，工具列表与候选的已批准清单一致，名称、描述、inputSchema有内容。至少核对候选承诺的read_files、find_files、search_files、read_image、apply_patch；总数受开关/Skills影响，不能固定说“必须13个”。不应把工具schema当路径授权。

如果看到官方filesystem/everything示例服务的工具，而不是候选清单：停止，配置连错了，不继续调用。

## C07 实际只读调用及结果对照

下面命令里的反斜线双引号用于Windows传递JSON，整条命令一行输入。不要把它转换成PowerShell或复制Linux单引号写法。

```cmd
call "%INSPECT%" --cli --config "%RUN%\private\mcp.json" --server acceptance --method tools/call --tool-name read_files --tool-args-json "{\"files\":[{\"path\":\"allowed.txt\"}]}" --connect-timeout 15000 --stored-auth-only --format json > "%RUN%\private\C07-read.json" 2> "%RUN%\private\C07-error.txt"
echo %ERRORLEVEL% > "%RUN%\logs\C07-exit.txt"
notepad "%RUN%\private\C07-read.json"
```

PASS：退出0，结果含alpha，指向allowed.txt，无isError:true；若出现授权询问，只批准本次允许文件。关闭记事本，继续同样方式测试下表（可复制上一条，仅替换tool-name、tool-args-json和输出编号）：

| 编号 | tool-name | CMD中完整tool-args-json参数值 | PASS对照 |
|---|---|---|---|
| C07-F | find_files | `"{\"patterns\":[\"*.txt\"]}"` | 找到allowed.txt，不包含RUN\outside文件 |
| C07-S | search_files | `"{\"pattern\":\"alpha\"}"` | 在allowed.txt中命中alpha |
| C07-I | read_image | `"{\"path\":\"pixel.gif\"}"` | image/gif，宽高1×1，有有效图片内容 |

每条结果分别写C07-F/S/I文件，不覆盖read结果。搜索返回Node引擎可以算工具回退功能通过，**不能拿它通过B02的原生ripgrep项**。

若更倾向GUI，可在相同私有配置下运行 `call "%INSPECT%" --config "%RUN%\private\mcp.json"`，打开它在本机打印的地址，选择acceptance并Connect，进入Tools选择上述工具填写参数。保留默认本机绑定/认证，不设置DANGEROUSLY_BIND_ALL_INTERFACES，不关闭代理认证或origin检查；不使用默认样例catalog。Inspector的界面/认证URL也可能含令牌，不截图外发。GUI找不到相应控件就用已记录的CLI，不猜隐藏按钮。Ctrl+C停止Inspector，不等于停止Bridge。

## C08 写入和回退：只动虚构文件

前提：候选承诺的写入授权/确认流程已实现。若声明所有操作自动允许，必须先评审策略；不得把未授权成功修改判PASS。

执行一次明确的补丁：

```cmd
call "%INSPECT%" --cli --config "%RUN%\private\mcp.json" --server acceptance --method tools/call --tool-name apply_patch --tool-args-json "{\"patch\":\"*** Begin Patch\n*** Update File: allowed.txt\n@@\n-alpha\n+beta\n*** End Patch\"}" --connect-timeout 15000 --stored-auth-only --format json > "%RUN%\private\C08-write.json" 2> "%RUN%\private\C08-error.txt"
echo %ERRORLEVEL% > "%RUN%\logs\C08-exit.txt"
type "%RUN%\workspace\allowed.txt"
```

PASS：按规则获得确认、工具成功，实际文件第一行变为beta，UI预览与落盘一致。不要只看“成功”字样。随后用同样补丁把 `-beta\n+alpha` 改回，确认恢复alpha并保留第二份结果。

再发送原来alpha→beta的补丁到一个不匹配内容的临时文件，应明确报上下文不匹配且字节不变，不能悄悄改相近位置。该负向用例由技术执行方提供固定夹具或在独立轮次准备，不能拿真实代码做错误补丁实验。

## C09 拒绝场景：必须有负向证据

| 检查 | 小白操作 | 预期与判定 |
|---|---|---|
| 错令牌 | 复制mcp.json为wrong-token.json，在记事本只替换URL最后令牌为INVALID_ACCEPTANCE_TOKEN；用该配置做C05 | 正确地址刚成功的前提下，错误令牌被拒绝，无有效会话。仅网络断开/超时不算权限通过；当前原路由错路径预期404 |
| 工作区外读取 | 用read_files，files里的path改为 `../outside/do-not-touch.txt` | 应拒绝，不返回OUTSIDE_FIXTURE_ONLY；返回了就FAIL并停止，不把workspace说明文字当隔离 |
| 明确拒绝写入 | 新一轮对虚构文件发起写入，出现确认时点拒绝；技术方核对实际取消/授权回调 | 内容和哈希不变，工具报告拒绝。没有确认却成功写入，不能PASS；原调度器丢回调是已知阻断项 |
| 会话隔离 | 两个独立测试客户端会话分别启动受控任务；按批准用例让B尝试读取/取消A的任务ID | 应遵守会话归属；不能随便用共享ID访问另一会话。每次CLI是新连接，不能把两次CLI调用当成同一持久会话；此项需技术执行方提供持久客户端夹具，否则BLOCKED |

本轮不给任意执行工具发删除/递归写入/扫描真实目录指令。文件工具拒绝越界，不证明run_command或自定义脚本也具备OS级隔离；该范围必须单独评审和验证。

## C10 停止、轮换与清理

1. 在Bridge页面点击Stop。预期服务/隧道确实停止，客户端不能继续成功调用。
2. 在确认候选的端点轮换语义后使用 **ShunCode: Rotate Bridge Endpoint**。把新地址写入另一份私有配置；新连接应成功，旧地址/令牌应按承诺失效。已建立会话的失效规则也要记录，不能只测试新连接。
3. 再停止Bridge，关闭Inspector和候选。检查任务管理器及候选日志；有残留Agent host/隧道时先记录，必要时关闭虚拟机，不执行泛化的taskkill清理整台主机。
4. 比较outside文件哈希与C01一致。保留必要的脱敏证据，轮换/销毁测试令牌和临时凭证，再恢复快照。

Stop后短时间的连接错误是预期，但停止前的超时不能据此倒推成正常。

## C11 协议兼容与远程客户端补验

上面先明确用legacy握手。若候选声称支持现代协议，复制私有配置，把protocolEra改为modern，再执行初始化、列工具和一次只读调用，记录实际协商版本；不以健康接口宣称的版本列表代替真实握手。没有明确版本承诺则BLOCKED等待清单。

如果产品承诺Arena/其他远程MCP客户端支持，还必须在该客户端的正式MCP配置界面添加测试地址，验证连接、列工具、一次只读调用和断开。不同客户端界面不一样，不能用Inspector通过替代所有客户端；没有账号/功能权限则该客户端项BLOCKED。地址只填客户端设置，不作为聊天消息发送。

## 对外提交哪些结果

提交脱敏的客户端名称/版本、传输与协商版本、候选构建标识、C05—C11结果状态和必要响应摘要。不能提交完整MCP地址、会话ID、私有配置、Inspector状态目录或OAuth内容。这里没有任何项目可以因为单元测试绿色而自动填写PASS。
