# Full-fidelity Mode

Full-fidelity mode is the advanced install path for operators who want archive coverage beyond the official plugin hook lifecycle.

## Why it exists

Standard mode archives every message that reaches OpenClaw's official plugin hooks.

That is enough for most cases, but some channels can drop inbound group messages earlier, usually at channel-level `requireMention` / mention gating.

When that happens:

- the bot correctly does not reply
- the message never reaches later plugin hooks
- a passive archive plugin cannot see it

Full-fidelity mode patches those early-drop points so the message can still be archived without broadening reply behavior.

## What it changes

Full-fidelity mode is about passive visibility only.

It should:

- preserve the normal reply rules
- preserve `requireMention`
- avoid creating sessions for skipped messages
- only add an early archive write before the channel returns

It should not:

- make the bot reply more often
- bypass channel routing policy
- force more messages into live model context

## Known affected channel pattern

The gap appears when a channel:

1. parses the inbound group message
2. evaluates mention gating
3. returns early before later plugin hook stages

This pattern has been observed in channels such as:

- Telegram
- Discord
- Slack
- LINE
- iMessage
- BlueBubbles

Exact upstream coverage may change over time. Re-check current OpenClaw source before carrying patches forward.

## Recommended implementation shape

Use the public plugin as the baseline:

```bash
openclaw plugins install @dashhuang/conversation-archive --pin
openclaw gateway restart
```

Then add a small source patch per affected channel.

The patch should:

- live in the channel ingress path
- run before the channel drops the message
- write the same JSONL schema the plugin uses
- be best-effort and fail closed

For example, in a `requireMention` early-return path:

1. detect that the message is being skipped only because it did not mention the bot
2. build the archive entry using the same shape as the plugin output
3. append it to `logs/message-archive-raw/...`
4. return normally without changing reply behavior

## Verification

After installing the plugin and your patch layer:

1. restart the gateway
2. run:

```bash
python3 ./scripts/check_archive.py --archive-root logs/message-archive-raw --mode full-fidelity
```

3. in a target group with `requireMention: true`, send a message without mentioning the bot
4. confirm:
   - the bot still does not reply
   - the message appears in `logs/message-archive-raw/...`

If a skipped message still does not appear, your patch is either:

- too late in the lifecycle
- writing to the wrong workspace/archive path
- not using the same conversation keying as the plugin

## Upstream direction

The long-term clean solution is an upstream early inbound read-only hook.

If OpenClaw eventually provides that lifecycle point, Full-fidelity mode can collapse back into a patch-free plugin install.
