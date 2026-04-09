#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from pathlib import Path


DEFAULT_ARCHIVE_ROOT = Path("logs/message-archive-raw")
DEFAULT_EVENT_ROOT = Path("logs/message-archive-events")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Move non-canonical duplicate archive rows into a separate event log tree."
    )
    parser.add_argument("--archive-root", default=str(DEFAULT_ARCHIVE_ROOT))
    parser.add_argument("--event-root", default=str(DEFAULT_EVENT_ROOT))
    parser.add_argument("--backup-dir", help="Optional backup directory for rewritten archive files.")
    parser.add_argument("--apply", action="store_true", help="Rewrite files in place. Dry-run by default.")
    return parser.parse_args()


def source_priority(entry: dict) -> int:
    source = str(entry.get("source") or "")
    role = str(entry.get("role") or "")
    if role == "user":
        if source == "mention-skip":
            return 40
        if source == "message-preprocessed":
            return 30
        if source == "message-hook":
            return 20
        if source == "import":
            return 10
        return 0
    if role == "assistant":
        if source == "message-sent-internal":
            return 30
        if source == "message-hook":
            return 20
        if source == "import":
            return 10
    return 0


def fallback_stable_id(entry: dict) -> str:
    return "|".join(
        [
            f"peer:{entry.get('peer_id') or entry.get('conversation_slug') or entry.get('conversation_label') or ''}",
            f"role:{entry.get('role') or ''}",
            f"speaker:{entry.get('speaker_id') or entry.get('speaker_name') or ''}",
            f"date:{entry.get('local_date') or ''}",
            f"time:{entry.get('local_time') or ''}",
            f"text:{entry.get('text') or ''}",
        ]
    )


def stable_id(entry: dict) -> str:
    if entry.get("role") == "user" and entry.get("source_message_id"):
        return f"smid:{entry['source_message_id']}"
    if entry.get("message_id"):
        return f"mid:{entry['message_id']}"
    return f"fallback:{fallback_stable_id(entry)}"


def score(entry: dict) -> int:
    text = str(entry.get("text") or "").strip()
    placeholder = text in {"", "[User sent media without caption]"} or text.startswith("<media:")
    return (0 if placeholder else 10) + source_priority(entry)


def append_unique_event_lines(event_file: Path, lines: list[str], apply: bool) -> int:
    existing = set()
    if event_file.exists():
        existing = {
            line.strip()
            for line in event_file.read_text(encoding="utf-8", errors="ignore").splitlines()
            if line.strip()
        }
    new_lines = [line for line in lines if line.strip() and line.strip() not in existing]
    if apply and new_lines:
        event_file.parent.mkdir(parents=True, exist_ok=True)
        with event_file.open("a", encoding="utf-8") as handle:
            for line in new_lines:
                handle.write(line if line.endswith("\n") else f"{line}\n")
    return len(new_lines)


def main() -> int:
    args = parse_args()
    archive_root = Path(args.archive_root)
    event_root = Path(args.event_root)
    backup_root = Path(args.backup_dir) if args.backup_dir else None

    if not archive_root.exists():
        raise SystemExit(f"archive root missing: {archive_root}")

    file_count = 0
    files_touched = 0
    duplicates_moved = 0
    events_appended = 0

    for archive_file in sorted(archive_root.rglob("*.jsonl")):
        rel = archive_file.relative_to(archive_root)
        if any(part.startswith("backup") for part in rel.parts[:-1]):
            continue
        file_count += 1

        parsed_rows: list[tuple[str, dict]] = []
        for raw_line in archive_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            parsed_rows.append((line, entry))

        groups: dict[tuple[object, ...], list[int]] = defaultdict(list)
        for idx, (_line, entry) in enumerate(parsed_rows):
            key = (
                entry.get("channel"),
                entry.get("chat_type"),
                entry.get("peer_id"),
                entry.get("role"),
                stable_id(entry),
            )
            groups[key].append(idx)

        keep_indices: set[int] = set()
        moved_lines: list[str] = []
        for indices in groups.values():
            best_index = max(indices, key=lambda idx: (score(parsed_rows[idx][1]), -idx))
            keep_indices.add(best_index)
            for idx in indices:
                if idx != best_index:
                    moved_lines.append(parsed_rows[idx][0])

        if not moved_lines:
            continue

        files_touched += 1
        duplicates_moved += len(moved_lines)
        event_file = event_root / rel
        events_appended += append_unique_event_lines(event_file, moved_lines, args.apply)

        if args.apply:
            if backup_root is not None:
                backup_file = backup_root / rel
                backup_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(archive_file, backup_file)
            kept_lines = [parsed_rows[idx][0] for idx in range(len(parsed_rows)) if idx in keep_indices]
            archive_file.write_text(
                "".join(f"{line}\n" for line in kept_lines),
                encoding="utf-8",
            )

    print(
        json.dumps(
            {
                "archive_root": str(archive_root),
                "event_root": str(event_root),
                "apply": args.apply,
                "file_count": file_count,
                "files_touched": files_touched,
                "duplicates_moved": duplicates_moved,
                "events_appended": events_appended,
                "backup_dir": str(backup_root) if backup_root else None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
