import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


classify = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "resources" / "classify-codex-turn.py")
)["classify"]


class NotifyTests(unittest.TestCase):
    def setUp(self):
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        self.enter_patch(patch.dict(os.environ, CODEX_HOME=home.name))
        self.enter_patch(patch("time.sleep"))
        thread = "12345678-1234-1234-1234-123456789abc"
        self.event = {"type": "agent-turn-complete", "thread-id": thread,
                      "turn-id": "turn-1", "last-assistant-message": "已完成。"}
        self.path = Path(home.name, "sessions/2026/11/26", f"rollout-test-{thread}.jsonl")
        self.path.parent.mkdir(parents=True)
        self.start_thread("user")

    def enter_patch(self, patcher):
        patcher.start()
        self.addCleanup(patcher.stop)

    def append(self, kind, **payload):
        with self.path.open("a") as log:
            print(json.dumps({"type": kind, "payload": payload}), file=log)

    def start_thread(self, source):
        self.path.write_text("")
        self.append("session_meta", id=self.event["thread-id"], thread_source=source)
        self.append("event_msg", type="task_started", turn_id="turn-1")

    def answer(self, phase):
        self.append("response_item", type="message", phase=phase, role="assistant",
                    content=[{"type": "output_text", "text": self.event["last-assistant-message"]}])

    def test_progress_and_tool_activity(self):
        self.answer("commentary")
        self.assertEqual(classify(self.event), "ignore")
        self.append("response_item", type="function_call")
        self.assertEqual(classify(self.event), "ignore")

    def test_final_then_late_callback(self):
        self.answer("final_answer")
        self.assertEqual(classify(self.event), "completed")
        self.append("event_msg", type="task_started", turn_id="turn-2")
        self.assertEqual(classify(self.event), "ignore")

    def test_final_question(self):
        self.event["last-assistant-message"] = "请确认是否继续。"
        self.answer("final_answer")
        self.assertEqual(classify(self.event), "input")

    def test_interrupted_or_background_turn(self):
        self.answer("final_answer")
        self.append("event_msg", type="turn_aborted", turn_id="turn-1")
        self.assertEqual(classify(self.event), "ignore")
        self.start_thread("subagent")
        self.answer("final_answer")
        self.assertEqual(classify(self.event), "ignore")

    def test_missing_evidence(self):
        self.answer("final_answer")
        for message in ("另一条消息", "", None):
            self.assertEqual(classify({**self.event, "last-assistant-message": message}), "ignore")
        self.path.unlink()
        self.assertEqual(classify(self.event), "ignore")
