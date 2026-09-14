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
