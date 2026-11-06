# Changelog（本 fork）/ Release notes for this fork

本文件只记录 [luyanci/dsh-im](https://github.com/luyanci/dsh-im) 这个 fork 自己发布的版本。
上游 [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的历史记录原样保留在 [`CHANGELOG.md`](CHANGELOG.md)，
那份文件我们不再改动，所以合并上游标签时不会冲突。

This file records only the releases of the [luyanci/dsh-im](https://github.com/luyanci/dsh-im) fork.
Upstream history stays untouched in [`CHANGELOG.md`](CHANGELOG.md) so merging upstream tags never conflicts.

## 版本规则 / Versioning

fork 的版本号**始终保持在上游当前版本之上**：上游发布新标签时，fork 直接跳到更高的 minor
（例如上游发 5.11.0，fork 的下一个版本就从 5.12.0 起）。这样依赖 `^x.y.z` 的安装与
升级检查都会正常前进，不会因为预发布后缀被判定为「更旧」。

The fork always stays ahead of the upstream version: when upstream publishes a tag, the fork jumps to the
next higher minor (upstream 5.11.0 → fork 5.12.0). That keeps `^x.y.z` ranges and update checks moving
forward instead of treating a prerelease suffix as older.

## [5.11.3] - 2026-11-06

### Fixed / 修复

- Telegram 出站富文本会把 `&` `<` `>` 转成 HTML 实体，但 Telegram 的富文本渲染**不解码**这些实体：
  正文里的 `<b>` 显示成 `&lt;b&gt;`，代码块里的 HTML 也变成 `&lt;!DOCTYPE html&gt;`，读者复制出来完全不能用。
  现在整段原样发送，不再做任何实体转义；`tg-thinking` 这类标签也不再被强转。
  Telegram rich messages escaped `&`, `<` and `>` into HTML entities, but Telegram's rich renderer does not decode
  them: prose showed `&lt;b&gt;` and code blocks arrived as `&lt;!DOCTYPE html&gt;`, useless to copy. The markdown is
  now sent unchanged with no entity escaping at all.

## [5.11.2] - 2026-11-06

### Fixed / 修复

- OneBot 高级设置里「访问设置」保存必定失败：共享端点表把整个 `{ botId, policy }` 请求当成了策略本体传给
  `updateAccessPolicy`，而校验要求 `direct` / `group` 两个作用域，于是每次都报「请同时提交完整的私聊和群聊访问设置」。
  现在按字段拆开，只把 `policy` 交给控制器。（`fff93a57`）
  Saving the access policy in the OneBot advanced settings always failed: the shared endpoint table handed the
  whole `{ botId, policy }` payload to `updateAccessPolicy`, which validates `direct`/`group` scopes, so every
  save reported a missing-scope error. Only `policy` is forwarded now. (`fff93a57`)
- OneBot「消息处理方式」保存必定失败：同一张表读取 `payload.mode`，而请求字段叫 `busyMessageMode`，
  控制器收到 `undefined`，报「Message mode must be queue or steer」。已改为读取正确字段，并补了回归测试。（`5f55c277`）
  Saving the OneBot message mode failed for the same reason: the table read `payload.mode` while the field is
  `busyMessageMode`, so the controller received `undefined`. Fixed, with a regression test. (`5f55c277`)

## [5.11.1] - 2026-11-06

### Fixed / 修复

- 改名收尾：包名改为 `@luyanci/dsh-im` 之后，client bundle 注册的 loader id、`cordis.patch.yml` 的
  `name`、`plugins.bundle.config` 的 key、`plugins` 页与样式标记一并跟随，避免 DSH 因 id 与包名不一致拒绝加载。
  Finished the rename: the client loader id, the `cordis.patch.yml` name, the `plugins.bundle.config` key and the
  style markers all follow `@luyanci/dsh-im`.
- 内置的「检查更新 / 手动更新」链路跟随新包名：registry 预检读取 `<scope>:registry`（原先硬编码 `@xmanrui`），
  tarball 路径按包名推导，手动安装命令与文档链接一并更新。相关测试同步改名。
  The built-in update checker and manual-update command follow the new package: the registry preflight reads
  `<scope>:registry`, the tarball path is derived from the package name, and the docs links point at the fork.

## [5.11.0] - 2026-11-06

### Added / 新增

- 新增 OneBot v11（QQ）渠道：协议端（SnowLuma / NapCat / Lagrange）通过反向 WebSocket 连接本机，插件只负责收发。支持群聊与私聊文本、@、引用（按 `get_msg` 解析被引用消息）、图片与文件收发；长文按 1500 字分段发送；回合内不发占位、不删消息，最终答案单独发出，回合失败时仍发一条错误提示。设置页与其它渠道一致：每账号独立工作区、模型、Agent Preset、访问策略与别名。
  Added a OneBot v11 (QQ) channel. A protocol end (SnowLuma / NapCat / Lagrange) dials the host over a reverse WebSocket, and the plugin only receives and sends. Group and private text, mentions, replies (quoted message fetched through `get_msg`), images and files in both directions, long answers split at 1500 characters, no placeholder and no deletions during a turn, the final answer sent as its own message, and one error message when a turn fails. Settings match the other channels: per-bot workspace, model, agent preset, access policy and alias.
- Telegram 新增每机器人开关「最终答案就地编辑」（默认关闭）。关闭思考过程留痕时，能装进一条的最终答案直接替换进度占位消息：不删消息，也不会弹新消息通知；多段答案或编辑被拒时仍删除占位并另发答案，保证答案一定送达。
  Added a per-bot "Edit the final answer in place" switch for Telegram, off by default. With thinking traces off, a final answer that fits one message replaces the progress placeholder: nothing is deleted and no new-message notification appears. Multi-part answers, or a refused edit, still delete the placeholder and send the answer as its own message, so it always lands.

### Security / 安全

- 注入的上下文块（`<dsh_im_source>`、`<dsh_im_source_guidance>`、`<dsh_im_reply_to>`、`<dsh_im_context>`）现在由插件用进程内密钥签名，开头标签带上 `sig` 属性，Host 拆分提示词时逐块校验。用户自己写出的同名标签即使 JSON 形状合法，也只会作为普通消息文本保留，不能再冒充插件写入的来源块。
  Injected context blocks (`<dsh_im_source>`, `<dsh_im_source_guidance>`, `<dsh_im_reply_to>`, `<dsh_im_context>`) are now signed by the plugin with a per-process secret: the opening tag carries a `sig` attribute, verified block by block when the Host splits a prompt. A tag the sender typed stays ordinary message text even with a schema-valid body, so it can no longer impersonate a plugin-produced block.

- 用户自己写出的上下文块（`<dsh_im_source>`、`<dsh_im_source_guidance>`、`<dsh_im_reply_to>`、`<dsh_im_context>`）在最终提交到DSH 时,会被自动移除。
  Users writing context blocks (`<dsh_im_source>`, `<dsh_im_source_guidance>`, `<dsh_im_reply_to>`, `<dsh_im_context>`) are automatically removed before submission to DSH.

### Telegram：fork 自 5.7.0 起累积的改动

这些改动在 fork 的 5.7 → 5.10 构建里已经发布过，但一直没写进任何 CHANGELOG，统一补记在这里。

- 转发消息带 `[转发自 …]` 来源前缀；转发里带来的 @ 不再唤醒机器人（当初那个 @ 是发给原对话的）。
- 接受匿名群管理员与关联频道转进群的消息，并保留 `author_signature`（匿名管理员的自定义头衔、频道帖署名）。
- 只有 `is_forum` 为真的群才把 `message_thread_id` 当作话题键，普通群的社区话题不再切碎会话。
- 媒体组/相册合并成一条消息处理；入站贴纸转成图片；出站的 `.webp` 走 `sendSticker` 发真贴纸，失败回退成图片。
- 纯图片消息不再自动补一句「请分析这张图片」之类的说明文字。

Released in the fork's 5.7 → 5.10 builds but never written down; recorded here once:

- forwarded messages carry a `[转发自 …]` origin prefix, and a mention inside a forwarded message no longer addresses the bot.
- messages from anonymous group admins and from the linked channel are accepted, keeping the author signature.
- only forums treat `message_thread_id` as the topic key, so community topics no longer split sessions.
- media groups arrive as one message, inbound stickers become images, and outbound `.webp` files go out as real stickers with an image fallback.
- an image-only message no longer gets a canned "describe this image" sentence.
