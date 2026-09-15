# Custom Tools / Skills执行链恢复（2026-09-15）

## 这次恢复了什么

从原Windows0.7.4扩展bundle恢复以下9个模块、105个声明。函数体保留原发布逻辑，只重建ESM导入/导出、转换Node内建require。每个声明的原偏移、原SHA及输出SHA记录在provenance.json，不运行整个扩展来提取。

| 模块 | 声明数 | 实际恢复范围 |
|---|---:|---|
| custom-tool-contract | 12 | 目录、保留名称、超时与结果协议常量 |
| custom-tool-manifest | 7 | JSON读取、字段/命令/超时校验 |
| custom-tool-migration | 4 | 旧Skills目录迁移与进程内去重 |
| custom-tool-skill | 20 | Markdown/frontmatter、入口发现、sidecar、诊断 |
| custom-tools | 8 | 工具加载、重复名称处理、启用过滤、指纹 |
| custom-tool-admin | 4 | 启停manifest/sidecar、删除工具或Skill |
| custom-tool-skill-import | 20 | 目录/ZIP导入、命名、生成提示型Skill入口 |
| custom-tool-sandbox | 10 | 参数校验、子进程执行、输出/超时/取消 |
| read-image | 20 | 图片格式/尺寸识别、路径与权限检查、读取和结果格式化 |

以上9个来源标签的**已发布顶层声明全部纳入**。这不包括编译擦除的类型、被tree-shaking删除的逻辑、原测试和原导出表。此前列出的5个无对应JS目标现在都有实现，但不能据此宣布原工程编译成功。

## 已验证的实际链条

`tests/bridge-core-custom-tools.test.mjs`使用临时目录：

1. 原声明与重建manifest解析器对照，拒绝保留工具名、越界命令、非法超时等输入。
2. 加载工具、处理重复、过滤禁用项、生成状态指纹。
3. 写回启停设置、删除指定临时manifest；保留旁边的无关文件。
4. 迁移旧目录，保留同名冲突，不覆盖现有目标。
5. 导入自建Skill目录，生成入口、发现工具、运行其纯文本提示脚本、启停和删除；保留导入源。
6. 重复导入目录命名与实际工具名称碰撞检查。
7. 归档路径字符串的拒绝检查；**没有运行tar.exe解压或测试恶意ZIP安全性**。
8. 受控Node脚本执行、参数传递、错误参数拒绝、调用前取消。
9. 临时图片读出、权限拒绝、大小限制与取消。
10. 原TS运行时导入审计，区分文件存在与真正导出是否齐全。

另外，全模块加载、原声明哈希和确定性输出测试也覆盖新增模块。对照VM中的child_process被替身拒绝执行；真实子进程只在独立ESM测试中运行自己创建/审阅的Node夹具。VM不是安全沙箱。

## 发现或确认的风险——不得直接部署

- **名字叫sandbox，不等于沙箱。** 原执行器使用execFile、不经shell，但仍是宿主用户权限的进程，继承process.env，可通过Node或Skill解释器运行代码；cwd不限制文件访问范围。
- 原loadCustomTools默认还会迁移旧目录，不是纯只读查询。测试只给它临时目录。`skillsEnabled:false`可避开Skill加载/迁移，不是全功能安全开关。
- 迁移根在尝试前就加入进程内集合，失败后重试受影响。原样保留，不把它称作可靠事务。
- 导入重复Skill时只改目标目录名，原frontmatter name仍可能相同，加载器最终保留第一项。测试确认两个目录存在但只发现一个同名工具。
- ZIP列表的路径字符串校验不检查全部链接/解压行为；目录遍历使用stat，不能据此声称抵抗符号链接、循环和并发替换。这里没有安全认证。
- 原管理员删除、导入和sidecar写回没有统一事务或原子路径隔离。
- 图片读取也在路径/权限检查后才打开文件，不能认为消除了已知检查/使用竞态。`include_data_uri:false`仍返回base64，不是禁止返回图片内容。
- 本轮未覆盖所有超时、子进程树终止、输出溢出、损坏图像、解压炸弹或GUI事件；入口还需宿主授权、确认和MCP会话控制。

**新增实现没有装入社区overlay或接入真实MCP服务。** 原件、原商业认证分离原则、现有更新包都保持不变。

## 工程还卡在哪里：现在有可重复的运行时导入清单

执行 `node tools\audit_extension_runtime.mjs --check`。工具校验原TS哈希，用esbuild擦除类型后检查共享模块ImportDeclaration；不执行源码、不修改导入，不进行类型检查。

后续文件执行轮次已补齐以下缺口：55个共享导入现在都有对应导出，3个barrel关系与invokeFileTool已恢复。详情见 [FILE_EXECUTION.md](FILE_EXECUTION.md)。原TS仍未接线或类型检查通过。

这份统计只检查该目录的静态共享运行时导入，不检查完整宿主依赖、动态导入、类型、VS Code proposed API或所有打包资产。详见 `docs/evidence/extension-runtime-imports.json`。

## 普通Windows CMD + conda复现

在源码根目录、激活恢复环境后：

```cmd
conda activate shuncode-recovery
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run check:bridge-core
node tools\audit_extension_runtime.mjs --check
node --test tests\bridge-core-custom-tools.test.mjs
npm.cmd test
```

测试会在系统临时目录写文件并运行受控Node夹具，不操作真实工作区或安装目录。不要直接对自己的项目调用loadCustomTools/importSkill/deleteCustomTool来试验。没有要求改用Anaconda Prompt，也没有创建venv。

当前全部41个模块是可测试重建基础，不是已完整恢复的ShunCode工程或可分发Windows安装器。
