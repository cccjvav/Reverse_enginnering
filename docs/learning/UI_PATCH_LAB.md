# 第二组实验：只解析双宿主UI，不启动原界面

## 学完要能回答什么

- 为什么Workbench和Sessions的片段不能混用？
- 为什么AST位置要减一，而不是按UTF-8字节数切片？
- 如何去掉自有商业界面，同时保留工具、Skills、隧道凭证控制？
- 为什么免费可用不等于真实Bridge正在运行？

这组实验读取原类、生成内存中的修改字符串并核对方法，不运行原构造器、静态块、扩展或MCP服务器，不写安装目录。它不是完整UI重建，也不提供伪装成真实验收的界面截图。

## 1. 环境和位置

普通Windows CMD，先按 [CMD+conda指南](../WINDOWS_CMD_CONDA.md) 创建环境。每次新开CMD激活一次，在含package.json的源码根目录操作：

```cmd
conda activate shuncode-recovery
cd /d "你的源码根目录完整路径"
python tools\check_cmd_environment.py
npm.cmd run learn:check
```

若尚未安装npm依赖，先执行 `npm.cmd ci --ignore-scripts --no-audit --no-fund`。环境检查应为ok:true；教材检查应成功，projectWideExplanationComplete:false不是错误，是未完成全项目教学的标记。

## 2. 运行静态UI实验

```cmd
npm.cmd run learn:ui
echo %ERRORLEVEL%
```

第二条必须单独输入，应为0。输出要逐项读：

| 字段 | 预期 | 意义与局限 |
|---|---|---|
| staticAnalysisOnly | true | 仅解析/修改字符串，不执行原类 |
| recoveredClassExecuted | false | 没有调用原类或构造器；不是已打开原UI |
| filesWritten | false | 此实验没有写文件；其他build命令会写文件，不能混为一谈 |
| distinctHostInputs | true | 两份原类的哈希不同，必须分别核验 |
| hosts | 两项 | workbench和sessions都要检查，不能只看第一项 |
| preservedMethodCount | 各73 | 不在允许改动集合中的原方法内容逐字保持 |
| toolRenderingPreserved | true | renderCustomTools仍在保留方法证据中 |
| tunnelTokenClearingPreserved | true | 清除隧道令牌功能没有被误删 |
| paymentMethodRemoved | true | 新类的方法表中已无createPayment |

每个宿主还有originalSha256和updatedSha256。哈希不同表示输入/输出字节不同；哈希不是签名，不能证明逻辑正确或完整应用可运行。

完整 `call tools\run-learning.cmd` 现在也包含这组实验。它先做环境和教材检查，再做策略模拟、静态UI实验、Node/Python回归。

## 3. 不要把四层材料混在一起

```text
recovered/bridge-ui 与 recovered/bridge-ui-sessions
  原编译类片段，作为证据保留，不是完整原TypeScript项目
                    ↓ 分别校验各自SHA
community/ui/access-card.js.txt
  新的社区说明卡片（替换旧账户/付款区域）
community/ui/access-methods.mjs
  三个新方法体字符串（渲染状态、渲染错误、刷新）
                    ↓
tools/patch_bridge_ui.mjs
  定位旧区域 → 收集编辑 → 逆序替换 → 解析检查 → 核对73个保留方法
                    ↓
tools/build_community.mjs
  才把两套原/新片段写入overlay输出，并加入manifest
```

本轮逐行补齐的是 `patch_bridge_ui.mjs` 全部72行，以及 `access-methods.mjs` 全部20行。卡片模板、捕获器、完整原类及所有UI测试还没有逐行讲完，不能从这张图推导成整个UI工程已恢复。

## 4. 小实验：括号为什么造成位置偏移

`class Demo { ... }` 可以是声明；补丁器用 `(` 和 `)` 包住它，让解析器明确得到类表达式。原文本开头没有这个左括号，AST坐标却把它算进去了，所以切原文时要用 `start-1` 和 `end-1`。

例如原文本：

```js
class Demo { first() { return "😀"; } second() { return 2; } }
```

表情在UTF-16中占两个代码单元，在UTF-8中占四字节。Acorn坐标与JS的slice都按UTF-16代码单元工作。不要把它转成字节偏移，也不要在得到AST后先格式化原文再按旧坐标切。

回归中有一项会准确切出 `second() { return 2; }`，验证表情之前产生的偏移没有破坏第二个方法。

## 5. 为什么不把所有包含auth、token、license的东西删除

本次只移除作者自有商业命令、套餐/支付控件和商业状态引用。MCP访问令牌、工具权限、模型认证、隧道凭证仍有实际用途。

补丁器有两个层次的保护：

1. 允许改变的方法明确列出来，不在名单内的方法必须在新类中仍唯一存在，内容必须相同。
2. 旧商业命令/状态字符串若残留就拒绝输出。

这不是全面的安全证明：允许修改的方法仍需认真测试；已保留的原方法也可能含已知或未知缺陷，原读写路径竞态没有因“哈希相同”而消失。

## 6. 真正练习失败，而不是让你修改原件

在同一CMD运行：

```cmd
node --test tests\community-ui-hardening.test.mjs
```

应看到5项测试通过。这些测试中的“成功”包含**按预期拒绝错误输入**：

- 非字符串、对象、两个类组成的序列表达式、额外语句，都不能冒充一个UI类。
- 含会throw的静态块可以被解析，但静态块不能真的运行。
- 两个宿主分别测试：旧收费门槛缺失、账户卡片起点缺失、账户/连接卡片顺序倒置，均应停止。
- 不支持的宿主名拒绝；新卡片若引入旧商业标识，即使在注释里也拒绝。
- 静态实验必须覆盖两个宿主并给出各73个保留方法。

这里的损坏输入都是内存字符串副本，测试不覆盖recovered原件。不要为了看红色输出直接破坏原件SHA，也不要删除检查来“修好”测试。

另外的 `tests/community-ui.test.mjs` 还验证未登录社区用户启动、保留停止、组件不匹配拒绝、隧道配置缺失拒绝等行为。它使用替身调用经过审阅的方法，不执行原构造器；与本组完全静态实验不同，二者都不等于真实GUI验收。

## 7. 三个易误解的细节

**Object.hasOwn为什么重要？** 方法体映射是普通对象，会继承constructor等属性。直接按真值判断 `accessMethods[name]`，可能把继承属性当替换代码。只接受自有属性可以避免这种误替换；这曾是实际开发中遇到的问题。

**state-running为什么不证明Bridge运行？** 新renderAccess方法复用了徽章CSS样式，表示社区策略就绪。真实运行状态仍来自Bridge管理器；不能看绿色徽章就宣称监听端口或工具调用成功。

**为什么保留refreshAccessAndPlans这个旧名字？** 原类仍有调用点。新方法体只返回refresh，不再查询套餐；保留名字让调用者继续工作，不代表支付逻辑还在后台偷偷运行。

## 8. 自测与边界

1. 两个宿主的类很像，可以互换吗？——不可以，实际编译变量绑定与哈希不同。
2. 源码里出现available:true就算成功吗？——不够，还要edition匹配，并区分策略状态与真实运行状态。
3. 构造器在允许修改名单里，就不需要检查吗？——不对，需要定位、顺序检查及行为/结构回归，不能靠73个未改方法的证据替它兜底。
4. 卡片顺序倒置时自动交换边界安全吗？——不安全，可能意味着错误版本或错误定位，应拒绝并调查。
5. 5项新测试成功就能发布完整安装器吗？——不能；这轮仍无真实GUI、完整扩展激活、MCP客户端或新装/升级验收。

继续精读 [逐行手册](LINE_BY_LINE.md) 的第5、6部分。当前全项目覆盖边界见 [COVERAGE](COVERAGE.md)。
