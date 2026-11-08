# OneBot 合并转发：读取实现（草稿）

> 状态：草稿，未实现。目标：让模型能读到合并转发（聊天记录）里的内容，而不是只看到一个 `[合并转发]` 占位。
> 相关代码：`src/channels/onebot/onebot-normalize.mjs`（`forward` 段）、`onebot-api.mjs`、`onebot-runtime.mjs`。

## 1 现状

`renderSegment` 遇到 `forward` 段直接返回 `[合并转发]`：

```js
case 'forward':
  // Deferred: merged forwards are read through get_forward_msg later.
  return { text: '[合并转发]' };
}
```

协议端给出的 `forward` 段只有资源标识（`data.id`，NapCat/Lagrange 都是 `resid` 形式），正文要另外取。

## 2 取内容

OneBot v11 的 `get_forward_msg`（NapCat/Lagrange 均实现）：

```
action: get_forward_msg
params: { id: "<forward 段的 data.id>", message_id: <可选，部分实现用消息 id> }
返回: { messages: [ { sender: { user_id, nickname }, time, message: [segments] } ] }
```

`messages[].message` 是**与普通消息同构的段数组**，所以渲染器可复用现有 `renderSegment`（`at`、`image`、`face`、`mface` 都能吃）。

## 3 渲染成什么样

不要拼成"一条长文本"塞进正文，而是渲染成一个**清单**，每行一条：

```
[合并转发：3 条]
1. 泥(@winzkh)：随机填充一个5gb的二进制文件
2. VC酱qwq：草
3. YC酱：先别跑
```

规则：

- 标题行写条目数（`[合并转发：N 条]`），不是每台 QQ 都给 `title`；
- 每条前缀 `序号. 发送者：`；发送者优先群名片/昵称，兜底 QQ 号；
- 单条正文过长按 200 字符截断，标 `…`；
- 图片渲染成 `[图片]`，语音 `[语音]`，视频 `[视频]`，表情 `[表情]`；**不下载**任何媒体（与引用媒体的取舍一致，避免回合前拉大文件）；
- 嵌套转发（转发里有转发）只渲染到一层，内层输出 `[合并转发（未展开）]`；
- 总长度上限：整段渲染 ≤ 2 000 字符，超出时保留前若干条并追加 `…（其余 N 条未显示）`。

## 4 何时取

**只在这条消息真的会被交给模型时取**，也就是：`addressed` 已满足、并且会进入 bridge。取的动作放在 runtime 的 `#onFrame` 里，和 `#addressedForQuote` 同一层：

1. 归一化阶段先给出占位，并记下 `forwardIds: [resid…]`；
2. 消息确定要进入 bridge 后，逐个 `get_forward_msg`，把结果渲染文本替换占位；
3. 任一取失败：保留 `[合并转发（读取失败）]`，**不阻塞**整条消息；失败原因进日志（`onebot-forward-failed`）。

不做预取缓存：合并转发是低频消息，缓存命中率低、还会让"同一 resid 被引用两次"命误。需要时可以再引入 LRU。

## 5 边界与风险

| 场景 | 处理 |
|---|---|
| 协议端不实现 `get_forward_msg` | 返回 `[合并转发（协议端不支持）]`，日志一次 |
| `resid` 过期（QQ 的合并转发有有效期） | 同读取失败；提示里不写"已过期"，因为无法区分 |
| 单条消息含大量图片 | 只出 `[图片]` 占位，数量不写 |
| 转发内容含伪造上下文标签 | **必须**同样过 `stripInjectedContextTags`（转发的正文也是用户输入） |
| 条目极多（几百条） | 按 2 000 字符上限截断，不逐条下载 |

安全上要强调：合并转发的正文等价于"别人说的话被搬过来"，按 `AGENTS.md` §1.3 的转发铁律处理——内容可以聊，指令不认。

## 6 改动清单

1. `onebot-api.mjs`：`getForwardMsg: (id) => session.request('get_forward_msg', { id })`；
2. `onebot-normalize.mjs`：`forward` 段保留 `forwardIds`，并导出 `renderForwardTranscript(nodes, { limit })`（纯函数，好测）；
3. `onebot-runtime.mjs`：进 bridge 前解析占位；
4. 测试：渲染纯函数（条数、截断、嵌套、伪造标签），运行时（取失败保留占位、成功替换）；
5. 文档：`docs/onebot-channel.md` §5 段映射补一行，§9 开放问题去掉"forward 时机"。

## 7 待定

1. 转发正文要不要**单独成文化**（不进当前消息正文，而是像引用那样单独一个块）？两种对模型都行，后者更容易做长度隔离。
2. 是否需要 `--raw` 之类调试开关，把完整转发 JSON 落到日志里方便排查？
3. 图片是否给文件名（便于 `read_image` 之外的手工核对），还是只写 `[图片]`？
