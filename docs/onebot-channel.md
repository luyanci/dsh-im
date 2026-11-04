# OneBot v11 渠道设计稿（QQ）

状态：设计稿，未动工。基线 `v5.10.0`（`c826bfa4`）。

目标：新增第 10 个渠道 `onebot`，通过 OneBot v11 协议接入 QQ 生态，复用现有语义消息 / 会话路由 / 回合控制权那一层，不另起一套。

## 1 范围

第一版做什么：

- 反向 WebSocket 接入，协议端主动连我们；
- 群聊与私聊的文本、@、引用、图片、表情（`face`/`mface`）；
- 触发模式（mention / all）、白名单、命令门、占位消息、会话绑定、投递目标；
- 禁言（`set_group_ban`）、撤回（`delete_msg`）、群成员信息；
- 连接状态上报与重连。

第一版不做什么（Deferred，留接口）：

- 合并转发（`forward` / `node`）；
- 语音、视频、文件上下行；
- QQ 卡片 / Ark / Markdown 消息；
- 主动点赞、拍一拍、群公告。

> 合并转发是 OneBot 相对 Telegram 的真优势（`get_forward_msg` 能读到每条内容），但它牵出一整套嵌套渲染与上下文拼装，第一版先不做，接口按「一个语义消息可以有多段内容」预留。

## 2 协议端

使用 SnowLuma。开工前必须先确认（见 §9 开放问题）：

1. 是否实现 OneBot v11 反向 WebSocket，鉴权头是 `Authorization: Bearer <token>` 还是 `?access_token=`；
2. 是否推送 `message_sent`（自己发出的消息回显）；不推的话自环过滤靠 `sender.user_id === self_id`；
3. 图片段给什么：`file://`、`base64://`、还是 http url；
4. 心跳事件格式与周期，以及断线后是否自动重连。

**第 0 步验收**：一个独立探针脚本连上去，把原始事件落盘，确认以上四点。在此之前不写接入代码。

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

Host 侧：

| 文件 | 职责 |
|---|---|
| `src/channels/onebot/onebot-connection.mjs` | 反向 WS 服务端：只监听 `127.0.0.1`、校验 token、记录连接元数据（`X-Self-ID`、`X-Client-Role`）、重连与状态 |
| `src/channels/onebot/onebot-runtime.mjs` | 事件 → 语义消息；自环过滤；段解析（`@`/`reply`/`image`/`face`） |
| `src/channels/onebot/onebot-api.mjs` | `send_group_msg`、`send_private_msg`、`get_msg`、`get_group_member_info`、`delete_msg`、`set_group_ban` |
| `src/channels/onebot/onebot-bridge.mjs` | 接 `text-harness-bridge.mjs`，实现渠道侧的「发送一条消息」与「能力探测」 |
| `src/channels/onebot/config-store.mjs` / `state-store.mjs` | 与 `qq`、`telegram` 同构 |
| `plugin-src/host/channels/onebot/{index.mjs,production.mjs,rpc.mjs}` | `apply()` 接线，照 `plugin-src/host/channels/qq/` |

Client 侧：

| 文件 | 职责 |
|---|---|
| `plugin-src/client/channels/onebot/{api.js,index.js,styles.js}` | 设置卡：监听端口、access token、selfId、白名单、「测试连接」 |
| `plugin-src/client/channel-logos.js` | 新增 `OneBotLogoGlyph`，内联 SVG（断两处圆环 + 「1\|」），来源 `onebot.dev/logo.png` |
| `plugin-src/host/index.mjs` | 加 `applyOneBot` 与配置 schema 的 `onebot` 段 |

i18n：所有新 `t('中文')` 字面量必须同时补 en / ru，否则 `i18n-coverage.test.mjs` 会让 CI 挂。

## 5 段映射

| OneBot 段 | 语义消息 | 备注 |
|---|---|---|
| `text` | 正文 | 原样，不加包装（framing 归生产方） |
| `at` | 唤醒判定 | `qq === self_id` 才算被叫到；`qq === 'all'` 单独处理 |
| `reply` | 引用关系 | 段里只有 `id`，要 `get_msg` 补内容；补不到就标 `unavailableReason` |
| `image` | 产物 | 上行统一 base64（兼容最好）；下行优先 base64，能力允许再走 http |
| `face` / `mface` | 表情占位 | 渲染成 `[表情]` / `[表情 名称]`，不当作正文 |
| `forward` / `node` | 暂不支持 | 第一版落占位 `[合并转发]`，Deferred |

自环：`post_type === 'message_sent'` 或 `sender.user_id === self_id` 一律丢弃，否则会自己跟自己说话。

## 6 渠道能力差异

| 能力 | Telegram | OneBot (QQ) |
|---|---|---|
| 消息编辑（原位改） | 有，`editMessageText` | **没有** |
| 撤回 | `deleteMessage` | `delete_msg` |
| 禁言 | `restrictChatMember` | `set_group_ban` |
| 合并转发读取 | 读不到 | `get_forward_msg` 可读（Deferred） |
| reaction | 有 | 无 |
| 图片限制 | 10MB 左右 | 依协议端，风控更敏感 |

**「最终答案就地编辑」这个开关在 OneBot 上不适用**：QQ 没有编辑能力，只能删占位再新发。设置卡里该开关对该渠道隐藏或置灰，并在 `CHANGELOG` 注明，别让用户以为坏了。

## 7 安全

- 反向 WS **只监听 `127.0.0.1`**，不接受外部连接；
- access token 走凭据服务，不进设置文件；
- 与现有渠道同一条链路：`stripInjectedContextTags` 剥离用户手写的上下文块 → 块签名校验 → `AGENTS.md` 1.5 兜底；
- 转发消息带 `[转发自 …]` 前缀，转发里的 @ 不唤醒（同 `AGENTS.md` 1.3）；
- 禁言沿用 1.2 的规则：主人 / 管理员 / 自己不可禁，时长上限 5 分钟。

## 8 测试

单测：

- 事件解析：群 / 私聊、`at` 判定、`reply` 段、`image` 三种形态、`face`；
- 自环过滤：`message_sent` 与 `sender.user_id === self_id` 两条路径；
- 图片编码：data URL / base64 / `file://` 输入统一转换；
- 配置校验：端口、token 缺省、白名单格式。

集成：起一个假 WS 端（`node:ws`）模拟协议端，跑「收到消息 → 交给 harness → 发回」全链路，并覆盖断线重连。

不依赖真实 QQ 账号的用例必须占绝大多数，真实协议端只留手动验收。

## 9 开放问题

1. SnowLuma 的协议细节（§2 那四点）；
2. 第一版是否要带合并转发与 `mface`——不带省约三分之一工作量；
3. 白名单默认策略：空 = 全部拒绝（推荐）还是全部允许；
4. 是否复用 `termlink` 式本地图片服务，还是统一 base64 内联；
5. 版本号：渠道级新功能按 minor 递增，计划 `5.11.0`。

## 10 里程碑

| 阶段 | 内容 | 出口 |
|---|---|---|
| M0 | 探针脚本 + 协议确认 | 原始事件落盘，四点结论写回本文档 |
| M1 | 连接层 + 发送 | 能从测试脚本发一条群消息 |
| M2 | 运行时 + 语义消息 | 群聊文本往返跑通，接上 bridge |
| M3 | 接线 + 设置卡 + logo + i18n | 设置页可配置、可测连接 |
| M4 | 引用 / @ / 图片 / 表情 | 四类段全覆盖 |
| M5 | 禁言 / 撤回 / 群成员 | 管理动作可用 |
| M6 | 测试 + 打包 | `npm run check` 绿、CI 绿 |

估时：M1–M3 约一到两天等效工作量，M4–M6 再一天。合并转发不进这个里程碑。
