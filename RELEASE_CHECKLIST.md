# Conversation Archive Release Checklist

Use this checklist before publishing a new public package version.

## Package metadata

- choose the release version and update `package.json`
- confirm the npm package name is correct
- confirm `openclaw.plugin.json` still uses plugin id `conversation-archive`
- confirm the public README and install commands match the package name

## Functional verification

- run `node --test ./tests/conversation-archive.test.mjs`
- run `python3 ./tests/test_search_archive.py`
- run `python3 ./scripts/search_archive.py --help`
- run `python3 ./scripts/check_archive.py --help`
- install the package into a clean OpenClaw checkout
- confirm `openclaw plugins info conversation-archive` shows the plugin as loaded
- confirm an agent session exposes:
  - `conversation_archive_search`
  - `conversation_archive_health`
- confirm a real message is archived into `logs/message-archive-raw/...`

## Pack verification

- run `npm pack --dry-run`
- confirm the tarball contains only the intended public files
- confirm no local state, archives, secrets, or control-plane docs are included

## Documentation

- confirm `README.md` explains the product and the Standard vs Full-fidelity split
- confirm `INSTALL.md` includes both local and npm install paths
- confirm Full-fidelity mode is documented as optional and advanced
- confirm the upstream issue link for broader skipped-message coverage is current

## Release

- create a git tag for the version
- publish to npm with public access
- create a GitHub release with install instructions
- smoke test `openclaw plugins install <npm-spec> --pin`
