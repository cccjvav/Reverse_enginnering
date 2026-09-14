# 给现有用户：ShunCode 0.7.4 社区版自助迁移

这是原作者决定停止自有收费门槛后的迁移方法。可以称为“作者授权的去商业化更新”，不需要伪造账号、订单、激活码或服务端签名。

**适用：作者上传的精确 Windows 0.7.4 构建。** 其他版本、同版本但不同构建、已经修改过的文件均不能强行应用。该更新仍为实验版，未完成 Windows 图形界面端到端验收；先在安装目录副本测试，不覆盖唯一工作环境。

## 改什么，不改什么

- 移除 Bridge 先商业登录/付款/兑换再使用的门槛、付费 UI、商业授权复验与用量上报。
- 保留 MCP 地址令牌、工作区与工具检查、隧道凭证、Codex 登录和模型 API Key。
- 模型或隧道提供商自己收取的费用不会因此消失。
- 不清除聊天、设置、历史订单，不自动停掉作者的远端收款后台。

## 路线一：直接用作者发布的更新包（普通用户）

下载本分支的 [`shuncode-community-0.7.4-overlay.zip`](shuncode-community-0.7.4-overlay.zip)。GitHub 文件页可使用 Download raw file。

当前文件：467,406 字节；SHA-256：

```text
6c5aef6c1d8338367bbf76595524fb8d9f8c991b8652c87838670ee20f85d2fa
```

Windows普通CMD可核对下载文件：

```cmd
certutil -hashfile "shuncode-community-0.7.4-overlay.zip" SHA256
```

哈希应与作者可信发布页一致；哈希本身不是数字签名。不要从陌生镜像取得一个包和同一镜像提供的哈希就当作可信。

1. 保存原安装器、工作资料，复制安装目录作为测试副本。
2. 按 [CMD+conda指南](../docs/WINDOWS_CMD_CONDA.md) 准备并激活环境。需要 Python 3.10 或更高版本，包含 Tcl/Tk；本教程使用普通CMD中激活的conda环境。仅更新包不需要Node.js。完整解压ZIP。
3. 关闭所有 ShunCode 窗口和后台进程。
4. 在已激活conda的同一个CMD中，用 `cd /d "更新包解压目录"` 进入目录，执行 `call apply-community.cmd`，选择**包含 `resources/app` 的应用目录**，不是项目文件夹，也不是 `resources/app` 本身。
5. 工具先核验全部 8 个目标；全部匹配后，再确认是否写入。失败则停止，不手改 manifest，不跳过哈希。
6. 保存应用目录里的 `.shuncode-community-backups` 备份。遇到权限错误先确认路径和文件占用，不要给陌生脚本提升权限或关闭安全软件。
7. 手动启动测试副本，检查 Bridge 页面、启动/停止与自有功能。工具不会替你启动应用。

命令行只检查，不写入：

```cmd
python .\apply_community.py --app-dir "C:\Test\ShunCode"
```

确认目标正确后应用：

```cmd
python .\apply_community.py --app-dir "C:\Test\ShunCode" --apply
```

回退：关闭应用，将实际备份目录传给 `--restore`：

```cmd
python .\apply_community.py --app-dir "C:\Test\ShunCode" --restore "C:\Test\ShunCode\.shuncode-community-backups\实际备份目录"
```

回退也会检查状态。若提示文件又被其他程序修改，先保全现状，不要强行覆盖。

## 路线二：从公开维护代码自行生成相同补丁（开发者）

先按 [CMD+conda指南](../docs/WINDOWS_CMD_CONDA.md) 创建并激活恢复环境，再在 GitHub 选择 `arena/01a09d2c-reverse-enginnering-of-shun` 分支下载源码，或克隆该分支。不需要从聊天下载附件。源码 ZIP 中的 EXE 可能只是 Git LFS 指针，不能当安装器使用；复现当前补丁不需要下载那个 EXE。

仓库根目录，普通CMD中激活 `shuncode-recovery` 后（不要用py -3切到全局Python）：

```cmd
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd test
python -m unittest discover -s tests -q
npm.cmd run build:community
```

对安装目录副本只检查：

```cmd
python tools/apply_community.py --payload .work/community-overlay --app-dir "C:\Test\ShunCode"
```

确认后加 `--apply`。要制作可分享 ZIP，执行：

```cmd
python tools/package_community.py
```

打包器会检查当前 payload 是否与已通过真实安装包验证的 manifest 一致；更改过的 payload 必须重新验证，不能自行修改“验证通过”标记。

两条路线最终作用相同，不是先后叠加两次。已应用的目录再次执行通常会因不再匹配原件而拒绝，这是保护行为，不是需要破解的新限制。

## 如果想自己理解并修改收费逻辑

阅读 [COMMUNITY_MIGRATION.md](../docs/COMMUNITY_MIGRATION.md)，它已经记录：

1. 从扩展 activate 追踪 license service → access controller → BridgeManager。
2. 商业账号/支付与真正安全认证如何区分。
3. 用本地社区可用性策略替代商业授权，不伪造许可证。
4. 移除支付、轮询与复验，保留真实 Bridge 生命周期。
5. 分别修改 Workbench 与 Sessions 自定义 UI，并核验无关方法不变。
6. 版本/哈希锁定、真实包校验、备份、回滚及第一轮宿主匹配失败的修正。

维护文件在 `community/extension/src/` 和 `community/ui/`；原件在 `recovered/`。不要直接在整个 bundle 里全局替换 `auth/token/false/true`，那会同时破坏安全检查或模型认证。

## 必须随分发附上的限制

- 原读取器和补丁写入器存在已复现的目录替换竞态，详见 [读文件说明](../reconstructed/bridge-core/FILE_READER.md) 与 [补丁说明](../reconstructed/bridge-core/PATCH_WRITER.md)。旧更新 ZIP **没有修复这些问题**。
- `community/bridge-core/` 是单独维护候选，不在 ZIP 内；再次检查路径也不是完整防竞态方案。
- 不建议把实验版本用于敏感目录、不可信并发工作区或不可信远程会话；MCP 地址按凭证保密。
- 自动更新可能覆盖社区修改。迁移前记录原更新设置，更新后若文件变了必须重新核对，不能盲目重打补丁。
- Community 标签不自动授予所有代码新的开源许可；作者还需明确自有代码许可，保留第三方版权与 NOTICE。
- 旧客户端、网站和后台仍可能下单。作者应另行停售、处理历史订单/退款、停用旧支付接口；客户端补丁做不到服务器下线。

作者分发时建议同时提供：本教程链接、固定版本 ZIP 与哈希、去商业化技术教程、已知风险/回退说明。不把实验补丁宣传为完整安装器、已签名发行版或已经解决全部安全问题。


新版启动器优先使用已激活的conda Python；从资源管理器直接双击不会继承另一个CMD窗口的激活状态。两版ZIP的8个应用目标（6个文件替换、2个宿主UI补丁）相同，已经应用旧社区补丁的用户无需重打。
