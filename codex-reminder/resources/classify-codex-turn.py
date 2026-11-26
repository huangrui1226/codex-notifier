"""Classify Codex completion and approval events. Emit no conversation content."""
import json
import os
from pathlib import Path
import re
import sys
import time


def has_final_answer(path, thread_id, turn_id, message):
    """Check the latest turn in this thread. A queued callback can arrive late."""
    with path.open("rb") as transcript:
        header = json.loads(transcript.readline())
        meta = header["payload"]
        if (header["type"] != "session_meta" or meta["id"] != thread_id
                or meta.get("thread_source", "user") != "user"
                or isinstance(meta.get("source"), dict)):
            return False

        current_turn = None
        matches = False
        for line in transcript:
            row = json.loads(line)
            item = row["payload"]
            kind = item.get("type")
            if row["type"] == "event_msg":
                if kind == "task_started":
                    current_turn = item.get("turn_id")
                    matches = False
                elif kind == "turn_aborted":
                    current_turn = None
                    matches = False
            elif current_turn == turn_id and row["type"] == "response_item":
                matches = False
                if (kind == "message" and item.get("role") == "assistant"
                        and item.get("phase") == "final_answer"):
                    answer = "\n".join(
                        part["text"] for part in item["content"] if part.get("type") == "output_text"
                    )
                    matches = answer.strip() == message
    return matches


def session_path(thread_id):
    uuid_pattern = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
    if not isinstance(thread_id, str) or not re.fullmatch(uuid_pattern, thread_id):
        return None
    sessions = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions"
    paths = sessions.glob(f"*/*/*/rollout-*{thread_id}.jsonl")
    return max(paths, key=lambda candidate: candidate.stat().st_mtime_ns, default=None)


def classify_approval(event):
    if not isinstance(event, dict) or event.get("hook_event_name") not in ("PermissionRequest", "PreToolUse"):
        return "ignore"
    turn = event.get("turn_id")
    if not isinstance(turn, str) or not turn or event.get("permission_mode") == "dontAsk":
        return "ignore"
    try:
        path = session_path(event.get("session_id"))
        if path is None:
            return "ignore"
        # Hooks fire before approval routing. Use this turn's effective settings,
        # which can differ from config.toml and from other concurrent sessions.
        result = "ignore"
        with path.open("rb") as transcript:
            for line in transcript:
                if not any(key in line for key in (b'"turn_context"', b'"task_started"', b'"task_complete"', b'"turn_aborted"')):
                    continue
                row = json.loads(line)
                item = row["payload"]
                if row["type"] == "turn_context":
                    manual = (item.get("turn_id") == turn and item.get("approvals_reviewer") == "user"
                              and item.get("approval_policy") != "never")
                    result = "approval" if manual else "ignore"
                elif row["type"] == "event_msg" and item.get("type") in ("task_started", "task_complete", "turn_aborted"):
                    result = "ignore"
        return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return "ignore"


def confirmed_final(event, message):
    thread_id = event.get("thread-id")
    turn_id = event.get("turn-id")
    if not isinstance(turn_id, str) or not turn_id:
        return False
    try:
        path = session_path(thread_id)
        if path:
            # The notify callback can race the transcript writer's last flush.
            for delay in (0, 0.15, 0.35):
                if delay:
                    time.sleep(delay)
                try:
                    if has_final_answer(path, thread_id, turn_id, message):
                        return True
                except json.JSONDecodeError:
                    continue
    except (OSError, KeyError, TypeError, AttributeError, UnicodeError):
        pass
    return False


def classify(event):
    if not isinstance(event, dict) or event.get("type") != "agent-turn-complete":
        return "ignore"

    # A plain-text handoff can end the turn without invoking a question tool.
    # Only inspect the final paragraph of prose. Ignore examples and quoted text.
    message = event.get("last-assistant-message")
    if not isinstance(message, str) or not message.strip():
        return "ignore"
    if not confirmed_final(event, message.strip()):
        return "ignore"
    paragraphs = re.split(r"\n\s*\n", message.strip())
    last = paragraphs[-1].strip()
    if last and not last.startswith((">", "`", "~")) and not last.endswith(("```", "~~~")):
        last = re.sub(r"`[^`]*`|\[[^\]]*\]\([^)]*\)", "", last)
        tail = re.split(r"(?<=[。！？.!?])\s*|\n", last.strip("* \n"))
        sentence = next((part.strip("* ") for part in reversed(tail) if part.strip("* ")), "")
        direct = r"^(?:请(?:你|您)?(?:确认|选择|回复|告诉我|提供|授权)|(?:需要|等待)(?:你|您)(?:确认|选择|回复|提供|授权)|please (?:confirm|choose|reply|provide|authorize)\b)"
        question = r"(?:你|您|是否继续|要继续|选哪个|选哪一|可以继续|\byou\b|^which (?:one|option)|^shall I\b|^should I\b)"
        if re.search(direct, sentence, re.I) or (
            sentence.endswith(("?", "？")) and re.search(question, sentence, re.I)
        ):
            return "input"
    return "completed"


if __name__ == "__main__":
    try:
        event = json.load(sys.stdin)
        print(classify_approval(event) if sys.argv[1:] == ["--approval"] else classify(event))
    except (ValueError, UnicodeError):
        print("ignore")
