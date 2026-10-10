# 接手指南 —— 给下一个在这个仓库工作的助手

> 你正在接手 **ShunCode 逆向恢复项目**。这份文件是工作手册，不是状态报告。
> 状态报告在 `docs/handoff/README.md`，路线图在 `docs/handoff/ROADMAP.md`。
>
> 最后更新：2026-10-10 / HEAD `6edbf6b`。
> **读完本文再动手。** 这里面大部分内容是前几轮踩坑换来的，不是常识。

---

## 0. 如果你只读三十秒

| # | 必须知道 |
|---|---|
| 1 | **用户就是 ShunCode 的原作者。** 他把自己的源码弄丢了，只剩自己发布的 exe。这不是破解别人的软件。 |
| 2 | **源码层面的恢复已完成；产品层面的验收一步都没做。** 别把"编译 0 错误"说成"能发布"。 |
| 3 | **`check:release` 退出码 2、7 项 BLOCKED 是正确状态。** 谁都不许把它改成 PASS。 |
| 4 | **收费/授权逻辑保留，不做去商业化。** 用户要把那套支付架构移植到别的项目。 |
| 5 | **声称"全部检查过"之前，先数清总数。** 这条是用户当面质疑两次之后立的规矩。 |
| 6 | 两个 `.exe` 是 **LFS 指针（134 B）**，沙箱**没装 git-lfs**，你开不了包。见 §6。 |

---

## 1. 这个项目到底在干什么

用户几年前写了一个叫 **ShunCode** 的 VS Code 衍生 IDE，自己发布了 Windows 安装包，然后**源码丢了**——没有旧仓库，没有开发机备份，只剩两个自己当年打出来的安装程序。

他想要回三样东西：

1. **能编辑的源码** —— 不是反编译出来的面条，是能看懂、能改的东西
2. **能重新编译打包** —— 改完能出一个新的安装器
3. **搞清楚自己当初怎么实现的** —— 很多实现细节他本人已经忘了

> **附带说明**：他最初说过想去掉自己设的收费门槛，**后来改主意了**——
> 理由是那套支付架构"值得参考，可能用于我别的项目"。
> 所以**收费逻辑保留**。`community/` 里有三份去商业化改造，**不要合入主线**。

### 恢复的原理（你需要理解，否则会误判手上的东西）

ShunCode = **A 层（作者自己写的 VS Code 扩展）** + **B 层（被改造过的 VS Code 载体）**。

| 层 | 恢复方式 | 恢复质量 | 位置 |
|---|---|---|---|
| **A 层** 扩展 | 安装包里**真的带了原始 `.ts`** | **原件，逐字节** | `recovered/shuncode-0.8.1/src/` |
| **B 层** 载体 | 只有编译后的 bundle，按注释切段抽取 | **抽取产物，不可直接运行** | `reconstructed/carrier-0.8.1/src/` |

**这个区别必须一直记着。** A 层是作者的真迹，带完整类型注释；B 层是从打包产物里切出来的 `.js`，变量名还在但结构是编译器排过的。
交付给别人时，这两类**必须分目录、分别标注**（现有打包脚本已经这么做了：`original-typescript/` vs `recovered-from-bundle/`）。

---

## 2. 现在走到哪了

### 已经做到的（有证据，别重做）

| 成果 | 证据 |
|---|---|
| 载体能从上游源码重建（npm install + 编译 **0 错误**） | CI run `35371925282`、`docs/evidence/carrier-build-probe.json` |
| 作者的 Electron 44 剪贴板适配**逐字恢复**（`main.js` 没混淆） | `docs/handoff/CLIPBOARD_RECOVERY.md` |
| B 层 41 模块 **399/399 导出声明有真类型** | `npm run verify:btypes` |
| 工程布局**从作者自己的 `tsconfig.json` 恢复**，0 未解析模块 | `docs/handoff/SKELETON.md` |
| A+B 层完整编译 **0 错误** | `npm run assemble:skeleton-full && npm run diagnose:skeleton` |
| Chat 宿主 11 个成员重建，作为**标注清楚的候选声明** | `community/host-types/` |
| 0.8.1 新版同样恢复 + 与 0.7.4 逐文件对比 | `docs/evidence/version-diff-0-8-1.json` |
| Bridge / web_agent 两个交付包 | `docs/handoff/WEB_AGENT_*.md` |

### 一步都没做的

**没有产出过任何新安装器，没有在真机上启动过。** 7 项门槛里 5 项卡在这，而且在 Linux 沙箱里**做不了**：

- 打出新安装包（要跑完整 Code OSS 构建 + Inno Setup，产物是 Windows exe）
- 真机激活验收（装上去、启动、看 GUI 和 Chat 卡片）
- 原生模块 ABI（`node-pty`、`ripgrep` 要在 Electron 44 真实 ABI 下跑通）
- MCP 桥端到端（真客户端连隧道发请求）

> **不要在 Linux 上做一个近似验证，然后描述得像通过了真机验收。** 这是红线。

### 两个版本的身份

| | 0.7.4 | 0.8.1 |
|---|---|---|
| 大小 | 240 559 253 B | 233 014 452 B |
| sha256 | `fdc2328b…1a671272` | `c1b5a8bb…4e48ea6f` |
| inventory 条目 | 9 875 | 10 472 |
| 扩展层 `src/` | 34 文件 / 15 076 行<br><sub>28 `.ts` + 6 `.mts`</sub> | **68 文件 / 21 077 行**<br><sub>57 `.ts` + 10 `.mts` + 1 `.js`</sub> |
| 载体实现模块 | 41 | **60** |

0.8.1 相对 0.7.4：**新增 39 文件、改动 23、删除 0**。三大新功能是**外部 MCP 接入、技能（Skills）系统、网络/代理韧性**。

---

## 3. 用户是什么样的人，怎么跟他工作

**他不是专业开发者。** 他能看懂思路、能提出很尖锐的质疑，但不要默认他会用命令行。

| 他的习惯 | 你要怎么配合 |
|---|---|
| Windows 机器，用 conda | 操作步骤按**普通 Windows CMD 里激活 conda** 写，见 `docs/WINDOWS_CMD_CONDA.md` |
| 喜欢细致的教学 | 讲清楚每步要花多久、做不成会怎样；失败如实记 |
| **会抓你的虚报** | 他当面质疑过两次"你说全部检查了，真的吗" |
| 要可下载的交付物 | 不要只在预览里给，用 `npm run serve:downloads` |
| 要成果进仓库 | 不能只在聊天里丢附件，必须 commit + push |

### 他最在意的

1. **Bridge 和 Chat**（优先级最高）
2. **支付实现**（要移植到别的项目）
3. 其他部分优先级较低

他倾向**不自建 IDE 载体**，想把能力做成**能单独安装的 VS Code 扩展**。已经查证过：Bridge 可行（41 模块零 `vscode` 依赖），Chat 用稳定 API 也可行。

### 一条很重要的态度

用户明确说过**允许你独立判断、纠正方法、审查前任助手的工作质量**。
他不要一个只会顺着说的助手。**发现路线图错了就说，发现前任结论错了就推翻**——但要拿证据。

> 真实案例：前任助手把"逐文件授权"列为头号优先项。审计发现 0.7.4 里
> `checkPermission` **从来没有生产者**，这个能力当年根本没启用过。
> 那份文档（`NEXT_AUTHORIZATION.md`）现在保留作历史记录，**标注了不要按它排工作**。

---

## 4. 五条铁律

### ① 不许把发布门槛改成 PASS
`check:release` 退出 2 是**预期行为**。`59/14/11` 那组基线诊断数字同理，是真实差距的刻度，不是待修的 bug。

### ② 不许伪造恢复
- 不许用固定 `() => true` 的回调冒充权限恢复
- 不许给公开的 `vscode` 命名空间补假字段冒充原始宿主
- 重建出来的东西放 `community/`，**标注清楚是候选声明**，不要混进原件

### ③ 保护不可变原件
这几棵树**只读**，任何改动都要先问：

```
recovered/shuncode-extension/     0.7.4 原件（对比基准，逐字节未动）
recovered/shuncode-0.8.1/         0.8.1 原件
reconstructed/carrier-0.8.1/      载体抽取产物
reconstructed/bridge-core/        Bridge 重建
```

要加维护层就放 `community/`。收工前必查：
```bash
git diff --quiet HEAD -- recovered reconstructed community && echo OK
```

### ④ 不索要、不入库任何机密
不要真实密钥、密码、证书私钥。不要把秘密、完整的 MCP 令牌 URL、私有配置、巨大解包目录、临时依赖提交进去。
打包脚本里有密钥扫描闸门（`SECRET_RE`），**不要删**。

### ⑤ Linux 不能冒充 Windows
沙箱是 Linux。任何需要 GUI、真机、Windows 原生模块的结论，**只能写"未验证"**。

---

## 5. 你可能接到的任务，和怎么做

### A. "我又找到一个新版本安装包，也恢复出来"

**这是已经走通过的流程**（0.8.1 就是这么来的）。顺序：

1. 用户上传 exe（**必须他上传**，仓库里的是 LFS 指针，见 §6）
2. `python3 tools/installer_forensics.py` —— 取 inventory 和哈希。
   ⚠️ **这个脚本里的哈希闸门永远不要删**，有测试锁死它
3. 抽取扩展层 `.ts`（安装包真的带了原始 TS）→ `recovered/shuncode-<ver>/`
4. 从 bundle 切段抽载体 `.js` → `reconstructed/carrier-<ver>/`
   - **切段口径**：顶格 `// <path>.(ts|mts|js|mjs|cjs)` 切，同名取最丰富的，剔掉 `init_define_`
   - ⚠️ `tools/reconstruct_bridge_core.mjs` **不能复用**，它写死了 0.7.4 路径和 pinned sha256
5. 跟上一版逐文件对比 → `docs/evidence/version-diff-<ver>.json`
   - ⚠️ `compare_versions.py` 的**空树守卫还没加**（遗留 TODO），传错目录会静默出空结果
6. 写一份"新版有什么变化"，参考 `docs/handoff/0.8.1-新版有什么变化.md`

> `.gitignore` 第 3 行有 `dist/`，往 `recovered/` 里放东西时如果路径含 `dist` 会被静默吞掉，用 `git add -f`。

### B. "把某块能力移植到我另一个项目"

已经做过两次（Bridge → web_agent，0.8.1 MCP/Skills → web_agent）。**固定三件套**：

```
分析文档  +  可直接粘贴给对方助手的提示词  +  配套源码包
```

**对方的助手读不到这个仓库**，所以引用的源码必须随包同行。这条犯过错：曾经交付时写"详见另一个 zip"，等于没给。

做法要点：

| 要点 | 说明 |
|---|---|
| **先读对方代码再下结论** | 跨项目比对**按行为搜，不按模块名**。模块名零命中不构成"缺失"证据 |
| **先列对方已经做对的** | 下结论前跑计数。曾经假设对方"无稳定错误码"，实际有 51 个；"无原子写"，实际有 `atomicWriteText` |
| **区分三类"缺失"** | 有意排除的 / 对方自有的 / 真缺失。报 ✗ 之前先分类 |
| **两条线分开写** | ①**补差距**（你缺 X、我有 X）②**方法论优化**（提炼我的做法用到你的架构，哪怕我没这功能）。两条线互相索引 |
| **包内路径承诺必须兑现** | 文档里写 `original-typescript/xxx` 就必须真在包里。有校验脚本，见 §7 |
| **确认对照分支** | web_agent 的 `main` 是另一套脚手架，对照目标是 `arena/01a0e8ea-web-agent` |

交付物在 `docs/handoff/WEB_AGENT_*.md`，打包脚本 `tools/build_webagent_0_8_1_package.py`。

### C. "继续往能发布推进"

**先告诉用户真话**：下一步的瓶颈不在沙箱里，在他的 Windows 机器上。
需要他提供什么见 `docs/handoff/WHAT_THE_AUTHOR_MUST_SUPPLY.md`。

你在沙箱里能做的是继续缩小类型差距、补测试、改进重建工具。
**不能做的**是出安装器和真机验收——那 5 项门槛只能留红。

### D. "我当初这块是怎么实现的？"

直接读 `recovered/shuncode-0.8.1/src/`（原件，有类型注释）。
`docs/SOURCE_READING_GUIDE.md` 是导读。回答时**引用文件名 + 行号**，别转述。

⚠️ **凭印象写文件清单必被打脸。** 曾经编出一个不存在的 `global-skill-recovery.js`（真名是 `skill-import-recovery.js`）。先 `ls` 再写。

### E. 改工具或文档

- 改 `tools/*.py` **必须跑 `npm run learn:build`**，否则 `bridge-core-learning.test.mjs` 必红
- `npm run audit:docs` 把文档里的机械项（死链、过期计数）自动化了，改完文档跑一下

---

## 6. 沙箱环境的坑

| 坑 | 说明 |
|---|---|
| **两个 exe 是 LFS 指针** | 各 134 B，`git lfs` **没装**，拉不回来。要重新开包只能让用户再上传 |
| **`/tmp` 在两次 bash 调用之间会消失** | 需要跨调用的中间产物放工作区 |
| **沙箱重置会清空 `.work/downloads/`** | 跑 `python3 tools/prepare_downloads.py` 重建 |
| **下载服务不热加载** | 新增产物要 stop + start。沙箱重置后旧 `process_id` 会 `not_found` |
| **快照排除 `dist/`、`out/`、`node_modules`** | 这些目录显示 `D` 是快照机制，不是真删。`git checkout -- <tree>` 还原，**绝不提交这种删除** |
| **回归大面积红先查 `node_modules`** | 表现是 `ERR_MODULE_NOT_FOUND`、`check:release` 退出码从 2 变 1。先 `npm install` |
| **没有 `7z` / `innoextract` / `bc` / `pytest`** | Python 测试入口是 `python3 -m unittest discover -s tests -p "test_*.py"` |
| **Actions 日志正文取不到** | 改读 `runs/{id}/jobs` 的 `conclusion` |

**已经排除的方向，不要再查**：证据超 4 MB、`recovered/**` 被 LFS 捕获、LFS 配额、GITHUB_TOKEN 权限。

---

## 7. 工作方法：七条经验

这些是方法，不是规则列表。照着做，你的输出质量会和前几轮一致。

### ① 说"全部"之前先数
```bash
find <目标> -type f | wc -l     # 先得到分母
```
连续三次把"部分检查"报成"全部检查"之后，这条成了硬规矩。
**宁可说"我查了 19 个里的 12 个"，也不要说"都查过了"。**

### ② 断言失败先怀疑断言
看到 ✗ **必须打开源文件确认**，绝不因为 ✗ 就去改文档。
曾经正则说 `skills.js` 没有 frontmatter，打开一看 `:65-130` 全是。
**正则得出"没有"时，一定要打开文件确认。**

### ③ 文档里的数字必须来自脚本输出
不许凭估算。曾经写"6 460 行"，实际 6 496。
写完回头跑脚本回填，或者干脆让脚本生成那段。

### ④ 反向验证你的安全闸门
声称"有密钥扫描"之前，**真的植入一个假密钥试试拦不拦得住**：

```bash
# 在 shell 里拼出测试串，不要把完整形态写进任何会提交的文件
FAKE="xoxb-$(printf '1%.0s' {1..12})-$(printf 'A%.0s' {1..16})"
printf '\nconst k = "%s";\n' "$FAKE" >> <某个会被打包的文件>
grep -c 'xoxb-' <该文件>                # 先确认植入成功，再谈拦截
python3 tools/build_<xxx>_package.py    # 应当硬失败中止
# 然后务必还原，并 git diff --quiet 确认原件干净
```

⚠️ 做之前先清 `__pycache__`。

> **⚠️ 这条本身踩过坑：** 最初这段示例直接把一个完整形态的假 Slack token
> 写进了 Markdown，结果 **GitHub 推送保护（GH013）直接拒了整个 push**。
> **文档里永远不要出现完整形态的凭据样本**，哪怕是假的、哪怕在代码块里、
> 哪怕紧挨着写了"这是假的"。用占位描述或 shell 拼接。
> 被拦之后：改掉 → `git commit --amend` → 重推，**不要去点那个 unblock 链接**。

### ⑤ 改脚本用 `edit_file` 定位，别用无限次 `replace`
真实事故：`"WEB_AGENT_总方案-0.8.1.md",` 这个串在两个列表里都出现，
`str.replace` 不限次数把二元组改成了三元组 → `ValueError: too many values to unpack`。
**改完必须实跑一次**，不要 `>/dev/null 2>&1` 把 stderr 吞掉（这次就是因此晚发现）。

### ⑥ 方向比有无更容易错
web_agent 的 `mcp/oauth.js` 是**入站**（它当服务端），出站只有静态 bearer。
"有没有 OAuth"答案是"有"，但用在移植结论上就完全错了。
**判断一个能力时，先确定它的方向、触发者、作用域。**

### ⑦ 每轮开工先核对 git 状态
沙箱重置会让 git 守卫"空转"：
```bash
git rev-parse HEAD && git rev-parse origin/<branch>
# 落后就 fetch + merge-base --is-ancestor 确认，再 reset --mixed
```
**push 被拒先 fetch 核对再整合，禁止强推**，不要覆盖他人或自动提交的更新。

---

## 8. 开工 / 收工检查单

### 开工
```bash
cd /home/user/Reverse_enginnering_of_shun
git rev-parse --short HEAD && git status --short
git rev-parse origin/arena/01a0afd4-reverse-enginnering-of-shun   # 对一下有没有落后
ls node_modules >/dev/null 2>&1 || npm install
```

### 收工（全部要跑）
```bash
npm run learn:build                                            # 改过 tools/*.py 必跑
python3 -m unittest discover -s tests -p "test_*.py"           # 期望 96 OK (4 skipped)
npm test                                                       # 期望 167 pass / 0 fail
npm run audit:docs                                             # 期望 145 文件 / 0 findings
npm run check:release; echo "退出码 $? —— 必须是 2"
git diff --quiet HEAD -- recovered reconstructed community && echo "不可变树 OK"
```

然后：更新 `docs/handoff/STATE.json`、commit、**push 到当前会话分支**。

> **基线会随工作变化**，上面的数字是 2026-10-10 / `6edbf6b` 时的值。
> 如果你的改动合理地改变了某个数字，**更新这份文件里的数字**，不要让它烂掉。

---

## 9. 仓库地图

```
recovered/
  shuncode-extension/      0.7.4 原件（对比基准，逐字节未动）
  shuncode-0.8.1/          0.8.1 原件，src/ 68 文件 21 077 行  ← 作者真迹
                           （57 .ts + 10 .mts + 1 .js；那个 .js 是
                            bridge-license-claims.js，作者自己混放的）
  bridge-ui/               Bridge 前端
reconstructed/
  carrier-0.8.1/src/       60 个抽取的 .js，不可直接运行
  bridge-core/             87 文件，Bridge 重建（指纹 8dd74e29…）
  type-contracts/          类型契约
community/                 维护层、候选声明、去商业化改造（不合主线）
reference/                 pinned 的上游候选声明
docs/
  handoff/                 28 份交接文档，入口是 README.md
  evidence/                68 份机器可读证据（JSON）
  learning/                源码对照教学行映射
  WINDOWS_CMD_CONDA.md     用户的操作环境说明
  SOURCE_READING_GUIDE.md  源码导读
tools/                     54 个脚本（28 py + 22 mjs）
tests/                     36 个测试（21 mjs + 13 py）
```

### 文档入口的优先级

| 想知道 | 读 |
|---|---|
| 怎么工作（本文） | `AGENTS.md` |
| 项目当前状态 | `docs/handoff/README.md` |
| 还差什么 | `docs/handoff/STATUS_NOW.md` |
| 机器可读快照 | `docs/handoff/STATE.json` |
| 要用户提供什么 | `docs/handoff/WHAT_THE_AUTHOR_MUST_SUPPLY.md` |
| 0.8.1 新增了什么 | `docs/handoff/0.8.1-全部新增功能清单.md` |
| web_agent 移植 | `docs/handoff/WEB_AGENT_总方案-0.8.1.md`（入口，含 23 项）<br>`docs/handoff/WEB_AGENT_方法论优化-0.8.1.md`（N1–N8） |

> ⚠️ **`NEXT_AUTHORIZATION.md` 的优先级排序已被判定为错误**，保留作历史记录，不要按它安排工作。

---

## 10. 交付物打包的惯例

现有两个打包脚本（`tools/build_webagent_0_8_1_package.py` 是模板）：

- `ORIGINAL` / `RECONSTRUCTED` 两张表，**每个文件带一句"为什么要看它"**
- `SECRET_RE` 密钥扫描，命中就**硬失败中止**
- 源文件不存在也**硬失败**（不许静默跳过）
- **固定时间戳 + `external_attr`**，保证 zip 字节可复现
- 指纹用 `contentSha256`（`archiveSha256` 天然不稳定）

**一个受众 = 一个包。** 不要让对方"再去下另一个 zip"。

包内路径承诺的校验（文档里写了 `original-typescript/xxx` 就必须真在包里）：

```python
pkg = set(re.findall(r'`(?:original-typescript|recovered-from-bundle)/([\w.\-]+)`', doc_text))
missing = [p for p in pkg if p not in zip_basenames]
```

这条抓到过真 bug：N4 的提示词引用了一个被当作"支付内容"排除在包外的文件，对方助手会扑空。

---

## 11. 最后一句

这个项目最大的价值不是"恢复了多少行代码"，而是**每一条结论都有证据、每一个没做到的地方都如实标红**。

用户信任这份诚实。**不要为了让报告好看而动摇它。**

遇到拿不准的，宁可写"未验证"，宁可问他一句。
