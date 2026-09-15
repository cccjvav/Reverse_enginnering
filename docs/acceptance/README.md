# Windows小白验收手册：从构建检查到安装/卸载

> 类型恢复进度：累计14个[候选类型契约](../../reconstructed/type-contracts/README.md)使独立合同模式诊断降至14条（11条定制Chat字段、3条HTTP边界）；原A05/JS推断基线仍59条，两种模式都失败，宿主与权限门槛未放行。

**你的终端固定为：普通CMD（cmd.exe），在里面激活conda。不要求Anaconda Prompt、PowerShell、venv。** 软件内部的受管终端目前使用产品自带Git Bash，这是产品资产，与“你用CMD操作”不冲突。

本手册是可执行的验收规程，不是“全部已验收”的报告。每项都有编号，配套 [结果记录表](RESULTS.csv)。

## 0. 先看今天能做到哪一步

| 阶段 | 当前事实 | 你现在怎么做 |
|---|---|---|
| A：恢复环境、自动化回归、实验bundle | 已有跨平台CI证据；你的电脑仍待实测 | 可以按本文执行 |
| A05：候选类型检查 | 当前59个错误，退出码1 | 可以复现；记FAIL，不要记PASS |
| B：完整候选宿主、原生资产、真实激活/GUI | 尚未提供完整验收候选，且有类型/安全阻断项 | **BLOCKED，不运行实验bundle冒充产品** |
| C：真实MCP客户端与授权 | 原调度器不转发逐文件权限回调，未完成安全整合 | **BLOCKED**；等候选通过前置门槛再做 |
| D：源码构建的完整Windows安装器 | 尚未产出 | **BLOCKED**；不要拿原0.7.4 EXE或overlay ZIP代替 |

当前参考证据：[源码连接构建](../LINKED_EXTENSION_BUILD.md)、[117项Node回归及CI](../evidence/extension-build-tests.json)、[59条类型诊断](../evidence/linked-type-diagnostics.json)。CI成功不等于你的电脑通过，也不等于GUI或安装器通过。

**PASS**＝做了该项且所有预期都满足；**FAIL**＝执行后不符合；**BLOCKED**＝缺前提不能执行；**NOT_RUN**＝具备条件但还未做。不要因为“应该能行”填写PASS。已知59错误可以是“复现正确”，但类型验收仍为FAIL。

## 1. 三个地方，绝不能混淆

| 名称 | 含义 | 禁止事项 |
|---|---|---|
| 源码目录SOURCE | 有package.json、tools、recovered的仓库 | 不改recovered原件来消除报错 |
| 验收目录RUN | 每一轮新建，保存日志与虚构测试文件 | 不放真实项目、聊天、密钥；不得覆盖旧轮次 |
| 候选应用APP | 将来发布者交付的完整可启动目录 | 不是源码目录，不是.work/linked-extension，也不是resources/app本身 |

B/C/D一律在**可恢复快照的Windows虚拟机**内，使用未登录生产账号的新Windows用户；关闭共享文件夹、宿主磁盘映射和不必要的剪贴板共享。先快照，后安装。若你没有这样的环境，先只做A，B/C/D记BLOCKED，不要求你为了验收冒险修改主力电脑。

`--user-data-dir`、`--extensions-dir`只隔离部分编辑器数据。原软件还可能访问Windows凭据、用户目录中的Codex账号、共享聊天/工作区Hub及注册表，**这两个参数不等于整机隔离**。

### 谁负责什么

- 技术执行方：提供候选产物、固定构建提交、哈希/资产清单、宿主版本、预计安装身份、已知风险、回退方案；记录自动化与Windows验证证据。
- 验收操作者：在隔离Windows桌面完成本文点击与观察，填写实际结果，保留脱敏证据。无法找到菜单时记BLOCKED，不需要猜代码。
- 不需要提供生产账号密码、API Key、商户密钥、Windows密码或证书私钥。网络/模型测试若需要账号，应使用你自己控制的独立测试账号；未配置则该项记BLOCKED，不能声称第三方认证已通过。

## 2. 打开普通CMD，准备本轮记录

Win+R，输入 `cmd`，Enter。看到 `C:\Users\名字>` 是提示符，别复制进去。所有命令每次输入一行，等结束后再下一行。普通权限即可，A不需要管理员。

```cmd
conda activate shuncode-recovery
set "SOURCE=你的源码根目录完整路径"
set "RUN=%USERPROFILE%\ShunCode-Acceptance\RUN-001"
cd /d "%SOURCE%"
if exist package.json (echo SOURCE_OK) else (echo STOP_WRONG_SOURCE)
if exist "%RUN%" echo STOP_RUN_ALREADY_EXISTS
```

把SOURCE中文占位符换成资源管理器地址栏中的真实路径，例如 `D:\Projects\Reverse_enginnering_of_shun`。若出现STOP，先停下修正。RUN已存在就改为RUN-002，**不删除旧结果腾位置**。

确认SOURCE_OK、RUN不存在后：

```cmd
mkdir "%RUN%\logs"
mkdir "%RUN%\screenshots"
mkdir "%RUN%\private"
mkdir "%RUN%\workspace"
mkdir "%RUN%\outside"
copy /-Y "%SOURCE%\docs\acceptance\RESULTS.csv" "%RUN%\results.csv"
ver > "%RUN%\logs\windows-version.txt"
node --version > "%RUN%\logs\node-version.txt"
python --version > "%RUN%\logs\python-version.txt"
```

若conda不能激活，先按 [CMD+conda指南](../WINDOWS_CMD_CONDA.md) 处理，不改用py -3或关闭系统安全机制。新开CMD后这些变量和激活状态可能没有了，要重新设置，不要复制进PS终端。

用Excel/WPS或记事本打开results.csv填写实际结果；不需要安装Excel才能验收。源文件是空白模板，不是自动测试报告。

## A. 现在可以执行的源码与环境检查

### A01 环境是否真来自conda

```cmd
where python
where node
where npm.cmd
python tools\check_cmd_environment.py > "%RUN%\logs\A01-environment.txt" 2>&1
echo %ERRORLEVEL% > "%RUN%\logs\A01-exit.txt"
type "%RUN%\logs\A01-exit.txt"
notepad "%RUN%\logs\A01-environment.txt"
```

**PASS预期：** 退出码0，JSON中ok:true，Python/Node/npm来自活动conda环境，Tk可导入。where列出多个路径时，靠前项优先。**FAIL：** 指向系统Python、Windows商店、全局Node、缺Tk或返回非零。先修环境，不继续测试。

日志可能含Windows用户名，外发前脱敏；不要导出完整环境变量。

### A02 安装锁定依赖

```cmd
call npm.cmd ci --ignore-scripts --no-audit --no-fund > "%RUN%\logs\A02-install.txt" 2>&1
echo %ERRORLEVEL% > "%RUN%\logs\A02-exit.txt"
type "%RUN%\logs\A02-exit.txt"
```

**PASS预期：** 0。会联网下载并写node_modules，不安装ShunCode。网络或证书错误记FAIL，保存首个错误；不删除锁文件、不关闭SSL验证、不使用任意镜像的包替换。

### A03 运行现有整套回归

```cmd
call tools\run-learning.cmd > "%RUN%\logs\A03-regression.txt" 2>&1
echo %ERRORLEVEL% > "%RUN%\logs\A03-exit.txt"
type "%RUN%\logs\A03-exit.txt"
```

**PASS预期：** 0，日志出现ALL_LEARNING_CHECKS_PASSED。早期源码连接基线为117项Node，本轮扩充后为133项Node；Python在Windows应运行34项（本地Linux记录中有3项Windows专属跳过，不能把该跳过结果复制为Windows验收）。测试数以后可能变化，要同时记录提交及实际日志。**这仍不是GUI/MCP验收。** 出错打开日志找第一个失败，别只看最后一句。

### A04 构建实验扩展并核对来源

```cmd
call npm.cmd run build:linked-extension > "%RUN%\logs\A04-build.txt" 2>&1
echo %ERRORLEVEL% > "%RUN%\logs\A04-build-exit.txt"
call npm.cmd run check:linked-extension > "%RUN%\logs\A04-check.txt" 2>&1
echo %ERRORLEVEL% > "%RUN%\logs\A04-check-exit.txt"
certutil -hashfile ".work\linked-extension\dist\extension.cjs" SHA256 > "%RUN%\logs\A04-sha256.txt"
```

每条命令若失败就停止后面的步骤。**PASS预期：** 两个退出码都是0，输出SHA与同一提交的 `docs/evidence/linked-extension.json` 中outputSha256一致；参考输入数73、共享连接31。当前基线bundle为1,673,367字节，SHA为：

```text
c97853579b4b9fab7f27f3647f41b19bdfb32c4f424af6be22db3b5378703a00
```

未来源码/依赖变化后必须使用新提交附带的哈希，不硬套旧哈希。哈希相同只是文件一致性，不证明安全。**不能把这份实验bundle覆盖到APP。**

### A05 真正的类型门槛（当前失败）

```cmd
call npm.cmd run diagnose:linked-types > "%RUN%\logs\A05-types.txt" 2>&1
echo %ERRORLEVEL% > "%RUN%\logs\A05-exit.txt"
type "%RUN%\logs\A05-exit.txt"
```

当前参考：退出码1、errorCount:59、candidateTypecheckPassed:false。在表中写 **FAIL，已复现当前59个已知错误**，不是你的操作失败，也不是PASS。日志含具体文件和位置。

将来的门槛：在经确认的宿主声明/类型方案下0错误，并经技术评审确认没有用any、跳过选项或删文件隐藏问题。仅给当前候选类型补字段，不证明宿主真的实现该字段。

**现在到这里就应停止完整产品放行路线。下面B/C/D是准备好的后续规程，不授权你拿半成品硬测主力安装。**

## B. 完整候选宿主、原生资产和真实GUI

### B00 领取候选、核对身份——没有资料就BLOCKED

技术执行方必须同时给出：完整应用目录/归档及SHA、构建提交、目标Windows架构、宿主commit、Electron/Node版本、资产清单与SHA、候选专用品牌/数据/安装标识、启动方式、已解决的类型/权限问题、预期网络清单。

“原0.7.4安装器”“overlay ZIP”“linked-extension的CJS”均不能充当完整新候选。对方只给一个EXE却没有对应构建/哈希时，不做正式放行。

在虚拟机中新建一轮RUN并设置SOURCE后，将候选解压到含空格的目录；以后再做中文路径的独立轮次。执行：

```cmd
set "APP=候选完整应用目录的绝对路径"
set "EXE=%APP%\ShunCode.exe"
dir /b "%APP%"
if exist "%EXE%" (echo EXE_FOUND) else (echo STOP_NO_EXE)
certutil -hashfile "%EXE%" SHA256 > "%RUN%\logs\B00-exe-hash.txt"
```

ShunCode.exe来自现有源码的命名约定；候选若明确改名，应改EXE并记录，不重命名二进制“修好”检查。把单个EXE哈希与发布清单对比，并核验整个发行归档；只验EXE不能覆盖其他资产。

### B01 宿主版本与隔离启动

第一次启动前，虚拟机快照、生产账号为空、仅有虚构文件；先断开外网，查看候选是否在离线时发生异常。确保APP内没有会覆盖CLI隔离参数的便携data配置；不能确认时记BLOCKED。

```cmd
start "ShunCode acceptance" "%EXE%" --new-window --user-data-dir "%RUN%\user-data" --extensions-dir "%RUN%\extensions" "%RUN%\workspace"
```

start后第一个引号是窗口标题，不能省略变成程序路径。该命令来自Code OSS常见CLI契约，**必须由候选说明确认支持**。进程启动命令返回0不等于窗口正常或已使用指定目录。

观察并记录：

1. 窗口标题/帮助→关于（Help→About）：记录版本、commit、Electron、Chromium、Node、架构；与候选清单逐项比对，不与conda Node混淆。
2. 标题/资源管理器显示的是RUN\workspace，不是历史项目。
3. 不出现你的真实聊天/模型账号；检查RUN\user-data、RUN\extensions有预期内容。发现生产资料立即停止，恢复快照，不继续授权。
4. 关闭窗口再用同一命令启动，测试数据仍在；另一轮RUN的用户数据不应串入。

**PASS：** 身份、目录和隔离结果均符合清单。版本号一样但Electron/commit不符，或出现未知原生模块ABI错误，均FAIL。无法确认数据目录则BLOCKED，不靠“看上去是空窗口”判断隔离。

### B02 原生资产：文件存在与实际可用分开验

在资源管理器打开 `%APP%\resources\app`，按照候选资产清单检查以下约定，逐个运行 `certutil -hashfile "实际文件完整路径" SHA256` 比对。目录本身不能用该命令当文件求哈希。

| 资产 | 从现有源码得到的定位线索 | 真正PASS还要做什么 |
|---|---|---|
| node-pty | resources/app/node_modules.asar/node-pty，或node_modules/node-pty | 在**候选Electron扩展宿主**中成功加载并创建PTY；不能用conda的node加载一次代替ABI验收 |
| Git Bash | resources/app/extensions/shuncode/runtime/git/bin/bash.exe | 执行下述受管终端小命令，读到结果；缺失时应该明确报错，不退回未知系统shell |
| Agent host | 扩展runtime/agent-host.js，或候选明确配置的入口 | ShunCode输出中实际解析到正确入口，子进程就绪并能处理一次受控请求；不能只看文件名 |
| ripgrep | 扩展runtime/bin/rg.exe | 资产哈希一致，诊断能确认本次查找/搜索使用ripgrep；只见Node回退不能把原生rg项记PASS |
| cloudflared/ngrok | 按候选清单定位，不能猜固定路径 | 只测试承诺支持的提供商；版本/来源核验后在C阶段建立并停止测试隧道 |

ASAR是归档文件，不是普通文件夹。若node_modules.asar不可浏览，让技术执行方提供归档内部清单和Electron加载日志，不要求你随便安装解包软件或把归档改名。

F1打开命令面板，搜索 **ShunCode: Show Runtime Status**；找不到时记录当前界面和菜单搜索结果，记BLOCKED。在输出面板（View→Output）选择ShunCode，检查实际runtime入口与就绪状态；没有可观察的就绪证据就不能通过。

受管终端测试只在已批准的候选与虚构工作区，通过原工具入口执行：

```text
printf 'ACCEPTANCE_TERMINAL_OK\n'
```

这是**产品内Git Bash的测试输入，不是在CMD里输入**。预期退出0并出现该标记。随后执行 `sleep 30`，在5秒左右取消，观察任务变为取消/停止、窗口不冻结；30秒后不应继续显示运行。技术执行方还需核对进程树是否清理，不能只看UI标签。没有执行入口或取消控件则BLOCKED。不要使用rm、注册表命令、远程下载脚本或生产路径试终端。

### B03 扩展是否真的激活

1. F1搜索 **Developer: Show Running Extensions**（中文通常为“开发人员: 显示正在运行的扩展”），找到ShunCode。记录运行位置、状态/激活时间。找不到命令也如实记录，不能编造截图。
2. View→Output，选择ShunCode；再查看Log (Extension Host)等宿主日志（译名可能不同）。寻找首次错误，不把无关扩展的绿勾当ShunCode成功。
3. F1执行 **ShunCode: Show Runtime Status**，确认有响应，无“command not found”。
4. F1执行 **Developer: Reload Window**，重复以上检查；没有重复注册、崩溃循环或启动后立即退出。

FAIL例：Cannot find module、node-pty ABI不匹配、缺Agent host、proposed API不被允许、Cannot read properties of undefined。记录完整第一条错误及堆栈的非敏感部分，不关闭扩展验证或强行允许所有proposed API来掩盖。

### B04 原生Chat/Workbench/Sessions界面对照

先在Workspace建虚构文件（做法见C文档）；打开Chat入口和Bridge入口。候选必须给出两个宿主入口的实际点击路径；若Sessions入口未提供，这项BLOCKED，不能只测Workbench就通过。

| 操作 | 预期 | 不通过的典型表现 |
|---|---|---|
| 普通窗口打开Bridge | 显示社区说明，不要求自有商业账号/付款/激活码 | 旧购物区残留，或点按钮无反应 |
| 按候选步骤进入Sessions，再打开Bridge | 同样社区策略，布局与绑定正确 | 只有一个宿主正确、另一个报变量未定义 |
| 在原生Chat中对虚构文件执行一次只读操作 | 工具结果卡片可读，items/metrics等已承诺字段展示正确 | 卡片空白、undefined、异常 |
| 在获得写入确认后修改虚构文件 | diff预览、实际前后内容一致 | 预览与落盘不同、无授权即修改 |
| 缩窄/放大窗口、滚动、关闭重开 | 主要控件可见且可点击，无明显裁切 | 文本遮挡按钮、状态与实际运行不符 |

没有模型测试账号时，依赖模型的Chat项BLOCKED；可以先通过Inspector测试工具，但不能把它记成Chat UI通过。真实调用可能计费，先设置测试额度。自有商业免费不代表第三方模型免费。

## C. 真正的MCP协议、工具与拒绝场景

详见 [MCP逐步验收](MCP.md)，包含固定版本Inspector、CMD命令、连接配置、测试输入和应有结果。它有独立前置门槛，当前不能跳过已知权限问题直接公开服务。

## D. 完整Windows安装器验收

详见 [安装、新装/升级/卸载规程](INSTALLER.md)。只能测试与候选源码构建相对应的完整安装器，不能给ZIP套壳后当源码恢复成功。

## 7. 证据怎么保存和发出

每项至少保存：编号、候选提交/哈希、实际日期、Windows/应用版本、实际步骤、预期、观察、状态、证据文件名。结果表中的“当前项目状态”是写文档时的参考，**不是你执行后的状态**。

截图：Win+Shift+S只截测试界面；移除MCP地址里的令牌、授权头、模型Key、登录信息和真实用户名。MCP完整URL、会话ID、Inspector认证URL与私有配置全部留在RUN\private，不放Git、不粘贴聊天。完整user-data、.codex、Windows凭据和整个环境变量不能作为普通证据包发送。

可分享内容只包括脱敏后的结果表、必要日志节选与截图。保留未脱敏原件在隔离验收机本地，避免误脱敏后失去追踪能力。不要自动打包整个RUN。

## 8. 停止与放行

出现意外生产数据、未授权读写、令牌泄漏、连接错误目标、未知支付/登录页面、写错目录或崩溃循环：停止客户端、用Bridge Stop关闭服务、关候选应用；仍有残留或不确定时关闭虚拟机/恢复快照。**不要先卸载或删目录来破坏事故证据**。

源码/环境通过不能豁免B/C/D。正式放行要求所有发布范围内必测项PASS、无未处理阻断问题；N/A必须写明产品明确不支持的范围及审批依据，不能把失败的必测项改成N/A。当前总结果是 **NOT_READY / 不可作为完整恢复版本发布**。
