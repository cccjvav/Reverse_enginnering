# 第一组代码逐行精读：社区策略、控制器与补丁基础

先读 [零基础实验课](START_HERE.md)，再读本页。这里完整讲解三个文件的134行（含注释、空行和结构行），不是全工程已经讲完。

本页由手写注解和真实源码生成；不要复制本页去覆盖原源文件。修改源码后需重新审阅注解并生成。类型声明不等于运行时保证，测试也不等于完整安全认证。

## 阅读顺序

1. `BridgeLicenseService`：回答“商业账号/付款是否必要”。
2. `BridgeAccessController`：把请求转给真实 Bridge，不伪造运行状态。
3. `patch_utils.mjs`：内容指纹、逆序替换、AST 遍历、唯一定位。

章节目录：
- [第1部分：社区可用性策略：73行](#file-1)
- [第2部分：生命周期适配器：30行](#file-2)
- [第3部分：补丁定位基础工具：31行](#file-3)

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

## 学完后如何确认不是只看懂了文字

回到 [实验课的自测](START_HERE.md#自测与答案)，执行教学测试。完整待讲文件见 [覆盖清单](COVERAGE.md)。
