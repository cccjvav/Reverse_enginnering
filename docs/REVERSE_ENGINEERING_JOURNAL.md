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
