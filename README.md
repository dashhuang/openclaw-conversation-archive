# Conversation Archive

Conversation Archive is an OpenClaw plugin for canonical message archiving, pipeline event capture, and later history retrieval.

It keeps curated memory lean while preserving a searchable JSONL archive for exact recall.

## What it does

- archives canonical inbound and outbound messages into workspace-local JSONL files
- writes gateway-stage hook records into a separate event log tree when internal hooks are enabled
- enriches canonical archive entries with preprocessed inbound text and internal sent-message payloads
- keeps image messages simple: preserve caption/text when present, otherwise store a plain media placeholder
- keeps curated memory and live session context lean
- supports later retrieval when users need exact wording, chronology, or speaker attribution
- bundles a skill that tells agents when to search raw history instead of guessing
- exposes built-in tools:
  - `conversation_archive_search`
  - `conversation_archive_health`

## Install

Published package target:

```bash
openclaw plugins install @dashhuang/conversation-archive@0.2.0 --pin
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

## Upgrade Notes

### 0.2.0

- `logs/message-archive-raw/` now means canonical chat messages only
- gateway / pipeline stage rows are written to `logs/message-archive-events/`
- internal-hook installs no longer double-write the same message into the main archive tree
- existing mixed archives can be backfilled with:

```bash
python3 extensions/conversation-archive/scripts/canonicalize_archive.py \
  --archive-root logs/message-archive-raw \
  --event-root logs/message-archive-events \
  --apply
```

How to implement it:

- see `FULL_FIDELITY.md`

## Archive layout

Canonical message files are appended under each workspace:

```text
logs/message-archive-raw/<channel>/<chat_type>/<conversation_slug>/<YYYY-MM-DD>.jsonl
```

Gateway/pipeline event traces are written separately under:

```text
logs/message-archive-events/<channel>/<chat_type>/<conversation_slug>/<YYYY-MM-DD>.jsonl
```

The JSONL record shape stays compatible across both trees so operators can migrate gradually and backfill older mixed archives.

## Bundled pieces

- `index.js`
  - archive plugin, built-in search tool, and internal-hook enrichment
- `skills/conversation-history/`
  - guidance for agents to search raw history when memory is insufficient
- `scripts/search_archive.py`
  - JSONL search utility for operator workflows and compatibility
- `scripts/check_archive.py`
  - archive health check
- `scripts/canonicalize_archive.py`
  - moves lower-priority duplicate rows out of the canonical archive tree and into the event log tree
- `INSTALL.md`
  - standard-mode and full-fidelity install guidance

## Status

This repository is the standalone public package source.
