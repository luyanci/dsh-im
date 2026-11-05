# OneBot v11 渠道设计稿（QQ）

状态：设计稿，未动工。基线 `v5.10.0`（`c826bfa4`）。

目标：新增第 10 个渠道 `onebot`，通过 OneBot v11 协议接入 QQ 生态，复用现有语义消息 / 会话路由 / 回合控制权那一层，不另起一套。

> 命名注意：仓库里已有 `qq` 渠道，那是**腾讯官方 QQ 机器人 SDK**（`@tencent-connect/qqbot-nodejs`）的接入，与本渠道无关。本渠道叫 `onebot`，配置键、目录、日志前缀一律用 `onebot`，不要与 `qq` 混淆。

## 1 范围

第一版做什么：

- 反向 WebSocket 接入，协议端主动连我们；
- 群聊与私聊的文本、@、引用、图片、表情（`face`/`mface`）；
- 触发模式（mention / all）、白名单、命令门、会话绑定、投递目标；
- 连接状态上报与重连。

**不做管理动作**：禁言、踢人、撤回、改群名片这些不放进通道，交给独立的管理 API caller（见 §7.1）。通道只负责收与发——包括**不撤回任何消息**：既不删自己发的，也不替谁删别人的。

第一版不做什么（Deferred，留接口）：

- 合并转发（`forward` / `node`）；
- 语音、视频、文件上下行；
- QQ 卡片 / Ark / Markdown 消息；
- 主动点赞、拍一拍、群公告。

> 合并转发是 OneBot 相对 Telegram 的真优势（`get_forward_msg` 能读到每条内容），但它牵出一整套嵌套渲染与上下文拼装，第一版先不做，接口按「一个语义消息可以有多段内容」预留。

## 2 协议端

使用 [SnowLuma](https://github.com/SnowLuma/SnowLuma)：把 QQ 原生会话转成 OneBot v11 动作与事件，Windows x64 / Linux x64 / arm64，带 WebUI（默认 `http://localhost:5099`）。它同时提供 WS 服务端与**反向 WS 客户端**两种角色，我们做前者。

从其官方反向 WS 文档能直接确定的部分（不必再猜）：

- **鉴权**：`Authorization: Bearer <token>` 或 `?access_token=` 两种都收；token 为空表示不校验；
- **头**：`X-Self-ID`（账号）与 `X-Client-Role` 是**必带**的，缺了直接拒；
- **角色**：`Universal`（动作+事件同一连接）或 `Api` / `Event` 拆两条；我们第一版只支持 `Universal`，拆分的两条留后置；
- **自环回显**：由协议端配置 `reportSelfMessage` 决定，示例配置里是 `false`，即默认不回显。仍按 `sender.user_id === self_id` 兜底过滤；
- **心跳**：WS ping/pong，默认 30 秒，两次未响应即断开；协议端自己负责重连，我们只需接受新连接；
- **限制**：单帧入站 100 MiB、出站缓冲 16 MiB、并发 128 条连接、动作超时 30 秒；重复的活动通道会被 409 拒掉，跨账号帧直接断连。

### 2.1 实测结论（M0，SnowLuma 实测）

用 `scripts/onebot-probe.mjs`（只监听 `127.0.0.1`，落 `.onebot-probe.jsonl`）在真实账号上跑过一轮，以下是观测事实，不是推测：

| 观测项 | 实际结果 |
|---|---|
| 握手头 | `X-Self-ID`、`X-Client-Role: Universal`、UA `OneBot/11`；无 token 时 `authForm: none`，连接正常 |
| 元事件 | `meta_event.lifecycle`（`connect`、`enable`，带 `status.online/good`）与 `meta_event.heartbeat` 都会来；实测 WS ping 间隔约 26s |
| 私聊消息 | `message_type: private`、`sub_type: friend`，带 `user_id`、`message_seq` |
| 群消息 | `message_type: group`、`sub_type: normal`，带 `group_id`、`group_name`、`message_seq` |
| `sender` | `{user_id, nickname, card, role, sex, age}`；`role` 取 `owner` / `admin` / `member`，可直接用于权限判断 |
| `@` 段 | `{"type":"at","data":{"qq":"2951316926"}}`，`qq` 是**字符串**，与 `self_id` 比较要转字符串 |
| `reply` 段 | `{"type":"reply","data":{"id":"392264416"}}`，只有 id；**`get_msg` 能取回完整消息**（含 `message` 数组、`sender`、`real_id`），引用内容靠它补 |
| 图片段 | `{"type":"image","data":{"file":"DD49F613….jpg","url":"https://multimedia.nt.qq.com.cn/download?…"}}` —— `file` 是**裸资源名**，内容是**带签名的 url**；入站必须下载 url，不能把 `file` 当路径，也不是 base64 |
| `message_id` | **符号不稳定**：同一轮的私聊/群聊里既有负数也有正数，且响应里另有 `real_id`。一律当不透明字符串 |
| 自发回显 | SnowLuma 在 `reportSelfMessage: false` 时**不会**收到自己发的消息；`send_private_msg` 只返回 `{"message_id":…}`。**不能依赖这个开关**，见 §5 自环 |
| 其他事件 | `notice` 里有 `notify/input_status`（`status_text: "对方正在输入..."`），可用于原生呈现的输入状态 |

`get_login_info` 返回 `{user_id, nickname}`，可用于设置卡的「当前账号」显示。

**第 0 步验收**：已完成。`scripts/onebot-probe.mjs` 具备 `--send-user` / `--send-group` / `--get-msg`，可随时复跑；输出含真实 QQ 号，`.gitignore` 已排除。

## 3 分层

对齐 `CONTEXT.md` 的定义，OneBot 只负责「传输 / 归一化 / 原生呈现」，其余交给共享层：

```
OneBot 事件 (WS JSON)
   │  onebot-runtime.mjs      归一化
   ▼
语义消息（shared/conversation）
   │  会话路由：group:<group_id> / private:<user_id>
   ▼
text-harness-bridge.mjs      触发门、命令门、占位、回合控制权
   │
   ▼
onebot-api.mjs               原生呈现：send_group_msg / send_private_msg
```

## 4 文件清单

Host 侧（已实现）：

| 文件 | 职责 |
|---|---|
| `src/channels/onebot/onebot-connection.mjs` | 反向 WS 服务端：只监听 `127.0.0.1`、校验 token 与两个必带头、按账号去重、动作 `echo` 配对、心跳超时断开 |
| `src/channels/onebot/onebot-normalize.mjs` | 事件 → 语义消息；自环过滤；段解析（`@`/`reply`/`image`/`face`/`mface`/`forward`）；图片按签名 url 懒加载 |
| `src/channels/onebot/onebot-api.mjs` | 只含收发所需：`send_group_msg`、`send_private_msg`、`get_msg`、`get_login_info`。管理动作不在这里（§7.1） |
| `src/channels/onebot/onebot-bot.mjs` | bridge 驱动的 bot 客户端：长文分段、附件降级、图片自适应形态；**不实现** typing / 卡片 / 流式，借此退出进度呈现 |
| `src/channels/onebot/onebot-bridge.mjs` | `TextHarnessBridge` 子类 + descriptor（无 reaction、无编辑） |
| `src/channels/onebot/onebot-runtime.mjs` | 一个账号一个监听器：起 server、接桥、收发、状态与账号信息 |
| `src/channels/onebot/onebot-controller.mjs` | 账号增删、监听重启、状态聚合；令牌走凭据服务 |
| `src/channels/onebot/onebot-config-store.mjs` | 每账号配置文档（selfId / 端口 / 路径 / 图片形态 / 白名单），令牌只存引用 |
| `src/channels/onebot/onebot-{harness-client,state-store}.mjs` | 与其它渠道同构的薄别名 |
| `plugin-src/host/channels/onebot/{index.mjs,production.mjs,rpc.mjs}` | `apply()` 接线、生产组装、管理 RPC |

Client 侧（已实现）：

| 文件 | 职责 |
|---|---|
| `plugin-src/client/channels/onebot/{api.js,index.js,styles.js}` | 设置卡：账号列表与连接状态、添加账号（QQ 号 / 端口 / 令牌 / 图片形态）、重启与删除 |
| `plugin-src/client/channel-logos.js` | `OneBotLogoGlyph`，内联 SVG（断两处圆环 + 「1\|」），来源 `onebot.dev/logo.png` |
| `plugin-src/client/{i18n.js,i18n-ru.js}` | 卡片文案的英文 / 俄文投影 |
| `plugin-src/host/index.mjs` | `applyOneBot` 注册 |

i18n：host 侧新增的 `t('中文')` 走 `src/channels/shared/i18n-{en,ru}/onebot.mjs`，客户端文案走 `plugin-src/client/i18n*.js`；两处都有覆盖率测试守着。

## 5 段映射

| OneBot 段 | 语义消息 | 备注 |
|---|---|---|
| `text` | 正文 | 原样，不加包装（framing 归生产方） |
| `at` | 唤醒判定 | `qq === self_id` 才算被叫到；`qq === 'all'` 单独处理 |
| `reply` | 引用关系 | 段里只有 `id`，要 `get_msg` 补内容；补不到就标 `unavailableReason` |
| `image` | 产物 | 入站按 `data.url` 下载（签名链接，会过期，随即缓存），`data.file` 是裸资源名不可当路径；出站见下 |
| `face` / `mface` | 表情占位 | 渲染成 `[表情]` / `[表情 名称]`，不当作正文 |
| `forward` / `node` | 暂不支持 | 第一版落占位 `[合并转发]`，Deferred |

自环：`post_type === 'message_sent'` 或 `sender.user_id === self_id` 一律丢弃，否则会自己跟自己说话。

**这条必须自己兜住，不能指望协议端配置**：SnowLuma 有 `reportSelfMessage` 可以关掉上报，但其他 OneBot 实现不一定有这个开关，也不一定默认关闭（NapCat、Lagrange、go-cqhttp 等各家行为不一致），有的会推 `message_sent`，有的把自发消息混进 `message` 事件里。所以过滤放在我们这侧，按 `sender.user_id === self_id`（字符串比较）和 `post_type === 'message_sent'` 双条件丢弃；`reportSelfMessage` 只当作减少噪音的加分项。

**出站图片的形态按协议端自适应**：`send_group_msg` 的 `image` 段在不同实现里接受的写法不同（`base64://`、`file://`、http url 各有一家不吃）。设置项 `imageSendFormat` 默认 `auto`，按 `base64 → url → file` 逐级试，一条成功就记住：

- 缓存键用 `selfId + 协议端标识`（UA/版本），换协议端或换号自动重试；
- 单个形态失败只记日志、换下一个形态，不打扰用户；
- 全部失败才让整条消息失败，并把三种形态的错误一起上报。

`file://` 只对**协议端与 DSH 同机**有意义；跨机部署时自动跳过。

### 5.1 协议端差异清单

不同 OneBot v11 实现在这些点上有分歧，通道侧一律按「防御式」处理：

| 分歧点 | SnowLuma 实测 | 其他实现 | 我们的策略 |
|---|---|---|---|
| 自发消息回显 | 可用 `reportSelfMessage: false` 关闭 | 不一定有开关，或默认上报 | 自己按 `sender.user_id` 过滤，不依赖配置 |
| `message` 字段形态 | `array`（段数组，配置可选） | 有的是 CQ 码字符串 | 两者都解析：数组直接读，字符串走 CQ 码解码 |
| 图片段 | `file` 裸资源名 + 签名 `url` | 可能是 `file://`、`base64://` 或仅 `file` | 按优先级 url → base64 → file 解析路径 |
| `message_id` | 正负号不稳定，另有 `real_id` | 有的会随平台变化 | 当不透明字符串，不参与数值运算 |
| `@` 段 `qq` | 字符串 | 有实现给数字 | `String(qq) === String(self_id)` |
| 角色 | `Universal` / `Api` / `Event` 拆分 | 只有单一连接 | 第一版要求 `Universal`，拆分留后置 |

## 6 渠道能力差异

| 能力 | Telegram | OneBot (QQ) |
|---|---|---|
| 消息编辑（原位改） | 有，`editMessageText` | **没有**（见 §6.1，OneBot 走静默模式） |
| 禁言 | `restrictChatMember`（由工作区 `tg.py` 调） | `set_group_ban`（由工作区 caller 调，见 §7.1） |
| 合并转发读取 | 读不到 | `get_forward_msg` 可读（Deferred） |
| reaction | 有 | 无 |
| 输入中状态 | 无 API | 有 `notice/input_status` 可读；第一版不呈现 |
| 进度/占位消息 | 占位 + 编辑 | **不发**，见 §6.1 |
| 图片限制 | 10MB 左右 | 依协议端，风控更敏感 |

**「最终答案就地编辑」这个开关在 OneBot 上不适用**：QQ 没有编辑能力，只能删占位再新发。设置卡里该开关对该渠道隐藏或置灰，并在 `CHANGELOG` 注明，别让用户以为坏了。

### 6.1 回合呈现策略：静默模式

OneBot 渠道**不参与进度呈现**，与 Telegram 的占位/编辑那套彻底分开。规则：

1. **不创建占位消息**：回合开始时什么都不发，没有「正在处理…」；
2. **忽略所有状态更新**：中间进度、工具调用、状态文本一律不进 QQ——既不发新消息，也不改动已有消息；
3. **不删除任何消息**：不为了腾位置去删占位，也不删自己发过的内容；
4. **最终答案单独发一条**：回合结束后把最终答案作为一条新消息发出，它不是一个「被编辑过的占位」，就是一条普通消息。

实现上，渠道声明自己不具备「消息编辑」与「进度呈现」能力，bridge 侧据此把占位创建、进度更新、删除统统短路成 no-op；不要再为 QQ 写一套「先发占位再删」的兼容路径，那正是要避免的。

代价与取舍：长回合期间用户看不到任何进展，这是刻意的——QQ 侧刷进度消息更容易触发风控，且没有编辑能力时「发一条改一条」只会变成删了重发。

失败时的呈现（已定案，跟随插件既有行为）：状态更新忽略，但**回合失败照常发一条错误**，复用 `src/channels/shared/message-failure.mjs` 的失败文案与错误码（`TURN_INTERRUPTED`、`MODEL_TIMEOUT`、`CHANNEL_RATE_LIMIT` 等），作为一条普通新消息发出，带参考号便于对日志。失败属于「结果」不属于「状态」，静默只作用于进度。

## 7 安全

- 反向 WS **只监听 `127.0.0.1`**，不接受外部连接；
- access token 走凭据服务，不进设置文件；
- 与现有渠道同一条链路：`stripInjectedContextTags` 剥离用户手写的上下文块 → 块签名校验 → `AGENTS.md` 1.5 兜底；
- 转发消息带 `[转发自 …]` 前缀，转发里的 @ 不唤醒（同 `AGENTS.md` 1.3）；
- 禁言沿用 1.2 的规则：主人 / 管理员 / 自己不可禁，时长上限 5 分钟。

### 7.1 与管理 API 的边界

通道只做收与发；群管理（禁言、踢人、撤回、改名片、全员禁言、点赞）不进入 dsh-im，放在**工作区里的独立 caller**，与现在 Telegram 的做法保持一致——`tools/tg.py` 一直是直接打 Bot API，插件本身不提供禁言工具。

QQ 侧同样可行，因为 SnowLuma 的 `networks` 允许同一账号同时启用多种适配器：

| 适配器 | 默认端口 | 用途 |
|---|---|---|
| `wsClients` | 连我们 6700 | dsh-im 通道：反向 WS 收事件、发消息 |
| `httpServers` | 3000 | 管理 caller 走 HTTP API 调动作 |
| `wsServers` | 3001 | 备选：caller 连这个 WS 发动作 |

所以两条链路互不干扰：通道断线不影响管理 caller，反之亦然。

落地形态（与 Telegram 对称）：

- 新工作区里放 `tools/qq.py`，直接调 SnowLuma 的 HTTP API（`POST /set_group_ban` 等），token 用 `httpServers.accessToken`；
- 配一个 `qq-moderation` skill，规则沿用 `AGENTS.md` 1.2：默认 3 分钟、上限 5 分钟、先嘴回一次才动手、群主/管理员/自己不可碰；
- 只读动作（`get_group_member_info`、`get_group_member_list`）也走 caller，通道侧不保留。

**为什么不放在通道里**：现有 9 个渠道从头到尾没有调用过任何成员查询 API（Telegram 侧也只有工作区里的 `tg.py` 用 `getChatMember` 做禁言守卫），原因是发送者信息随事件一起来——我们实测的 `sender` 已经带 `user_id`、`nickname`、`card`、`role`（`owner` / `admin` / `member`）。访问控制看的是配置里的 id 列表，不是实时角色查询；群历史存档存的也是事件里给的值。所以通道不需要这两个动作，`onebot-api.mjs` 不实现它们。

**安全**：`httpServers` / `wsServers` 默认监听 `0.0.0.0`，本机部署必须改成 `127.0.0.1`；token 用自动生成的那个，不要和反向 WS 的 token 复用。

## 8 测试

单测：

- 事件解析：群 / 私聊、`at` 判定、`reply` 段、`image` 三种形态、`face`；
- 自环过滤：`message_sent` 与 `sender.user_id === self_id` 两条路径；
- 图片编码：data URL / base64 / `file://` 输入统一转换；
- 配置校验：端口、token 缺省、白名单格式。

集成：起一个假 WS 端（`node:ws`）模拟协议端，跑「收到消息 → 交给 harness → 发回」全链路，并覆盖断线重连。

不依赖真实 QQ 账号的用例必须占绝大多数，真实协议端只留手动验收。

## 9 开放问题

### 已结案

| 原问题 | 结论 |
|---|---|
| SnowLuma 的协议细节（鉴权、头、回显、心跳） | §2.1 实测解决：Bearer 或 `?access_token=`、`X-Self-ID`+`X-Client-Role` 必带、lifecycle+heartbeat 都会来、WS ping 约 26s |
| 图片段是什么形态 | §2.1 实测解决：`file` 是裸资源名，内容是签名 `url`；入站按 url 下载并缓存，不用 base64 |
| 自环怎么过滤 | §5 定案：自己按 `post_type === 'message_sent'` 与 `sender.user_id === String(self_id)` 双条件丢弃，不依赖协议端开关 |
| 是否保留「正在处理」占位与进度 | §6.1 定案：静默模式——不发占位、忽略状态更新、不删消息、最终答案单独发 |
| 消息编辑能力怎么处理 | §6 定案：QQ 没有编辑，`编辑最终答案` 开关对该渠道隐藏，不做「发占位再删」的兼容路径 |
| 白名单默认策略 | 与既有渠道一致：默认 `open`（`defaultCanExecuteCommands: true`），复用 `plugin-src/host/channels/shared/access-policy-production.mjs` 的 `openScope()`；白名单只作可选收窄 |
| 出站图片形态 | 取决于协议端实现，所以不写死：设置项 `imageSendFormat`（`auto` 默认 / `base64` / `url` / `file`），`auto` 按 `base64 → url → file` 依次尝试，成功后按 `selfId + 协议端标识` 缓存结果 |
| 回合失败要不要吭声 | §6.1 定案：要发，复用 `message-failure.mjs` 的文案与错误码，作为普通新消息 |
| 版本号 | `5.11.0`（渠道级新功能按 minor 递增） |

### 仍待决定

1. **是否解析 CQ 码字符串**：SnowLuma 配 `messageFormat: array`，但换到其他实现可能给 CQ 码字符串。可以第一版只吃数组、遇到字符串明确报错，也可以顺手写个 CQ 码解码器（约 100 行）。
2. **是否支持 `Api` / `Event` 拆分角色**：第一版只接 `Universal`，拆分的两条留后置。
3. **合并转发与 `mface` 何时补**：第一版不做（Deferred），接口按「一条语义消息可含多段内容」预留；补的时点待定。
4. **端口与令牌默认值**：默认 `6700` + 手动填写 token，还是随机生成一个写进设置。

## 10 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 探针脚本 + 协议确认 | ✅ 结论在 §2.1 |
| M1 | 连接层 + 收发 | ✅ `onebot-connection.mjs` / `onebot-api.mjs` / `onebot-bot.mjs` |
| M2 | 运行时 + 语义消息 | ✅ `onebot-normalize.mjs` / `onebot-runtime.mjs` / `onebot-controller.mjs` |
| M3 | 接线 + 设置卡 + logo + i18n | ✅ host 接线、客户端设置卡、内联 SVG logo、en/ru 词条 |
| M4 | 引用 / @ / 图片 / 表情 | 解析已覆盖（normalize 测试）；**真实账号往返未验证** |
| ~~M5~~ | 管理动作已移出通道，归工作区 caller | — |
| M6 | 测试 + 打包 | 单测 53 项 + 全量 5023 项（仅剩两条本地环境失败）；CI 触发待 push tag |

尚未在真实协议端验证的部分（都需要启动一个 bot，本轮刻意没做）：真实收发往返、协议端对 `base64://` 图片的接受度、长文分段在客户端的观感、多账号并发监听。

剩下的开放问题见 §9，均不阻塞下一次开工。
