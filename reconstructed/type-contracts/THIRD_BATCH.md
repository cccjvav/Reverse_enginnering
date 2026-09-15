# 第三批：CustomTool/Skill及日志回调契约

这是工程类型恢复，不是产品放行。累计12个模块、18条候选错误；原JS推断59条基线仍可独立复现。

## 新增5份声明及依据

| 声明 | 从哪里推导 | 关键约束 |
|---|---|---|
| custom-tools.d.ts | 同名facade、manifest解析、skill返回、contract常量、sandbox执行返回 | 完整Manifest、StatusEntry、发现/查找/筛选、执行结果及日志参数 |
| custom-tool-skill.d.ts | diagnoseSkillTools/readSkillManifest/failSkill和原bridge-server的duplicate-name分支 | loaded真假判别联合、失败理由/修复方式、可选失败名称 |
| custom-tool-skill-import.d.ts | importSkill/generateSkillRunner两个返回路径 | 重命名来源可缺失；generatedRunner只有true或undefined；已有runner没有runnerRel |
| custom-tool-admin.d.ts | toggleCustomTool/deleteCustomTool实际落盘与返回 | 明确返回enabled或deleted路径，日志string回调；不是授权检查 |
| bridge-tool-name.d.ts | 名称裁剪/前缀候选/isKnown调用 | isKnown收string返boolean，未知名原样trim返回而非拒绝 |

原始51个文件、41个提取模块、SDK依赖锁、社区ZIP和实验bundle均未修改。独立声明只接入候选诊断解析。部分Skill/import声明覆盖当前消费者需要的公共入口，没有声称为提取产物每一个内部导出补齐类型。

## 一步步读懂这次类型

### 1. Manifest不是任意对象

name/title/description、command、timeoutMs、enabled、sourcePath来自parseManifest返回。Skill另有skillDir。输入Schema只保证根对象的type为object，其他键保持unknown，因为原解析器没有完整验证每个JSON Schema关键字。这个有依据的Record<string, unknown>不是给整个Manifest加通配字段掩盖错误。

command为字符串数组，但它的非空性、数量和内容安全仍靠运行时验证；string[]不意味着命令安全。executor可以运行脚本，原实现不是OS沙箱。声明成功不代表执行权限或路径竞态已解决。

### 2. 查找失败和未启用必须处理

loadCustomTools会读JSON、加载Skills；启用Skills时还可能迁移旧目录，所以不能把“发现”当成绝对只读操作。listEnabledCustomTools过滤enabled，findCustomTool在过滤后的列表查找，因此返回Manifest或undefined。不能直接当作必定存在的工具来运行。

Skill诊断loaded:true只说明文件能解析、入口能找到；它不表示enabled:true。测试中的关闭Skill仍是loaded:true，而findCustomTool找不到它。

### 3. 成功/失败为什么用联合类型

loaded:true时必有name；loaded:false时必有reasonCode/reason/fix，name可选。这里保留失败名称，是因为原bridge-server会把名称冲突的已加载结果改成带name的失败项。

reasonCode还包括unknown：原实现读取失败且没有收集到明确原因时确实使用这个兜底，不能为了枚举漂亮而漏掉。

同理，generateSkillRunner的generated:true分支有runnerRel；generated:false是入口已经存在，没有该字段。类型负例要求先判断generated，不能直接访问runnerRel。

### 4. 导入成功不是加载或安全成功

importSkill返回name、directory、renamedFrom和generatedRunner。重名时会换名；没生成runner时返回undefined，不是false。若导入后生成runner失败，原代码可能只写日志并仍返回导入结果，因此不能仅凭导入成功就对工具执行打PASS。

本轮只在临时文件夹导入虚构目录、生成/检查runner，不执行runner，不新增ZIP安全通过结论。之前发现的归档/脚本安全限制仍适用。

### 5. 日志参数“接受”与“执行”分开

原bridge-tool-dispatcher向executeCustomTool传入signal和log；提取执行器只使用signal，从未调用options.log。

第一版最小声明只写signal，候选诊断出现20条，其中新增log属性不匹配且其参数仍隐式any。对照原消费者后补兼容参数log:(message:string)=>void，并在声明上直接写明NOT invoked。这描述已有调用契约，不是编造执行器有日志行为。

新增测试用预先aborted的signal调用虚构工具，返回exit_code:null、aborted:true、isError:true，日志调用次数0。它不会启动子进程，不把“回调可传入”冒充“审计日志已写出”。

### 6. 多文件来源核验

facade里的Manifest和executeCustomTool不能只拿facade文件当证据。因此provenance新增evidenceDependencies，记录manifest、contract、sandbox、skill四个原模块SHA。诊断器将这些哈希与core来源清单交叉核对，并验证实际字节，再解析声明；声明文件本身也有SHA。

## 实际失败与修正

独立声明夹具使用strict/noEmit/skipLibCheck:false。第一次检查真的失败了：node:path声明采用export=，不能用export * as直接再导出。改为具明确类型的导出常量（含ESM namespace实际default形态），重新生成声明哈希后通过。没有通过关闭声明检查绕开错误。

新类型负例覆盖：查找可能缺失、skillsEnabled必须布尔、command元素必须字符串、schema根type、成功诊断必有name、generatedRunner不接受false、runner分支缺字段、exit_code可null、名称谓词必须返boolean。负例用@ts-expect-error，若错误意外消失，测试会因未使用指令而失败。

## 普通Windows CMD怎么复现

先激活conda，进入仓库根目录并按原指南安装锁定依赖，逐行执行：

```cmd
call npm.cmd run diagnose:contract-types
echo %ERRORLEVEL%
node --test tests/bridge-core-type-contracts.test.mjs
echo %ERRORLEVEL%
```

合同模式预期18条错误、退出1；专项9项通过、退出0。两者不矛盾：回归证明当前状态可复现，不把18条错误认作类型通过。

39→18共减少21条：8条缺失类型导出、3条Skill名称访问、10条隐式any回调。剩余分类为TS2305=1、TS2339=11、TS2345=3、TS2353=1、TS2724=2。新增声明没有新增any，但原TS的显式any、checkJs:false下的未检查实现仍存在。

下一步还需取消命令、ToolContentBlock/文件工具结果、HTTP边界处理和定制Chat宿主；权限调度、原生资产、真实激活/GUI/MCP和新Windows安装器都未放行。

## 本轮CI结果

提交10bc1f72113ec6b38539c0b491d73ef16bb397b6的[运行35033132376](https://github.com/cccjvav/Reverse_enginnering_of_shun/actions/runs/35033132376)已完成：Ubuntu、Windows2022、普通CMD+conda三个作业全部成功。作业/步骤API证据在docs/evidence/type-contract-batch3-tests.json，本地126项Node/31项Python通过（另3项Windows专属本地跳过）。未归档远端逐项完整日志；CI成功不表示18条类型错误已消失，更不是实机产品验收。
