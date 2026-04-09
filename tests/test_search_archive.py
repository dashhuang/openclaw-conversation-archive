from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SEARCH_SCRIPT = PLUGIN_ROOT / "scripts" / "search_archive.py"


class SearchArchiveTest(unittest.TestCase):
    def run_search(self, cwd: Path, query: str) -> list[dict]:
        proc = subprocess.run(
            ["python3", str(SEARCH_SCRIPT), "--query", query, "--limit", "10", "--json"],
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(proc.stdout)

    def test_keeps_repeated_messages_without_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_dir = tmp_path / "logs" / "message-archive-raw" / "telegram" / "direct" / "telegram-451740013"
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
                    "peer_id": "telegram-451740013",
                    "conversation_label": "telegram:direct:451740013",
                    "conversation_slug": "telegram-451740013",
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
                    "peer_id": "telegram-451740013",
                    "conversation_label": "telegram:direct:451740013",
                    "conversation_slug": "telegram-451740013",
                    "role": "user",
                    "speaker_name": "Dash",
                    "text": "repeat me",
                },
            ]

            with archive_file.open("w", encoding="utf-8") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

            results = self.run_search(tmp_path, "repeat me")
            self.assertEqual(len(results), 2)
            self.assertEqual(results[0]["timestamp_utc"], "2026-03-14T00:00:01.000Z")
            self.assertEqual(results[1]["timestamp_utc"], "2026-03-14T00:00:02.000Z")

    def test_prefers_enriched_entry_when_message_id_matches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_dir = tmp_path / "logs" / "message-archive-raw" / "telegram" / "group" / "telegram-100123"
            archive_dir.mkdir(parents=True)
            archive_file = archive_dir / "2026-03-29.jsonl"

            entries = [
                {
                    "timestamp_utc": "2026-03-29T00:00:01.000Z",
                    "timestamp_local": "2026-03-29T08:00:01+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:01",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "m-1",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "message-hook",
                    "text": "[User sent media without caption]",
                },
                {
                    "timestamp_utc": "2026-03-29T00:00:01.000Z",
                    "timestamp_local": "2026-03-29T08:00:01+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:01",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "m-1",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "message-preprocessed",
                    "text": "[Image OCR]\nAI CINEMA\n3-29 13:20",
                },
            ]

            with archive_file.open("w", encoding="utf-8") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

            results = self.run_search(tmp_path, "AI CINEMA")
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["source"], "message-preprocessed")
            self.assertIn("AI CINEMA", results[0]["text"])

    def test_prefers_mention_skip_over_other_user_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_dir = tmp_path / "logs" / "message-archive-raw" / "telegram" / "group" / "telegram-100123"
            archive_dir.mkdir(parents=True)
            archive_file = archive_dir / "2026-03-29.jsonl"

            entries = [
                {
                    "timestamp_utc": "2026-03-29T00:00:01.000Z",
                    "timestamp_local": "2026-03-29T08:00:01+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:01",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "m-2",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "message-hook",
                    "text": "hook 文本",
                },
                {
                    "timestamp_utc": "2026-03-29T00:00:01.000Z",
                    "timestamp_local": "2026-03-29T08:00:01+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:01",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "m-2",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "message-preprocessed",
                    "text": "preprocessed 文本",
                },
                {
                    "timestamp_utc": "2026-03-29T00:00:01.000Z",
                    "timestamp_local": "2026-03-29T08:00:01+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:01",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "m-2",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "mention-skip",
                    "text": "真实群消息",
                },
            ]

            with archive_file.open("w", encoding="utf-8") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

            results = self.run_search(tmp_path, "消息")
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["source"], "mention-skip")

    def test_prefers_message_sent_internal_for_assistant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_dir = tmp_path / "logs" / "message-archive-raw" / "telegram" / "group" / "telegram-100123"
            archive_dir.mkdir(parents=True)
            archive_file = archive_dir / "2026-03-29.jsonl"

            entries = [
                {
                    "timestamp_utc": "2026-03-29T00:00:05.000Z",
                    "timestamp_local": "2026-03-29T08:00:05+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:05",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "a-1",
                    "role": "assistant",
                    "speaker_name": "Assistant",
                    "source": "message-hook",
                    "text": "我查一下。",
                },
                {
                    "timestamp_utc": "2026-03-29T00:00:05.000Z",
                    "timestamp_local": "2026-03-29T08:00:05+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:05",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "a-1",
                    "role": "assistant",
                    "speaker_name": "Assistant",
                    "source": "message-sent-internal",
                    "text": "我查一下。",
                },
            ]

            with archive_file.open("w", encoding="utf-8") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

            results = self.run_search(tmp_path, "我查一下")
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["source"], "message-sent-internal")

    def test_import_source_message_id_does_not_merge_with_live_message_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_dir = tmp_path / "logs" / "message-archive-raw" / "telegram" / "group" / "telegram-100123"
            archive_dir.mkdir(parents=True)
            archive_file = archive_dir / "2026-03-29.jsonl"

            entries = [
                {
                    "timestamp_utc": "2026-03-29T00:00:05.000Z",
                    "timestamp_local": "2026-03-29T08:00:05+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:05",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "live-1",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "message-preprocessed",
                    "text": "同一句话",
                },
                {
                    "timestamp_utc": "2026-03-29T00:00:05.000Z",
                    "timestamp_local": "2026-03-29T08:00:05+08:00",
                    "local_date": "2026-03-29",
                    "local_time": "08:00:05",
                    "channel": "telegram",
                    "chat_type": "group",
                    "peer_id": "-100123",
                    "conversation_label": "telegram:group:-100123",
                    "conversation_slug": "telegram-100123",
                    "message_id": "live-1",
                    "source_message_id": "import-42",
                    "role": "user",
                    "speaker_name": "Dash",
                    "source": "import",
                    "text": "同一句话",
                },
            ]

            with archive_file.open("w", encoding="utf-8") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

            results = self.run_search(tmp_path, "同一句话")
            self.assertEqual(len(results), 2)
            self.assertEqual({row.get("source") for row in results}, {"message-preprocessed", "import"})


if __name__ == "__main__":
    unittest.main()
