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

## 15. 恢复Custom Tools/Skills与图片执行实现（2026-09-15）

本轮按用户要求优先恢复工程，不再以扩充讲解代替源码进度。不询问中间选择，不用空函数/any冒充完成。工作区索引再次仅有初始历史，先fetch固定分支，用mixed reset对齐远端并仅恢复快照未保留的已跟踪dist证据；不切分支、不改其他用户文件。

静态检查原bundle和已有来源索引，确认5个此前无JS对应目标的声明实际仍在原产物中，其传递依赖均可落在自有标签及Node内建模块。扩展生成器SEEDS，依赖闭包仍拒绝未解析变量、第三方可执行依赖、跨来源声明和初始化循环。

新增custom-tool-admin/contract/manifest/migration/sandbox/skill-import/skill/custom-tools及read-image共9模块105声明；当前37模块311声明204568字节。九个来源标签的已发布顶层声明全部纳入，原函数体不重写，类型/原导出表不冒称找回。基线版本为0.0.0-reconstructed.4。

新增11项测试：原manifest解析器对照、加载/重复/过滤、启停/删除、迁移、目录Skill导入与生成入口实际执行、重名、归档路径字符串拒绝、受控进程、预取消、图片读取/拒绝及运行时导入审计。只用自建临时目录和受控Node脚本；不运行tar.exe、不处理陌生ZIP、不启动原扩展。对照VM的child_process使用拒绝执行替身，允许的os仅为Node内建模块。

新确认的边界：原sandbox仅execFile进程管理，继承宿主环境，不能隔离文件/网络；loadCustomTools默认会触发迁移；迁移集合可能阻止失败重试；重复Skill导入只改文件夹名，frontmatter名仍冲突；ZIP字符串检查不等于链接/解压隔离；图片也有检查/打开间隔。均原样保留并明确禁止直接部署，不把测试通过说成安全缺陷修复。

新增静态运行时导入审计：原TS哈希校验后经esbuild擦除类型，收集共享ImportDeclaration；55个说明符中51个对应模块导出存在，3个barrel导出待接（CUSTOM_TOOL_OUTPUT_SCHEMA、CUSTOM_TOOLS_DIR_NAME、executeCustomTool），1个invokeFileTool仍缺失。继续追踪发现完整文件调度依赖find/search及打包注入的rgPath（__dirname/runtime/bin/rg.exe），不能随意给undefined或空实现蒙混。原TS24个缺失路径现均有JS标签对应，仍未真正接线或完成类型检查。

执行npm ci、build:bridge-core、audit:boundary、learn:build/check、check:bridge-core、运行时审计、npm test与Python回归。Node106通过；Python34发现/31本地通过/3个Windows专属跳过。第一次重定向测试日志因.work目录不存在失败，创建目录后重跑成功。教学仍363行，不将新恢复源码自动算为已讲解；覆盖分母145文件28332行。ZIP未变，SHA仍6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa。

本轮Windows/CMD+conda待推送复验，证据见custom-tools-recovery-tests.json。未完成完整宿主API适配、类型恢复、文件调度、完整编译/安装器或GUI/MCP验收。


### 15 跨平台执行链复验结果

代码提交aebec3c76ba2e734ab5e3d9e42d8a2d3e410f2d3，运行 [34959381656](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34959381656) 的Windows2022核心、Ubuntu24.04核心、独立Windows CMD+conda作业全部成功。新测试中的临时工具和提示型Skill执行在Windows也通过，未改用Anaconda Prompt。gh run watch --exit-status返回0，API作业/步骤证据存入custom-tools-recovery-tests.json；不宣称已取得逐项远端完整日志。再次核验51个原扩展文件SHA相同。

本轮不再把5个目标列为“无JS实现”，而是明确更新为“已有发布逻辑重建，但原TS未接线”。仍有55个共享运行时说明符中的3个再导出关系和1个完整文件执行入口未接通；这不是完整依赖审计的全部范围。目标未一次性全部完成：原类型、宿主兼容、搜索/调度、原生资产、完整工程编译/安装器及实际GUI/MCP验收仍待完成。

## 16. 文件调度、查找搜索与barrel恢复（2026-09-15）

继续工程接线缺口：补回invokeFileTool/dispatchFileTool及find-files/search-files/ripgrep-diagnostics。识别原打包插件独立注释，纠正rgPath被归给前一src标签的旧索引；严格匹配原initializer，显式重定位到保留扩展的runtime/bin/rg.exe，记录runtimeAssetRewrite。没有提供或执行该二进制。VM原声明对照提供原布局__dirname并拒绝子进程执行。

根据现存TS导入需求和原声明位置，新增custom-tools的三个barrel再导出，provenance记录compatibilityReexports，保持函数对象身份且校验来源/依赖，不编造本地声明。当前41模块389声明262904字节；索引内38个共享src标签的已发布顶层声明均纳入，另外3个快照/资产模块。原TS并未改写接线，类型、其他bundle和宿主构建不计作完成。

新增7测试：路径/再导出、原实现对照查找搜索、直接权限/取消/越界拒绝、读/图/补丁调度、错误封装、spawn替身模拟所有rg不可用后两工具Node回退，以及权限回调未转发的原行为。只使用临时目录，不执行真实rg。Node113通过，Python31通过/3项Windows专属本地跳过。

安全发现：dispatchFileTool原函数只转发workspaceRoots/signal，不传checkPermission/config。临时夹具确认拒绝回调未被调用且原文件仍可读。这不能证明宿主上层没有授权，但足以阻止将该模块直接当成自带授权的远程服务。原样重建并记录，没有冒充安全修复。

执行build:bridge-core、audit:boundary、运行时审计、learn:build/check、npm test、Python回归；55个共享运行时导入现在全部有导出，未解析和待再导出计数为0。核心版本reconstructed.5；ZIP未改，原哈希保留。教学仍363行，覆盖分母变为150文件29877行，未把恢复代码自动算作已讲解。

本轮Windows CMD+conda推送后待验，证据见file-execution-tests.json。完整源码工程、TS类型、宿主接口、原生资产、授权整合和完整安装器/GUI仍未完成。


### 16 跨平台复验成功

测试代码b6a96b568de4fc1060a6321e285992904cb54152，运行 [34968350673](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34968350673) Windows2022、Ubuntu24.04、独立Windows CMD+conda三个作业全部成功，gh run watch退出0。原查找搜索对照、临时文件调度和模拟rg不可用的回退测试均在该测试集中；没有以真实rg或完整应用验收替代说明。远端证据仅API作业/步骤结论，不伪造逐项完整日志。再次核验51个原扩展文件SHA相同。

action Node20运行时被平台改用Node24的弃用提示仍存在；不影响本轮作业通过，也不是完整应用兼容性结论。本轮完成的是最后一个已知共享运行时导出缺口及再导出关系，仍需TS接线、宿主接口/授权、原生资产和完整构建验收。

## 17. 原TS入口实际连接构建与类型诊断（2026-09-15）

用户希望尽量一次完成，已明确不预先保证整机/宿主/安装器未验证结果。本轮不止统计导出，而是新增build_linked_extension.mjs，从原extension.ts出发，用构建插件连接../../../src到重建JS；两个商业模块替换为社区维护TS，入口精确删除旧烟雾绕过和登出关闭persistentMode。只在内存改写并验证原件/重建输入SHA，不覆盖原文件，不读取旧dist/extension.js作为新bundle代码输入。

73个输入（32个保留扩展源码、41重建模块），31条共享导入真正连接。旧商业配置与未被入口引用的codex-account-view未进入bundle，不把它们算作全部34TS运行输入。初次先用明确external列表验证内部连接，随后安装并打入锁定npm候选：MCP server/node2.0.0、https-proxy-agent7.0.6。npm pack server2.0.0的5个chunk文件名与原bundle来源标题一致；属于候选证据，不证明整个原锁文件身份。

加强metafile外部导入审查后，发现依赖内部未打包的可选supports-color；构建实际拒绝，补锁8.1.1后重新成功。最终118个依赖输入记录SHA，静态external只允许Node内建和vscode。输出1673367字节CJS在.work/linked-extension/dist/extension.cjs，文件不入Git，也未加载或安装。动态Electron/node-pty、Agent host入口、PortableGit/隧道/rg原生资产仍不由静态external清单保证。

CJS输出的rg路径改用输出dist的../runtime/bin/rg.exe，避免把ESM仓库路径或无效import.meta写进最终CJS。资产没有因此出现，不宣称实际rg已运行。社区ZIP不变。

新增diagnose_linked_types.mjs，TypeScript5.9.3、固定@types/node22系列，采用strict/noEmit/NodeNext，明确allowJs:true/checkJs:false/skipLibCheck:true。下载公开Code OSS候选df53daabb18cd157bdb08c7f01c34df936cf12f4的8个声明文件与MIT许可，存reference/vscode-types并记录来源/哈希，不冒称原定制宿主类型。未采用any空壳或扩大接口索引签名。

实际类型诊断退出1：59错误，TS2305=10、TS2339=14、TS2353=1、TS2558=2、TS2724=2、TS2749=5、TS7006=25。包括丢失CustomToolManifest等类型、泛型/类类型和回调；ChatSimpleToolResultData缺items/metrics/diffPreview/presentationKind/presentationStyle，进一步证实公共候选与定制宿主契约不完全一致。检查覆盖34个TS/MTS及8个宿主声明，不等于原始tsconfig或整个Code OSS检查。

新增4项回归验证确定性构建、来源拒绝、依赖实际打包与诚实记录类型错误。Node117通过；Python31通过、3项Windows专属本地跳过。回归测试通过不等于类型检查通过——它明确断言59错误/false。根锁文件与候选声明添加-text，保证Windows哈希与诊断复现；CI触发范围包括新工具和reference。

执行npm install精确依赖（ignore-scripts）、npm pack、build/check:linked-extension、diagnose:linked-types（预期失败）、check:bridge-core、learn:build、npm test和Python回归。原51文件哈希一致，ZIP仍原SHA。教程仍363行，分母153文件30141行。完整宿主、类型修复、权限整合、原生资产、真实激活/GUI/MCP和安装器未完成；本轮已可重复生成新扩展实验bundle，不再仅有旧bundle替换。


### 17 Windows/Linux/CMD复验结果

测试代码fa6570ae6bb3ed5153e74cd6f56dcd87cd1d4e9f，运行 [34970685889](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34970685889) 的Windows2022核心、Ubuntu24.04核心、独立Windows CMD+conda三个作业全部成功。各平台测试会重新连接bundle并比较完整证据，包括输出SHA、依赖输入SHA和59条类型诊断；这不是类型检查成功，更不是实际扩展激活。

gh run watch --exit-status返回0，GitHub作业/步骤API结果保存到extension-build-tests.json；未下载逐项完整远端日志，不虚构更高证据等级。旧action运行时弃用提示仍存在。用户环境继续普通CMD激活conda，不引入Anaconda Prompt或venv。

本轮确实越过“只有导出存在”阶段，得到可重建的新扩展bundle；仍不能声称一次性完成剩余项目。最直接的后续阻断项是59条候选类型错误及定制宿主契约，再往后还有原生资产、运行时、权限与安装验收。

## 18 普通CMD+conda的分阶段验收规程（2026-09-15）

本轮交付docs/acceptance：总手册、MCP、安装器、34行空白结果表、只含example.invalid的私有配置模板、来源与验证边界。根README、CMD环境、Windows构建和源码连接构建指南均增加入口。每项按编号列前置条件、命令/点击、预期、失败/停止与证据规则；区分源码SOURCE、每轮RUN和候选APP。安装/升级/卸载只在无生产数据且可恢复快照的Windows虚拟机执行。

先检查instance-launcher/runtime-client/ide-tool-broker及Bridge路由：确认ShunCode.exe约定、Agent入口解析、node-pty的宿主路径、缺PortableGit实际抛错（过时注释不能代替执行逻辑）、令牌化/mcp和/healthz路径。普通CMD是操作者终端，不是产品内部Git Bash的替代品。CLI用户数据参数不隔离全局账号/凭证，因此不能以空窗口代替虚拟机隔离。

执行npm view查询Inspector2.6.0的engines/bin/gitHead/dist.integrity；通过gh api读取固定提交795b1bb30ac845b7baa7cb3df8ec0b693882ca1d的官方配置、CLI及Web说明。在忽略目录.work/acceptance-inspector使用npm install --save-exact --ignore-scripts --no-audit --no-fund安装194包，实际运行launcher --cli --help成功。出现server-legacy弃用警告，未忽略记录。未连接任何真实ShunCode/MCP目标。Inspector要求Node>=22.19，故规程提供独立conda环境，不修改恢复工程Node最低版本或根依赖锁。使用显式只读--config和--server，避免默认样例/旧配置；原始响应及令牌配置保存在RUN/private，外发必须脱敏。

安装器规程从尚不存在的新候选交付清单起步，覆盖哈希/签名、新装、同版重装与跨版升级的区别、持久化、取消/占用、卸载保留/清除、快照回退、中文/空格路径、用户/系统范围和并存身份。未猜静默参数，不要求关闭SmartScreen或删除注册表。原0.7.4 EXE和overlay均不能冒充源码构建的安装器。

实际文档验证：Python解析所有新增文档及入口链接，目标存在；JSON解析及example.invalid检查；CSV34个唯一编号、状态仅NOT_RUN/BLOCKED、实际结果空白。人工检查CMD命令环境和逐项证据边界。Windows命令、GUI及真实协议仍未执行，不能把文档检查当端到端验收。

重新执行npm test：117/117通过；python -m unittest discover -s tests -p 'test_*.py'：34项发现、31通过、3项Windows专属跳过。check:bridge-core通过（41模块389声明262904字节）；learn:check通过，153文件30141行、6文件363行已完整解释，完整覆盖仍false。CRLF感知diff --check通过。原51文件逐字节对比HEAD一致，原ZIP未改。

本轮只新增验收材料，未修复59条类型错误，未改实验bundle、运行时代码或部署补丁。现有回归验证诚实保留类型失败，并非类型已通过；未新增Windows实机验收。A可运行，A05类型门槛仍FAIL；完整宿主、原生资产、真实激活/GUI/MCP与新安装器B/C/D仍BLOCKED，整体NOT_READY。后续工程仍应先重建有证据的类型契约、确认定制宿主字段并修复权限调度，再提交真正候选走本文流程。

## 19 第一批候选类型契约恢复（2026-09-15）

先核对59条诊断和原JS/TS调用点，选择concurrency、adaptive-concurrency、jsonrpc-request-id-registry、bridge-session-registry四个实现闭合且不依赖未知宿主字段的模块。不修改提取原件，用reconstructed/type-contracts中的候选声明建立实例类型、泛型、判别联合、可选get和回调约束。它们不是原始声明，也不改变运行时授权行为。每份声明及对应原JS哈希写入provenance，诊断前与原core清单及文件交叉验证。

环境恢复时发现本地Git元数据只在初始提交，工作文件保留了上轮成果，node_modules和dist未持久化。第一次诊断真实失败于缺typescript；npm ci --ignore-scripts --no-audit --no-fund恢复23包。gh API确认本分支远端fd346bc，git fetch本分支成功；引用origin/分支不存在，故首次mixed reset失败且未改变文件，随后确认FETCH_HEAD就是fd346bc并mixed reset FETCH_HEAD，仅恢复同分支索引/历史，不覆盖工作树。从该HEAD恢复快照排除的六个原dist文件；没有切分支或重建原bundle。

保留diagnose:linked-types的59条JS推断基线，新增diagnose:contract-types/--contracts与独立contract-type-diagnostics.json。启用四个候选合同后实际退出1、49错误：TS2305=10、TS2339=14、TS2353=1、TS2558=1、TS2724=2、TS2749=1、TS7006=20。减少10条（4个值/类型错误、1个泛型参数错误、5个会话回调隐式any），不是降低strict或补any所得。候选诊断仍checkJs:false/skipLibCheck:true，报告明确runtimeImplementationCheckedByTypeScript:false。

新增三项回归：准确诊断与宿主错误保留；strict/noEmit/skipLibCheck:false的独立声明夹具（含七个@ts-expect-error负例，拒绝不合约调用）；对原JS的有限运行时合同核验。声明不声称穷尽实现行为，reason保持string是因为实现接受调用者自定义销毁理由。类型夹具只写.work，不生成应用代码。

执行新专项测试3通过，全套npm test现在120/120通过；Python34项发现、31通过、3Windows专属跳过；check:bridge-core、check:linked-extension、learn:check及CRLF感知diff检查通过。learn:build更新清单为154文件30247行，仍仅6文件363行完整讲解；新增声明说明不计作全工程逐行覆盖。原51文件逐字节比对HEAD一致，社区ZIP SHA仍6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa；实验bundle保持1673367字节与原SHA。

CI路径覆盖新增类型目录与新报告。本轮本地测试不代替新Windows CI结果；此前34970685889只对应历史117项。下一批仍需恢复Activity/CustomTool/Skill/EventStore与HTTP回调，定制Chat宿主字段必须继续结合真实宿主证据，不能单纯module augmentation伪装已实现。权限调度、宿主原生运行资产、激活/GUI/MCP/安装器均未完成，整体仍NOT_READY。

### 19 远端提交与CI权限边界

实现提交3586853已成功推送同一Arena分支。推送后gh run list两次查询只返回旧运行，尚未查到本提交的新CI。尝试gh workflow run bridge-core-tests.yml --ref arena/01a09d2c-reverse-enginnering-of-shun，API真实返回403 Resource not accessible by integration。未换身份、未索取令牌、未绕过权限；本轮不能声称Windows CI通过。GitHub连接的Actions调度权限需在Arena端检查/重新连接，或由仓库所有者在Actions页面手工执行该分支工作流。代码推送已成功，不受该调度权限错误影响。

## 20 第二批类型契约：活动/事件/HTTP（2026-09-15）

继续比对bridge-activity-tracker、bridge-event-store、bridge-http-router的提取JS与原bridge-constants/bridge-tool-dispatcher/bridge-mcp-transport调用点；在锁定SDK2.0.0声明中确认EventStore结构。新增三份独立.d.ts及哈希来源，累计7模块，不改原JS/TS或实验bundle。

活动输入/输出保留泛型presentation、可选状态字段与原消费者的终态限制；事件存储使用候选SDK JSONRPCMessage，并通过严格夹具检验可赋给EventStore。没有虚构可选getStreamIdForEventId，也没有声称JS本身会校验JSON-RPC数据。HTTP参数使用Node类型和unknown正文，原headers值直接转发，所以保留string[]而非虚假收窄。

本轮合同诊断实际退出1：39错误，TS2305=9、TS2339=14、TS2345=3、TS2353=1、TS2724=2、TS7006=10。旧13条消失（ActivitySnapshot导出1、ActivityTracker泛型1、EventStore实例类型1、HTTP隐式any10），同时原传输层381—383行暴露3个string[]与string参数不匹配。没有删除原调用、修改strict或用any抹掉新错误；旧JS推断基线仍59。

专项测试扩充至6项且全部通过：独立strict/noEmit/skipLibCheck:false夹具增加6个负例；原JS验证活动presentation/重复finish统计、事件同stream重放/等待send/传播失败/游标逐出、合成HTTP请求对象数组头原样转发。后者不是实际Node网络解析或远程漏洞验证，真实重复请求头可能合并，后续必须明确候选边界策略，不能随意取数组首项。既有纯本地HTTP夹具仍不接真实Bridge/隧道或执行工具。

全套npm test实际123/123；Python34项发现、31通过、3Windows专属跳过。check:bridge-core（41模块389声明262904字节）、check:linked-extension（73输入/31连接/1673367字节）、learn:check、CRLF感知diff检查通过。原51文件与HEAD逐字节一致，ZIP原SHA不变。学习清单154文件30338行，完整讲解仍6文件363行，新增声明说明不冒称全工程逐行覆盖。第二批讲解在reconstructed/type-contracts/SECOND_BATCH.md，CMD规程区分类型退出1与专项测试退出0。

本轮查询发现上一轮代码358685378717895767e85a7079166cfd5fcaa5f6的自动CI已完成，运行34977478994成功；不再把“当时未查到”当永久事实。之前手动dispatch的403仍是真实历史事件。本轮新代码尚未据此验收，不沿用旧120项成功冒充新123项Windows通过。

未修运行时权限调度、未实现新HTTP拒绝策略、未改定制Chat宿主，剩余CustomTool/Skill/取消命令/日志/工具结果/宿主字段继续待恢复。没有部署实验扩展、执行真实激活/GUI/MCP或构建完整Windows安装器，整体仍NOT_READY。

### 20 本轮Windows/Linux/CMD复验

实现提交7c5c20fa17b195b7fa6393efc24db7d72637c592推送后自动触发34980025558。使用后台gh run watch --exit-status等待，第一次180秒等待到期时Windows/Ubuntu核心已通过、CMDconda仍运行；继续阻塞等待后进程退出0。三个作业全部成功：Ubuntu30秒、Windows49秒、CMDconda4分4秒。gh run view作业/步骤API结果和本地计数存docs/evidence/type-contract-tests.json，没有冒称已下载逐条完整远端日志。动作运行时Node20弃用/强制Node24警告仍存在，未把它误报成项目Node环境失败。

新CI确实覆盖本轮123项Node回归及CMD环境检查，仍不代表39条类型错误消失、扩展实际激活或GUI/MCP/安装器通过。当前GitHub自动触发可用，不要求用户为历史手动dispatch的403重复提供任何凭证。

## 21 第三批类型契约：CustomTool/Skill（2026-09-16）

本轮继续恢复类型，不改原始实现。工作区再次保留上轮文件但Git元数据回到初始提交、node_modules/dist未保留；先确认当前固定分支与远端FETCH_HEAD=0561f1d，再mixed reset FETCH_HEAD恢复同分支历史/索引（不覆盖工作文件），从该HEAD恢复快照排除的六个原dist文件，npm ci --ignore-scripts --no-audit --no-fund恢复23包。没有切换或创建分支。

读取custom-tools facade、manifest/contract/sandbox、skill/import/admin函数体及原bridge-server/dispatcher/transport消费者。新增custom-tools、custom-tool-skill、custom-tool-skill-import、custom-tool-admin、bridge-tool-name五份候选.d.ts，累计12个模块。Skill成功必有name；失败带reason/fix且name可选以覆盖原服务器duplicate-name分支；保留unknown原因兜底。import.generatedRunner实际是true或undefined，runner.generated真假对应有/无runnerRel。Manifest.inputSchema只承诺根type:object和未知扩展键，不虚构深层JSON Schema已验证或脚本安全。

facade字段与执行返回来自多个原模块，故provenance增加四个evidenceDependencies（manifest/contract/sandbox/skill）及SHA；诊断器逐一与原core清单和实际字节校验后解析声明。没有新增any或原文件修改。

初版execute选项只写实现读到的signal，诊断真实20条，发现原消费者还传log并有回调隐式any。对照原调用补入兼容log:(message:string)=>void，但声明直接注明提取执行器NOT invoked；运行时测试验证预先aborted调用返回null/aborted/isError且log计数0、不启动子进程。不能把接受回调当作日志功能恢复，也不是修复执行器。

独立strict/noEmit/skipLibCheck:false夹具首次真实失败，两条node:path的export=不能使用export *问题。改成明确typeof import的导出常量及namespace default形态，刷新声明哈希后专项9项全通过，不关闭声明检查。新增9个类型负例覆盖缺失查找、布尔选项、command元素、schema根、成功name、导入true/undefined、runner分支、nullable退出码、名称谓词；新增3个原JS测试覆盖发现/失败/未启用、导入生成/已有/重名结果、预取消与不调用日志。Skill夹具只在临时目录写入/生成文件，不执行其脚本，不验证归档安全或真实产品加载。

最终候选诊断实际退出1：18条（TS2305=1、TS2339=11、TS2345=3、TS2353=1、TS2724=2）。39→18减少8个缺失导出、3个Skill名称访问、10个隐式any回调诊断；TS7006清零不代表原显式any或checkJs:false实现已全部严格检查。原JS推断模式仍59，独立报告不覆盖该基线。

全套npm test126/126通过；Python34项发现、31通过、3Windows专属本地跳过。check:bridge-core、check:linked-extension、learn:check及CRLF感知diff检查通过。原51文件与HEAD逐字节一致，社区ZIP原SHA6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa不变，实验bundle仍1673367字节原哈希。学习清单154文件30465行，完整解释仍6文件363行；新说明不算全工程逐行覆盖。THIRD_BATCH.md记录普通CMD命令、预期和真实失败修正；SECOND_BATCH明确标为历史39条，当前入口改为18条。

剩余18条集中于取消命令/ToolContentBlock接口、文件结果content、3处HTTP头边界、定制Chat字段。权限调度、真实宿主/原生运行资产/激活/GUI/MCP/新安装器未完成，没有部署实验产物，整体仍NOT_READY。本轮新Windows CI待推送后单独确认，不沿用第二批34980025558作为本轮证明。

### 21 Windows/Linux/CMD复验完成

实现提交10bc1f72113ec6b38539c0b491d73ef16bb397b6已推送固定分支，自动触发35033132376。后台gh run watch --exit-status退出0；Ubuntu23秒、Windows50秒、普通CMD+conda2分23秒三个作业全部成功。gh run view获取作业/步骤API证据保存docs/evidence/type-contract-batch3-tests.json，保留第二批历史证据不覆盖。动作运行时Node20弃用/被强制Node24提示仍记录为警告；未改变项目conda环境。未归档远端逐项完整日志，不冒称更高证据等级。

本轮源代码回归和CMD适配通过；候选18条类型错误、定制宿主与安全/运行时/安装器门槛仍失败或阻塞，不能因为CI绿色发布完整产品。

## 22 剩余契约与维护运行时边界（2026-09-16）

用户要求一次完成后统一报告；本轮没有继续分批请求确认，执行剩余可验证工作，但不能将未完成的宿主/桌面/安装器标成完成。原件保护保持，工作分支从cb2e1ce开始。

先读取managed-command-cancellation、managed-command-risk、原CommandState/cancellationTarget与file-tool-registry/消费者。新增取消命令和文件结果两份候选声明，累计14模块。取消状态/owner/高风险预约/nullable退出码完整保留；文件内容为text/image联合、content可选。初版native owner声明为字面量导致原默认参数被误窄化，真实诊断15条；改为与原var及跨会话调用一致的string后14条。当前TS2339=10、TS2345=3、TS2353=1，即11条定制Chat字段和3条原HTTP头边界。没有补未验证的宿主augmentation或删除原调用来刷绿；原JS推断仍59。

新增community/bridge-core/file-tool-dispatcher.mjs：独立维护入口要求可信宿主checkPermission，否则PERMISSION_POLICY_REQUIRED；审批结果只有true允许。向五种文件工具转发权限与configByTool，read_files复用之前的检查点候选。未知工具/参数拒绝，失败信息不再泛称没有任何读写。它没有接入原扩展，原消费者缺少宿主策略；不会把这个未整合模块塞进overlay。配置必须来自宿主，不来自模型；会话绑定、审批UI、OS隔离和剩余竞态均未解决。

新增community/bridge-core/http-router.mjs：在正确端点拒绝数组/重复协议头，rawHeaders检查覆盖Node已拼接重复头的情形，不回显令牌/头值。原错误路径和令牌路由保留。用真正的回环Node HTTP服务器和无工具处理器测试4类重复头400/零调用、错令牌404、单值合法请求200、缺session头400。不是实际MCP或隧道测试，未接入原扩展构建。

首次维护专项两条断言失败：读结果实际有行号“1: alpha”，不是“alpha”；rm字符串在取消风险分类器返回normal，该分类器强调中途强停损坏风险而非通用危险命令分类。按实际语义改测试，用它明确识别的npm install字符串内存夹具（从不执行命令），没有改实现伪造高风险。另测5工具拒绝、字节不变、显式批准图片/补丁、单行配置预算、truthy非布尔拒绝、权限异常拒绝、owner及确认预约。修正后维护5项通过；新增声明严格夹具也通过。

## 23 旧Agent Host实际stdio探测与发布门槛（2026-09-16）

观察当前安装器仅134字节LFS指针，git lfs命令不存在；这不是新安装器或真实旧EXE。当前恢复区agent-host.js943158字节、mcp-server.js1286417字节确实存在，runtime/git/bin/bash.exe和runtime/bin/rg.exe不存在。未把缺少当前LFS对象说成永远无法获取，但也不运行指针或冒称已检查原生ABI。

进一步审读旧agent-host.js的启动/dispatch逻辑，只选择runtime/hello、runtime/ping、tools/list、不存在任务agent/cancel和未知方法五个固定请求。新增bridge-core-agent-runtime测试：校验原文件SHA后在空临时HOME、最小环境下启动Node；通过预加载JS守卫阻断HTTP/TCP/TLS/UDP/fetch和后续child_process入口，不继承账号/代理环境，不发送agent/run。守卫不是OS沙箱。实际protocol=8、ping=true、工具列表一致、not_running、-32601，收到全部响应再关闭stdin，退出0。保存本地证据agent-metadata-smoke.json；不是新源码Agent Host、模型执行、Electron、PTY、GUI或扩展激活验收。

新增check_release_readiness.mjs/npm run check:release：每次真实重跑候选诊断和内存bundle构建，观察运行文件/原安装器状态，保守列出载体/Chat/原生资产/权限整合/HTTP整合/实机/新安装器门槛。--write保存release-readiness.json；NOT_READY退出2。检查不会启动应用或公网服务，编辑报告不构成放行。新增门槛回归验证静态构建PASS不能使总状态READY。

## 24 本轮总验证与真实完成边界（2026-09-16）

完整本地npm test133/133；Python34项发现、31通过、3Windows专属跳过。check:bridge-core、check:linked-extension、learn:check、CRLF感知diff与新汇总文档链接检查通过。学习清单159文件30823行，仍仅6文件363行完整讲解。原51文件与HEAD逐字节一致，社区ZIP SHA6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa及实验bundle1673367字节原SHA不变。

docs/RECOVERY_STATUS.md按全部目标列已完成/未完成，包含普通CMD复现和实际失败修正。仍有14条候选错误；维护模块没有纳入原扩展，源构建Agent Host与完整载体、真实激活/GUI/MCP、原生资产和安装器未完成。总状态NOT_READY，没有“所有剩余项目已完成”的结论。本轮Windows CI在推送后另行记录，不沿用第三批的成功。

### 24 Windows/Linux/CMD最终复验

实现dcbd8efe73a0da3b7426575de92f289ff1fd8941成功推送，自动运行35034730553。后台gh run watch --exit-status退出0：Ubuntu30秒、Windows50秒、普通CMD+conda2分15秒全部成功。作业/步骤API和本地计数保存maintenance-recovery-tests.json。尝试gh run view --log获取完整远端日志，归档下载返回EOF，未获得逐项完整日志；临时签名URL不入库。此前动作Node20弃用/强制Node24警告仍存在，项目测试Node环境未因此改写。

最终文档统一标明：本地133项Node通过、候选14条仍失败、旧Agent Host仅内部stdio探测通过、新维护适配器未进入应用构建、总发布NOT_READY。不能声称用户要求的全部项目已经完成；本轮没有停止/删除安全检查或部署未验收产物来凑完成。

## 25 HTTP维护适配器进入实验扩展构建（2026-09-16）

本轮从5bc7b1a继续，不再只增加孤立模块。build_linked_extension新增显式HTTP维护模式：只将原bridge-mcp-transport.ts的共享HTTP导入改向community/bridge-core/http-router.mjs；默认旧构建不变。类型诊断使用同一个模式和来源清单，解析到维护路由的.d.mts；原模式59/14条继续独立保存，新HTTP模式11条（TS2339=10、TS2353=1，均为tool-presentation定制Chat宿主字段），仍退出1。

新增http_maintenance_inputs.mjs及精确三文件白名单/哈希清单，包含维护JS、.d.mts及http-router-types.d.ts，并核验原路由SHA与core来源。构建和诊断共同加载这份清单，防止声明/实际代码错位。维护JS新增JSDoc，除了入口拒绝重复/数组头，还在真正回调前再次校验单值。使用strict/checkJs:true/skipLibCheck:false对维护JS函数体与声明做独立检查；原路由以既有候选声明为边界，并非整个原JS工程严格检查通过。合成两次取头值由string变array时，末端守卫实际拒绝且处理器0调用。

HTTP变体实际输出.work/http-linked-extension/dist/extension.cjs，1675648字节，SHA1e4ca05f8d77b8c37ad1b02f00928923cdd833ab39c00d1a7bd68950fff7cc39；74一方输入、31共享连接、2商业策略替换。旧实验输出仍1673367字节/c9785357…不变。新报告http-linked-extension.json携带sourceIntegrated:true和runtimeActivationVerified:false；并没有加载完整扩展或部署应用。file-tool-dispatcher维护入口仍未接入，不改变宿主权限策略。

## 26 原传输层与真实候选SDK的本机协议往返（2026-09-16）

为避免只验证bundle包含字符串，同一构建器增加受限制的transportOnly测试入口（必须同时启用HTTP维护模式），从原BridgeMcpTransport TS生成独立CJS夹具；没有vscode外部依赖。使用真正的锁定server/node SDK2.0.0和原会话/工具注册逻辑，回环Node HTTP客户端完成2025-11-25 initialize、initialized通知、tools/list、惰性tools/call。仅dispatchToolCall及宿主回调为明确的内存替身，无文件/命令/模型执行；不启动BridgeManager或公网隧道。

真实SDK返回shuncode-bridge及会话头。重复头400和错令牌404不进入工具替身；合法调用携带bridge:会话owner。建立两会话，owner不同；删除第一会话后旧ID404，第二会话仍可列工具；最后销毁全部会话并关闭监听，端口清空。未测试实际任务ID归属、宿主审批、现代无状态协议、第三方客户端或GUI。结果及夹具来源哈希在http-transport-smoke.json，不保存随机会话ID/完整端点。该记录是本地平台数据，不冒称已包含Windows逐项结果。

新增HTTP专项5项全部通过，包括来源连接、11条真实诊断、适配器JS/声明严格检查、本机SDK生命周期及末端头类型防护。非法transportOnly模式的拒绝也测试通过。新增build:http-extension/check:http-extension/diagnose:http-types供普通CMD使用，不修改原三条基线命令。

## 27 本轮回归与门槛更新（2026-09-16）

全套本地npm test138/138；Python34项发现、31通过、3Windows专属本地跳过。check:bridge-core、旧check:linked-extension、新check:http-extension、学习构建及文档链接/diff检查通过。发布检查改为审核HTTP变体，真实11条错误、httpSourceIntegrated:true、NOT_READY退出2；HTTP整机门槛仍BLOCKED，不把源码接入当GUI通过。补充的门槛断言6项专项再次通过。

学习范围163文件31043行，完整讲解仍6文件363行。原51文件和社区ZIP字节不变，旧实验bundle证据不变。新HTTP证据使用-text保持Windows哈希一致，CI路径包含新helper及http证据。HTTP_EXTENSION_INTEGRATION.md详细区别三种类型模式、两份实验产物和本机惰性协议测试，更新入口与工程状态避免继续误称HTTP适配器完全孤立。

本轮尚未验证新Windows CI；推送后单独检查。剩余Chat宿主契约、真实文件授权接入、原生资产/ABI、完整扩展激活/GUI/MCP及新安装器仍未完成，整体NOT_READY。

### 27 本轮Windows/Linux/CMD复验完成

实现7680b458db21eb5efd84eacd97d141e5b50d5a11已推送并自动触发35036955654。gh run watch --exit-status后台进程退出0：Ubuntu35秒、Windows43秒、普通CMD+conda3分15秒均成功。作业/步骤API与本地138/31/3计数保存http-integration-tests.json；没有归档完整远端逐项日志。动作运行时Node20弃用/强制Node24警告仍存在，项目测试Node版本未改写。

确认这是新增HTTP源码接入和隔离SDK会话测试，不是原件替换、完整扩展激活或真实文件/模型/GUI/隧道验收。HTTP实验类型仍11条失败，产品NOT_READY；默认原连接基线14条及旧构建都保留。

## 28 公共Chat文本边界与严格检查（2026-09-17）

环境恢复时工作树内容保留但Git元数据退回初始提交。fetch固定Arena分支确认97099c5后mixed reset恢复索引，并从HEAD恢复6个缺失的已跟踪dist文件；未改原件或切换分支。npm ci恢复工具依赖。

没有向公共vscode命名空间添加虚构字段。新增本地富结果模型及input/output转换，受SHA和转换边界约束，只在portableChat显式模式接入；自动包含HTTP维护。摘要、文件增删数、指标、耗时、终端ID和diff转文字，最终整体脱敏/限制12000字符。useShunCodeStyle:true仍降级，这是兼容候选而非原卡片恢复。原始格式化器文件不改。

新bundle75输入31共享别名2策略替换1677498字节。消费者候选诊断0条；原推断59、合同14、HTTP11保持独立。5项专项包含实际转换格式化器VM执行、秘密/边界/diff及真实锁定公共声明strict/noEmit/skipLibCheck:false正反类型测试。VM宿主为空替身，未执行URI或GUI，完整JS和原宿主身份不获此证明。

全套Node143通过。发布审计改选portable-chat-fallback：源码连接、候选类型PASS，7个实际发布门槛仍BLOCKED，NOT_READY退出2。增加普通CMD命令、模式说明、来源与CI触发路径。学习清单166文件31232行；完整人工讲解仍6文件363行。远端CI须推送后单独记录，不借用上一轮成功。

### 28 回归与远端验证完成

Python34项发现、31通过、3Windows专属本地跳过；核心/默认/HTTP/portable确定性检查、学习核验、文档链接及diff检查通过。原recovered文件和已有overlay未改，默认73输入1673367字节与HTTP74输入1675648字节基线保留。

实现ee8ebed225e64fd0987f611a8f16a048d993a3f0推送固定分支后，CI35219484258的Ubuntu、Windows2022、普通CMD+conda三作业全部成功，gh run watch退出0。真实API作业/步骤记录保存portable-integration-tests.json；未归档完整远端逐项日志。setup-miniconda初始激活曾注释EnvironmentNameNotFound/退出1，但其后创建和真正CMD检查步骤成功；Node动作运行时、auto-activate-base/nodefaults弃用及包脚本警告仍存在，不隐去。

最终仍NOT_READY，当前完成范围为可选文本回退源码接入与自动化验证，不是原卡片/完整Windows应用交付。

推送CI文档时远端安装器取证工作流先写入085bfd1，仅更新两份提取证据元数据；首次推送因此被正常拒绝。fetch并核对差异后将本地文档提交rebase到该同分支提交上，不强推、不覆盖远端取证更新。该自动取证不代表生成新的Windows安装器。

## 29. 先交接，再推进授权：基线同步与调用图审计（2026-09-17）

用户希望接力文档同时是路线图，先做交接再继续工程。新增`docs/handoff/README.md`、`ROADMAP.md`、`NEXT_AUTHORIZATION.md`与`STATE.json`：独立项目背景、固定分支/不可变原件/保留认证的约束、第一小时CMD操作、P0–P7依赖/通过/停止条件、七发布门槛映射及下一授权任务具体正反向测试。不把完整Windows验收指南再复制一遍，链接现有分阶段步骤。

### 29.1 先检查远端，不重复聊天中的旧工作

- 起始会话快照文件已到97099c5，但Git索引/HEAD落在9159d82；先`git fetch origin arena/01a09d2c-reverse-enginnering-of-shun`，远端已是b77a9e512cd491de1efa2101ee578a5e647a2de5。
- 用`git archive 97099c5`逐个比较工作区字节：所有已存在文件相同，仅六个recovered旧dist因会话目录排除未保存。核验后才`git reset --mixed 97099c5`恢复索引、从97099c5补这六个原件，再`git merge --ff-only FETCH_HEAD`。没有覆盖现有修改、硬重置、切分支或强推；这些是本次特殊恢复操作，不是下次可直接复制的步骤。
- 实际远端已包含ee8ebed公共Chat文本回退、085bfd1自动安装器静态证据、b77a9e5 CI文档。最新可选portable类型0，不能再把HTTP-only的11当当前候选失败。
- `npm ci --ignore-scripts --no-audit --no-fund`成功，23包；原143 Node/31 Python/3跳过与35219484258 CI是继承证据，在本次复验前没有伪称刚跑过。

### 29.2 授权下一步不是盲目alias：新增可复验审计

- 跟读原Facade构造、ToolDispatcherDeps、invokeFileTool及5个执行器context。入口和下游都只有workspaceRoots/signal；实际deps也不含文件审批服务。维护强制授权调度器尚不在portable图。
- 新增`tools/audit_authorization_wiring.mjs`，先用现有来源报告核验3个原件SHA，再TypeScript AST定位1接口/1构造/1入口/5执行器字段与行号；重建同源portable图，输出原alias仍指向reconstructed文件注册器且authorizedDispatcherBundled:false。对象spread/原件漂移/数量异常中止，不静默猜测。
- 新增固定报告`docs/evidence/authorization-wiring.json`与自动对照回归；`npm run audit:authorization-wiring`仅观察，`--write`显式更新报告。退出0只是报告完成，authorizationIntegrationVerified仍false，不是漏洞扫描或OS沙箱证明。没有接入固定true政策，也没有改变实验扩展构建字节。
- 首次命令重定向到不存在的`.work/`导致shell未执行报告生成，随后测试ENOENT；创建`.work`后重跑报告与单测，1/1通过。记录该失败，不用旧报告填补。
- 为CI增加审计工具/证据的paths触发，报告`-text`避免Windows自动CRLF造成hash证据差异。源码仍保留原件，旧overlay不重打包。

### 29.3 本轮本地复验（与上一轮CI分开）

- `npm run check:bridge-core`：41模块/389声明/262904字节闭包通过；注意这条命令不是npm test，随后单独执行完整测试。
- `npm test`：144/144通过、0失败/跳过；`python -m unittest discover -s tests -v`：34运行、31通过、3项Windows专属在Linux跳过。
- portable构建/check/诊断均退出0；75输入、31alias、2商业政策替换，1677498字节，SHA仍635190e62a2874fa9f07bad049e5da0944ef33f04456bb96da7fae5d823d2aaa。
- learn:build/check更新为168文件/31303行，6文件363行已人工解释，full:false；新增审计与测试尚没有逐行人工教程，不能把生成覆盖清单算已教完。
- `check:release`仍退出2/NOT_READY，2PASS/7BLOCKED；没有运行完整宿主/GUI/Windows安装器，也没有把维护授权接入产品。
- 完成前检查并修正路线图验收链接：B指向已有acceptance/README.md，C为MCP.md，D为INSTALLER.md；逐一核验handoff内相对Markdown目标存在，STATE.json可解析。给旧验收/恢复计划顶部补充最新入口，保留历史诊断模式定义。

### 29.4 推送后Windows/Linux/CMD验证

- 交接/审计提交`2d26aca5e9578ca1fbb950235ccb9351294b3ea6`已推送固定分支。推送前fetch确认远端仍b77a9e5；原overlay SHA仍6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa；原件/重建原貌/维护应用源码/lockfile无差异。
- 当前gh版本不支持`gh run list --commit`，改用`gh api .../actions/runs`并核对head_sha，不升级工具或误把上次绿色run当本次。
- `gh run watch 35232127826 --exit-status`作为后台进程等待，退出0：Ubuntu job105238656156（1分17秒）、Windows 2022 job105238656709（1分38秒）、普通CMD+conda job105238656649（3分39秒）均success。
- 从GitHub API保存run和3个jobs的步骤/起止时间到`docs/evidence/handoff-integration-tests.json`。保留Action Node20弃用/被迫Node24告警；这是Action运行时，不是项目Node22错误。未归档完整逐条远端日志，不扩张证据范围。
- STATE.json和交接入口补上本轮真实CI，不再pending-push。后续仅证据/文档提交，明确CI被测代码SHA为2d26aca；P1仍READY（审计完成、宿主服务实现未开始），下一步按P1.1确认可信owner/取消生命周期后设计策略。

## 30. 接手校正：CI分支绑定失效与回归护栏（2026-09-18）

新一轮会话分支为`arena/01a0afd4-reverse-enginnering-of-shun`。按交接要求先核验远端：`git ls-remote`显示`arena/01a09d2c-reverse-enginnering-of-shun`与本地HEAD同为`df7dde398d7d24e544bf233064743c89474cdd35`，无需快进，也没有可合并的新提交；工作树干净。

### 30.1 复现基线（Linux，非Windows/GUI）

- `npm ci --ignore-scripts --no-audit --no-fund`成功，23包；Node v22.22.3、Python 3.11.2。
- `check:bridge-core`41模块/389声明/262904字节通过；`build/check:portable-extension`与`diagnose:portable-types`退出0，75输入/31alias/2政策替换/1677498字节、候选类型0错误。
- 交接前基线：`npm test` 144/144通过；`python3 -m unittest discover -s tests` 34运行/31通过/3项Windows专属跳过；`check:release`退出2、NOT_READY、2PASS+7BLOCKED。
- 另核验`check:linked-extension`、`check:http-extension`、`learn:check`、`audit:boundary`、`audit:authorization-wiring`全部退出0，无证据漂移。以上为复现，不是新进展。

### 30.2 交接文档未记录的阻断缺陷：CI仍绑定已退役分支

三个workflow把上一条会话分支ID写死，接手后实际后果不是“少跑一点”，而是：

- `push.branches`只列`arena/01a09d2c-...`，本分支推送**不触发任何workflow**；
- 即便手动`workflow_dispatch`，job级`if: github.ref == 'refs/heads/arena/01a09d2c-...'`会把全部job判为skipped；
- 更严重的是两个证据型workflow用`ref: arena/01a09d2c-...`检出、并`git push origin HEAD:refs/heads/arena/01a09d2c-...`写回**旧分支**。在新分支触发却测旧代码、把报告提交到旧分支，属于会产生错误证据的行为，不只是覆盖缺失。

修正为会话分支族匹配，不是放开到所有分支：`branches: ['arena/**']`；job守卫`startsWith(github.ref, 'refs/heads/arena/')`；检出与写回一律用触发态`${{ github.ref }}`；两个写回型workflow的`concurrency.group`追加`-${{ github.ref }}`，避免不同会话分支互相串行或抢同一组。保留原有paths过滤、pinned action SHA、LFS与失败传播设置，未放宽`permissions`，未新增部署或密钥步骤。

### 30.3 新增结构回归，避免再次静默退化

新增`tests/test_ci_workflow_branch_binding.py`（5项）：断言无workflow残留具体会话ID（正则兜底任意`arena/<8位hex>-*`）、push触发匹配`arena/**`、job守卫分支无关、证据型workflow检出/写回使用触发ref（允许40位pinned SHA形式的action ref）、写回型并发组按分支隔离。仓库未声明PyYAML、恢复conda环境也不含，故按GitHub实际求值的字面串做结构断言，并在文件头写明该测试不代表workflow运行成功或任何门槛通过。

首次运行因把`git push origin \S+`写成非贪婪单词匹配，截断`${{ github.ref }}`导致误报；修正为行尾匹配后通过。变异验证：把push触发改回硬编码分支、把写回目标改回固定分支，两次分别有2项失败，确认断言不是恒真。同时给CI paths加入该测试文件。

### 30.4 本轮复验与边界

- `python3 -m unittest discover -s tests -q`：39运行、36通过、3项Windows专属跳过（新增5项后由34→39）。
- `npm test`仍144/144通过；`learn:build`更新为169文件/31412行，`learn:check`退出0；6文件363行人工解释与full:false不变，新增测试尚无逐行教程。
- `check:release`仍退出2/NOT_READY，七门槛维持BLOCKED。**本次是CI基础设施与回归护栏修复，不触碰授权实现，不改变任何发布门槛。**
- `git diff`确认`recovered/`、`reconstructed/`、`community/`、`reference/`、ZIP与EXE零改动；portable bundle SHA仍`635190e...a2daa`。
- 未验证项：workflow在新分支的真实触发结果需推送后以实际run ID为准，本地静态断言不能替代；Windows/GUI/安装器与P1宿主授权仍未开始，P1状态不变。

### 30.5 推送后实测：触发已修复，但账号计费拦截使作业未执行

推送`c8d2191`后，本分支**首次**产生三个workflow run（此前为0个，是修复生效的直接对照）：`35345456845`（Reconstructed Bridge core tests）、`35345456314`（Windows installer forensics）、`35345456431`（Windows package static probe），`head_branch`均为`arena/01a0afd4-reverse-enginnering-of-shun`、`head_sha`均为`c8d2191`，说明分支族匹配与job守卫确实放行了本分支。

但三个run全部`failure`，原因不是代码：GitHub注解为“The job was not started because recent account payments have failed or your spending limit needs to be increased.”，API显示每个job的`steps`长度为**0**，即checkout/依赖安装/测试一步都没跑。

因此本轮**不存在本分支的绿色CI结果**，也不能据此宣称跨平台通过。已如实记录在`docs/evidence/ci-branch-binding.json`，明确区分“触发绑定已验证”与“作业未执行”，并列出未被本次run证明的项（任何测试/类型/门槛结果、Windows CMD行为、证据写回是否正确——写回步骤根本没到达）。需仓库所有者先解除计费限制再重跑。本地Linux替代验证（144 Node、39 Python、check:release退出2）仅为沙箱结果，不能冒充GitHub runner或Windows验收。

### 30.6 计费解除后的首个绿色CI，以及被CI抓到的自身失误

用户解除计费限制后重跑。`gh run rerun`报"workflow file may be broken"、`gh workflow run`返回403（令牌无dispatch权限），故改为向被监听路径提交真实变更触发——把新证据`docs/evidence/ci-branch-binding.json`加入core工作流的paths，本身也是应有的配置。

第一次重跑`35346260051`**失败，且是我自己的过错**：上一条提交给workflow加了一行paths，却没按仓库自身的完成定义重跑`learn:build`，导致`docs/learning`覆盖数据停留在旧值（该文件115行/全库31412行，实际应为116/31413），`tests/bridge-core-learning.test.mjs`的新鲜度断言失败。远端日志blob在本沙箱多次EOF/404取不到，于是**克隆推送后的提交到干净目录复现**，确认只有这一项失败且与CI环境无关，再`learn:build`修正。这正是该测试存在的意义，不是flaky，不做重试绕过。

修正后`35346853707`三作业全部success：`core (ubuntu-24.04)`、`core (windows-2022)`、`windows-cmd-conda`（普通CMD+conda）。这是**本分支第一份真实跨平台绿色结果**，证据存入`docs/evidence/ci-branch-binding.json`，并在其中写明范围仅为静态分析/测试，不含扩展激活、GUI、MCP、Electron ABI与安装器验收，不改变任何发布门槛。

### 30.7 P1.1：可信主体与生命周期设计记录

按NEXT_AUTHORIZATION.md P1.1完成源码跟读，产出`docs/handoff/P1_1_OWNER_LIFECYCLE.md`（设计记录，未实现）：

- 厘清三种"看起来像授权"但都不是逐文件授权的机制：`BridgeAccessController`/License为商业可用性、HTTP bearer为连接级准入、`commandOwnerId`为命令归属作用域。
- `commandOwnerId`三条真实来源：传统会话`bridge:<sessionId>`（transport.ts:678）、现代请求`modern:<sha256身份信封>`（bridge-mcp-modern.ts:36）、本机兜底`native-chat`。`bridgeManagedCommandOwnerId`对空会话抛`MCP_SESSION_UNAVAILABLE`，是fail-closed的，新策略应保持。
- 生命周期汇聚点：`onSessionDestroyed`（transport.ts:207）→`endRemoteConversation`+`releaseCommandOwner`→`terminalManager.releaseOwner`（ide-tool-broker.ts:1780）；触发自DELETE/传输关闭/空闲裁剪。**发现缺口：现代路径无会话销毁事件、不调用releaseCommandOwner**，故授权记录必须自带有限TTL，不能只依赖会话销毁。
- 再次核验断线：`grep checkPermission recovered/shuncode-extension/src/*.ts`命中**0**处，原扩展TS从未构造文件权限服务，P1产物只能是新维护设计，不得标成找回的原始d.ts。
- 另记录两项容易被忽略的副作用：接入回调会使find/search从首选引擎（ripgrep）降级为逐条过滤的Node实现（find-files.js:372、search-files.js:534）；原回调签名`(absolutePath)`不含操作类型，而apply_patch内部横跨新增/修改/移动/删除四种检查点，仅凭工具名无法区分"允许读"与"允许删"，P1.2须新增宿主上下文并如实标注为偏离原件的新设计。

文档中22处源码行号/符号引用全部用脚本逐条核对，修正了1处偏移（transport取消信号应为:677）。本轮仍未接入任何策略，`check:release`维持退出2、七门槛BLOCKED。
