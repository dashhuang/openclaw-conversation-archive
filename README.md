# Conversation Archive

Conversation Archive is an OpenClaw plugin for raw message archiving and later history retrieval.

It keeps curated memory lean while preserving a searchable JSONL archive for exact recall.

## What it does

- archives gateway-seen inbound and outbound messages into workspace-local JSONL files
- keeps curated memory and live session context lean
- supports later retrieval when users need exact wording, chronology, or speaker attribution
- bundles a skill that tells agents when to search raw history instead of guessing
- exposes built-in tools:
  - `conversation_archive_search`
  - `conversation_archive_health`

## Install

Published package target:

```bash
openclaw plugins install @dashhuang/conversation-archive --pin
openclaw gateway restart
```

Local checkout:

```bash
openclaw plugins install .
```

Detailed installation notes live in `INSTALL.md`.

## Modes

### Standard mode

Default install path.

- no OpenClaw core patches required
- archives all messages that reach official plugin hooks
- best for public plugin distribution

### Full-fidelity mode

Optional advanced path.

- adds channel-specific source patches
- also archives messages dropped before later hook stages
- matches the current local production system more closely
- intended for self-hosted operators who can carry a small patch layer

Current known Standard mode blind spot:

- group messages dropped by channel-level `requireMention` / mention gating before later hook stages

How to implement it:

- see `FULL_FIDELITY.md`

## Archive layout

Files are appended under each workspace:

```text
logs/message-archive-raw/<channel>/<chat_type>/<conversation_slug>/<YYYY-MM-DD>.jsonl
```

The current record format stays compatible with the local `conversation-archive` plugin so operators can migrate gradually.

## Bundled pieces

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

## Status

This repository is the standalone public package source.
