from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SEARCH_SCRIPT = PLUGIN_ROOT / "scripts" / "search_archive.py"


class SearchArchiveTest(unittest.TestCase):
    def test_keeps_repeated_messages_without_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_dir = tmp_path / "logs" / "message-archive-raw" / "telegram" / "direct" / "telegram-sample-user"
            archive_dir.mkdir(parents=True)
            archive_file = archive_dir / "2026-03-14.jsonl"

            entries = [
                {
                    "timestamp_utc": "2026-03-14T00:00:01.000Z",
                    "timestamp_local": "2026-03-14T13:00:01+13:00",
                    "local_date": "2026-03-14",
                    "local_time": "13:00:01",
                    "channel": "telegram",
                    "chat_type": "direct",
                    "peer_id": "telegram-sample-user",
                    "conversation_label": "telegram:direct:sample-user",
                    "conversation_slug": "telegram-sample-user",
                    "role": "user",
                    "speaker_name": "Dash",
                    "text": "repeat me",
                },
                {
                    "timestamp_utc": "2026-03-14T00:00:02.000Z",
                    "timestamp_local": "2026-03-14T13:00:02+13:00",
                    "local_date": "2026-03-14",
                    "local_time": "13:00:02",
                    "channel": "telegram",
                    "chat_type": "direct",
                    "peer_id": "telegram-sample-user",
                    "conversation_label": "telegram:direct:sample-user",
                    "conversation_slug": "telegram-sample-user",
                    "role": "user",
                    "speaker_name": "Dash",
                    "text": "repeat me",
                },
            ]

            with archive_file.open("w", encoding="utf-8") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

            proc = subprocess.run(
                [
                    "python3",
                    str(SEARCH_SCRIPT),
                    "--query",
                    "repeat me",
                    "--limit",
                    "10",
                    "--json",
                ],
                cwd=tmp_path,
                check=True,
                capture_output=True,
                text=True,
            )

            results = json.loads(proc.stdout)
            self.assertEqual(len(results), 2)
            self.assertEqual(results[0]["timestamp_utc"], "2026-03-14T00:00:01.000Z")
            self.assertEqual(results[1]["timestamp_utc"], "2026-03-14T00:00:02.000Z")


if __name__ == "__main__":
    unittest.main()
