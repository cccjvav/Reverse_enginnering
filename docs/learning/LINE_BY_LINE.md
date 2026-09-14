# 第一组代码逐行精读：社区策略、控制器与补丁基础

先读 [零基础实验课](START_HERE.md)，再读本页。这里完整讲解4个文件的271行（含注释、空行和结构行），不是全工程已经讲完。

本页由手写注解和真实源码生成；不要复制本页去覆盖原源文件。修改源码后需重新审阅注解并生成。类型声明不等于运行时保证，测试也不等于完整安全认证。

## 阅读顺序

1. `BridgeLicenseService`：回答“商业账号/付款是否必要”。
2. `BridgeAccessController`：把请求转给真实 Bridge，不伪造运行状态。
3. `patch_utils.mjs`：内容指纹、逆序替换、AST 遍历、唯一定位。
4. `build_community.mjs`：原件校验、策略/入口替换、manifest与双宿主UI组装。

章节目录：
- [第1部分：社区可用性策略：73行](#file-1)
- [第2部分：生命周期适配器：30行](#file-2)
- [第3部分：补丁定位基础工具：31行](#file-3)
- [第4部分：社区overlay主构建器：137行](#file-4)

<a id="file-1"></a>
## 第1部分：社区可用性策略：73行

原文件：[community/extension/src/bridge-license-service.ts](../../community/extension/src/bridge-license-service.ts)

对应源码 SHA-256：`30ed09b966c8addd6e55746ccf40fe988befaebc427b30f7084af448f6be0ed8`

### L1

```ts
/**
```

开始一段文档注释，直到第6行才结束；注释不会发网络请求，也不参与授权判断。

### L2

```ts
 * Community edition policy, authored during recovery.
```

说明这是恢复过程中新写的社区版策略，不是原安装包里逐字取回的实现；保留来源身份能避免把修改当证据。

### L3

```ts
 * The legacy class/fields are a compatibility adapter, NOT a fabricated licence.
```

旧类名和字段名是给旧调用者兼容用的。名字含 License 不等于正在签发许可证，真正行为要看39行以后的方法。

### L4

```ts
 * No OAuth, checkout, receipt polling, JWT signing/verification or usage upload.
```

列出明确不做的事情：OAuth登录、结账、订单轮询、JWT签名/验签、用量上传；这是范围说明，仍需测试核实，不能只信注释。

### L5

```ts
 * Provider accounts (e.g. Codex) and Bridge transport authentication are separate.
```

第三方模型账号和 Bridge 传输认证是另一层。去掉自己的收费服务不能同时删掉 Codex 登录或 MCP 路由令牌。

### L6

```ts
 */
```

结束第1行开始的文档注释；下面才是 TypeScript 声明。

### L7

```ts
export interface BridgeAccessSnapshot {
```

export 让其他模块可以导入；interface 描述状态对象应有什么字段；BridgeAccessSnapshot 是类型名。它不是对象实例，转译成 JavaScript 后接口会被擦除。

### L8

```ts
  readonly edition: "community";
```

edition 的类型是字面量 "community"，不是任意字符串。readonly 在类型检查时限制重新赋值，不等于运行时 Object.freeze；实际值由43行创建。

### L9

```ts
  readonly available: true;
```

available 的类型只能是 true，表示这项社区能力可用；不是已经监听端口、隧道成功或工具安全。实际运行状态由 BridgeManager 管理。

### L10

```ts
  readonly requiresAccount: false;
```

requiresAccount 只能为 false，表示本自有 Bridge 不要求商业账号；不是所有模型都无需账号。

### L11

```ts
  readonly requiresPayment: false;
```

requiresPayment 只能为 false，表示本自有 Bridge 不要求付款；模型供应商的收费仍独立存在。

### L12

```ts
  readonly serverConfigured: false;
```

serverConfigured 是旧商业授权服务的字段。false 不表示整个 Bridge 服务器没有配置，不能为了让界面显示正常就乱改成 true。

### L13

```ts
  readonly signedIn: false;
```

signedIn 固定为 false：没有伪装成已经登录的商业用户。界面需要改用 available 等能力字段，不能继续用商业登录状态拦住免费功能。

### L14

```ts
  readonly installationId: string;
```

installationId 声明为字符串。这里保留接口形状，不读取设备指纹；44行实际返回空字符串。

### L15

```ts
  readonly githubUserId: string;
```

githubUserId 是旧 GitHub 商业身份编号字段；类型是 string，44行返回空值，不虚构真实用户。

### L16

```ts
  readonly githubLogin: string;
```

githubLogin 是旧 GitHub 登录名字段；保留名字让旧界面读取不报字段缺失，实际仍为空。

### L17

```ts
  readonly giteeUserId: string;
```

giteeUserId 同样是旧 Gitee 身份编号；45行填空值，不向 Gitee 发请求。

### L18

```ts
  readonly giteeLogin: string;
```

giteeLogin 是旧 Gitee 用户名；保持兼容字段，不代表继续支持商业登录流程。

### L19

```ts
  readonly email: string;
```

email 是旧商业身份的邮箱字段；45行不提供邮箱，也不读取用户资料。

### L20

```ts
  readonly avatarUrl: string;
```

avatarUrl 是头像地址；45行为空，避免为假账号填头像链接。其他代码是否加载资源仍要另查，接口本身不加载图片。

### L21

```ts
  /** Legacy availability flag. It does not assert possession of a paid licence. */
```

这一行特地解释最容易误会的 licensed：下面的 true 只是旧接口的可用性兼容值，不是持有付费许可证的声明。

### L22

```ts
  readonly licensed: true;
```

licensed 的类型固定为 true，兼容仍读取该字段的旧逻辑；没有 JWT、签名或订单凭证。不能把整个工程里的 licensed 都全局替换成 true。

### L23

```ts
  readonly expiresAt: string;
```

expiresAt 是旧授权到期时间字符串；46行用空值表示这里没有商业到期时间，而不是伪造遥远未来的有效期。

### L24

```ts
  readonly permanent: true;
```

permanent 固定为 true，配合旧界面表达社区可用性不按商业期限到期；不承诺产品永久维护或模型永久免费。

### L25

```ts
  readonly error: string;
```

error 是状态中的错误文本；46行正常返回空字符串。后面的支付方法仍会抛异常，不能误以为所有操作都不会失败。

### L26

```ts
  readonly plans: readonly never[];
```

plans 是只读数组类型，元素类型 never 表示正常类型系统中不能放入套餐元素；运行时47行返回 []。这是类型约束，不是运行时防篡改容器。

### L27

```ts
  readonly paymentTypes: readonly never[];
```

paymentTypes 同样是空支付方式列表；不提供支付宝等结账选项，不等于已把远端商户后台关掉。

### L28

```ts
  readonly plansError: string;
```

plansError 是兼容的套餐加载错误字段；空值不说明网络请求成功，而是这里根本不加载远端套餐。

### L29

```ts
  readonly paymentOrder: {
```

声明 paymentOrder 是一个嵌套对象。保留其形状是为了旧 UI 读取子字段时不因 undefined 而崩溃。

### L30

```ts
    readonly id: string; readonly status: string; readonly checkoutUrl: string;
```

同一行有三个声明：订单 id、状态 status、付款链接 checkoutUrl，类型都是字符串。49行分别给空 id、disabled 状态和空链接，不制造订单。

### L31

```ts
    readonly planId: string; readonly planName: string; readonly amount: string;
```

同一行声明套餐编号 planId、名称 planName、金额 amount；金额在旧接口里是字符串而不是 number，保持形状避免改变调用协议。

### L32

```ts
    readonly paymentType: string; readonly createdAt: string; readonly expiresAt: string;
```

声明支付类型 paymentType、创建时间 createdAt、订单到期 expiresAt；这里的 expiresAt 属于订单对象，不是23行的外层授权到期字段。

### L33

```ts
    readonly paidAt: string; readonly entitlementExpiresAt: string; readonly error: string;
```

声明已付款时间 paidAt、权益到期 entitlementExpiresAt、订单错误 error。均不填假付款记录；嵌套 error 与外层 error 是不同属性。

### L34

```ts
  };
```

结束 paymentOrder 的对象类型并加分号；它没有执行“关闭订单”操作，只结束一个类型声明。

### L35

```ts
}
```

结束整个 BridgeAccessSnapshot 接口；下面才是可以 new 出实例的服务类。

### L36

（空行）

空行用于把类型说明与运行实现隔开；删除空行通常不改变行为，但本教程按原行号追踪，改动后必须更新注解。

### L37

```ts
export class BridgeLicenseService {
```

导出名为 BridgeLicenseService 的类。旧调用者可以继续使用这个类名，但类内部已经换成社区策略。

### L38

```ts
  // Accept the historical constructor shape but never access identity/receipt storage.
```

说明为什么还接受旧构造参数：保持调用方式兼容，却不读身份/收据存储；对应测试用一读属性就报错的 Proxy 来检查。

### L39

```ts
  constructor(_context?: unknown, _output?: unknown) {}
```

constructor 在 new 时执行。两个参数的 ? 表示可省略，unknown 表示未确认类型；下划线是“有意不用”的命名习惯，不是特殊语法。空 {} 不保存也不读取参数，不会自动清除历史账号数据。

### L40

```ts
  async initialize(): Promise<void> {}
```

async initialize 返回 Promise&lt;void&gt;：调用者仍可 await 初始化，但方法没有网络、定时器或存储操作；空方法不是在后台做了收费初始化。

### L41

```ts
  async getStatus(): Promise<BridgeAccessSnapshot> {
```

声明异步 getStatus，承诺成功值符合状态接口。async 让返回对象被包装成 Promise，调用者通常用 await 取得它；esbuild 转译不代替完整 TypeScript 类型检查。

### L42

```ts
    return {
```

开始返回一个新对象字面量。每次调用都会新建外层对象及48行的订单对象，不复用一个容易被旧调用者改坏的全局状态。

### L43

```ts
      edition: "community", available: true, requiresAccount: false, requiresPayment: false,
```

真正赋值社区版本、可用、不需要商业账号、不需要付款。布尔值 true/false 没有引号；"false" 字符串在条件判断中反而是真值，不能混用。

### L44

```ts
      serverConfigured: false, signedIn: false, installationId: "", githubUserId: "", githubLogin: "",
```

实际返回商业服务未配置、未登录，以及空安装编号/GitHub编号/登录名；不是请求失败后兜底伪装成功，而是根本不接商业服务。

### L45

```ts
      giteeUserId: "", giteeLogin: "", email: "", avatarUrl: "",
```

实际清空 Gitee 账号、邮箱、头像的返回字段；这里是新返回对象的值，不是在磁盘上删除用户过去的数据。

### L46

```ts
      licensed: true, expiresAt: "", permanent: true, error: "",
```

返回旧 licensed/permanent 兼容值与空到期/错误文本；不能把这些字段当作签名许可证或真实 Bridge 运行状态。

### L47

```ts
      plans: [], paymentTypes: [], plansError: "",
```

创建两个新的空数组及空套餐错误文本，避免界面继续展示付款选项；[] 是数组，{} 是对象，两者不能随意互换。

### L48

```ts
      paymentOrder: {
```

开始构造 paymentOrder 运行时对象，满足29行声明的嵌套形状。

### L49

```ts
        id: "", status: "disabled", checkoutUrl: "", planId: "", planName: "", amount: "",
```

订单状态明确写 disabled，其他订单/套餐/金额/结账链接均为空。空 checkoutUrl 让旧调用者拿不到付款入口，但 UI 按钮还需要另行移除。

### L50

```ts
        paymentType: "", createdAt: "", expiresAt: "", paidAt: "", entitlementExpiresAt: "", error: "",
```

支付类型和各种时间字段均为空，订单 error 也为空；没有伪造“已支付时间”或“权益到期”。

### L51

```ts
      },
```

结束订单对象，末尾逗号是合法的尾逗号，不表示还有一笔订单。

### L52

```ts
    };
```

结束 return 的整个状态对象并加分号；async 方法会以这个对象兑现 Promise。

### L53

```ts
  }
```

结束 getStatus 方法。之前没有 await 不妨碍使用 async，它在这里主要维持旧异步调用协议。

### L54

```ts
  async requireFeature(feature: string): Promise<void> {
```

requireFeature 接收功能名字符串并返回 Promise&lt;void&gt;；用于检查是否是本服务认识的社区能力，不是验证商业许可证。

### L55

```ts
    if (feature !== "bridge") throw new Error(`Unknown community capability: ${feature}`);
```

!== 是严格不相等；只有 "bridge" 被接受，其他名称抛 Error。反引号建立模板字符串，${feature} 把收到的名称放进错误。async 中 throw 使 Promise 拒绝，调用者应捕获，不能改成无条件放行未知功能。

### L56

```ts
  }
```

结束 requireFeature；已知 bridge 没有触发 throw 时正常结束，成功值是 undefined，不是 true。

### L57

```ts
  // Compatibility for old callers: none of these starts an authentication flow.
```

说明下面保留的旧方法名只是适配层。看见 signIn 名字不能推断还有 OAuth，必须阅读它的方法体。

### L58

```ts
  async signIn(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

signIn 不打开网页、不请求账号，只调用当前实例 this 的 getStatus 并返回其 Promise。this 指调用方法的实例；若随意把方法摘出来调用，可能丢失 this。

### L59

```ts
  async signInWithGitee(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

signInWithGitee 也是返回本地状态；名称兼容旧命令，但没有 Gitee 登录流程。

### L60

```ts
  async signOut(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

signOut 返回本地状态，不停 Bridge、不清配置；旧商店“登出”不应让免费的 Bridge 停机。

### L61

```ts
  async refresh(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

refresh 重新创建本地快照，不向商业服务器复验授权。

### L62

```ts
  async refreshSession(): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

refreshSession 保留旧“刷新会话”的接口名，但不会刷新商业 OAuth token；MCP 会话本身是另一个模块的事情。

### L63

```ts
  async loadPlans(_force = false): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

loadPlans 的 _force 默认 false，调用者可继续传旧参数；参数被忽略，只返回空套餐状态，不强制发网络请求。

### L64

```ts
  async getPaymentOrder(_orderId = ""): Promise<BridgeAccessSnapshot> { return this.getStatus(); }
```

getPaymentOrder 的 _orderId 默认空字符串；不论传什么订单号，都只返回 disabled 的本地订单形状，不查询交易。

### L65

```ts
  async createPayment(_planId: string, _paymentType: string): Promise<never> {
```

createPayment 接受旧套餐编号和支付方式字符串但不用；Promise&lt;never&gt; 表示这个异步方法不会正常返回成功值，下一行会失败，而不是创建免费订单。

### L66

```ts
    throw new Error("COMMUNITY_PAYMENTS_DISABLED: ShunCode Bridge is free; no payment is required or accepted by this build.");
```

抛出带稳定前缀 COMMUNITY_PAYMENTS_DISABLED 的错误，让界面/测试明确知道“此构建禁用收款”。不能改成假订单成功响应，否则旧轮询和 UI 可能继续走付款流程。

### L67

```ts
  }
```

结束 createPayment。错误通过拒绝的 Promise 传播，调用者不能只用同步 try/catch 而忘记 await。

### L68

```ts
  async redeem(_code: string): Promise<never> {
```

redeem 接受旧激活码字符串但不用，返回类型也为 Promise&lt;never&gt;；不是对激活码内容进行真伪判断。

### L69

```ts
    throw new Error("COMMUNITY_PAYMENTS_DISABLED: No activation code is needed for ShunCode Bridge.");
```

直接拒绝兑换并解释 Bridge 不需要激活码；没有解密、验签或生成万能码。远端旧激活服务并不会因此自动关停。

### L70

```ts
  }
```

结束 redeem 方法；上面的错误就是该旧入口的明确处理结果。

### L71

```ts
  async reportUsage(_count: number): Promise<boolean> { return true; }
```

reportUsage 接收旧用量数字但不读取/上传；返回 true 只是兼容调用者的“处理完成”约定，不代表服务器收到了统计。async 实际返回的是 Promise&lt;boolean&gt;。

### L72

```ts
  dispose(): void {}
```

dispose 是同步空方法，返回 void。此服务没有创建定时器/监听器等资源需要释放；不能据此把整个 Bridge 的网络资源清理也删掉。

### L73

```ts
}
```

结束 BridgeLicenseService 类。真正启动/停止 Bridge 的代码不在这个类里，而在下一文件的控制器和原 BridgeManager 中。


<a id="file-2"></a>
## 第2部分：生命周期适配器：30行

原文件：[community/extension/src/bridge-access-controller.ts](../../community/extension/src/bridge-access-controller.ts)

对应源码 SHA-256：`3f5360261ac48e4df93be078ed15aa2836433ac4ae4b9e4b8a8cfac7e1a790e8`

### L1

```ts
/** Community lifecycle adapter. No commercial revalidation timer or usage upload. */
```

文档注释说明这是社区生命周期适配器：去掉商业复验和上报，保留真正的服务生命周期转发；不是一个完整服务器。

### L2

```ts
import type { BridgeManager, BridgeStatus } from "./bridge-server.js";
```

import type 只导入 BridgeManager/BridgeStatus 的类型，编译时会擦除。路径写 .js 是 NodeNext 风格的运行时扩展名，不意味着本文件直接加载那个服务器来执行；实际实例由构造器传入。

### L3

```ts
import type { BridgeAccessSnapshot, BridgeLicenseService } from "./bridge-license-service.js";
```

同样只导入状态与服务的类型。两行 type import 都不创建对象、不开端口；它们在转译后消失也不代表原工程的类型依赖已解决。

### L4

（空行）

空行分隔导入与类定义，方便阅读。

### L5

```ts
export class BridgeAccessController {
```

导出控制器类。它负责把旧 UI/命令调用接到社区策略或真正的 Bridge，不承担所有业务实现。

### L6

```ts
  constructor(
```

开始构造器参数列表，下一三行说明创建实例时传入哪些依赖。括号尚未闭合，所以不能单独运行这一行。

### L7

```ts
    private readonly licenseService: BridgeLicenseService,
```

private readonly 是 TypeScript 参数属性：把传入的服务存为 this.licenseService，并在类型层面限制外部访问/再次赋值；不是 JavaScript 的 # 私有字段，也不是深度冻结服务对象。

### L8

```ts
    private readonly bridge: BridgeManager,
```

把真正 BridgeManager 存为 this.bridge。服务运行依靠这个对象，不能用固定的 running 返回值冒充已经启动。

### L9

```ts
    private readonly _output?: unknown,
```

保留可选输出参数以兼容旧构造调用，unknown 不假设其接口。下划线表示故意不用；参数属性仍存下引用，但本文件不调用日志器或读取其内部属性。

### L10

```ts
  ) {}
```

结束参数列表和空构造器体。TypeScript 转译会为参数属性生成赋值，所以空 {} 不等于所有构造动作都没有发生。

### L11

```ts
  async start(domain?: string): Promise<BridgeStatus> {
```

start 可接收可选 domain 字符串，异步返回 BridgeStatus。这里只承诺返回类型，不保证实际一定能启动。

### L12

```ts
    // Keep BridgeManager's own checks, route tokens, workspace and tunnel safeguards.
```

注释提醒保留 BridgeManager 自己的路由令牌、工作区和隧道检查；不应为了免费把这些检查也删掉。

### L13

```ts
    return this.bridge.start(domain);
```

将 domain 原样传给真实 this.bridge.start 并返回它的结果/Promise。没有伪造运行状态，也没有 catch 吞掉错误；原经理的失败会传给调用者。

### L14

```ts
  }
```

结束 start 方法。收费门槛移除发生在策略/接入回调等位置，不能把整次改造理解成只删这一函数里的 if。

### L15

```ts
  async stop(): Promise<BridgeStatus> { return this.bridge.stop(); }
```

stop 直接转发到真实 BridgeManager.stop；免费的服务仍须能主动停止并释放资源，不能让停止按钮变成空操作。

### L16

```ts
  async getAccessStatus(): Promise<BridgeAccessSnapshot> { return this.licenseService.getStatus(); }
```

getAccessStatus 获取社区可用性快照，而不是 Bridge 运行状态；名字相近的 AccessSnapshot 与 BridgeStatus 不能混用。

### L17

```ts
  async signIn(): Promise<BridgeAccessSnapshot> { return this.licenseService.signIn(); }
```

signIn 转发给社区服务的兼容入口。真正是否登录取决于被调用方法，前一文件已解释它只返回本地未登录状态。

### L18

```ts
  async signInWithGitee(): Promise<BridgeAccessSnapshot> { return this.licenseService.signInWithGitee(); }
```

signInWithGitee 同样只转发；不会因为方法名称包含 Gitee 就自动发生网络请求。

### L19

```ts
  async refreshSession(): Promise<BridgeAccessSnapshot> { return this.licenseService.refreshSession(); }
```

refreshSession 转发社区状态刷新，不负责刷新 MCP 传输会话或第三方模型 token。

### L20

```ts
  async refresh(): Promise<BridgeAccessSnapshot> { return this.licenseService.refresh(); }
```

refresh 也返回新的社区状态，不重启 Bridge、不做商业授权复验。

### L21

```ts
  // Signing out of the retired shop must not stop a free Bridge or change auto-start.
```

注释明确旧商店登出不应停止免费 Bridge，也不应改自动启动配置。原扩展命令入口还需同步修改，不能只改这里。

### L22

```ts
  async signOut(): Promise<BridgeAccessSnapshot> { return this.licenseService.signOut(); }
```

signOut 只调用策略服务；这里没有 bridge.stop 或配置更新。相关测试在开始后调用登出并检查停止次数仍为0。

### L23

```ts
  async redeem(code: string): Promise<BridgeAccessSnapshot> { return this.licenseService.redeem(code); }
```

redeem 保留旧参数和返回类型，转发给始终拒绝兑换的服务。服务的 Promise&lt;never&gt; 不会产生成功值，因此可以符合这层较宽的返回声明；运行时仍会拒绝。

### L24

```ts
  async loadPlans(force = false): Promise<BridgeAccessSnapshot> { return this.licenseService.loadPlans(force); }
```

loadPlans 的 force 默认 false 并传下去；服务会忽略该参数。转发参数保持接口兼容，不表示会请求套餐。

### L25

```ts
  async createPayment(planId: string, paymentType: string): Promise<BridgeAccessSnapshot> {
```

createPayment 收下套餐编号和支付类型，开始一个两行方法体；对外保持旧状态返回声明，不承诺实际上成功。

### L26

```ts
    return this.licenseService.createPayment(planId, paymentType);
```

转发到策略的禁用支付方法，错误继续传播；没有创建支付宝订单，也没有用空订单冒充交易成功。

### L27

```ts
  }
```

结束 createPayment 方法。

### L28

```ts
  async getPaymentOrder(orderId = ""): Promise<BridgeAccessSnapshot> { return this.licenseService.getPaymentOrder(orderId); }
```

getPaymentOrder 默认订单号为空，交给策略返回 disabled 本地快照；不能把它当作真实订单查询器。

### L29

```ts
  dispose(): void {}
```

dispose 是空适配器清理；这里只是不再拥有商业定时器等资源。它不会代替 stop，整个扩展仍要按真实生命周期停止 Bridge。

### L30

```ts
}
```

结束控制器类。它的30行需要与服务、扩展入口、UI、安装更新器配合，不能独立构成完整应用。


<a id="file-3"></a>
## 第3部分：补丁定位基础工具：31行

原文件：[tools/patch_utils.mjs](../../tools/patch_utils.mjs)

对应源码 SHA-256：`db740e6555b7631b873fa313372ad2f76498625ee431e72da07d8109a9d7fb4b`

### L1

```js
import { createHash } from 'node:crypto';
```

从 Node 内建 crypto 模块取 createHash，用于计算 SHA-256。哈希能比较内容是否相同，不等于密码、数字签名或运行安全证明。

### L2

```js
import path from 'node:path';
```

导入 Node path 工具，用它处理 Windows/Linux 路径，避免硬拼分隔符造成平台错误。

### L3

```js
import { fileURLToPath } from 'node:url';
```

导入 fileURLToPath，把 ESM 的 file: URL 转成操作系统路径；不是从互联网下载 URL。

### L4

（空行）

空行将导入和具体实现隔开。

### L5

```js
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
```

import.meta.url 是当前模块文件地址；先转路径、取 tools 目录、再向上一级得到仓库 ROOT。它不依赖用户终端当前在哪个目录，export 供其他脚本共用。

### L6

```js
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
```

导出箭头函数 hash：创建新的 sha256 状态，喂入 bytes，再以十六进制字符串输出摘要。每次调用独立；字符串默认按 UTF-8 编码，Buffer 则保留原字节，换行变化也会改变摘要。

### L7

```js
export function applyEdits(text, edits) {
```

applyEdits 接受原始文本和一组 {start,end,text} 替换。它做字符串操作，不写磁盘；这里的索引按 JavaScript UTF-16 字符单元，不是 UTF-8 字节偏移。

### L8

```js
  let boundary = text.length;
```

把初始边界设为文本长度，后面从尾部向前处理编辑，用这个边界拒绝越界或互相覆盖的区间。

### L9

```js
  for (const edit of [...edits].sort((a,b) => b.start-a.start)) {
```

[...edits] 先复制数组以免排序修改调用者的数组；sort 中 b.start-a.start 按起点降序。先改后面的内容，不会让前面尚未处理的原始位置移动。

### L10

```js
    if (edit.start < 0 || edit.end > boundary || edit.start > edit.end) throw new Error('Overlapping/invalid patch spans');
```

三项检查分别拒绝负起点、终点越过当前边界、起点大于终点；throw 让操作失败而非猜测位置。这不是完整不可信输入校验：没有在此检查整数、有限数值或缺失字段，调用者应提供 AST 产生的有效区间。

### L11

```js
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
```

slice(0,start) 保留前段，edit.text 是替换内容，slice(end) 保留后段；end 不包含在删除区间里。例如把 abcdef 的[1,3)替成X，得到 aXdef。

### L12

```js
    boundary = edit.start;
```

边界退到刚处理的起点；下一次（位置更靠前）的终点不能跨过它，从而避免重叠。不能把 boundary 错设成新字符串总长度。

### L13

```js
  }
```

结束从后到前的编辑循环；多个互不重叠的编辑已经累积到 text 中。

### L14

```js
  return text;
```

返回修改后的字符串，调用者决定是否解析、校验或写文件；此函数自身没有验证 JavaScript 语义。

### L15

```js
}
```

结束 applyEdits。

### L16

```js
export function allNodes(ast) {
```

allNodes 用来遍历 AST（抽象语法树）：输入是解析器产生的普通树，不是待执行的程序。

### L17

```js
  const nodes = [], stack = [ast];
```

nodes 收集找到的节点，stack 初始只放根 ast；显式栈避免用本函数的递归层层调用。

### L18

```js
  while (stack.length) {
```

只要栈里有待检查项就继续；stack.length 为0时退出。

### L19

```js
    const n = stack.pop(); if (!n?.type) continue; nodes.push(n);
```

pop 取栈尾项；n?.type 是可选链，n 不存在时不会直接访问出错。没有 type 的项跳过，其他放入结果。这是形状判断，不验证某个 type 一定是合法 AST 节点。

### L20

```js
    for (const v of Object.values(n)) {
```

Object.values(n) 枚举这个节点的属性值，尝试找其中的子节点；数字位置、字符串名称等通常会在后续判断中被忽略。

### L21

```js
      if (Array.isArray(v)) { for (const c of v) if (c?.type) stack.push(c); }
```

属性值若是数组，就检查每个元素 c；有 type 的元素进栈。典型例子是 Program.body 中的一组语句。

### L22

```js
      else if (v?.type) stack.push(v);
```

非数组但有 type 的对象也进栈，如函数的 body。else if 与上一行的 if 配对，不是另一个独立扫描器。

### L23

```js
    }
```

结束属性值循环；当前节点的候选子节点都已经放入栈。

### L24

```js
  }
```

结束 while 的这一轮并继续处理栈；此遍历没有 visited 集合，所以只用于当前 Acorn 普通无环 AST，不适合带 parent 回指的循环图。

### L25

```js
  return nodes;
```

返回所有收集的节点；其顺序受栈的后进先出影响，不保证是源码从左到右顺序。定位逻辑应按条件找，不依赖偶然顺序。

### L26

```js
}
```

结束 allNodes。

### L27

```js
export function only(nodes, predicate, label) {
```

only 接受节点数组、筛选函数 predicate、用于错误提示的 label；目标是明确“恰好一个匹配”，而不是随便拿第一个。

### L28

```js
  const matches = nodes.filter(predicate);
```

filter 对每项调用 predicate，收集返回真值的项。筛选函数由调用者提供，例如找特定变量名的声明。

### L29

```js
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, got ${matches.length}`);
```

长度不是1就抛错；0说明没找到，多个说明定位歧义，二者都应停止补丁。模板字符串把 label 和实际匹配数放进错误，便于排查版本不一致。

### L30

```js
  return matches[0];
```

只在前一行确认恰好一个后才返回索引0的匹配项；此时拿第一个才是安全的定位选择，而不是忽略其他候选。

### L31

```js
}
```

结束 only。它只保证数量条件，是否选中了正确业务位置仍取决于 predicate 和原始文件哈希。


<a id="file-4"></a>
## 第4部分：社区overlay主构建器：137行

原文件：[tools/build_community.mjs](../../tools/build_community.mjs)

对应源码 SHA-256：`302cf892a3aa41a16eac6d6a10aa9103f5cfbd9755432371cf4abfbd9e6966c3`

### L1

```js
// Version-locked, reproducible overlay. Never evaluates the recovered extension.
```

注释声明产物是锁定原版本的overlay，不是完整源码重编译。脚本解析原扩展文本，不执行原扩展；新维护代码与构建工具仍会被执行。

### L2

```js
import { parse } from 'acorn';
```

导入Acorn的parse，把JS文本变成AST以定位声明/调用；解析不等于运行代码。

### L3

```js
import { transformSync } from 'esbuild';
```

导入esbuild同步转译函数，将新写TS转成JS；它不是完整TypeScript类型检查器。

### L4

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
```

导入异步文件读取、写入和建目录；真正写盘发生在build中的输出阶段，默认不指向已安装软件。

### L5

```js
import { createHash } from 'node:crypto';
```

导入createHash，但当前文件未直接使用它；实际hash来自第9行的公共工具。这是可识别的冗余导入，不是另一个签名流程。

### L6

```js
import path from 'node:path';
```

导入路径工具，拼接本机路径而非硬编码Windows分隔符。

### L7

```js
import { fileURLToPath } from 'node:url';
```

导入fileURLToPath，最后用来识别“直接运行脚本”还是“被其他模块导入”。

### L8

（空行）

空行分开第三方/内建导入与本项目公共工具导入。

### L9

```js
import { ROOT, hash, applyEdits, allNodes, only } from './patch_utils.mjs';
```

导入仓库根、SHA函数、逆序编辑、AST遍历与唯一匹配工具；前一章节已逐行解释这些函数。

### L10

```js
export { ROOT, hash, applyEdits, allNodes, only } from './patch_utils.mjs';
```

同时把这五个工具重新导出，兼容从构建器导入它们的调用者；不是再执行一遍工具，也不复制定义。

### L11

（空行）

空行分开导入与首个转换函数。

### L12

```js
export function scriptModule(ts) {
```

scriptModule接收TS文本并返回适合放回旧脚本bundle的JS片段；不接受文件路径，也不自行读取文件。

### L13

```js
  const js = transformSync(ts, { loader: 'ts', target: 'es2022', format: 'esm', legalComments: 'inline' }).code;
```

loader指定TS，target指定ES2022，format先生成ESM，legalComments保留相关注释；取结果的code字符串。类型声明会被擦除，转译成功不保证类型依赖齐全。

### L14

```js
  const ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
```

把刚生成的ESM按module语法解析，取得顶层导出语句的位置；这里不是解析原始TS。

### L15

```js
  return applyEdits(js, ast.body.filter(n => n.type === 'ExportNamedDeclaration').map(n => {
```

从顶层body筛出具名导出节点，逐个映射成编辑，再交applyEdits执行；目标是去除导出列表，让片段嵌入原脚本作用域。

### L16

```js
    if (n.declaration) throw new Error('Unexpected export shape');
```

如果导出节点直接携带声明就拒绝，因为直接删除可能连类/函数本体一起删掉；这里只接受当前固定转译器产生的导出形状。

### L17

```js
    return { start:n.start, end:n.end, text:'' };
```

为导出列表建立[start,end)空字符串替换；保留已在其他位置声明的类/函数。

### L18

```js
  }));
```

结束map和applyEdits调用，返回移除导出列表后的JS；不是调用其中的Bridge类。

### L19

```js
}
```

结束scriptModule，下面的sections负责文本区段定位。

### L20

```js
function sections(text, marker) {
```

sections接收完整文本和来源标签，返回该标签出现的所有区段位置，不假设标签只出现一次。

### L21

```js
  const tags = [...text.matchAll(/^\/\/ (?:extensions\/|src\/|node_modules\/|<define:)[^\n]+\n/gm)];
```

正则匹配以//开头的来源行：extensions、src、node_modules或构建注入标记；g找全部、m让^匹配每行开头。这里是文本扫描而非Acorn注释识别，只用于固定哈希产物，不能当通用安全解析器。

### L22

```js
  return tags.filter(t => t[0] === `// ${marker}\n`).map(t => {
```

筛出完整标签行精确相等的项，再逐项计算区段；末尾换行也是当前格式约定的一部分。

### L23

```js
    const next = tags.find(n => n.index > t.index);
```

寻找它之后的下一个来源标签；不是找同名标签。matchAll提供的index是JS字符串偏移。

### L24

```js
    return {start:t.index, end:next?.index ?? text.length};
```

区段从本标签起点到下个标签起点；没有下个标签就到全文末尾。?.防止next缺失，??只在null/undefined时使用后备值。

### L25

```js
  });
```

结束这批区段的映射；返回的是位置数组，还没有做任何替换。

### L26

```js
}
```

结束sections；完整来源/边界仍依赖当前原件和格式，不是完整上游差异分析。

### L27

```js
const protectedModules = [
```

开始必须逐字节保留的模块标签列表；它定义本次去商业化不应触碰的关键范围。

### L28

```js
  'extensions/shuncode/src/bridge-server.ts',
```

保护Bridge服务器逻辑，不为了免费绕开真实启动和工作区机制。

### L29

```js
  'extensions/shuncode/src/bridge-mcp-transport.ts',
```

保护MCP传输逻辑，不删路由令牌或传输会话检查。

### L30

```js
  'extensions/shuncode/src/bridge-tool-dispatcher.ts',
```

保护工具调度器；收费与工具授权不是同一层。

### L31

```js
  'extensions/shuncode/src/ide-tool-broker.ts',
```

保护IDE工具代理，避免改坏宿主工具调用与相关控制。

### L32

```js
  'extensions/shuncode/src/codex-auth.ts',
```

保护Codex自身认证；作者取消自有收费不代表第三方模型无需登录。

### L33

```js
  'src/bridge-http-router.ts', 'src/workspace-paths.ts', 'src/tool-input-validation.ts',
```

同一行保护HTTP路由、工作区路径、工具输入校验三个共享模块；保留原实现不等于证明原实现没有已知竞态。

### L34

```js
];
```

结束8个标签的数组。它不是全应用安全审计清单，未列出的修改仍需另行评审。

### L35

```js
export function protectedHashes(text) {
```

protectedHashes给这些标签对应的全部文本片段计算哈希。

### L36

```js
  return Object.fromEntries(protectedModules.map(marker => {
```

map把每个标签变成键值对，Object.fromEntries再组装成对象，便于生成报告和比较。

### L37

```js
    const found = sections(text, marker);
```

查找当前标签的所有区段，处理构建初始化与实际声明分开的情形。

### L38

```js
    if (!found.length) throw new Error(`Missing security/provider module: ${marker}`);
```

完全找不到就抛错停止，不能把缺失模块当作“无需保护”。错误带标签供定位。

### L39

```js
    return [marker, found.map(s => hash(text.slice(s.start, s.end)))];
```

返回标签及其各区段SHA数组；slice按字符串区段取文本，hash对文本UTF-8编码求摘要。

### L40

```js
  }));
```

结束映射与对象构造。此处的哈希证明一致性，不证明功能正确或安全。

### L41

```js
}
```

结束protectedHashes。

### L42

```js
export function patchExtension(original, service, controller) {
```

patchExtension接收原bundle文本、社区服务TS文本、控制器TS文本；返回修改文本和保护证据，不直接写安装目录。

### L43

```js
  const nodes = allNodes(parse(original, { ecmaVersion:'latest', sourceType:'script' }));
```

按script语法解析原bundle，再遍历AST节点；这一步不会运行其中的扩展激活函数。

### L44

```js
  const edits = [];
```

准备编辑数组，之后先收集位置，再一次性逆序替换，避免前面改动影响后面原坐标。

### L45

```js
  const controllerSection = only(sections(original, 'extensions/shuncode/src/bridge-access-controller.ts'), () => true, 'controller section');
```

定位控制器来源区段，only要求恰好一个。谓词恒真表示这里按区段数量判断；多段或找不到都停止。

### L46

```js
  edits.push({...controllerSection, text:`// Community lifecycle (reconstructed replacement)\n${scriptModule(controller)}\n`});
```

把原控制器区段替换成明确标为重建替换的注释及转译后的社区控制器；展开语法带入start/end坐标。

### L47

```js
  const serviceSection = only(sections(original, 'extensions/shuncode/src/bridge-license-service.ts'), s => original.slice(s.start,s.end).includes('var BridgeLicenseService = class'), 'commercial service section');
```

服务标签可能出现多段，用含实际BridgeLicenseService类声明的文本筛出目标，再要求唯一。这依赖已核验的固定bundle形状，不是任意版本都适用。

### L48

```js
  edits.push({...serviceSection, text:`// Community availability (not a signed commercial licence)\n${scriptModule(service)}\n`});
```

用新社区服务替换商业服务实现，并注明不是签名商业许可证；不是生成假许可证骗原验签器。

### L49

```js
  const configSection = only(sections(original, 'extensions/shuncode/src/bridge-license-config.ts'), () => true, 'commercial config');
```

唯一定位商业授权配置区段；这里针对自有收费服务配置，不是全应用的所有配置。

### L50

```js
  edits.push({...configSection,text:'// Commercial trust configuration retired in community edition.\n'});
```

将该商业配置区段替换为停用说明注释；不删除模型、隧道或MCP的真实凭证配置。

### L51

```js
  const gate = only(nodes, n => n.type === 'VariableDeclarator' && n.id.name === 'authorizeBridgeStart', 'start callback');
```

在AST里找名称为authorizeBridgeStart的变量声明器，并要求唯一，避免全局替换碰到无关代码。

### L52

```js
  edits.push({start:gate.init.start,end:gate.init.end,text:'async () => { await bridgeLicense.requireFeature("bridge"); }'});
```

只替换初始化表达式，留下变量声明结构。新回调等待requireFeature("bridge")完成，接受已知社区能力，而不是对所有未知功能放行。

### L53

```js
  const signOut = only(nodes, n => n.type === 'CallExpression' && n.arguments[0]?.value === 'shuncode.bridge.license.signOut', 'legacy sign-out');
```

查找第一个实参为旧商业登出命令字符串的调用节点；可选链处理没有第一个实参的调用。仍须恰好一个匹配。

### L54

```js
  const fn = signOut.arguments[1];
```

按已知注册调用形状取第二个参数作为回调函数；这不是对任意函数注册API都成立的通用规则。

### L55

```js
  edits.push({start:fn.body.start,end:fn.body.end,text:'{ await bridgeLicenseReady; return bridgeAccess.signOut(); }'});
```

只替换该回调的函数体：先等策略初始化，再返回社区登出状态；不再借商店登出修改自动启动或隐式停止。

### L56

```js
  const result = applyEdits(original,edits);
```

把所有编辑应用到原文本；共同使用原坐标，applyEdits负责逆序处理和重叠拒绝。

### L57

```js
  parse(result,{ecmaVersion:'latest',sourceType:'script'});
```

再解析修改结果，确认JS语法成立；解析成功不等于扩展激活、UI或工具功能测试成功。

### L58

```js
  const before = protectedHashes(original), after = protectedHashes(result);
```

分别计算修改前后8组保护片段的哈希。

### L59

```js
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Security or provider module changed');
```

将两个有固定构造顺序的对象序列化比较；不一致就停止并报告保护模块被改变。不是声称全文件只能有这些编辑。

### L60

```js
  for (const forbidden of ['shuncode-bridge-license.', '/v1/payments', 'PAYMENT_POLL_INTERVAL_MS', 'LICENSE_REVALIDATION_INTERVAL_MS', 'SHUNCODE_BRIDGE_LICENSE_SMOKE_BYPASS']) {
```

遍历禁止残留的商业地址片段、支付路径、支付轮询/复验常量与旧烟雾测试绕过开关；这是固定文本检查，不是全面网络流量审计。

### L61

```js
    if (result.includes(forbidden)) throw new Error(`Retired commercial path remains: ${forbidden}`);
```

结果包含任一禁止字符串就失败；不能把这一行删掉来让未完成的改造通过。

### L62

```js
  }
```

结束禁止残留项循环，后续才会返回已经检查的修改结果。

### L63

```js
  return { code:result, protectedModules:before };
```

返回code字符串和原保护片段哈希；它们稍后进入产物清单，不在这里自动安装。

### L64

```js
}
```

结束patchExtension。

### L65

```js
export function communityManifest(original) {
```

communityManifest生成修改版扩展package配置；入参是解析后的对象，不是原文件路径。

### L66

```js
  const p = structuredClone(original);
```

structuredClone复制对象，避免在调用者持有的原manifest上原地修改；原证据文件当然也不会因此被写盘。

### L67

```js
  p.displayName = 'ShunCode Community';
```

将显示名称改为社区版，不等于更改扩展唯一标识或所有安装/升级身份。

### L68

```js
  p.description = 'Recovered ShunCode custom tools and UI. Bridge is free; model and tunnel provider accounts remain separate.';
```

更新描述，明确Bridge免费且模型/隧道账号独立；文字不是许可证条款或安全认证。

### L69

```js
  p.shuncodeEdition = 'community';
```

添加shuncodeEdition标记，帮助识别本次修改版；不伪造原发行构建信息。

### L70

```js
  const retired = command => typeof command === 'string' && /^shuncode\.bridge\.(license|payment)\./.test(command);
```

retired仅匹配字符串类型且以shuncode.bridge.license/payment开头的命令；正则里的点转义成字面量，避免误匹配其他字符。

### L71

```js
  p.contributes.commands = p.contributes.commands.filter(c => !retired(c.command));
```

筛掉命令面板贡献中的商业命令；不是删除所有注册函数或第三方登录命令。

### L72

```js
  for (const [key, items] of Object.entries(p.contributes.menus ?? {})) {
```

遍历菜单配置；没有menus时用空对象，避免对undefined调用Object.entries。

### L73

```js
    if (Array.isArray(items)) p.contributes.menus[key] = items.filter(i => !retired(i.command));
```

只处理值为数组的菜单项集合，并过滤商业命令；保留非数组配置形状及其他菜单项。

### L74

```js
  }
```

结束菜单过滤循环，保留命令不在这里重新注册或执行。

### L75

```js
  return p;
```

返回复制后修改的manifest；其他字段如引擎/proposed API不在本函数里重写。

### L76

```js
}
```

结束communityManifest；此操作本身不证明能在普通VSCode以VSIX安装。

### L77

```js
function patchEntrySource(text) {
```

patchEntrySource同步修改随包提供的extension.ts副本，使源码说明与bundle改造尽量对应；它不是全工程编译器。

### L78

```js
  const a = text.indexOf('  const authorizeBridgeStart = async () => {');
```

按固定缩进和文本找到启动授权回调起点；这是锁定原源码的定位方式，换版本不能盲用。

### L79

```js
  const b = text.indexOf('\n  const bridge = new BridgeManager', a);
```

从起点往后找BridgeManager创建位置作为结束边界；保留后续真实经理创建逻辑。

### L80

```js
  if (a < 0 || b < 0) throw new Error('Unexpected original source entry');
```

任一起点/终点找不到就拒绝，不猜测应该删除多少行。

### L81

```js
  text = text.slice(0,a) + '  const authorizeBridgeStart = async () => {\n    await bridgeLicense.requireFeature("bridge");\n  };' + text.slice(b);
```

保留前后文本，只把中间启动回调换成等待社区能力检查；换行由转义序列明确写入。

### L82

```js
  const legacy = '      await vscode.workspace.getConfiguration("shuncode.bridge").update("persistentMode", false, vscode.ConfigurationTarget.Global);\n';
```

保存旧登出逻辑中把persistentMode设为false的完整语句，含缩进和换行，准备精确删除。

### L83

```js
  if (text.split(legacy).length !== 2) throw new Error('Unexpected sign-out source');
```

split结果长度必须为2，表示恰好出现一次；0次或多次都不是预期版本形状，不能静默继续。

### L84

```js
  return text.replace(legacy,'');
```

只删除这一条旧配置更新语句并返回；不删除用户现有设置文件，也不强制开启自动启动。

### L85

```js
}
```

结束patchEntrySource。

### L86

```js
export async function build(output = path.join(ROOT,'.work/community-overlay')) {
```

build是异步构建入口，默认写到仓库的.work/community-overlay。output可由可信调用者传入，不能把真实安装目录当作学习输出位置。

### L87

```js
  const originals = JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-extension.json'),'utf8'));
```

读取并解析原扩展来源清单，后续按它核对原文件SHA；不是读取服务器许可证。

### L88

```js
  const origin = path.join(ROOT,'recovered/shuncode-extension');
```

定位原件目录recovered/shuncode-extension，保持与维护代码目录分离。

### L89

```js
  const readOriginal = async relative => {
```

声明一个内部异步读取器，relative是构建器自己提供的已知相对路径。

### L90

```js
    const entry = only(originals.copied,e => e.path === relative,relative);
```

在来源清单里找唯一同路径记录；找不到或有多条就拒绝，不能用未知文件替代证据。

### L91

```js
    const bytes = await readFile(path.join(origin,relative));
```

从原件目录读取Buffer；此时没有写入原件，也没有执行文件内容。

### L92

```js
    if (hash(bytes) !== entry.sha256) throw new Error(`Original evidence changed: ${relative}`);
```

计算实际SHA与记录对比；不一致立即停止。更新记录里的哈希来掩盖原件改变会破坏证据链。

### L93

```js
    return bytes;
```

校验通过后返回原始字节，调用者决定何时解码为文本或JSON。

### L94

```js
  };
```

结束内部readOriginal函数定义。

### L95

```js
  const service = await readFile(path.join(ROOT,'community/extension/src/bridge-license-service.ts'),'utf8');
```

读取新写的社区服务TS维护文件；它本来就是允许修改的维护层，不是原件目录。

### L96

```js
  const controller = await readFile(path.join(ROOT,'community/extension/src/bridge-access-controller.ts'),'utf8');
```

读取新写的社区控制器TS维护文件，后续与服务一起转译嵌入。

### L97

```js
  const bundle = await readOriginal('dist/extension.js');
```

通过带哈希检查的读取器取得原扩展bundle。

### L98

```js
  const patched = patchExtension(bundle.toString('utf8'),service,controller);
```

把原bundle按UTF-8解码，交patchExtension静态修改与校验，返回code及保护哈希。

### L99

```js
  const manifest = communityManifest(JSON.parse(await readOriginal('package.json')));
```

核验原package.json后解析成对象，再生成社区manifest；原package字节不被覆盖。

### L100

```js
  const outputs = {
```

开始定义6个输出文件的路径到内容映射；它是输出计划，不是已经完成写盘。

### L101

```js
    'dist/extension.js': patched.code,
```

第一项是修改后的可执行扩展JS，而不是原始TS重新完整编译产物。

### L102

```js
    'package.json': JSON.stringify(manifest,null,2)+'\n',
```

第二项把新manifest按两空格缩进序列化并补末尾换行，方便阅读和稳定比对。

### L103

```js
    'src/bridge-license-service.ts': service,
```

第三项保留社区服务TS，便于后续维护和教学。

### L104

```js
    'src/bridge-access-controller.ts': controller,
```

第四项保留社区控制器TS；这些TS文件随包输出并不证明原TS工程已经能完整编译。

### L105

```js
    'src/bridge-license-config.ts': '// Commercial configuration retired. See the preserved original under recovered/.\nexport {};\n',
```

第五项给旧商业配置TS输出退役说明及空导出；export {}使其仍是模块，不包含商业信任配置。

### L106

```js
    'src/extension.ts': patchEntrySource((await readOriginal('src/extension.ts')).toString('utf8').replaceAll('\r\n','\n')),
```

第六项先核验原extension.ts，解码并把CRLF转LF，再应用固定入口/登出修改；只规范化这个输出副本，不格式化原件。

### L107

```js
  };
```

结束输出映射，当前固定版本应有6项。

### L108

```js
  const files = [];
```

准备文件清单数组，记录每个原/新文件哈希及大小。

### L109

```js
  for (const [relative, contents] of Object.entries(outputs)) {
```

遍历输出映射，分别拿到相对路径与内容；数组顺序来自当前固定对象构造。

### L110

```js
    const destination = path.join(output,'resources/app/extensions/shuncode',relative);
```

把输出路径拼在输出目录的resources/app/extensions/shuncode下面，模拟应用布局但不是默认安装路径。

### L111

```js
    await mkdir(path.dirname(destination),{recursive:true});
```

递归创建所需父目录；已经存在也可继续。不需要先手工建每层目录。

### L112

```js
    await writeFile(destination,contents);
```

写入当前输出文件内容。这是明确的写盘点，默认发生在.work生成目录，不在recovered里。

### L113

```js
    files.push({path:`resources/app/extensions/shuncode/${relative}`, originalSha256:hash(await readOriginal(relative)), sha256:hash(contents), size:Buffer.byteLength(contents)});
```

记录安装相对路径、再次核验取得的原SHA、新内容SHA和UTF-8字节大小；字符串length与字节数不同，所以使用Buffer.byteLength。

### L114

```js
  }
```

结束6文件输出循环。若中间失败应报告失败，不能仅凭生成目录存在判断构建完成。

### L115

```js
  const { buildUiPatch } = await import('./patch_bridge_ui.mjs');
```

动态导入UI补丁构建函数；它和本构建器共用独立helper，避免此前顶层await循环依赖的问题。导入工具不是执行原Workbench应用。

### L116

```js
  await mkdir(path.join(output,'ui'),{recursive:true});
```

建立输出ui目录，存原/新类片段，不复制整个几十MB宿主bundle。

### L117

```js
  const uiPatches = [], preservedUiMethods = {};
```

分别准备UI补丁清单数组和保留方法记录对象。

### L118

```js
  for (const variant of ['workbench','sessions']) {
```

明确处理workbench与sessions两个宿主；不能只改一个就认为所有入口已更新。

### L119

```js
    const ui = await buildUiPatch(variant);
```

为当前宿主生成自己的UI替换片段，内部仍需验证对应原类与未改方法。

### L120

```js
    const relative = variant === 'workbench' ? 'out/vs/workbench/workbench.desktop.main.js' : 'out/vs/sessions/sessions.desktop.main.js';
```

三元表达式按宿主选择真实bundle相对路径；两个文件不同，不假设其字节一样。

### L121

```js
    const entry = only(originals.core_code_index,e => e.path === relative,relative);
```

在原宿主索引里找唯一记录，取得完整宿主文件SHA用于安装时核对；本地只保存类片段不等于不需要核对完整宿主。

### L122

```js
    const find = `ui/bridge.${variant}.original.txt`, replacement = `ui/bridge.${variant}.community.txt`;
```

建立该宿主的原片段和社区片段输出文件名，避免两个宿主互相覆盖。

### L123

```js
    await writeFile(path.join(output,find),ui.original);
```

保存原UI片段，作为将来安装时寻找与校验的目标文本。

### L124

```js
    await writeFile(path.join(output,replacement),ui.code);
```

保存新UI片段；安装器不能对其他相似版本任意替换这段内容。

### L125

```js
    preservedUiMethods[variant] = ui.preservedMethods;
```

记录当前宿主哪些方法被保留，供审计与回归测试核对；保留原方法不是安全缺陷已修复的证明。

### L126

```js
    uiPatches.push({path:'resources/app/'+relative,originalSha256:entry.sha256,
```

开始记录UI更新项：完整安装相对路径和整个原宿主SHA。

### L127

```js
      find,findSha256:hash(ui.original),replace:replacement,replaceSha256:hash(ui.code)});
```

继续记录原/新片段文件路径及各自SHA；安装器需要同时验证宿主与替换文本，不只是搜到一个类名。

### L128

```js
  }
```

结束两个宿主的构建循环。

### L129

```js
  const report = { edition:'community', baseVersion:'0.7.4', scope:'Version-locked extension overlay, not a complete source rebuild or tested Windows installer.',
```

开始总manifest：社区标识、精确基底0.7.4及“不代表完整源码/Windows安装器”的范围说明。

### L130

```js
    protectedModules:patched.protectedModules,preservedUiMethods,files,uiPatches };
```

把保护模块、UI保留方法、6文件与2宿主片段清单纳入报告；8个目标不代表8个全部功能模块。

### L131

```js
  await writeFile(path.join(output,'overlay-manifest.json'),JSON.stringify(report,null,2)+'\n');
```

把报告写到overlay-manifest.json，供验证器、打包器、应用器后续检查；生成清单不是已经通过真实安装包验证。

### L132

```js
  return report;
```

返回报告，调用者可检查它或继续验证/打包。

### L133

```js
}
```

结束异步build函数定义；导入模块本身不会调用这个函数。

### L134

```js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
```

只有命令行入口路径与当前模块文件路径一致时才执行下面代码；被测试或其他脚本导入时不自动构建。fileURLToPath处理file URL与Windows路径差异。

### L135

```js
  const report = await build();
```

直接运行时等待默认build完成；失败会让脚本报错，不应继续把半成品打包。

### L136

```js
  console.log(`Built ${report.files.length} community overlay files; security/provider modules byte-identical.`);
```

打印6个overlay文件与保护模块字节一致的摘要。文字中的一致性来自前面的哈希检查，不是完整功能或GUI验收。

### L137

```js
}
```

结束直接运行入口条件。完整流程后面还需要真实包校验、打包、备份应用和单独的Windows验收。

## 学完后如何确认不是只看懂了文字

回到 [实验课的自测](START_HERE.md#自测与答案)，执行教学测试。完整待讲文件见 [覆盖清单](COVERAGE.md)。
