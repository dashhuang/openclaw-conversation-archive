# Conversation Archive

Conversation Archive is an OpenClaw plugin for turning live chat traffic into a searchable raw archive.

Conversation Archive 是一个 OpenClaw 插件，用来把实时聊天流量沉淀成可搜索的原始 archive。

It keeps curated memory lean while preserving exact JSONL history for later recall.

它会让精炼记忆保持轻量，同时保留可供以后精确回忆的 JSONL 历史记录。

In practice, this plugin is best for ongoing archive capture.

实际使用上，这个插件最适合“持续归档正在发生的聊天”。

If you also want to bring old AI conversations into OpenClaw, pair it with:

如果你还想把过去在其他 AI 工具里的聊天一起带进 OpenClaw，推荐搭配：

- [openclaw-chat-history-import](https://github.com/dashhuang/openclaw-chat-history-import)

That companion skill bundle is designed for importing old ChatGPT / Claude exports into the same archive and memory workflow.

这个配套 skill bundle 专门用来把旧的 ChatGPT / Claude 导出记录导入到同一套 archive 和记忆工作流中。

## What It Does

## 它做什么

- archives gateway-seen inbound and outbound messages into workspace-local JSONL files
- keeps curated memory and live session context lean
- supports later retrieval when users need exact wording, chronology, or speaker attribution
- bundles a `conversation-history` skill that tells agents when to search raw history instead of guessing
- exposes built-in tools:
  - `conversation_archive_search`
  - `conversation_archive_health`

- 把网关看到的收发消息归档成 workspace-local JSONL 文件
- 让精炼记忆和实时 session 上下文保持轻量
- 在用户需要原话、时间线或说话人归属时，支持后续精确检索
- 自带一个 `conversation-history` skill，指导 agent 什么时候该去搜 raw history，而不是猜
- 暴露两个内置工具：
  - `conversation_archive_search`
  - `conversation_archive_health`

## Recommended Stack

## 推荐搭配

For the most complete setup:

如果你想要一套更完整的聊天记忆能力，推荐这样搭配：

1. use `conversation-archive` for ongoing live archive capture
2. use [`openclaw-chat-history-import`](https://github.com/dashhuang/openclaw-chat-history-import) to import old ChatGPT / Claude history
3. use the bundled `conversation-history` skill to search both kinds of archive data

1. 用 `conversation-archive` 持续归档新的实时聊天
2. 用 [`openclaw-chat-history-import`](https://github.com/dashhuang/openclaw-chat-history-import) 导入旧的 ChatGPT / Claude 历史
3. 用仓库里自带的 `conversation-history` skill 搜索这两类 archive 数据

## Install

## 安装

Published package target:

发布包安装：

```bash
openclaw plugins install @dashhuang/conversation-archive --pin
openclaw gateway restart
```

Local checkout:

本地 checkout 安装：

```bash
openclaw plugins install .
```

Detailed installation notes live in `INSTALL.md`.

更详细的安装说明见 `INSTALL.md`。

## Modes

## 模式

### Standard mode

### Standard mode

Default install path.

默认安装路径。

- no OpenClaw core patches required
- archives all messages that reach official plugin hooks
- best for public plugin distribution

- 不需要 OpenClaw 核心补丁
- 归档所有能到达官方 plugin hook 的消息
- 最适合公开分发

### Full-fidelity mode

### Full-fidelity mode

Optional advanced path.

可选的高级模式。

- adds channel-specific source patches
- also archives messages dropped before later hook stages
- matches the current local production system more closely
- intended for self-hosted operators who can carry a small patch layer

- 增加针对特定渠道的 source patches
- 连那些在后续 hook 之前就被丢掉的消息也会尽量归档
- 更接近我们当前本地生产环境的行为
- 更适合能接受少量 patch 层的自托管使用者

Current known Standard mode blind spot:

当前已知的 Standard mode 盲点：

- group messages dropped by channel-level `requireMention` / mention gating before later hook stages

- 在后续 hook 之前就被频道级 `requireMention` / mention gating 丢掉的群消息

How to implement it:

如何启用：

- see `FULL_FIDELITY.md`

- 见 `FULL_FIDELITY.md`

## Archive Layout

## Archive 目录结构

Files are appended under each workspace:

每个 workspace 下都会按这个结构写入文件：

```text
logs/message-archive-raw/<channel>/<chat_type>/<conversation_slug>/<YYYY-MM-DD>.jsonl
```

The record format stays compatible with the local `conversation-archive` layout so operators can migrate gradually.

记录格式保持与本地 `conversation-archive` 布局兼容，方便渐进迁移。

## Bundled Pieces

## 仓库组成

- `index.js`
  - archive plugin and built-in search tool
- `skills/conversation-history/`
  - guidance for agents to search raw history when memory is insufficient
- `scripts/search_archive.py`
  - JSONL search utility for operator workflows and compatibility
- `scripts/check_archive.py`
  - archive health check
- `INSTALL.md`
  - standard-mode and full-fidelity install guidance

- `index.js`
  - archive 插件与内置搜索工具
- `skills/conversation-history/`
  - 当记忆不够时，引导 agent 去搜 raw history 的 skill
- `scripts/search_archive.py`
  - 供运维工作流和兼容层使用的 JSONL 搜索工具
- `scripts/check_archive.py`
  - archive 健康检查
- `INSTALL.md`
  - standard-mode 和 full-fidelity 的安装说明

## Status

## 状态

This repository is the standalone public package source.

这个仓库是独立公开分发的插件源码仓库。
