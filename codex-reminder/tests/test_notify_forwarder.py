import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest


class ForwarderTests(unittest.TestCase):
    def test_only_a_live_application_receives_events(self):
        resources = Path(__file__).resolve().parents[1] / "resources"
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            profile = home / "Library/Application Support/icon-app"
            profile.mkdir(parents=True)
            hook = home / "icon-app-reminder.sh"
            shutil.copyfile(resources / "notify-macos.sh", hook)
            shutil.copyfile(resources / "classify-codex-turn.py", home / "classify-codex-turn.py")
            codex = home / ".codex"
            thread = "12345678-1234-1234-1234-123456789abc"
            transcript = codex / "sessions/2026/11/26" / f"rollout-test-{thread}.jsonl"
            transcript.parent.mkdir(parents=True)

            def write_row(kind, **payload):
                with transcript.open("a") as log:
                    print(json.dumps({"type": kind, "payload": payload}), file=log)

            def start_turn(turn, reviewer):
                write_row("event_msg", type="task_started", turn_id=turn)
                write_row("turn_context", turn_id=turn, approvals_reviewer=reviewer, approval_policy="on-request")

            write_row("session_meta", id=thread, thread_source="user")
            start_turn("first", "user")
            write_row("response_item", type="message", role="assistant", phase="final_answer",
                      content=[{"type": "output_text", "text": "Done."}])
            completion = json.dumps({"type": "agent-turn-complete", "thread-id": thread,
                                     "turn-id": "first", "last-assistant-message": "Done."})
            # Model an old installation with glow still enabled and a leftover helper.
            (profile / "reminders.json").write_text('{"popup":false,"sound":false,"edgeGlow":true}')
            glow = home / "icon-app-edge-glow"
            glow.write_text('#!/bin/sh\necho unexpected > "$HOME/effect"\n')
            glow.chmod(0o700)

            def notify(*args, payload=None):
                result = subprocess.run(["/bin/sh", str(hook), *args], input=json.dumps(payload).encode(),
                                        capture_output=True, check=True, timeout=3,
                                        env={**os.environ, "HOME": temp, "CODEX_HOME": str(codex)})
                self.assertEqual(result.stdout, b"")  # The hook never supplies an approval decision.

            notify("{}")
            endpoint = str(home / "app.sock")
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(endpoint)
                server.listen()
                server.settimeout(2)
                (profile / "reminder-route").write_text(endpoint + "\n")
                def receive(expected):
                    connection, _ = server.accept()
                    with connection:
                        self.assertEqual(connection.recv(32), expected)

                notify(completion)
                receive(b"completed")
                start_turn("second", "auto_review")
                for name in ("PreToolUse", "PermissionRequest"):
                    notify("--hook", "approval", payload={"session_id": thread, "turn_id": "second",
                                                         "hook_event_name": name})
                notify("--hook", "input")
                receive(b"input")  # Auto-review must not mute questions.
                start_turn("third", "user")
                notify("--hook", "approval", payload={"session_id": thread, "turn_id": "second",
                                                     "hook_event_name": "PermissionRequest"})
                notify("--hook", "approval", payload={"session_id": thread, "turn_id": "third",
                                                     "hook_event_name": "PermissionRequest"})
                receive(b"approval")
                server.settimeout(0.1)
                with self.assertRaises(socket.timeout):
                    server.accept()
            # An abnormal exit can leave both the route file and the socket on disk.
            notify("{}")
            notify("--hook", "input")
            self.assertFalse((home / "effect").exists())
