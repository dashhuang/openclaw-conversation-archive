#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


REQUIRED_FIELDS = [
    "timestamp_utc",
    "timestamp_local",
    "local_date",
    "local_time",
    "channel",
    "chat_type",
    "role",
    "text",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check conversation archive health.")
    parser.add_argument("--archive-root", default="logs/message-archive-raw", help="Archive root to inspect.")
    parser.add_argument("--hours", type=int, default=24, help="Freshness window in hours.")
    parser.add_argument(
        "--mode",
        choices=["standard", "full-fidelity"],
        default="standard",
        help="Coverage mode to report.",
    )
    return parser.parse_args()


def latest_archive_file(archive_root: Path) -> Path | None:
    jsonl_files = [path for path in archive_root.rglob("*.jsonl") if path.is_file()]
    if not jsonl_files:
        return None
    return max(jsonl_files, key=lambda path: path.stat().st_mtime)


def inspect_sample(path: Path) -> tuple[list[str], str | None]:
    try:
        last_non_empty = ""
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    last_non_empty = line
        if not last_non_empty:
            return [], "latest archive file is empty"
        sample = json.loads(last_non_empty)
        missing = [field for field in REQUIRED_FIELDS if field not in sample]
        return missing, None
    except Exception as exc:  # noqa: BLE001
        return [], str(exc)


def main() -> int:
    args = parse_args()
    archive_root = Path(args.archive_root)

    if not archive_root.exists():
        print(f"missing archive root: {archive_root}")
        return 1

    latest = latest_archive_file(archive_root)
    if latest is None:
        print(f"no archive files under: {archive_root}")
        return 1

    age_seconds = int(time.time() - latest.stat().st_mtime)
    missing_fields, sample_error = inspect_sample(latest)

    print(f"archive_root={archive_root}")
    print(f"mode={args.mode}")
    print(f"latest_file={latest}")
    print(f"age_seconds={age_seconds}")

    if age_seconds > args.hours * 3600:
        print(f"warning=freshness-exceeded ({args.hours}h)")

    if missing_fields:
        print(f"missing_fields={','.join(missing_fields)}")
        return 1

    if sample_error:
        print(f"sample_error={sample_error}")
        return 1

    if args.mode == "standard":
        print("note=standard-mode archive coverage depends on official plugin hook visibility")
    else:
        print("note=full-fidelity mode assumes channel-level skip patch coverage is installed")

    print("status=ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
