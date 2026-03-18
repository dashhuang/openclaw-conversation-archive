# Security Policy

## Supported usage model

Conversation Archive stores raw message history. Operators should treat archived files as sensitive data.

At minimum:

- keep archives on operator-controlled storage
- do not commit generated archive files
- review filesystem permissions for workspace directories
- avoid exposing archive contents through tools to untrusted users

## Disclosure

If you find a security issue in the package itself, report it privately to the maintainer before opening a public issue.

Examples of relevant issues:

- unintended archive disclosure
- path traversal
- unsafe command execution paths
- tool behavior that expands agent privileges unexpectedly

## Non-goals

This package does not try to solve:

- operator credential management
- host-level sandboxing
- OpenClaw core permission boundaries

Operators remain responsible for safe OpenClaw runtime configuration.
