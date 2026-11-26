"""Classify a legacy Codex notify payload. Emit no conversation content."""
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


def confirmed_final(event, message):
    thread_id = event.get("thread-id")
    turn_id = event.get("turn-id")
    uuid_pattern = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
    if not isinstance(thread_id, str) or not re.fullmatch(uuid_pattern, thread_id):
        return False
    if not isinstance(turn_id, str) or not turn_id:
        return False
    sessions = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions"
    paths = sessions.glob(f"*/*/*/rollout-*{thread_id}.jsonl")
    try:
        path = max(paths, key=lambda candidate: candidate.stat().st_mtime_ns, default=None)
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
        print(classify(json.load(sys.stdin)))
    except (ValueError, UnicodeError):
        print("ignore")
