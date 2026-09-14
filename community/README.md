# ShunCode Community：定制功能恢复与去商业化

本目录是作者明确要求的修改版；`../recovered/` 仍保存原始发行包提取证据。**Community 是本次构建标识，不意味着已为原代码选定新的开源许可证。**

## 改动范围

| 改为免费/移除 | 明确保留 |
|---|---|
| Bridge 商业许可证启动门槛 | MCP 路由访问令牌、地址保密提示 |
| 为解锁 Bridge 而进行的 GitHub/Gitee 登录 | Codex 自身登录、模型 API Key、第三方模型费用 |
| 支付宝套餐购买、下单、激活码和支付轮询 | Cloudflare Named/ngrok 所需的真实隧道凭证 |
| 15 分钟商业授权复验、授权到期自动停机 | BridgeManager 的工作区、隧道、MCP 会话检查 |
| 商业服务端用量上报 | 本地工具统计、工具参数/路径验证、工作区范围选择 |
| 账户/付费面板与收费相关命令面板入口 | JSON 工具、Skills、共享工作区、聊天等自有 UI |

新的可用性服务明确返回 `edition: community`、`available: true`、`signedIn: false`。保留的 `licensed: true` 仅兼容旧接口中的功能可用字段，**没有伪造账号、签名、订单或许可证**。旧下单/兑换命令保留拒绝处理，不能创建扣款。登录/刷新兼容调用只返回本地状态，无外部认证。

## 结构与构建方式

- `extension/src/`：新写的离线可用性服务、生命周期控制器。
- `ui/`：免费说明卡片与渲染方法。
- `../tools/build_community.mjs`：以原始哈希锁定的扩展 bundle 为基底，替换已识别的商业模块；同时输出对应修改后的 TS 源文件。**不是从完整原始工程重新编译。**
- `../tools/patch_bridge_ui.mjs`：对取回的自定义 Bridge Widget 做 AST 定位修改；JSON 工具、Skills、隧道设置等无关方法逐字节检查不变。
- `../tools/apply_community.py`：离线校验/应用/回退工具。

在仓库根目录：

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
python3 -m unittest discover -s tests -v
npm run build:community
```

输出在 `.work/community-overlay/`：6 个扩展替换文件，以及两个宿主 bundle 中的**自定义 UI 类替换片段**。不会把几十 MB 的整个 VS Code bundle 纳入更新包。按哈希核验两个宿主（Workbench 和 Sessions），避免只改其中一个导致界面行为不一致。

## 测试版更新包

如果本目录已有 `shuncode-community-0.7.4-overlay.zip`，它是经过真实包文件比对的**实验性更新包**，不是完整 Windows 安装器，也尚未通过 Windows 实机端到端功能验收。

1. 保留原始安装包和工作资料。优先在原安装目录的**测试副本**上验证，不覆盖唯一工作环境。
2. 从 GitHub 下载并完整解压 ZIP；需要 Python 3.10+，无需 Node.js。
3. 关闭所有 ShunCode 窗口和后台进程，避免并发更新/文件占用。
4. 双击 `apply-community.cmd`，选择包含 `resources/app` 的 ShunCode 应用目录。
5. 工具先验证 8 个目标文件都与作者上传的 **0.7.4 精确构建**匹配。通过后再次确认才写入。不同版本、已经打过补丁、缺文件或校验失败时会停止，不能强行跳过。
6. 工具自动在应用目录的 `.shuncode-community-backups/<时间-随机值>/` 保存原件，采用同目录临时文件替换；失败时尝试回滚并报告结果。**务必保留备份**。
7. 工具不会自动启动 ShunCode。之后手动测试 Bridge 页面、启动/停止、工具与工作区功能。

只检查不写入（默认 CLI 操作）：

```powershell
python apply_community.py --app-dir "C:\path\to\ShunCode"
```

应用：在上述命令后加 `--apply`。

回退（关闭应用后）：

```powershell
python apply_community.py --app-dir "C:\path\to\ShunCode" --restore "C:\path\to\ShunCode\.shuncode-community-backups\具体备份目录"
```

回退也会校验哈希：如果应用后来已更新或文件被其他人修改，不会强行覆盖。若进程被强制终止导致锁文件残留，先确认没有更新/回退进程在运行，保留备份和错误信息后再处理，不要盲目删锁重试。Program Files 等目录可能需要写权限，工具不会自动提权或关闭安全防护。

## 不会偷偷处理的事情

- 不删除旧订单、历史付款记录或已有账号数据；新客户端不再读取它们作为门槛，也不恢复未完成支付轮询。
- 不访问、关闭或修改远端 Cloudflare Worker、商户支付宝/支付网关、GitHub/Gitee OAuth 后台。
- 不保证第三方模型或隧道服务免费，不移除它们的认证。
- 不禁用 TLS 校验，不把 Bridge 变成匿名公网命令执行端点。
- 不改应用自动更新策略；旧更新源将来可能覆盖这份实验补丁。正式发行需要另行处理社区版更新源和完整打包。

## 原商业服务的下线待办（需要你在自己的后台完成）

新客户端不下单，不等于旧客户端/旧官网已经不能下单。若已对外出售，请在你控制的后台：

1. 停止套餐销售和创建新订单，移除网站/文档购买入口；不要继续接受已不需要的付款。
2. 保留历史订单、对账、退款和异步支付通知的必要处理，不要直接删掉支付回调服务。
3. 对旧用户说明免费迁移方式和售后/退款安排；是否退款由你依据实际订单决定。
4. 完成旧客户端迁移后，再评估停用授权 Worker 与专用于商业登录的 OAuth 应用。不要误撤销模型服务或开发账号凭证。

这些后台操作目前**没有执行**，也不需要你把密码、令牌或支付密钥发到对话里。
