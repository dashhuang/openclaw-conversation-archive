# Conversation Archive Install

Conversation Archive supports two install modes.

## Standard Mode

Recommended default.

Characteristics:

- no OpenClaw core patch required
- archives messages that reach official plugin hooks
- exposes:
  - `conversation_archive_search`
  - `conversation_archive_health`
- bundles the `conversation-history` skill

### Install from npm

Once published:

```bash
openclaw plugins install @dashhuang/conversation-archive --pin
```

### Install from a local checkout

From an OpenClaw repo checkout:

```bash
openclaw plugins install .
```

### Verify

Run:

```bash
openclaw plugins list
```

Then verify the archive in an agent workspace:

```bash
python3 ./scripts/check_archive.py --archive-root logs/message-archive-raw --mode standard
```

If the package was newly added or the plugin path changed, restart the gateway:

```bash
openclaw gateway restart
```

If you have a tool-capable session, the plugin should also expose:

- `conversation_archive_search`
- `conversation_archive_health`

## Full-Fidelity Mode

Advanced install path.

Characteristics:

- keeps all Standard mode behavior
- additionally archives messages dropped before later hook stages
- intended for self-hosted operators who want maximum archive coverage

Important:

- this mode should not broaden reply behavior
- it only increases passive archive visibility

### Additional step

Apply the documented channel-specific patch layer after installing the plugin.
Implementation notes live in `FULL_FIDELITY.md`.

Current known patch-sensitive channels:

- Telegram
- Discord
- Slack
- LINE
- iMessage
- BlueBubbles

### Verify

Run:

```bash
python3 ./scripts/check_archive.py --archive-root logs/message-archive-raw --mode full-fidelity
```

Then send or observe test messages in the target channel and confirm archive files appear under:

```text
logs/message-archive-raw/<channel>/<chat_type>/<conversation_slug>/<YYYY-MM-DD>.jsonl
```

## Notes

- Standard mode is the public baseline.
- Full-fidelity mode is the advanced path for operators willing to carry the extra patch layer.
- Curated memory and raw archive are complementary:
  - curated memory stays concise
  - archive stays searchable for exact historical recall
