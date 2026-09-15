# 唯一默认操作环境：Windows 普通 CMD + conda

> **[普通CMD+conda：逐步验收手册](acceptance/README.md)**：宿主、原生资产、实际激活、GUI/MCP和安装/升级/卸载的操作、预期、失败处理及空白结果表。当前A可复现，A05仍59个类型错误，B/C/D尚阻塞；不是已完成验收报告。

本项目面向你的所有当前操作步骤，以 **Windows 的命令提示符 cmd.exe，在其中激活 conda 环境** 为准。不要求 Anaconda Prompt，不使用 PowerShell 的激活命令，不创建 venv/virtualenv。

这份环境用于恢复工具、教学实验、测试与现有更新包，**不是尚未选定的完整 Code OSS 构建工具链**。虚拟环境不是 ShunCode 的运行环境：它隔离的是你的 Python/Node 工具，不会把 Electron 应用装进 conda。

## 1. 打开你要用的 CMD

按 Win+R，输入 `cmd`，按 Enter。普通权限即可。提示符通常类似：

```text
C:\Users\你的用户名>
```

激活环境后可能多出 `(shuncode-recovery)`。提示符不是要输入的命令。若看到 `PS ...>`，说明开的是另一种终端；重新打开 cmd，不用转换这里的语法。

本页所有 `cmd` 代码块都在同一个窗口执行，每次一条。引号使用英文直双引号。示例路径必须替换为实际路径。

## 2. 确认 conda 能在这个窗口使用

```cmd
where conda
conda --version
conda env list
```

已经能 `conda activate` 的用户，直接进入下一节，不必重复初始化。

若 conda 已安装但 CMD 找不到，先在资源管理器找到**实际安装目录**中的 `condabin\conda.bat`。不要猜一定在C盘或某个用户名下面。可仅对当前窗口使用完整路径：

```cmd
call "你的实际conda安装目录\condabin\conda.bat" --version
```

后面的 conda 命令也可以用这个完整路径替代开头的 `conda`。如果希望以后新开的 CMD 直接识别 conda，可以先查看初始化将改什么，再决定执行：

```cmd
call "你的实际conda安装目录\condabin\conda.bat" init --dry-run cmd.exe
call "你的实际conda安装目录\condabin\conda.bat" init cmd.exe
```

第二条会改变当前用户的CMD初始化配置。执行后关闭窗口，重新打开普通CMD，再检查 `conda --version`。这不是要求改用 Anaconda Prompt，也不需要你手动修改注册表。若不想持久初始化，可继续使用完整路径的 `conda.bat`。

不要为了激活环境手工设置 `CONDA_PREFIX`：它应由 conda 正确设置，单独造一个变量并不能完成PATH和DLL环境配置。

## 3. 进入源码根目录（包含 package.json、tools、community）

从资源管理器地址栏复制路径：

```cmd
cd /d "你复制的源码根目录完整路径"
cd
dir /b
if exist package.json (echo ROOT_OK) else (echo WRONG_FOLDER)
if exist tools\learning_lab.mjs (echo LAB_FOUND) else (echo LAB_MISSING)
```

`cd /d` 同时切换盘符和目录，源码在D盘时也可从C盘进入。单独 `cd` 显示当前目录；`dir /b` 列出名称。最后应看到 `ROOT_OK` 与 `LAB_FOUND`，否则先修正目录，不继续安装。

## 4. 创建隔离环境：只需一次

仓库提供 `environment-cmd.yml`。先看 `conda env list`，确认没有一个你正在使用、同名但不同用途的环境；不要删掉已有环境来腾名字。

```cmd
conda env create -f environment-cmd.yml
conda activate shuncode-recovery
```

如果你只使用完整路径调用conda：

```cmd
call "你的实际conda安装目录\condabin\conda.bat" env create -f environment-cmd.yml
call "你的实际conda安装目录\condabin\conda.bat" activate shuncode-recovery
```

环境文件逐项解释：

- 首行注释说明用途，不执行代码。
- `name: shuncode-recovery`：环境名，不是Git分支、项目目录或软件版本。
- `channels:`：下载软件包的来源列表。
- `conda-forge`：本文件选择的社区渠道。
- `nodefaults`：不自动追加默认渠道；不等于取消所有网络请求。
- `dependencies:`：环境需要的软件。
- `python=3.12`：选Python 3.12系列，满足更新器要求。
- `nodejs>=22.13,<23`：选兼容的Node 22系列；Node用于恢复脚本，Python不替代它。
- `tk`：Python图形更新器的Tcl/Tk依赖。

这不是每个包精确锁定的跨机器二进制锁文件；conda解析结果会随渠道更新变化，npm依赖另由 `package-lock.json` 锁定。环境创建会联网、下载并写入conda环境，不会修改已安装的ShunCode。

已有专用环境需要补齐本文件依赖时：

```cmd
conda env update -n shuncode-recovery -f environment-cmd.yml
conda activate shuncode-recovery
```

这里没有 `--prune`，也不会自动删除你的其他包。不要在不确定用途的共享环境上照做；可复制环境文件改一个新名字后创建专用环境。

## 5. 确认没有混用全局 Python/Node

```cmd
echo %CONDA_PREFIX%
where python
python --version
python -c "import sys; print(sys.executable)"
where node
node --version
where npm.cmd
npm.cmd --version
python -c "import tkinter; print(tkinter.TkVersion)"
python tools\check_cmd_environment.py
```

`where` 可能列出多个位置，靠前者优先。最后的检查器要求当前Python、Node和npm都来自激活的conda前缀，并验证版本和Tk导入。输出应为 `"ok": true`。它只检查环境，不自动安装、不改PATH、不打开GUI、不启动Bridge。

不要用 `py -3` 替代这里的 `python`：Windows Python Launcher 可能选到conda之外的解释器。**每次重新打开CMD，都要重新激活环境。** 在一个窗口激活，不会让后来从资源管理器双击的程序自动获得同一环境。

检查输出含本机安装路径，公开求助前可遮掉用户名；无需公开其他环境变量或密钥。

## 6. 安装依赖并一次跑完本轮学习检查

仍在源码根目录、同一个已激活CMD窗口：

```cmd
npm.cmd ci --ignore-scripts --no-audit --no-fund
call tools\run-learning.cmd
echo %ERRORLEVEL%
```

最后应为0，且看到 `ALL_LEARNING_CHECKS_PASSED`。

`run-learning.cmd` 按顺序执行：

1. 切到脚本所在仓库根目录，检查conda环境；不自行激活一个猜测的环境。
2. 检查npm依赖是否已经存在；缺少时停止并提示安装，不偷偷联网安装。
3. 检查逐行教材是否与源码一致。
4. 运行只使用替身的策略实验，以及不执行原类的双宿主UI静态实验。
5. 运行Node回归测试（含临时文件和回环HTTP测试）。
6. 用当前conda的Python运行Python回归。

中途失败就停止，保留非零退出码。它不运行更新器、不修改安装目录，也不等于完成所有工程恢复。

CMD批处理文件中，调用另一个 `.cmd/.bat` 后还想执行下一行，应该使用 `call`；否则控制流程可能不返回。这里的脚本已经处理。交互式逐条输入 `npm.cmd ...` 可以正常返回提示符；示例调用总入口时仍明确写 `call`。

## 7. 实际更新器也使用当前 conda

下载并解压最新版社区更新ZIP后，保持当前CMD环境激活，进入解压目录：

```cmd
cd /d "你实际解压更新ZIP的目录"
call apply-community.cmd --help
```

新版启动器优先使用 `%CONDA_PREFIX%\python.exe`，不会在已经激活conda时先跑全局 `py`。无参数启动会打开GUI；有CLI参数时转发参数并返回退出码，不额外暂停。你可以先做只检查：

```cmd
call apply-community.cmd --app-dir "C:\Test\ShunCode"
```

**只有你确认是安装目录副本、全部原文件匹配并已备份后**，才加 `--apply`。这不是学习检查脚本的一部分。

如果只想更新已有安装，不需要Node，可以另建仅含Python/Tk的conda环境；激活后同样用更新启动器。恢复/教学总入口则要求Node也在同一环境。

新版ZIP只调整启动器和操作说明，8个应用目标（6个文件替换、2个宿主UI补丁）没有变化。已经成功应用旧版社区补丁的人**不需要重打**；不要因启动器更新而跳过原哈希保护。

## 8. CMD故障对照

| 现象 | 原因方向 | 安全处理 |
|---|---|---|
| conda不是内部或外部命令 | 当前CMD没配置conda入口 | 使用实际 `condabin\conda.bat` 完整路径，或审阅后初始化cmd.exe并重开窗口 |
| 已经有同名环境 | 不是必须删除的错误 | `conda env list` 确认用途；专用环境可更新，否则换新名字 |
| PackagesNotFound / 求解失败 | 渠道、网络、架构或版本可用性 | 保存错误；不要随意去掉版本范围或关闭SSL验证来掩盖问题 |
| 激活后 Python 仍在全局位置 | PATH混用或窗口不对 | 同一CMD重新激活，核对where与sys.executable，不改用py -3 |
| Node或npm来自全局安装 | 环境内缺Node或PATH顺序不对 | 用环境文件补齐，重新激活；检查器不帮你静默换成全局工具 |
| Tcl/Tk导入失败 | 当前Python环境缺Tk或二进制依赖 | 核对是conda的Python，再用环境文件补齐tk；不要复制别的Python DLL |
| ROOT_OK没有出现 | 目录不对 | 用 `cd /d` 切到含package.json的源码根 |
| 批处理只运行了第一条npm | 嵌套批处理没用call | 采用本仓库总入口或在自写.cmd里使用call |
| `echo %ERRORLEVEL%`不是0 | 上条命令失败 | 立即记录首个错误；它必须单独一行检查，别把 `%ERRORLEVEL%` 放在同一括号块里期待实时展开 |
| 直接双击仍用了其他Python | Explorer没有继承已激活CMD环境 | 从同一个CMD运行新版启动器，不要求改用Anaconda Prompt |

`conda deactivate` 只退出当前环境，不删除它。此流程不需要 `venv`、`virtualenv` 或 PowerShell执行策略更改。


## 9. 本轮实际验证记录

[CI运行34875639178](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/34875639178) 已通过，测试提交 `ab17a9398f1f29027450341ae324a47b0e38c746`。Windows2022的独立作业使用 `cmd /C CALL {0}`，创建本页声明的conda环境，在CMD显式激活，再跑环境检查、完整学习入口和更新器 `--help`；另有Windows/Linux Node回归作业通过。

本地Linux有90项Node通过、34项Python中31通过且3项真实CMD测试跳过；这3项在Windows作业中启用，作业通过。远端证据取得的是GitHub作业/步骤API状态，完整日志下载遇到EOF，未伪造逐项日志。setup阶段有弃用及一次环境尚不存在的提示，最终环境创建和显式激活检查成功；这些提示记录在证据中，不把它们隐瞒为“零警告”。

详见 [验证证据](evidence/cmd-conda-validation.json)。此结果证明这套CMD工具链流程能在该Windows runner工作，**不是已在你的电脑、ShunCode图形界面、真实MCP客户端或完整安装器上验收**。
