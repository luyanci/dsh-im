# OneBot 群聊行为设置

> 状态：已实现（`73d035ca` 之后的 OneBot 群聊行为提交）。决定：成员 id 手填、不做白名单总开关、
> 默认 `mention`、入口为 bot 设置里的「机器人群聊行为」独立页签（与 Telegram 一致）。
> 参考实现：Telegram 渠道的 group triggers（`src/channels/telegram/group-triggers.mjs`、
> `plugin-src/client/channels/telegram/group-triggers-settings.js`）。

## 1 要解决的问题

OneBot 渠道目前在群里的响应规则是**写死的默认值**：`onebot-normalize.mjs` 把
`config.groupTriggers` 交给 `groupTriggerAddressed()`，而 `onebot-config-store.mjs` 根本不存这个字段，
所以永远落到默认的 `mention`（被 @ 或回复才算叫我）。

Telegram 侧早就有了「机器人群聊行为」面板：每个群单独设规则，可以做到「只理会名单里的人」
「这个群完全不响应」「这个群所有消息都接」。OneBot 侧一个都没有，只能手改配置文件，而且改了也没人认。

本设计把 Telegram 那套搬到 OneBot：**每个 bot 的高级设置里多一块「群聊行为」**，群列表直接问机器人自己
（`get_group_list`），不必手抄群号。

## 2 数据模型

复用 Telegram 已经过测试的规范化函数，不另造一套：

```jsonc
// onebot 配置里，每个 bot 多一个字段
{
  "botId": "onebot_94087db04b3f7323301f35e1",
  "groupTriggers": {
    "defaults": { "mode": "mention", "senders": [] },   // 新群、未配置群
    "groups": {
      "904897306": { "mode": "all", "senders": [] },
      "909906121": { "mode": "mention-list", "senders": ["2058282593"] }
    },
    "hiddenGroupIds": []                                 // UI 里被作者隐藏的群
  }
}
```

- 规范化：`normalizeGroupTriggers()` / `normalizeGroupTriggerScope()`（`group-triggers.mjs`），
  含模式白名单、成员 id 数量上限 500、控制字符过滤；
- 五种模式语义与 Telegram 完全一致：`off` / `mention` / `mention-list` / `all` / `all-list`；
- **缺省即 `mention`**，与当前的隐式行为一致，所以老配置升级后行为不变；
- 私聊不受影响。

`onebot-config-store.mjs` 的 `normalizeBot()` 增加该字段；`setSettings` 的补丁路径要能合并它
（现在是整体 `normalizeBot({ ...existing, ...patch })`，天然支持）。

## 3 RPC 端点

放在现有 OneBot 表中（`plugin-src/host/channels/onebot/rpc.mjs`），命名对齐 Telegram：

| 端点 | 入参 | 返回 |
|---|---|---|
| `bot.group-triggers.get` | `{ botId }` | `{ defaults, groups, hiddenGroupIds }` |
| `bot.group-triggers.set` | `{ botId, defaults, groups, hiddenGroupIds }` | `{ ok: true, restarted: bool }` |
| `onebot.groups.list` | `{ botId }` | `[{ groupId, groupName, memberCount }]` |

要点：

- `set` 先规范化再落盘；校验失败返回结构化错误，前缀沿用现有 `onebot.set-settings` 的写法；
- **保存后重启该 bot 的 runtime**（配置进 runtime），与 Telegram 一致：提示「已保存，下次收消息生效」；
- `onebot.groups.list` **不进配置**，直接走当前连接：
  `session.request('get_group_list')`，5 秒超时；
  未连接返回 `{ code: 'onebot-not-connected' }`，UI 提示并允许手填群号；
- 不做 `resolve`（Telegram 那个是把 `t.me` 链接/@handle 解析成 chat id，QQ 没有这套）。

## 4 主机侧改动

1. `onebot-api.mjs`：加 `getGroupList: () => session.request('get_group_list')`；
2. 新增 `oneBotApiGroupList(data)`（放 `onebot-normalize.mjs` 或 api 文件旁的纯函数）：
   `{ group_id, group_name, member_count }` → `{ groupId: String, groupName: String, memberCount: Number|null }`，
   缺字段容错、非数组返回 `[]`；
3. `onebot-controller.mjs`：暴露 `listGroups(botId)`（拿 runtime 的 session）+ `groupTriggers(botId)`；
4. `onebot-runtime.mjs`：`#session` 已存在，透传即可；不额外缓存群列表（每次现问，避免过期）。

## 5 客户端 UI

Telegram 面板不能直接复用（它有 chat-id 解析、@handle 输入），所以：

- 抽一个**共享组件** `plugin-src/client/channels/shared/group-rules-settings.js`：
  - props：`endpoints`（get/set/list）、`labels`、`listGroups`（返回群列表的调用）；
  - 渲染：新群默认（模式 + 名单）、已有规则列表（群名 + 数字 id + 模式 + 名单）、添加群（下拉 = 群列表，
    可手填数字 id 兜底）、保存；
- `plugin-src/client/channels/onebot/group-triggers-settings.js`：薄壳，传入 OneBot 的 endpoints 与中文标签；
- 挂在 OneBot **高级设置**折叠区里（与访问设置、消息处理方式同层），每个 bot 一份；
- Telegram 面板后续也可以切到共享组件（可选，不在本次范围）。

界面文案（中文源串，需要同步补 en / ru 字典，`i18n-coverage` 会拦）：

- 「群聊行为」「新群聊默认设置」「添加群聊」「从机器人加入的群中选择」「无法读取群列表，可手动填写群号」
- 「选择这个群从不响应/被@或回复时/所有消息」「仅名单成员」「群聊设置已保存」
- 五种模式的 label 直接沿用 Telegram 现有五个（已翻译）。

## 6 边界与风险

| 场景 | 处理 |
|---|---|
| 协议端没连上 | 群列表拿不到，UI 允许手填；规则照常保存 |
| `get_group_list` 超时/不支持 | 同上；错误进反馈条，不阻塞 |
| 群里被踢但仍存规则 | 保留规则（id 仍是键），列表里标「不在当前群列表」 |
| 群名变化 | 每次读取时以 `get_group_list` 为准，配置里不存名字 |
| WebSocket 版本差异 | `member_count` 可能缺失 → `null`，UI 不显示人数 |
| 保存后是否需要重启 | 需要；只重启该 bot，不动其他 bot |

## 7 测试

1. `onebot-config-store`：`groupTriggers` 往返、缺省补默认、更新其他字段不丢规则；
2. `oneBotApiGroupList`：正常、重复群号、缺字段、非数组；
3. RPC：`get/set/list` 的参数校验与转发；非法规则集被拒；
4. controller：未连接时面板仍可打开、`listGroups` 返回 `onebot-not-connected`、保存后重启监听；
5. i18n 覆盖测试通过。

## 8 已定

1. **名单成员**：手填 QQ 号（不从 `get_group_member_list` 选人）；
2. **不做**「全局白名单群」开关，逐群 `off` 已够；
3. `defaults` 保持 `mention`，升级后行为不变；
4. 入口：bot 设置里「机器人群聊行为」独立页签（`ONEBOT_BOT_SETTINGS_TABS`）。
