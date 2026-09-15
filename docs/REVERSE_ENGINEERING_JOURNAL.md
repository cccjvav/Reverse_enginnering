# ShunCode 逆向恢复操作日志（教学版）

这不是“反编译一次就找回整个工程”。我们把它拆成可验证的小步骤：原包 → 安装器格式 → 应用资源 → 代码来源 → 可维护工程 → 可重复构建。每个阶段保留证据，不将猜测写成结论。

## 安全与记录约定

- 分析作者自己的软件；不执行安装器或包内脚本，不使用包内凭证访问服务。
- 原始安装包保持不变，SHA-256 用来证明后续分析的是同一文件。
- 使用已有的开源格式解析工具优先于自己逆向压缩算法；工具有版本记录。
- 大型运行时/原包不重复提交。小报告写入 `docs/evidence/`，脚本写入 `tools/`。
- 包中出现的 JS 不自动等于原始源码。恢复结果需标注“原样提取”“source map 内嵌源码”“人工重建”。
- 自动报告有条数/体积上限；截断或失败会明确标注。工作流显示绿色只说明脚本完成，必须继续读报告中的退出码。

## 01 — 定位原始材料与解决传输（2026-09-14）

**问题：** 能否取得作者上传的 Windows 安装包？

```bash
git fetch origin arena/01a09d2c-reverse-enginnering-of-shun
git ls-tree -rl FETCH_HEAD
git show FETCH_HEAD:ShunCode-0.7.4-win32-x64-Setup.exe
```

**观察：** 文件名是 `.exe`，Git 对象却只有 134 字节。内容是 `version https://git-lfs.github.com/spec/v1`、`oid sha256:...`、`size ...`。

**解释：** 这是 Git LFS 指针，不是安装器；Git fetch 成功不能证明 241 MB 的包已经下载。LFS 指针标明实际文件大小为 240,559,253 字节，SHA-256 为 `fdc2328b2520a128fd3449ed2015a7383e2b7dafaae05c3892d5a4c11a671272`。

**失败记录：** 沙箱到 `media.githubusercontent.com`、`github-cloud.githubusercontent.com` 的 TLS 连接失败；LFS batch API 本身可用。此前 Linux Release 的资源下载域名也失败。不是安装包损坏的证据。

**解决：** 在 GitHub Windows runner 中使用 `actions/checkout` 的 `lfs: true` 下载，Python 重新计算完整 SHA-256。运行 [34849979254](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34849979254) 成功校验文件，并将小报告提交回本分支。

**证据：** [`evidence/windows-package.json`](evidence/windows-package.json)。本地仅需 Git fetch 报告，不再下载大包。

## 02 — 第一轮通用解包尝试

```text
7z l -slt -sccUTF-8 ShunCode-0.7.4-win32-x64-Setup.exe
```

`l` 只列出档案内容，`-slt` 输出机器可读详细属性，不执行 EXE。

**结果：** 退出码 2，没有内部文件列表。**不能因此断言文件加密、损坏，或属于某一种安装器。** 原工具没保留详细错误文本，这是记录不足；下一轮补上有体积限制的诊断文本，并去掉非必要编码参数重试。

**知识点：** `.exe` 既可能是程序，也可能是“解包小程序 + 压缩数据”的安装器。能识别 PE 头，不代表能识别它承载的数据。

## 03 — 按格式识别，而不是盲目换工具

脚本：[`../tools/installer_forensics.py`](../tools/installer_forensics.py)。
工作流：[`../.github/workflows/installer-forensics.yml`](../.github/workflows/installer-forensics.yml)。

执行步骤：

1. **再验哈希。** 输入不符合已确认的大小和哈希就停止，不对未知替换件自动继续。
2. **读取 PE 表。** DOS 头偏移 `0x3c` 给出 `e_lfanew`；该偏移应为 `PE\0\0`。COFF 头包含机器类型、节数和可选头长度；随后解析节的文件偏移及大小。
3. **计算节末尾后的数据量。** 大量尾部数据可能是安装器载荷，但也可能包含证书。安装器 stub 的 x86/x64 与应用自身架构不是一回事。
4. **只查允许的格式标记。** 查找 `Inno Setup Setup Data (`、`NullsoftInst`、7z/ZIP 文件头，记录偏移。标记是识别线索，不单独作为最终结论；不导出任意字符串以免公开密钥或私有地址。
5. **尝试专用解析器。** Ubuntu runner 从发行版仓库安装 `innoextract` 和 `p7zip-full`，记录 innoextract 版本，再运行：

   ```bash
   innoextract --version
   innoextract --list ShunCode-0.7.4-win32-x64-Setup.exe
   ```

6. 仅在专用解析器列表成功时，尝试 `innoextract --extract --output-dir .work/windows-extracted ...`。这是读取档案并写出文件，不是启动安装器。
7. 仅在解包退出码为 0 时生成应用资源清单：`package.json`、`product.json` 的允许字段，`.asar`、`.node`、source map 的数量和哈希。不会提交完整安装目录。

**下一步依结果分支：**

- 成功解包：确认 Electron/Code OSS 版本以及应用主入口，再定位作者定制代码。
- Inno 格式但解析失败：核对具体版本是否受工具支持，不盲目认定有加密。
- 不是 Inno：根据 PE 与标记信息选择别的格式解析工具。

这一节先记录实验设计；实际运行结果将随后补记，不能视为已解包成功。

### 03 实测结果与修正

运行 [34850939922](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34850939922)，证据保存于 [`evidence/installer-forensics.json`](evidence/installer-forensics.json)。

- 在文件偏移 **698,348** 和 **238,601,591** 发现 `Inno Setup Setup Data (6.4.0.1)`。专用解析器也检测到 6.4.0.1，格式判断获得第二项佐证。
- PE 机器类型为 `0x14c`（x86 启动 stub），节末尾为 **932,352**；其后的 **239,626,901** 字节与“大部分体积是安装载荷”相符。仍不能用这个 stub 的架构推断最终应用是 x86。
- 去掉编码参数重新运行 7-Zip 23.01，仍报 `Cannot open the file as archive`，不是仅由该参数造成的失败。
- 系统 `innoextract 1.9` 的版本输出明确标称支持到 **6.0.5**；实际解析 6.4.0.1 报 `Stream error while parsing setup headers`。

**判断：** 输入哈希正确且解析器落后，优先解决版本兼容，而不是修改原安装包或猜测存在密码。

查证上游版本支持：

```bash
gh api repos/dscharrer/innoextract/commits \
  --jq '.[0] | {sha,date:.commit.committer.date,message:.commit.message}'
gh api repos/dscharrer/innoextract/contents/src/setup/version.cpp \
  --jq .content | base64 -d | grep '6, 4'
```

上游提交 `6e9e34ed0876014fdb46e684103ef8c3605e382e` 的格式表包含 `Inno Setup Setup Data (6.4.0.1)`。这只是选择工具的依据，**仍要用真实包检验是否能成功提取**。

### 04 — 从固定源码构建匹配的解析器

在 runner 内安装 CMake、G++、Boost 和 LZMA 开发库，获取上述固定提交，然后：

```bash
cmake -S .work/innoextract-source -B .work/innoextract-build -DCMAKE_BUILD_TYPE=Release
cmake --build .work/innoextract-build --parallel 2
```

只构建解包工具，不构建或运行待分析应用。新版路径加入 runner PATH 后，复用同一套识别和提取脚本。保留上一轮失败报告，新报告另存为 `docs/evidence/windows-extraction.json`，不覆盖失败证据。

### 04 构建失败也属于证据

首轮源码工具构建任务 [34851170110](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34851170110) 在 CMake/构建步骤失败，未进入安装包提取。尝试 `gh run view 34851170110 --log-failed` 时，Actions 日志下载域名同样出现 TLS EOF，检查注释只有退出码，无法据此声称具体失败原因。

复查固定上游 `CMakeLists.txt` 的 `find_package(Boost ...)`，发现依赖还列出 `date_time`，前一版安装依赖列表未显式包含它。补齐该开发库以及 zlib/bzip2 开发库；是否为唯一故障原因不能从已有日志证实。

同时修正可观测性：新增 `tools/build_extractor.py`，将 CMake 配置和编译的退出码、日志首尾、CMake 版本写入 `docs/evidence/extractor-build.json`。即使构建失败，也先把有限大小的诊断报告写回分支，再将任务标记为失败。禁用 LTO 以缩短工具编译时间，不修改格式解析源码。

### 04 实测：成功解包

运行 [34851419303](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34851419303) 成功。`innoextract 1.10-dev + 6e9e34e` 对该包的 `--list` 和 `--extract` 均返回 **0**。虽然该开发版本的帮助文字仍写支持到 6.3.3，**真实包成功解析的证据比未更新的帮助文字更有决定性**。

详见 [`evidence/extractor-build.json`](evidence/extractor-build.json) 和 [`evidence/windows-extraction.json`](evidence/windows-extraction.json)。

- 解出 **9,875 个文件 / 1,032,221,550 字节**。
- 主应用目录：`code$GetDestDir/resources/app/`。
- 应用 `package.json`：名字 `ShunCode`、版本字段 `1.132.0`、入口 `./out/main.js`、开发依赖 Electron `44.2.0`。这是包内声明，不等于已经验证运行时二进制版本或找到上游基线。
- 产品 `product.json`：`applicationName=shuncode`、`commit=09533f921029d9d073c06e70f566ebe31e43cebc`。用 GitHub API 在 `microsoft/vscode` 查询该提交返回 422（未找到）；**不能直接将产品 commit 当作公开上游 commit**。
- 发现自定义扩展 `extensions/shuncode/package.json`，版本 **0.7.4**，主入口 `./dist/extension.js`。
- 普通文件没有独立 `.map`；存在 **85,578,099 字节的 `node_modules.asar`** 尚待检查内部目录。所以暂不能断言所有 source map 都不存在。

**知识点：** 静态提取后的 `code$GetDestDir`、`code$GetExeBasename` 是 Inno 动态常量的占位名。我们没有运行安装器，自然也没有执行其中的 Pascal Script 来计算最终安装路径；这种命名不表示解包错误。

## 05 — 优先恢复作者定制扩展，保留原件与来源

新增 `tools/recover_custom_extension.py`：只定位唯一的 `extensions/shuncode`，筛选文本文件，先检测常见凭证形式，再把通过检查的文件原字节保存在 `recovered/shuncode-extension/`。每个文件记录原始哈希；不格式化原件、不执行 JS、不运行包内 npm scripts。检测命中的文件只报告路径和匹配类型，不输出凭证值。

为什么先恢复扩展？它的产品名与版本和目标软件匹配，又有独立入口，是定制功能的重要候选位置。但这不意味着所有定制功能都在扩展里：工具还为核心 `out/` 文件生成路径、哈希和 `shuncode` 字样数量，供后续定位 Code OSS 本体修改。同时只读取 ASAR 目录头，检查其内部 source map 数量，无需把 85 MB 的第三方库复制到 Git。

当前是“已发布代码提取”，不是“已恢复完整原始 TypeScript 工程”。后续依据实际文件再决定格式化、source map 恢复或手工重建。

### 05 实测：发行包直接带有源码

运行 [34851848414](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34851848414) 提取成功。发现 `src/` 中有 **34 个 TS/MTS 文件**，带类型与注释，共 **682,862 字节**。这些不是本次反编译生成的文本，而是安装包本来就附带的源码。

第一轮后缀筛选还复制了捆绑 Git 目录中的文档、帮助文本，以及 vendor 文本，共 356 文件 / 16,998,342 字节。**这是提取范围过宽，不是额外恢复了自有代码。** 后续显式排除 `runtime/git/` 和 `vendor/`，将这些树压缩为数量/体积摘要，并删除误纳入的第三方材料（提交历史保留过程，不重写历史）。精简后为 **51 文件 / 4,776,532 字节**，源码原字节不变。增加了专项测试防止再次带入捆绑 Git 文档。

ASAR 头实测包含 **5,716 个文件、1,208 个 `.map` 路径**，报告中的样本位于第三方依赖。我们没有将这些 map 计入自有源码恢复成果，也没有将目录头统计说成已恢复 map 内的源码。

## 06 — 从“文件拿到了”到“工程完整吗”

```bash
python3 tools/audit_recovered_extension.py
```

新增静态审计，结果在 [`evidence/source-completeness.json`](evidence/source-completeness.json)。

- 51 个保留文件逐一计算 SHA-256，全部与提取记录一致。
- 扫描 TS/MTS 的 import/from/require，对 `.js → .ts`、`.mjs → .mts` 做简单路径解析。发现 **32 处未解析相对导入 / 24 个不同共享模块路径**。这是轻量静态审计，不等同完整编译器解析。
- 原 `tsconfig.json` 中 **10 个文件引用**目前缺失，包括 VS Code proposed API 声明、原工程共享模块和原始测试 TS。
- 扩展发行版 `package.json` 不包含构建 scripts、dependencies、devDependencies；不能直接假定 `npm install && npm run build` 可用。
- 三个 bundle 的模块边界注释中找到 **43 个上层共享源码路径标签**，其中有部分缺失模块对应的运行代码。后续可以据此恢复编译后的模块逻辑，但这些注释不携带被擦除的类型。
- 对 9 个恢复的 JS/CJS 文件运行 `node --check <file>`，均返回 0，记录在 [`evidence/javascript-syntax.json`](evidence/javascript-syntax.json)。这是只解析不执行，不是扩展激活或功能测试。

**下一阶段：** 先整理缺失共享模块与 bundle 标签的对应关系，建立“原样源码 / 编译产物重建”分离的工作区，再补构建依赖和宿主 API 类型。核心 Code OSS 定制仍需另外定位。详细阅读顺序见 [源码阅读指南](SOURCE_READING_GUIDE.md)。

### 06 精简规则复验

运行 [34852425206](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34852425206) 用新规则从原包重新提取成功。51 个自定义文本文件保持不变；第三方 runtime/vendor 目录只留摘要，不再复制。同步报告后再次运行来源审计，34 个源码文件、51 个文件哈希一致的结果保持不变。恢复工具的 16 项模拟单元测试通过；不将这些工具测试计作应用功能测试。

## 07 — 作者调整目标：恢复自有定制内容并去除商业收费门槛

不再以完整逆向 VS Code 为目标。按作者明确授权，把 Bridge 商业登录、套餐/支付宝付款、激活码、定期许可证复验和商业用量上报移除；保留传输访问令牌、隧道凭证、工具边界以及第三方模型自己的认证。

完整教学过程在 [COMMUNITY_MIGRATION.md](COMMUNITY_MIGRATION.md)，包括：

- 沿 `activate → license service → access controller → BridgeManager` 追踪收费链路。
- 通过 AST 从命令常量引用找到自定义 UI 类，而不是上传整个 VS Code bundle。
- 新的本地社区策略不伪造账号、订单或签名；付款/兑换旧命令明确拒绝。
- 把修改版放到 `community/`，原恢复文件不变；现阶段在缺少共享原始模块时采用可重复构建的定点 bundle overlay，不声称完整源码重编译成功。
- 第一轮双宿主校验拒绝了不同编译文本的 Sessions，记录了失败；分别捕获两个片段后运行 `34855446553` 验证成功。
- 自动更新工具做版本/哈希检查、备份、失败回滚，生成约 467 KB 的实验包，不重复传递 241 MB 安装器。

原商业后台尚未关闭，历史付款/退款未处理；这部分不可能仅通过修改客户端完成。Windows 实机端到端测试仍待完成。


## 08 — 从 bundle 声明恢复独立模块，而不是把切片当源码工程

### 观察与方法修正

同一 `src/*.ts` 标签经常分为两段：前段只有 `init_define_SHUNCODE_BUILD_INFO()`，真正的函数/类在依赖后面。早期 `.work/shared-review/` 正则切片只用于阅读，没有作为交付或原始 TS。随后使用 Acorn 的真实注释和顶层 AST 声明定位来源，固定 `eslint-scope@9.1.2` 做词法自由变量分析。

```bash
npm install --save-dev --save-exact eslint-scope@9.1.2 --ignore-scripts --no-audit --no-fund
npm run build:bridge-core
npm run check:bridge-core
npm test
python3 -m unittest discover -s tests -q
python3 tools/audit_recovered_extension.py
```

`tools/reconstruct_bridge_core.mjs` 先核对原 bundle 哈希，从明确选择的工具/路由/状态导出出发，递归找每个自由变量所属的声明。无法定位、进入第三方可执行代码、声明跨来源标签或形成 ESM 初始化环时直接报错，而不是填空函数骗过编译。它不会运行原扩展 bundle。

### 重建结果与诚实边界

- 生成 `reconstructed/bridge-core/src/`：**24 模块、130 声明、96,503 字节**；21 个自有标签的已发布顶层声明齐全，1 个工具注册表为子集，另外 2 个文件是原构建/SDK 常量快照。
- 新增 ESM 连线，把 Node 内建模块的静态 require 改接为 namespace import；函数/类体原样保留。原构建初始化调用被显式元数据依赖取代。来源证据逐声明记录位置/哈希，额外记录生成文件哈希和依赖。
- 只在本 bundle 内索引 38 个共享标签；历史 43 是三份 bundle 合并，二者口径不同。
- 原 `getBuildInfo()` 仍返回原发行构建身份；不把 `release=true` 冒充新重建工程的发行状态。
- 恢复了 5 个文件工具和 8 个 IDE 工具的目录，`wait` 仍排除在 Bridge 外。文件注册表没有执行器，路径/符号链接安全还需下一组依赖，参数解析成功不等于允许访问该路径。
- 后续维护修改单独放 `community/`；生成器拒绝覆盖已经手工修改的重建文件。为 Windows checkout 增加原件/重建/社区文件的字节保留规则，避免自动换行破坏来源哈希。

### 行为测试与发现的问题

本地 **40 项 Node 测试通过**（原社区 14 + 新核心 26），包括临时回环 HTTP 的令牌/方法/会话头/SSE/请求体检查、请求 ID 冲突、事件流隔离、活动会话保留、命令归属与强制取消的主机确认、工具输入，以及全部模块加载。另将**审查过的声明闭包**在隔离 VM 中执行，与重建 ESM 的确定性解析结果逐例对照；VM 不被宣称为安全沙箱，未执行整个扩展或安装器。

原并发器动态降上限的疑点已复现：2 个运行任务、1 个排队任务，把上限改为 1 后首次归还仍会放入排队任务。原貌层保留它，用明确标注的行为刻画测试记录；独立 `community/bridge-core/concurrency.mjs` 只增加 `current < max` 放行条件，并测试不撤销在途任务、排队取消和重复归还。该修复候选**没有纳入已有 overlay ZIP**。

23 项 Python 回归测试也通过；原件审计仍为 34 个源码文件、原始哈希一致、32 处相对导入未解决。另起一个包不等于这些原 TS 导入已接通。

Windows/Linux CI 使用 `bridge-core-tests.yml`，只拉文本证据，不下载 LFS 安装器、不运行 GUI。远端结果记录在 [bridge-core-tests.json](evidence/bridge-core-tests.json)；不把 Windows Node 测试称为 Windows 应用验收。


### 08 复查与 Windows/Linux 实测

另行扫描选中 22 个自有标签的非声明语句，确认全部仅为 22 次构建信息初始化调用，没有遗漏其他顶层赋值或启动副作用。给生成器追加明确拒绝其他语句的保护，并测试普通赋值、任意函数调用和带参初始化均被拒绝；生成 JS 与 provenance 字节不变。

[34858129327](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34858129327) 与加固后的 [34858427519](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34858427519) 均成功。最终测试代码提交为 `837017dc17e3737eae6789c3a809e8846f119a4c`，Windows Server 2022、Ubuntu 24.04 两个任务的依赖安装、确定性重建检查和 Node 测试步骤全部成功；Python 回归只在 Linux 上运行。

第一轮 `gh run view --log` 下载完整日志时，日志存储域名返回 EOF。没有把这个下载失败说成测试失败，也没有伪造逐项远端日志：使用 `gh run view --json ...jobs` 和 `gh run watch --exit-status` 核实作业/步骤成功，将有限结果保存为 `docs/evidence/bridge-core-tests.json`。Actions 有固定工具 action 使用旧 Node 目标、平台强制 Node 24 的警告，但任务本身成功；测试运行时由 setup-node 选择 Node 22。

截至本轮：本地 40 Node + 23 Python 通过，Windows/Linux 核心 CI 通过；原 0.7.4 overlay ZIP 未改动。仍未做完整扩展激活、真实文件工具执行、Electron GUI 或新安装器构建。下一阶段从文件执行链与工作区路径保护继续。


## 09 — 从输入解析走到真实文件读取

本轮先查看依赖索引中 `read-files`、`workspace-paths`、读图、搜索和补丁模块。确认文本读取只依赖 Node 内建模块与共享路径模块，因此先完整审阅这条链，不同时引入尚未定位部署位置的 ripgrep 或写入执行器。临时 `.work/shared-review/` 切片仍只作阅读，真正产物仍按 AST 声明生成。

在生成器的明确种子中加入 `readFiles/formatReadFilesForModel` 与两个路径函数，将 `DOMException/TextDecoder` 标为已确认的 Node 22 全局量。新增 **2 模块 / 22 声明**，总计 **26 模块 / 152 声明 / 113,420 字节 JS**。新包版本 `0.0.0-reconstructed.2`，仍是禁止 npm 发布的私有重建包，不冒充原 0.7.4 发行身份。

```bash
npm run build:bridge-core
npm run check:bridge-core
npm test
python3 -m unittest discover -s tests -q
python3 tools/audit_recovered_extension.py
```

原声明对照现在还需要原 bundler 的 `__toESM`。测试辅助工具从同一哈希固定的原 bundle 中只取 8 个已审阅的互操作辅助声明，并将 require 限定为 crypto/fs/fs-promises/path；不执行完整扩展。VM 注入 Node 的 TextDecoder 和相同的错误构造器，避免跨 realm 的 TypeError 身份差异导致错误分类假差异。这个 VM 仍只是对照工具，不是安全沙箱。

### 真实夹具测试与发现

新增 28 项测试，全部只在临时目录中创建小文件。覆盖根目录规范化、多根、相对/绝对路径、静态越界、内部/外部目录链接、Windows 分隔符与 POSIX 反斜杠字面量、编码/行范围/预算/版本、权限回调和取消。对同一夹具比较原声明与重建 ESM 的读取结果和文本格式。本地总计 **68 Node + 23 Python 通过**，原来源审计仍全部哈希一致、34 个 TS/MTS、32 处原 TS 相对导入缺口。

发现并稳定复现了原版本风险：规范化路径通过后，在异步权限回调中将原目录换成指向外部夹具的链接/junction，原声明和重建读取器都会返回外部夹具文本。风险测试明确标注 KNOWN SNAPSHOT RISK；它通过表示复现成功，不能计作“已安全”。没有读取用户文件或修改证据文件。

### 防护候选的边界

`community/bridge-core/read-files.mjs` 只调整共享模块 import，并在确认后加 realpath 检查点。与原核准根比较，阻止根被重新绑定后扩大范围；若变成另一个内部路径也要求重新确认。测试覆盖外部目录替换、内部目标替换、根本身替换、正常行为及精确差异范围。

**这不是完整竞态修复**：检查之后仍可能被替换，stat、探测与流读取还不是同一个固定句柄。后续需结合句柄复用、操作系统隔离和威胁模型继续设计。也记录了输出预算仅限制返回内容，完整版本计算仍扫描全文件，长行缓冲不由显示截断提供硬限额。

因此本轮交付是可读、可复现、可测试的读取基线及有限防护候选，不部署到真实 MCP 服务，不改 overlay，不宣称整个文件工具链安全。跨平台运行状态另存 [bridge-read-tests.json](evidence/bridge-read-tests.json)。


### 09 Windows / Linux 复验

运行 [34861023069](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34861023069) 成功，测试代码提交 `568c2a3c14e9183930300e03fac6552a500603cf`。Windows 2022 与 Ubuntu 24.04 两个任务的确定性重建、Node 测试步骤均成功；Windows 测试实际创建 junction 夹具，没有因权限不足跳过关键路径用例。Python 回归仅在 Linux 上执行。

通过 `gh run view --json ...jobs` 保存作业/步骤证据，没有再次尝试此前已知下载失败的完整日志域名，也没有编造远端逐项日志。原免费 overlay SHA-256 仍为 `83bdda87792194cf5ee2c7a5c9beded9c38dd49fac86562c5eb8ad68493c4268`；新增的安全发现另补充到社区迁移文档，明确已有 ZIP 不含检查点候选。


## 10 — 恢复补丁写入链（中断后续做）

上一轮停在两个模块已经生成、测试未补齐的状态。重新检查 `git status`，确认变更仍在；没有重新提取安装器，也没有覆盖原件。继续完整阅读 `apply-patch` 的解析、双重 preflight、进程内锁、staging、提交与 rollback，以及 `canonical-diff` 的文本规范化和显示生成。

生成器以 `applyPatch/formatApplyPatchForModel` 为新种子，自动闭合到差异模块，新增 54 个声明；现在为 **28 模块 / 206 声明 / 151,272 字节**。原 CJS 对照环境补入 Node process（临时文件命名需要 pid），没有加入子进程或第三方执行器。

执行 `npm run check:bridge-core`、`npm test`、`python3 -m unittest discover -s tests -q` 和原来源审计。新增 16 项临时文件测试，本地 84 Node + 23 Python 通过。所有写入均为自建临时夹具；没有修改真实工作区数据或证据。

验证了增删改移、编码/换行约定、版本冲突、上下文拒绝、权限/取消、静态越界、并发版本竞争，以及在 preflight 后制造目标冲突时对四类已完成操作的回滚。不是磁盘满、断电或所有回滚失败情形的穷尽测试。

发现两项原貌限制并保留复现：第二次权限回调期间把父目录换成外部 junction/link，原声明与重建写入器均在外部夹具创建文件；只改变末尾换行时原显示 diff 可以没有 hunk。风险刻画测试通过不代表安全目标通过。

因此没有给写入器套一个再次 realpath 就宣布修好，也不把它接入真实 MCP。进程内路径锁不阻止外部进程改目录，多文件也明确不是原子事务。说明与后续句柄/目录身份、系统隔离、回滚并发风险方向见 [PATCH_WRITER.md](../reconstructed/bridge-core/PATCH_WRITER.md)。本轮跨平台证据另存 [bridge-patch-tests.json](evidence/bridge-patch-tests.json)。


### 10 Windows / Linux 复验完成

运行 [34864622967](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34864622967) 成功，测试代码提交 `80472568854d51e25d652d92b1a7826b6189d7c0`。Windows 2022 与 Ubuntu 24.04 的确定性重建和 Node 测试步骤均通过，Python 回归仅在 Linux 运行。`gh run watch --exit-status` 返回 0，另从作业 API 保存有限步骤证据。固定 action 仍有旧 Node 目标的兼容警告，但未影响运行。没有声称下载了远端完整逐项日志。

本轮保留原证据和旧 overlay 不变，新增源码、测试和日志全部推送到会话分支；完整扩展、搜索/图片执行器、真实 MCP 集成与 Windows GUI 验收仍未完成。


## 11 — 作者要求区分自有定制与 Code OSS，并准备分发教程

目标扩展为恢复可维护的完整社区工程；不是逐字找回已删除的历史。已有代码按原扩展、编译 UI 片段、共享 JS 重建、社区维护层分离。本轮增加 `tools/audit_custom_boundary.mjs`：逐文件核对 51 个原件及两个 UI 捕获的哈希，用 Acorn 真实注释区分扩展路径、共享候选、捆绑第三方和未知部分；不执行 bundle，不把整个 Workbench 判为纯上游或纯定制。

```bash
npm run audit:boundary
npm run audit:boundary -- --check
npm test
python3 -m unittest discover -s tests -q
```

结果：34 个原 TS/MTS，跨 bundle 43 个共享标签；原 TS 的 24 个不同缺失目标中有 19 个已存在某种 JS 对应（含部分注册表），5 个仍缺，集中于 Custom Tools/Skills。仍未接回原 TS 类型/路径；19/24 不是工程完成百分比。两项新增边界测试核对清单可重复生成与保守分类。

### 上游参考查询，不盲目选择最新版

通过 `gh api` 获取固定来源。最初 main 指向 `bdadf2eb338657fd540c1b38713393b4a5856de1`，package 版本 1.139.0；旧教程的 `build/gulpfile.vscode.win32.js` 路径返回 404，列目录后确认任务已经是 `.ts`。记录这个失败，避免把过时命令当成已验证步骤。

随后找到公开标签 1.132.0 → `df53daabb18cd157bdb08c7f01c34df936cf12f4`，核对 LICENSE（MIT）、package、.nvmrc/.npmrc、Windows 打包任务与 proposed API 文件名。7 个所需声明均存在，但候选 Electron 42.7.1 与原包声明 44.2.0 不符，Node .nvmrc 为 24.18.0。这里只抓取少量参考内容，未克隆整个底座、未运行 npm 安装或构建脚本，也没有把它选成正式构建依赖。结果保存为 `upstream-build-reference.json`。

新增三份面向不同读者的文档：`CUSTOM_CODE_MAP.md`（边界与未确认部分）、`WINDOWS_BUILD_GUIDE.md`（已验证 overlay 构建 + 尚未执行的完整源码路线）、`community/MIGRATION_FOR_USERS.md`（普通用户/开发者双路线）。原 `COMMUNITY_MIGRATION.md` 的技术去商业化教程继续保留。用户教程明确作者授权、保留安全和第三方模型认证、不伪造订单/签名、备份回退、不能跳过哈希，以及旧更新包未修复的读写竞态。未为自有代码擅自选定新开源许可证。

本轮不更换旧 ZIP，不把未来 Code OSS 构建模板称为已生成 ShunCode 安装器。接下来优先补 5 个直接缺失目标及传递执行依赖，同时推进候选底座兼容性比较和原生宿主接入。


本轮实际重跑 `npm run build:community` 与 `python3 tools/package_community.py`，归档仍为 466,543 字节、SHA-256 `83bdda87792194cf5ee2c7a5c9beded9c38dd49fac86562c5eb8ad68493c4268`，与已发布文件完全一致。说明用户“自行生成补丁”路线在当前代码上可复现，而不是仅写未执行命令。完整 Code OSS/安装器模板则明确未执行。


### 11 复验与发布记录

本地 86 项 Node 与 23 项 Python 通过。运行 [34868508275](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34868508275) 在 Windows 2022 / Ubuntu 24.04 均成功，测试代码提交 `d318c49e5ab9e0a0c942b41d7f680cab25fa2c24`。使用作业/步骤 API 与 watch 返回码保存证据，仍未做完整 Code OSS 构建、安装器构建或 GUI 验收。用户迁移教程与更新 ZIP 已可分别从本分支分享；本轮没有改变已发布 ZIP。


## 12 — 从技术报告改为零基础实操与逐行课程

作者指出此前文档仍不够指导化，要求覆盖细节甚至每行代码。本轮不把原有高级报告改名后冒充教程，而是新建 `docs/learning/`：课程路线、Windows零基础操作、逐行精读、逐文件覆盖账本与可执行模拟实验。全工程逐行讲解尚未完成，明确保留待办状态。

先人工解释 `bridge-license-service.ts` 73行、`bridge-access-controller.ts` 30行、`patch_utils.mjs` 31行，共134行，含结构/注释/空行；同一行多个字段分别解释。重点纠正 readonly/类型擦除不等于运行时冻结、licensed兼容值不等于签名授权、async错误传播、控制器空构造体仍有参数属性赋值，以及 UTF-16 编辑坐标与UTF-8哈希的区别。

`annotations.json` 存真实代码行、人工解释与SHA；`tools/build_learning.mjs` 检查逐行对应关系，生成 `LINE_BY_LINE.md`、`COVERAGE.md` 和机器清单。当前纳入范围127文件/26,558行，只有3文件完整逐行解释；不把二进制、混编第三方bundle和锁文件算成已讲。测试只能证明覆盖/同步，不能自动证明解释正确。为跨Windows/Linux保留精确字节，补充代码和学习材料的 -text 属性。

`tools/learning_lab.mjs` 只转译两个新写的社区维护类，用stub代替BridgeManager，演示免费且未商业登录、支付/兑换/未知能力拒绝、登出不隐式停止、逆序文本替换、AST唯一定位和abc的SHA。它不启动真实服务、不改安装目录，也不把 Function 当安全沙箱。

```bash
npm run learn:build
npm run learn:check
npm run learn:lab
npm test
python3 -m unittest discover -s tests -q
```

本地模拟输出与教材一致；90项Node、23项Python通过。新增4项测试核验教材同步、过期/缺行/空解释拒绝、模拟行为、UTF-16偏移与定位歧义。未对产品运行代码做本轮修改，也未替换overlay。下一组需继续主构建器/UI/更新器的逐行说明；完整工程缺失仍按恢复计划推进，不能将134行教材称为全面完成。


### 12 跨平台复验

运行 [34870756579](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34870756579) 成功，测试代码提交 `0cda23e6a215ca1928686642da408de71030a456`。Windows 2022和Ubuntu 24.04的Node测试（含教材同步与模拟实验）均成功；Python回归仅在Linux运行。保存作业/步骤API证据，不宣称已取得逐项远端完整日志。课程、人工注解、生成器和实验已推送；全工程逐行讲解仍明确未完成。

## 13. 普通Windows CMD + conda适配与主构建器逐行教学（2026-09-14）

### 用户环境与范围

用户明确：普通CMD，在其中激活conda，不是Anaconda Prompt。将它写入README、专用环境指南与实验课，当前命令块改用CMD的cd /d、dir、certutil、npm.cmd、python和call，不引入venv/virtualenv或PowerShell执行策略修改。历史章节记录当时的操作，不伪改为当时已使用conda。

新增environment-cmd.yml：恢复/教学使用Python3.12、Node22.13至23之前、Tk，conda-forge/nodefaults。不是未来完整Code OSS工具链的承诺；候选底座版本与原包仍未对齐，必须另建环境。

### 实际实现与检查点

1. 新增只读 `tools/check_cmd_environment.py`：检查CONDA_PREFIX、conda-meta、Python/Node/npm路径归属、版本及Tk导入。避免执行错误选中的全局Node；不激活、不安装、不改设置、不打开窗口。
2. 新增 `tools/run-learning.cmd`：只接受已激活conda；检查教材、模拟实验、Node与Python回归，顺序失败即停。内部调用npm.cmd使用call，保留后续控制流程。
3. 新增独立 `tools/apply-community.cmd` 资产，由打包器读取。已激活conda时优先用其python.exe，缺失则停止、不悄悄退回全局py；转发参数、保留退出码。有参数不暂停，无参数GUI结束后暂停。启动器切到自身目录，所以CLI目标/外部payload应使用绝对路径。
4. 专用指南解释了普通CMD激活、完整conda.bat路径入口、审阅后可选init cmd.exe、同窗口继承、where与sys.executable、为何不用py -3、批处理CALL、错误码与安全停止。init会修改当前用户CMD初始化，文档不隐藏副作用。
5. 新增环境与分发包测试。真实CMD夹具仅运行临时Python替身，验证带空格/符号参数、conda解释器、退出码7；另测失效环境不回退和学习入口拒绝未激活环境。Linux明确跳过这3项，不能用跳过当Windows成功。
6. Windows CI新增独立conda作业，setup-miniconda固定到fc2d68f6413eb2d87b895e92f8584b5b94a10167，Miniforge创建声明环境，shell为cmd /C CALL {0}；显式在该CMD调用conda.bat activate，再跑总入口和更新器--help。不是在Anaconda Prompt或PowerShell里模拟CMD。

### 教学新增，不虚报完整工程

人工新增 `tools/build_community.mjs` 全部137行讲解：TS转译不等于类型检查、固定注释/AST定位、保护片段SHA、商业命令过滤、原件核验、6文件输出、双宿主片段、manifest及直接运行条件。源码本身未改。每行映射真实代码与SHA，新增数据流及自测问题。

生成器现在纳入.cmd，教材标题数量从报告生成，避免旧硬编码134行。最终4/132文件、271/26867行完整解释，全项目完成标记仍false。压缩行与重复维护/原件分别计数，不能换算工程完成率。

中间一次生成因新增第62行解释长度不满足检查而失败；审阅补充了3条过短结构行说明后重新生成。一次文档编辑因不存在的章节标题中止，检查实际标题后修正；未把中止的编辑或失败测试记作成功。

### 本地执行与更新包重打包

执行并通过：npm run learn:build、learn:check、learn:lab、check:bridge-core、npm test；python3 -m unittest discover -s tests -q。最终Node90项通过；Python发现34项，本地Linux31通过、3个真实CMD夹具跳过。本机无conda，不宣称本机已实测Windows环境。

先保留旧ZIP于.work，再执行npm run build:community与python3 tools/package_community.py。逐项比对15个ZIP条目：仅README.md、apply-community.cmd改变，全部11个payload条目（含manifest）字节相同，作用于8个应用目标。原51个扩展文件SHA再次匹配。

新版467406字节，SHA256为6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa。manifest仍为a543ed8a63f6a2fdcb3a23d8dfbc19573eb1e4041022a795e109d04633096c52；沿用34855446553对相同应用内容的真实原包验证，不谎称本轮又下载/运行安装器。旧历史证据保留旧ZIP哈希，当前用户下载页更新新哈希。

详见 `docs/evidence/cmd-conda-validation.json`。推送前Windows CMD+conda CI状态仍pending，必须等真实作业后另记结果。此次没有部署读/写竞态候选，没有完成完整源码整合、安装器、GUI或远端支付服务下线；已应用旧社区补丁的人无需因为启动器变化重打补丁。


### 13 跨平台实际结果与日志边界

代码提交ab17a9398f1f29027450341ae324a47b0e38c746已推送。运行 [34875639178](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34875639178) 成功，三个作业全部通过：Ubuntu24.04核心、Windows2022核心、独立Windows CMD+conda。后者作业104082013565创建环境、执行普通CMD显式激活、检查器、完整学习入口和更新器--help均成功；3个Windows专属夹具在该平台启用，不再采用Linux跳过结果冒充验证。

gh run watch --exit-status返回0；gh run view的JSON作业/步骤状态已纳入cmd-conda-validation.json。尝试下载该Windows作业完整日志仍发生EOF，因此只主张已获取API级步骤证据，不伪造逐项远端测试输出或实际解析后的精确包版本列表。

CI显示：旧action Node20运行时被平台改用Node24、auto-activate-base/nodefaults配置弃用、conda包脚本信任提示；setup中还报告一次EnvironmentNameNotFound，随后环境创建与显式CMD激活/总检查步骤均成功。完整setup日志未取得，不更具体断言中间提示原因。这不是需要用户改用Anaconda Prompt的理由，也不需要关闭SSL或安全软件。

当前能交付的是经过该Windows runner验证的CMD/conda工具链、改进分发启动器、271行实质教学及保留应用内容的ZIP；完整项目、全项目逐行教程和Windows GUI/安装器仍未完成。

## 14. 双宿主UI输入拒绝与静态逐行实验（2026-09-15）

本轮继续定制UI，不改用户安装目录，步骤仍为普通CMD激活conda。新增patch_bridge_ui.mjs全72行及access-methods.mjs全20行人工注解，累计6/134文件、363/26955行；完整UI/工程/逐行教学仍未完成。

工作区恢复时发现本地Git历史停在初始提交，但文件为上轮成果。先fetch当前固定分支，使用mixed reset对齐到远端c64f85c，只调整历史/索引、不覆盖工作文件；默认refspec没有创建remote-tracking引用，第一次按origin/分支名reset未成功，改为已取得的FETCH_HEAD。对齐后仅dist目录的6个已跟踪证据文件缺失，按HEAD恢复（该目录属于环境快照排除项）；其他文件无差异。没有新建/切换分支或删除仓库。

补丁器新增明确检查：输入必须是字符串，解析结果必须只有一个类表达式，账户卡片必须在连接卡片之前；错误时停止，不自动猜测交换位置。原件、卡片和新方法体未改。新增5项测试，包含两宿主缺失门槛/边界/倒置、额外表达式、禁止商业残留、未知宿主、UTF-16偏移，以及类静态块仅解析不运行。

新增learn:ui命令与UI_PATCH_LAB.md：解析两宿主，报告不同原哈希、各73个保留方法、工具渲染和清除隧道令牌保留、创建订单方法移除。代码只读文件并处理字符串，不new原类、不打开DOM、不写文件。CMD总入口加入该实验；教材解释与已有替身行为测试的区别，不把绿色徽章说成真实Bridge已运行。

执行npm ci --ignore-scripts --no-audit --no-fund；learn:build、learn:check、learn:ui、check:bridge-core、npm test成功。Node95通过，Python34发现/31通过/3项Windows专属本地跳过。重建overlay后，全部11个payload条目与已发布ZIP逐字节相同；ZIP未重打包，仍467406字节/SHA6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa。检查器改动不改变支持版本的应用输出，也不包含读写竞态修复。

本轮远端CI待推送后复验；证据在docs/evidence/ui-learning-validation.json。完整GUI、MCP客户端、安装器及其余工程缺口均不计作已完成。


### 14 Windows/CMD跨平台复验完成

代码提交1a334aec24e401829f884d8e81348fb3f5899a7a，运行 [34912486285](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34912486285) 三个作业全部成功：Windows2022核心、Ubuntu24.04核心、独立Windows CMD+conda。后者包括新增learn:ui的总入口及原更新器--help，Windows专属夹具在该平台启用。gh run watch --exit-status返回0，作业/步骤API证据已保存，不声称下载了逐项完整远端日志。

另核验51个原扩展文件SHA均符合来源清单。CRLF批处理新增行被默认git diff --check当作尾空白，按cr-at-eol规则复核通过，保留Windows批处理原CRLF而未强行换行。现有action Node20弃用/平台改用Node24提示仍存在，不是应用兼容性验收。

本轮已验证的实质变化是构建期输入拒绝更明确、双宿主静态实验及92行新增解释。应用输出与ZIP不变，仍未完成整个UI工程、读写隔离修复、完整源码重编译或Windows图形安装验收。
