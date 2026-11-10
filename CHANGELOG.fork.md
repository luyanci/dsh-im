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

每个版本小节开头都注明它**基于哪个上游版本**，格式为 `> 基于上游 / Based on upstream: vX.Y.Z`，
一行就够——版本号本身看上面那条规则，合并点看这一行。

Every release section starts with a single line naming the upstream version it is based on:
`> 基于上游 / Based on upstream: vX.Y.Z`.

## [UNRELEASED]

### Added / 新增

- OneBot 入站文件优先走 NapCat 的 URL 扩展接口：`get_private_file_url` / `get_group_file_url`（群文件 `busid` 默认 102）
  会返回真正的 http 下载链接，比读本地临时文件更通用（协议端与 DSH 不在同一台机器时也能用）；接口不存在、拒绝
  或下载失败（rkey 过期等）时自动退回 `get_file` 的本地路径 / `base64`，不影响其他协议端。
  Inbound OneBot files prefer NapCat's URL extensions: `get_private_file_url` / `get_group_file_url` (group files
  default to `busid` 102) return a real http link, which also works when the protocol end is not on this machine. If
  the action is missing, refused, or the download fails (an expired rkey), loading falls back to `get_file`'s local
  path or `base64`, so other protocol ends are unaffected.
- 上下文增强新增字段 `mentioned`：消息是「@ 了机器人」或「回复机器人」触发时，`<dsh_im_source>` 块里会出现
  `"mentioned":true`；未提及时整个字段省略（不写 false）。字段从协议结构（`at` 段比对 selfId、引用解析）取值，
  走签名通道，用户正文里手打任何字样都伪造不了。之前的临时做法「正文插入 `@了你`」已回退——那是可伪造的纯文本。
  Context enhancement gains a `mentioned` field: when a message mentioned the bot or replied to it, the
  `<dsh_im_source>` block carries `"mentioned":true`; otherwise the field is omitted (never `false`). It is derived
  from protocol structure (the `at` segment matching the bot id, reply resolution) and travels the signed path, so
  nothing typed in the message body can forge it. The earlier `@了你` text marker is reverted: plain text is forgeable.
- 新增显式静默标记 `[NO_REPLY]`：最终回复**整条**只有这个标记时，插件直接丢掉，读者看不到任何消息，
  也不会补「本轮处理已结束」的提示。模型很难真的输出空字符串，之前让它「安静结束」往往变成发一句占位；
  现在它有一个明确、可靠的办法闭嘴。标记只认整条精确匹配（大小写和首尾空白不敏感），正文里夹带不算。
  Turns can now be silenced with the exact marker `[NO_REPLY]`: when the final answer is that marker alone, the
  bridge drops the whole reply — no message, no empty-answer notice. Models rarely produce a truly empty answer, so
  "stay quiet" used to turn into a placeholder message; this gives them one reliable way to say nothing. Only an
  exact match counts (case and surrounding whitespace ignored); the marker inside real content does nothing.
- OneBot 渠道新增「机器人群聊行为」设置（每个账号一个独立页签，入口和 Telegram 对齐）：每个群可以单独设
  `不响应` / `被 @ 或回复时` / `所有消息`，并可限定只在名单成员发言时响应；规则与 Telegram 共用同一个规范化器，
  缺省 `mention`，所以老配置升级后行为不变。群列表直接问协议端（`get_group_list`），未连接时可手填群号；
  保存后只重启该账号。设计见 `docs/onebot-group-behavior.md`。（`1bc47cc3`）
  The OneBot channel now has a 「机器人群聊行为」 page per account, mirroring Telegram: each group can be set to
  `off` / `mention` / `all`, optionally limited to listed member ids. The rules reuse Telegram's normalizer, default
  to `mention`, so existing configs behave the same. The group list comes from the protocol end (`get_group_list`,
  manual id entry when disconnected) and saving restarts only that account. Design: `docs/onebot-group-behavior.md`.
  (`1bc47cc3`)
- 每个 bot 的「通用」页签新增「空白输出」：回合正常结束但没有任何文本时，默认发一句「本轮处理已结束，没有文本回复。」，
  也可以选静默（只把进度气泡收掉，不发言）。开关存在共享的每-bot 设置文档里，默认 `notice`，老配置行为不变；
  有附件没正文时的「任务已完成。」不受影响。（`eba4e794`）
  Every bot's 「通用」 tab now has an 「空白输出」 choice: when a turn ends successfully with no text, the bot either
  says 「本轮处理已结束，没有文本回复。」 (default) or stays silent, dropping only the progress bubble. The switch
  lives in the shared per-bot settings document, defaults to `notice`, so existing bots behave exactly as before; the
  「任务已完成。」 notice for a file-only turn is unchanged. (`eba4e794`)

### Fixed / 修复

- OneBot 入站文件（NapCat）修好了：NapCat 的 `file` / `video` / `record` 段**不带 `url`**，只有 `file` 与 `file_id`；
  而它的 `get_file` 返回的 `url` 其实是**本地路径**（`C:\…\NapCat\temp\…`），不是 http 链接。此前图片能进（图片段带
  http url），其他文件一律在准备 prompt 时失败。现在按「有 http url 直接下 → 否则 `get_file` 解析 → 读本地路径
  → `base64` 解码」的顺序加载，并复用同一份大小上限。协议端的「启用本地文件到 url」开关不会把 `url` 变成 http，
  只是额外附上 `base64`；两种形态都实测过，本地路径优先（比解几 MB 的 base64 便宜）。
  OneBot inbound files now work with NapCat: its `file` / `video` / `record` segments carry **no url**, only `file`
  and `file_id`, and its `get_file` action answers with a **local path** in `url` rather than an http link. Images
  arrived because image segments do carry an http url; every other file failed while preparing the prompt. Loading now
  goes http url → `get_file` → a staged local read → `base64`, under the same size cap. The protocol end's
  "local file to url" switch does not turn `url` into http; it only adds a `base64` payload. Both shapes were
  measured live, and the staged path wins because decoding megabytes of base64 is the more expensive route.
- 失败参考号现在会落盘：每次「处理消息 / 命令 / 批输入」失败，都会往 `<DSH_HOME>/.dsh-im/failures.jsonl`
  追加一行 JSON（`referenceId`、`code`、`reason`、`channel`、`at`、分类详情）。此前 `MF-…` 只出现在 stdout，
  而 DSH Desktop 不抓 stdout——用户把引用号发回来时磁盘上什么都搜不到。文件超过 2 MB 轮转一次（保留 `.1`），
  写入失败一律吞掉，绝不影响给用户的失败提示；token 形状会在落盘前打码。
  A failed turn's reference id is now durable: every failed message, command or batch input appends one JSON line to
  `<DSH_HOME>/.dsh-im/failures.jsonl` (`referenceId`, `code`, `reason`, `channel`, `at` and the classified details).
  The `MF-…` id used to exist only on stdout, which a DSH Desktop launch never captures, so a quoted id had nothing
  on disk to match. The file rotates once at 2 MB (keeping `.1`), a write failure is swallowed so it can never mask
  the user-facing notice, and bot tokens are redacted before they reach the file.
- OneBot（NapCat）会把 QQ 的灰字提示——例如文件收发回执——转成一条 `post_type: "message"`、`message: []` 的空消息。
  它没有正文、媒体和引用，过去会一路走到桥接层，让机器人回一句「目前支持文字、图片和文件消息。」。现在这类消息
  在进入桥接层之前就被丢掉，并记一行 `dropped a content-less message (segments=none)`（同类 10 分钟限频）；
  非消息帧（`notice.group_upload`、`message_sent` 等）也会被记一次名字，方便下次认出协议端新增的推送。
  NapCat turns QQ gray tips — a file transfer receipt, for instance — into a `post_type: "message"` frame with an
  empty `message` array. With no text, media or quote it used to reach the bridge, which answered "text, images and
  files only". Such a frame is now dropped before the bridge and logged as `dropped a content-less message
  (segments=none)` (once per kind per ten minutes); non-message frames such as `notice.group_upload` or
  `message_sent` are also named once, so a new push shape is identifiable next time.
- `sentAt` 现在在 Telegram 和 OneBot 上也能用：两者分别从消息的 `date` / 事件 `time`（秒）取时刻，交给桥接层
  按需渲染；此前后者只有微信实现了，勾了也不会出现。同时 `channel` 字段的允许列表补上 `onebot`、`matrix`、
  `imessage`、`email`、`wecom-app`——之前 OneBot 的块里根本没有 `channel`，就是这个列表漏了它。
  `sentAt` now works on Telegram and OneBot too: they publish the moment from the message `date` / event `time`
  (seconds) and the bridge renders it on demand; before this only Weixin implemented it, so the field never appeared.
  The `channel` allowlist also gained `onebot`, `matrix`, `imessage`, `email` and `wecom-app` — OneBot's source block
  had no `channel` at all because the list never named it.
- Telegram 出站富文本会把 `&` `<` `>` 转成 HTML 实体，但 Telegram 的富文本渲染**不解码**这些实体：
  正文里的 `<b>` 显示成 `&lt;b&gt;`，代码块里的 HTML 也变成 `&lt;!DOCTYPE html&gt;`，读者复制出来完全不能用。
  现在整段原样发送，不再做任何实体转义；`tg-thinking` 这类标签也不再被强转。（`81174877`）
  Telegram rich messages escaped `&`, `<` and `>` into HTML entities, but Telegram's rich renderer does not decode
  them: prose showed `&lt;b&gt;` and code blocks arrived as `&lt;!DOCTYPE html&gt;`, useless to copy. The markdown is
  now sent unchanged with no entity escaping at all. (`81174877`)
- 会话同步的最终答案在发送前会剔除宿主框架前缀（`Current runtime context.`、`[Compressed conversation section]`、
  `<system-reminder>`、`[SCHEDULE REMINDER`）。起因是上游 issue 报告：一个服务提示触发的回合模型没产出正文，
  聊天里却收到了注入的 runtime context 原文。该成因尚未复现确认，这道闸只做兜底——命中时跳过投递并记
  `host-framing-leak`，日志里不带正文；正文中提到这些字样的正常回答不受影响。（`edd54690`）
  Session sync now refuses to deliver text that starts with Host-injected framing (`Current runtime context.`,
  `[Compressed conversation section]`, `<system-reminder>`, `[SCHEDULE REMINDER`). An upstream issue reported a
  service turn whose model answered nothing yet the chat received the injected runtime context verbatim; the
  cause is unconfirmed, so this is a backstop — the delivery is skipped with a `host-framing-leak` log that never
  repeats the text, and an ordinary answer that merely mentions the framing still goes out. (`edd54690`)
- OneBot 渠道引用图片/文件时，被引用的媒体现在会真正取回来：`get_msg` 的 `data.url` 是签名下载链接，
  之前只把裸资源名写进引用块，模型拿到的是一句「只有个文件名」。现在引用块带一个惰性文件源，走既有的入站文件
  管线下载并落盘，图片/文件因此可读；没有 `url` 的旧消息仍只保留附件名。（`9bc89f24`）
  Quoted images and files on the OneBot channel are now actually fetched: `get_msg` carries the bytes behind a
  signed `data.url`, and the quote used to expose only the bare resource name. The reference now offers a lazy file
  source that the existing inbound-file pipeline downloads and stages, so quoted media is readable; a message with
  no `url` keeps just the attachment name. (`9bc89f24`)
- Telegram 引用图片、文件、贴纸、语音或视频时，引用块现在带着被引用媒体的惰性下载源（`files`），
  入站文件管线按需取回并落盘；此前引用只带一个附件名，所以「这张图里是什么？」永远答不上来。
  引用贴纸取原始 webp、动画/视频贴纸取首帧缩略图；文件大小上限沿用入站文件管线的 `maxBytes`。
  被引用文件超过 **4 MiB** 时只保留附件名、不预先下载：引用媒体是在回合开始前取回的，大文件会拖慢回答。
  （`1cffad68`、`3bad8bac`）
  Quoted photos, documents, stickers, voice notes and videos on Telegram now carry a lazy `files` source, so the
  inbound-file pipeline can fetch the quoted bytes on demand. Before this, a quote only held an attachment name and
  "what is in this picture?" could not be answered. Stickers quote their webp (or the thumbnail for animated/video
  stickers), and the inbound `maxBytes` limit still applies. A quoted file above **4 MiB** keeps only its name: the
  bytes are fetched before the turn starts, so a heavy quote would delay the answer. (`1cffad68`, `3bad8bac`)
- Telegram 引用一条机器人自己发过的消息时，直接从那 64 条「最近发出的答案」缓存里取原文，不再去翻会话历史；
  真的需要回查历史时超时从 5 秒降到 2 秒，捞不到就标 `not-delivered`，不让读者干等。（`b645f50c`）
  Quoting a message the bot sent resolves from a 64-entry cache of recently sent answers instead of paging the
  session transcript; when the transcript really is needed the timeout drops from five seconds to two, and an
  unrecoverable quote reports `not-delivered` instead of stalling the answer. (`b645f50c`)
- Telegram 的 `text_link` / `text_mention` 实体不再被丢掉：隐藏链接会还原成 `[文字](地址)`，被 @ 的人还原成
  `[名字](tg://user?id=…)`，`code` / `pre` 也还原成行内代码和代码块；普通消息和被引用的消息都走同一套渲染。
  在此之前，`对方发出了一个神秘链接` 这种只能看到标签、看不到它指向哪里。（`73d035ca`）
  Telegram `text_link` and `text_mention` entities are no longer dropped: a hidden link becomes `[label](url)`, a
  mentioned user becomes `[name](tg://user?id=…)`, and `code` / `pre` become inline and fenced code. The same
  rendering applies to a plain message and to a quoted one; before this the prompt saw the label but not the target.
  (`73d035ca`)
- 出站 `.gif` 现在走 `sendAnimation` 发成会动的动图。之前它落进 `sendPhoto`，Telegram 只会取第一帧，
  所以发出去是一张静止图；`image/gif` 也不再被并进相册（相册只有静态图）。（`1be074ec`）
  Outbound `.gif` now goes through `sendAnimation`. It used to fall into `sendPhoto`, where Telegram keeps only the
  first frame, so the reader got a still picture; `image/gif` is also excluded from photo albums for the same reason.
  (`1be074ec`)
- 「空白输出」选静默时，Telegram 会把「正在处理…」占位消息**删掉**再结束回合，不再留一个转圈气泡；
  实现上给流加了 `discard()`（没实现该方法的渠道退回原来的 `cancel()`）。OneBot 本来就不发占位，无需处理。（`071ccdbe`）
  In silent empty-answer mode Telegram now deletes the 「正在处理…」 placeholder before ending the turn instead of
  leaving a spinning bubble behind. The stream gained a `discard()`; channels without it keep the old `cancel()`
  fallback. OneBot never creates a placeholder, so nothing changes there. (`071ccdbe`)

### Changed / 变更

- OneBot 的管理端点表改成**组合共享表**（与 Telegram 同构）：`ONEBOT_ENDPOINTS` 现在展开
  `TOKEN_BOT_ENDPOINTS`，只有 add-bot、监听设置、群聊规则这些专属端点自己处理，其余交给共享处理器。
  之前逐条重抄共享端点，`bot.empty-answer.set` 因此只在 Telegram 可用、QQ 侧报「Unknown OneBot endpoint」；
  以后共享层新增设置项 OneBot 自动继承。专属端点（重启带 `sendTest`、无凭据绑定）行为与错误文案不变。
  共享处理器接的是 Proxy 适配器（类实例的方法在原型上，对象展开会全丢）。（`d7f3f80f`、`2f82212f`）
  OneBot's management table now composes the shared one, exactly like Telegram: `ONEBOT_ENDPOINTS` spreads
  `TOKEN_BOT_ENDPOINTS` and only add-bot, listener settings and group rules are handled locally. Re-listing every
  shared endpoint is why `bot.empty-answer.set` worked on Telegram but answered "Unknown OneBot endpoint" on QQ;
  new shared settings are now inherited automatically. The OneBot-only calls (restart with `sendTest`, no credential
  binding) keep their behaviour and error text. The shared handler is reached through a Proxy adapter, because the
  real controller keeps its methods on the prototype and an object spread dropped all of them. (`d7f3f80f`, `2f82212f`)

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

> 基于上游 / Based on upstream: **v5.10.0**（合并于 `aa58a922`）

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
