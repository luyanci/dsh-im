# dsh-im

把 IM 机器人接进 [DeepSeek Harness](https://github.com/xmanrui) 的渠道插件。在 QQ、Telegram、Discord、Slack、微信、飞书、企业微信、钉钉、WhatsApp、iMessage 里和同一个 DSH agent 对话：它跑在你的机器上，工作区、模型、记忆都是你自己的。

本仓库是 [`xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 的分支，跟上游保持同步（当前基于 v5.10.0），并在此之上维护自己的改动，见[与上游的差异](#与上游的差异)。上游 README 的原文快照放在 [`docs/upstream/`](docs/upstream/INDEX.md)，根目录这份 README 属于 fork 自己。

## 快速开始

```bash
# 装到当前的 DSH profile（web / desktop 均可）
dsh plugin add @luyanci/dsh-im

# 或者直接用 npm
npm install @luyanci/dsh-im
```

装完**重启 dsh**，在「设置 → IM 机器人」里选择渠道、填入凭据即可。

要求：Node.js ≥ 22.19，DSH ≥ 0.2.1-rc.2。

## 支持的渠道

| 渠道 | 接入方式 | 备注 |
|---|---|---|
| Telegram | Bot Token | 长轮询，无需公网 |
| **OneBot (QQ)** | 反向 WebSocket | 对接 SnowLuma / NapCat / Lagrange，见下文 |
| Discord | Bot Token | 需要开启 Message Content Intent |
| Slack | Bot Token + App Token | 设置页内置 Manifest，复制即用 |
| QQ（官方） | 腾讯官方 SDK | 走 QQ 开放平台，与 OneBot 渠道相互独立 |
| 微信 / 企业微信 / 企业微信应用 | 各自平台凭据 | |
| 飞书 / 钉钉 | 各自平台凭据 | |
| WhatsApp / iMessage | 各自桥接 | iMessage 仅 macOS |

每个机器人**独立**拥有：工作区、模型、Agent Preset、访问策略、显示名与别名。在「更多设置」里改。

## OneBot（QQ）

这是唯一需要**先配好对端**的渠道：协议端主动连本机，插件只负责收发。

1. 在本机安装并启动协议端（[SnowLuma](https://github.com/SnowLuma/) / [NapCat](https://github.com/NapNeko/NapCatQQ) / Lagrange），登录要接入的 QQ 号；
2. 在协议端开启**反向 WebSocket**，地址填 `ws://127.0.0.1:6700/onebot/v11/ws`；
3. 在 DSH 设置页填 QQ 号与同一端口；协议端和本页的访问令牌要一致（两边都留空表示不校验）；
4. 保存后协议端会自动连上，QQ 里 @ 它、或引用它的消息即可对话。

行为约定：

- 只监听回环地址，一个账号一个端口，端口冲突在保存时直接拒绝；
- 一个账号一条监听，支持多号并发；
- 回合内**不发占位、不改消息、不删消息**，最终答案作为普通消息发出；回合失败仍会发一条错误提示；
- 图片双向收发；文档走协议端的上传接口，表现为群文件/私聊文件，不是消息气泡；
- 视频与语音按文件处理，不做原生视频段与语音条；
- 管理动作（禁言、踢人、撤回、群成员查询）**不在渠道内**，需要时由工作区侧调用协议端接口。

协议事实、能力边界与实测结论都在 [`docs/onebot-channel.md`](docs/onebot-channel.md)。

## 配置

设置页里的选项写进插件配置；密钥类字段存进 DSH 凭据服务，配置文件里只留引用。渠道级选项（语言、投递、访问策略、工具开关等）见 `docs/` 下的对应文档。

## 与上游的差异

- **新增 OneBot v11 渠道**（第 10 个渠道）：反向 WebSocket、引用解析、图片/文件收发、静默回合、每账号设置、投递目标、接入引导；
- 上游功能保持跟随，合并时保留自己的渠道与文档。

本 fork 自己的发布记录在 [`CHANGELOG.fork.md`](CHANGELOG.fork.md)；上游历史原样保留在 [`CHANGELOG.md`](CHANGELOG.md)，那份文件我们不改，合并上游标签时不会冲突。版本号始终领先上游：上游发新标签时，fork 直接跳到更高的 minor。

## 文档

- `docs/onebot-channel.md` — OneBot 渠道设计稿与实测结论
- `docs/client-integration.md` — 客户端接入
- `docs/preset-workspaces.md` — 预设工作区
- `PROACTIVE_DELIVERY.md` — 主动投递

## 开发

```bash
npm install
npm run build     # 构建 lib/（client 与 host 两份 bundle）
npm test          # 单测；部分用例依赖本地代理与临时目录，以 CI 为准
npm run check     # build + test + 打包校验
```

## 许可

MIT。原始版权归 [xmanrui](https://github.com/xmanrui)，本分支的改动同样以 MIT 发布；第三方组件声明见 `THIRD_PARTY_NOTICES.md`。
