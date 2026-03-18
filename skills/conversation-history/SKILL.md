---
name: conversation-history
description: Use when the user asks what was said earlier in a chat, wants exact wording, prior links, chronology, or suspects memory may be incomplete. Search curated memory first, then search the raw conversation archive when precision matters.
---

# Conversation History

Use this skill when users need exact historical recall beyond curated memory.

## Why this exists

Curated memory is intentionally lossy.

The conversation archive keeps raw chat history searchable without forcing every message into the live AI session context. That helps preserve token budget while still allowing later retrieval.

## Workflow

1. Start with curated memory (`memory_search`, `MEMORY.md`, daily notes) for high-signal recall.
2. If the user needs exact wording, chronology, or channel-specific confirmation, search the raw archive:

```bash
python3 packages/conversation-archive/scripts/search_archive.py --query "keyword" --limit 8
```

3. Add filters when useful:

```bash
python3 packages/conversation-archive/scripts/search_archive.py --channel telegram --chat-type group --query "OpenClaw"
python3 packages/conversation-archive/scripts/search_archive.py --channel bluebubbles --chat-type direct --sender "Cherry" --limit 5
python3 packages/conversation-archive/scripts/search_archive.py --from-date 2026-03-01 --to-date 2026-03-14 --query "Confluence"
```

## Output Rules

- Prefer a short summary plus 1-3 concrete hits.
- Include date/time, channel, and speaker when citing history.
- Distinguish archive quotes from memory summaries.
- Do not dump long transcript blocks unless the user explicitly asks.

## Guardrails

- Do not say "I can't see old chat history" until you have tried both curated memory and archive search.
- Archive content records what participants said, not whether they were factually correct.
- Standard mode archive coverage depends on what reached official plugin hooks.
- If no relevant hit exists, say that directly and mention the filters you used.
