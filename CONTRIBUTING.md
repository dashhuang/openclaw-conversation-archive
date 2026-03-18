# Contributing

## Scope

This package is intended to stay small and operationally boring:

- archive gateway-seen messages into workspace-local JSONL
- expose search and health tools for later retrieval
- bundle a thin skill that teaches agents when to search history

Changes that broaden agent reply behavior, add unrelated integrations, or couple the package to one operator's local environment should be avoided.

## Development

Recommended local checks:

```bash
node --test ./tests/conversation-archive.test.mjs
python3 ./tests/test_search_archive.py
python3 ./scripts/search_archive.py --help
python3 ./scripts/check_archive.py --help
```

## Design rules

- keep the public baseline patch-free
- treat Full-fidelity behavior as an optional advanced path
- prefer stable JSONL formats over clever storage schemes
- keep search deterministic and easy to audit
- avoid introducing mandatory external services

## Pull requests

Please include:

- a short problem statement
- the behavior change
- tests or a clear reason no tests changed
- any compatibility or migration notes
