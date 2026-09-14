# 第0—3课：第一次安全地跑通恢复实验

## 这节课结束后，你应该能做什么

你应能：找对源码根目录；区分命令与输出；运行一个不会启动真实 Bridge 的实验；解释为什么社区版 `signedIn` 是 false、旧 `licensed` 却是 true；理解付款被拒绝为何是预期行为；看懂一次按位置修改字符串；知道教程和应用哪些还没完成。

**本节不安装补丁、不启动原安装器、不运行原扩展、不连接你的模型或隧道。** 你不需要支付宝信息、GitHub密码、模型密钥，也不需要管理员权限。不要把任何凭证发给我或贴到公开日志。

---

## 第0课：先认识文件和三个“地方”

### 0.1 三个目录不能混淆

| 名称 | 里面通常有什么 | 本节用途 |
|---|---|---|
| 源码根目录 | `package.json`、`tools`、`tests`、`community`、`recovered`、`reconstructed` | 所有实验命令在这里执行 |
| 已安装的 ShunCode 应用目录 | 程序文件及 `resources/app` | 本节**不操作**它 |
| 你平常写代码的项目目录 | 自己的项目文件 | 本节也**不拿它做读写实验** |

“根目录”不是电脑的C盘根，也不是一个固定叫 root 的文件夹；这里指这一份源码的最外层项目目录。

### 0.2 取得一份学习副本

1. 打开[本项目的固定工作分支](https://github.com/cccjvav/Reverse_enginnering_of_shun/tree/arena/01a09d2c-reverse-enginnering-of-shun)。确认分支栏显示 `arena/01a09d2c-reverse-enginnering-of-shun`。
2. 点击 **Code → Download ZIP**。这是源码下载，不是社区更新包。
3. 在你有写入权限的位置建立学习目录，例如“下载”文件夹内的 `ShunCode-learning`。不要放到 `Program Files`、正在使用的应用目录或唯一工作资料上。
4. 右键ZIP，选择“全部提取/解压”；不要直接在压缩包预览窗口里运行脚本。
5. 进入解压后的目录，找到同时含有 `package.json`、`tools`、`community` 的那一层。解压产生多一层同名目录很常见，以内容判断，不猜文件夹名字。
6. 保留下载ZIP不动，它是本次学习副本的恢复来源。真正安装补丁之前，仍要另外备份应用和用户数据；源码ZIP不是那些数据的备份。

源码里的 EXE 如果只有百余字节，可能是 Git LFS 指针：它记录大文件的位置和摘要，不是坏掉的小安装器。**本节不需要下载或运行那个 EXE**，需要的文本证据已经在源码中。

### 0.3 打开文件扩展名显示

Windows 11 的资源管理器一般在“查看 → 显示 → 文件扩展名”；Windows 10 一般在“查看”选项卡勾选“文件扩展名”。界面随系统版本可能不同，目标是能看见 `.md`、`.json`、`.ts`、`.mjs` 等后缀。

- `.md`：Markdown文档，直接阅读，不当程序运行。
- `.json`：结构化数据或配置，例如依赖和来源清单。
- `.ts/.mts`：TypeScript源码，带类型；通常需转译再执行。
- `.js/.mjs/.cjs`：JavaScript，不代表可以不审查就双击运行。
- `.py`：Python脚本。
- `.zip`：压缩归档，不是代码编译器。

不要把 `example.mjs.txt` 误当成 `example.mjs`，也不要通过改后缀把文档“变成程序”。

---

## 第1课：准备终端与工具

### 1.1 打开 PowerShell

从开始菜单搜索 **PowerShell**，普通打开即可；或者在资源管理器中打开学习源码目录后使用“在终端中打开”，确认终端标签是 PowerShell，而不是命令提示符/WSL。不同终端的语法有差别。

你可能看到：

```text
PS C:\Users\你的用户名>
```

这是**提示符**，表示当前目录，不是要复制执行的命令。下面所有代码块中的命令都不带这个提示符。每次粘贴一条命令，检查后按 Enter，等它结束再执行下一条。

### 1.2 确认 Node.js

输入：

```powershell
node --version
```

若已安装，通常输出 `v22.x.x` 或其他具体版本。此恢复工具链使用 Node 22.13+；Node 24也满足当前分析依赖的要求。这里的版本不是 ShunCode 版本，也不是 Electron 版本。

没有安装或版本太旧：到 [nodejs.org](https://nodejs.org/) 取得适合你Windows架构、满足上述要求的安装包。安装后关闭并重新打开终端，重新检查。不要从“破解工具合集”下载 Node。

再输入：

```powershell
npm.cmd --version
```

npm 是 Node 的包管理工具。这里在 Windows 明确使用 `npm.cmd`，避免 PowerShell 有时优先选中 `npm.ps1` 而触发脚本策略错误。**不需要因此关闭执行策略或安全软件。** Linux/macOS一般直接使用 `npm`。

### 1.3 Python什么时候需要

本节教学模拟只需要 Node。后面的恢复工具回归测试和实际更新器才需要 Python 3.10+。

先检查：

```powershell
py -3 --version
```

如果找不到 `py`，试：

```powershell
python --version
```

两者都不可用，再从 [python.org/downloads/windows](https://www.python.org/downloads/windows/) 安装Python，实际GUI更新器还需要 Tcl/Tk。安装方式随版本变化，以官方安装说明为准。若输入 `python` 只打开商店，并不表示解释器已经可用；安装后重开终端再确认。

### 1.4 切换到源码根目录

在资源管理器地址栏复制源码根目录的完整路径。在下面命令的双引号里放入你自己的路径：

```powershell
Set-Location -LiteralPath "你复制的源码根目录完整路径"
```

**这句有占位符，不能原样照抄。** `Set-Location` 切换当前目录；`-LiteralPath` 按原样解释路径；双引号让带空格/中文的路径作为一个参数。不要用中文弯引号 `“ ”` 代替程序需要的英文直引号 `"`。

验证：

```powershell
Get-Location
Get-ChildItem -Name
Test-Path .\package.json
Test-Path .\tools\learning_lab.mjs
```

最后两项应为 `True`。`Get-Location` 只显示位置，`Get-ChildItem` 只列文件；`Test-Path` 检查路径是否存在。`.\` 表示当前目录。

若为 `False`：停下，回到解压目录找正确那一层。不要为了让命令成功就新建空 `package.json`，也不要在系统目录随意运行安装命令。

### 1.5 安装分析工具依赖

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
```

逐项解释：

- `npm.cmd`：调用npm的Windows命令包装器。
- `ci`：按 `package-lock.json` 的锁定版本安装；会重建依赖目录，不是安装ShunCode。
- `--ignore-scripts`：不运行依赖包的安装脚本，适用于这里已经采用的恢复工具安装方式。
- `--no-audit`：本条命令不额外发送npm漏洞审计请求；不表示依赖已通过安全审计。
- `--no-fund`：不显示资助提示；不是付费解锁参数。

**会发生什么：** 从包仓库下载依赖，写入本学习副本的 `node_modules` 和npm缓存。联网来自安装工具依赖，不是 Bridge 商业登录。不会修改已安装的 ShunCode。

正常情况：命令最后返回提示符，没有失败退出。下载条目、用时和提示可因环境不同，不要求与你看到的截图/示例逐字一样。

在该命令结束后立即查看退出码：

```powershell
$LASTEXITCODE
```

外部命令通常以 `0` 表示成功，非0表示失败。它可能保留前一个外部命令的结果，所以要紧接在你要检查的命令之后看，不能隔几条命令再猜属于谁。

若失败，先看本页“故障排查”，不要删掉锁文件再试 `npm install` 来掩盖版本问题。完整 Code OSS 构建需要另一套已确认工具链，**不能把这里的 `--ignore-scripts` 原样照搬过去**。

---

## 第2课：先确认教材没过期，再运行模拟

### 2.1 检查逐行解释与源码一致

```powershell
npm.cmd run learn:check
```

- `run`：运行 `package.json` 中同名脚本，不是让你打开一个叫 run 的文件。
- `learn:check`：检查三个文件的SHA、每行原文、行号、解释和覆盖清单。
- 它读取源码/教材，不运行原扩展，不应用补丁。

成功输出包含这些要点（总文件/总行数会随项目增长）：

```text
"fullyExplainedFiles": 3
"explainedLines": 134
"projectWideExplanationComplete": false
```

`false` 在这里是诚实的进度标记，不是检查失败。退出码仍应为0。

若看到 `Lesson source changed` 或 `Stale lesson artifact`：源码和教材不配套。初学者应重新取得同一提交的一整份学习副本；不要只把SHA字段改掉，也不要盲目运行生成命令来“消灭报错”。维护者必须先审查差异和逐行解释，再生成。

### 2.2 运行不会启动真实服务器的实验

```powershell
npm.cmd run learn:lab
```

它只转译并运行两个本次新写的社区策略文件，用一个 **stub（替身）** 代替 BridgeManager。替身只记录启动/停止次数，不监听端口，不连接隧道或模型。

实验中的支付、兑换和未知能力调用都应被拒绝。拒绝被测试程序捕获并检查，所以它们是**预期失败**，不是整个实验坏了。

输出应包含：

```json
{
  "simulationOnly": true,
  "realBridgeStarted": false,
  "edition": "community",
  "signedIn": false,
  "legacyLicensed": true,
  "paymentRejected": true,
  "redemptionRejected": true,
  "unknownCapabilityRejected": true,
  "stubStarts": 1,
  "stubStops": 1,
  "edited": "aXdefYj",
  "locatedVariable": "price",
  "sha256OfAbc": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
}
```

逐项观察：

- 前两项说明这只是模拟，**不表示软件已经能真实启动**。
- `signedIn:false`：没有伪装登录；`legacyLicensed:true`：兼容旧接口的本地可用性值，不是签名许可证。
- 三个 `Rejected:true`：付款/兑换/未知能力正确失败。
- `stubStarts/stubStops`：模拟启动一次、显式停止一次。途中旧账号登出没有额外停止它。
- `edited`：下面第3课会手算为什么是这个字符串。
- `locatedVariable`：AST里按条件唯一找到 price 声明。
- 最后一项是字符串 `abc` 的SHA-256，不是你安装包的哈希，更不是密码。

实验明确限制它使用的网络/定时器入口并用存储替身检查误访问，但这**不是安全沙箱**。不要把未知下载代码塞进这个加载器运行。

### 2.3 再看完整回归，而不是把模拟当验收

```powershell
npm.cmd test
```

完整测试包含临时文件读写和本机回环HTTP测试，范围比教学模拟大，但仍不运行安装器或完整原应用。测试夹具会清理。它不是“绝对不写磁盘”。

读结果时先看结尾：`fail` 应为0、没有 `cancelled`。测试数量随新增用例增长，不要仅凭数量认定安全。若失败，记录失败用例名称、第一段错误和退出码。

特别注意 `KNOWN SNAPSHOT RISK`：这类测试专门确认原版本缺陷可以重现。它通过意味着“证实风险存在”，不是“安全问题已经解决”。

可选Python回归（使用你已经确认可用的解释器）：

```powershell
py -3 -m unittest discover -s tests -q
```

没有 `py` 但有Python时用：

```powershell
python -m unittest discover -s tests -q
```

`-m unittest` 运行Python内建测试模块，`discover` 寻找测试，`-s tests` 指定目录，`-q` 减少输出。本轮基线为23项、结尾 `OK`；不是23个应用功能全部验收通过。

---

## 第3课：先看数据流，再逐行读代码

### 3.1 为什么不能全局替换“认证”

```text
自己的商店账号/付款 ── 原先用于限制是否能启动 Bridge
MCP 路由令牌       ── 限制谁能访问工具接口
工作区/工具权限     ── 限制允许操作什么
模型账号/API Key   ── 使用第三方模型服务
隧道凭证           ── 使用真实公网隧道服务
```

本次移除第一层，不等于后四层也应删除。变量名里带 `auth`、`token`、`license` 只能提示你去调查，不能直接决定删掉。

社区模式的简化调用链：

```text
界面/命令 → BridgeAccessController
               ├─ getAccessStatus / 旧商店入口 → BridgeLicenseService（本地策略）
               ├─ start → 真正 BridgeManager.start（可能失败）
               └─ stop  → 真正 BridgeManager.stop
```

本实验把“真正 BridgeManager”换成替身，因此只能证明转发次数和约定，不能证明真实端口、会话、UI、隧道可用。

### 3.2 读 TypeScript 前必须认识的符号

| 写法 | 在本节里的意思 | 容易误会的地方 |
|---|---|---|
| `const` / `let` | 声明变量；前者不能重新给变量绑定另一个值 | const对象内部仍可能可改 |
| `true` / `false` | 布尔值 | 带引号的 `"false"` 是字符串，条件中反而是真值 |
| `""` / `[]` / `{}` | 空字符串 / 空数组 / 空对象 | 不是同一种“空”，旧接口期待的形状不同 |
| `interface` | TypeScript类型约定 | 转译后不成为运行对象 |
| `readonly` | 类型检查层面的只读约束 | 不自动执行 Object.freeze |
| `class` / `new` | 类定义 / 创建实例 | 定义类不等于已经启动服务器 |
| `this` | 当前方法所属实例 | 摘下方法单独调用可能丢失实例绑定 |
| `async` / `Promise<T>` | 异步返回约定，成功值为T | 方法里没 await 也可返回Promise |
| `await` | 等待Promise完成并取得值或收到错误 | 不是让其他所有代码都停住 |
| `void` | 没有有意义的返回值 | 不是布尔false |
| `never` | 在这些方法里表示不会正常返回成功值 | Promise<never>不是“永远挂起”；这里会拒绝 |
| `?` | 参数可省略；在 `?.` 中则是可选链 | 两处语法位置的意思不同 |
| `unknown` | 类型尚不确定，应先检查再使用 | 不等于已经知道所有属性都存在 |
| `_name` | 本项目用来提示“故意不用”的参数名 | 下划线本身不改变JS执行规则 |
| `throw new Error(...)` | 明确失败 | async中表现为Promise拒绝，需要await/catch处理 |
| `export` / `import type` | 导出 / 只导入类型 | type import会擦除，不自动载入服务器 |
| `!==` | 严格不相等 | 不是给变量赋值的 `=` |
| `//` / `/** ... */` | 单行 / 多行注释 | 注释说明意图，仍须用实现和测试核对 |

TypeScript → esbuild转译 → JavaScript不是“恢复原始类型”。我们的新策略本来就是新写的TS；从旧bundle拆出的JS则仍缺原始类型。esbuild转译成功也不是完整 `tsc` 类型检查通过。

### 3.3 手算逆序替换

原字符串与索引：

```text
字符：a b c d e f g h i j
索引：0 1 2 3 4 5 6 7 8 9
```

要把 `[1,3)` 即 `bc` 替成 `X`，把 `[6,9)` 即 `ghi` 替成 `Y`。方括号表示包含起点，右圆括号表示不包含终点。

1. 先做靠后的 `[6,9)`：`abcdefghij` → `abcdefYj`。
2. 再做靠前的 `[1,3)`：`abcdefYj` → `aXdefYj`。
3. 如果先改前面，字符串长度已变，后面原来的索引就可能失准。
4. 两个编辑区间重叠时不要猜；工具抛错让整个补丁停止。

JS字符串索引是UTF-16单元：`a😀b` 中 emoji占两个单元，替换它要用 `[1,3)`。这不是UTF-8文件字节偏移；中文/emoji场景不能混算。

AST把程序分成“变量声明、函数、调用”等结构。`allNodes`只遍历解析器生成的树；`only`要求筛选后恰好一个结果。找不到或找到多个就停止，不是随便改第一处名字相同的文本。

### 3.4 正式逐行阅读

打开 [LINE_BY_LINE.md](LINE_BY_LINE.md)。每一项包含：原文件、来源SHA、行号、真实代码和解释。先看服务，再看控制器，最后看补丁工具。

不要只看 true/false 那几行：状态形状、旧方法兼容、错误传播、空dispose的范围、构造器参数属性、类型擦除等都是避免改坏程序的关键。

---

## 自测与答案

先自行回答，再对照：

1. **为什么 `signedIn:false` 还可以免费？** 免费策略不需要商业账号；能力可用与商业登录是两种状态。
2. **能把所有 token 检查删掉吗？** 不能。MCP、隧道和模型凭证仍保护真实服务。
3. **`licensed:true` 是伪造许可证吗？** 在这份新策略里不是；它是旧接口可用性兼容值，没有签名/订单。但仍需改旧 UI，不能假定所有旧代码都理解这个区别。
4. **`readonly` 能防止运行时修改对象吗？** 不能。返回新对象能避免一次返回值被改坏后污染后续快照，但也不是整个对象深度冻结。
5. **旧 `signOut` 为什么不调用 stop？** 商店已退出产品策略；商店登出不应停止免费 Bridge。显式停止按钮仍必须调用真正的stop。
6. **为何不是让 createPayment 返回一个假成功？** 旧界面可能据此继续支付/轮询；明确拒绝能阻断收费路径，且不伪造交易。
7. **start 报 Unsafe workspace 时能 catch 后改回 running 吗？** 不能。这会伪造运行状态并掩盖安全错误。
8. **模拟实验通过证明安装包可用吗？** 不证明。真实宿主、MCP、Windows GUI和安装升级仍需各自验收。
9. **哈希相同证明代码安全吗？** 不证明。它证明对比的内容一致；坏代码也有稳定哈希。
10. **覆盖134行是不是全工程逐行教程完成？** 不是。其余文件和行数明确标为待讲，见覆盖清单。

### 可安全做的练习

- 不改代码，先在纸上预测 `loadPlans(true)`、`getPaymentOrder("example")`、`requireFeature("other")` 的结果，再对照逐行页和现有测试。
- 用两个不同长度的替换手算 `applyEdits`，解释为什么先改后面。
- 在 `tests/community-policy.test.mjs` 中找到“付款应拒绝”和“登出不应停止”的测试名称，检查它们究竟断言了什么。这个测试文件的完整逐行解释仍待补，不把能定位两条断言当作整份已讲。
- 如确实想改代码练习，只在额外学习副本里改一行注释，运行 `learn:check` 观察过期拒绝，然后从保留ZIP恢复那一个文件。**不要改原件、真实安装目录或SHA字段。** 注释变化触发检查也正常：教材锁定的是具体源码版本。

---

## 故障排查：先定位，再修复

| 现象 | 先判断什么 | 安全处理 |
|---|---|---|
| 找不到 node/npm | 是否安装、是否重开终端、PATH是否生效 | 重开终端，再用官方安装器检查安装；别下载陌生“补丁” |
| 提示 npm.ps1 被阻止 | 是否调用了PowerShell脚本包装器 | 使用本页 `npm.cmd`，不关闭系统执行策略 |
| 找不到 package.json/ENOENT | 当前目录是不是源码根 | Get-Location、Test-Path检查，回到正确解压层 |
| npm ci说锁文件不一致 | 是否混用了不同提交的文件或改过package | 重取同一提交完整副本，不删锁文件冒充解决 |
| 下载超时/证书错误 | 是网络/证书问题，不是商业门槛 | 保存错误、稍后重试或检查正常网络；不设 strict-ssl=false |
| EACCES/EPERM | 目录权限或文件被占用 | 换到用户可写的学习副本，关闭占用者，不首先提权 |
| Python命令打开商店 | 实际解释器可能没装好 | 核查官方Python安装和可用命令，不把商店窗口当版本输出 |
| Lesson source changed | 教材与源码版本不配套 | 恢复同版本副本；维护者先重新审阅，不手改指纹 |
| lab出现未捕获错误 | 是真实失败，不是输出里 Rejected:true | 保存完整第一条错误和退出码，不继续到安装 |
| npm test有 not ok/fail非0 | 某项断言没满足 | 记录用例名与错误；不能把测试删掉当修复 |
| 已打补丁后再打被拒绝 | 文件不再是原始哈希 | 正常保护；需要重打时先按真实备份回退，不叠加两种路线 |

命令明显卡住时可按 **Ctrl+C** 终止。终止下载可能留下不完整的依赖目录；修好原因后在学习副本重跑 `npm ci`。本节没有执行安装更新器，所以不涉及应用文件回滚。

求助时发：系统版本、`node --version`、当前目录是否含所需文件、执行的命令、第一段错误及退出码。路径里的用户名可以遮掉；不要发模型Key、MCP地址、隧道token、订单凭证或个人文件内容。

---

## 下一步去哪里？哪些事现在别做？

- 想理解免费逻辑：继续逐行页，然后等待覆盖清单中的构建器/UI/更新器章节；不要用全局字符串替换代替理解。
- 想给已有用户迁移：阅读 [用户迁移教程](../../community/MIGRATION_FOR_USERS.md)。实际应用要另选安装目录副本、关闭进程、全部哈希通过后确认；本节不会替你做这一步。
- 想从零制作完整安装器：阅读 [Windows路线](../WINDOWS_BUILD_GUIDE.md)。公开Code OSS底座还没最终匹配、共享/宿主接线仍缺，当前没有一条已经验证能生成完整ShunCode安装器的命令。
- 想知道所有还没讲的文件：打开 [覆盖清单](COVERAGE.md)。它明确列待办，不会把高级进度报告冒充面向小白的逐行课。

你可以分享课程和更新包链接，但应一并保留实验性、版本匹配、回退与已知安全风险说明。自己的收费门槛移除是作者授权的产品调整，不是允许绕过第三方服务认证。
