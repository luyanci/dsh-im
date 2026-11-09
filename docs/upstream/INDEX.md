# docs/upstream — 上游 README 快照

这个目录只放**上游 [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的 README 原文**，
不是我们写的内容：

| 文件 | 来源 |
|---|---|
| `README.md` | `git show upstream/main:README.md` |
| `README.en.md` | `git show upstream/main:README.en.md` |

**不要手改这两个文件。** 上游那边没有 `docs/upstream/` 这个目录，所以它们永远不会在 merge
时冲突；它们的更新方式只有一个——整份覆盖：

```bash
git fetch upstream main
git show upstream/main:README.md    > docs/upstream/README.md
git show upstream/main:README.en.md > docs/upstream/README.en.md
git add docs/upstream/
```

## 合并上游时的 README 规则

`README.md`（仓库根）**永远归这个 fork**：它是 fork 的说明页，不是上游 README 的拷贝。
所以合并上游标签时如果 `README.md` 冲突：

```bash
git checkout --ours README.md   # 保留 fork 版
git add README.md

git show upstream/main:README.md    > docs/upstream/README.md
git show upstream/main:README.en.md > docs/upstream/README.en.md
git add docs/upstream/
```

一句话：**根 README 取我们的，上游的 README 落到这里。** 这样每次都只解一次冲突，
快照文件本身不会再冲突。

## 同类文件

`CHANGELOG.md` 也是同样的思路：上游历史原文，本 fork 不改，见根目录的
`CHANGELOG.fork.md`（fork 自己的发布记录）。
