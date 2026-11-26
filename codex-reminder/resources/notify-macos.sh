#!/bin/sh
# The installed CLI hook only forwards event names to the running Mac app.
route="${HOME}/Library/Application Support/icon-app/reminder-route"
[ -f "$route" ] || exit 0
IFS= read -r endpoint < "$route" || exit 0
[ -S "$endpoint" ] || exit 0

case "$1" in
  --hook)
    case "$2" in
      approval)
        event=$(/usr/bin/python3 "$(dirname "$0")/classify-codex-turn.py" --approval) || exit 0
        [ "$event" = approval ] || exit 0
        ;;
      input) /bin/cat >/dev/null; event=input ;;
      *) exit 0 ;;
    esac
    ;;
  *)
    event=$(printf '%s' "$1" | /usr/bin/python3 "$(dirname "$0")/classify-codex-turn.py") || exit 0
    case "$event" in
      completed) ;;
      input) event=reply ;;
      *) exit 0 ;;
    esac
    ;;
esac

/usr/bin/python3 - "$endpoint" "$event" <<'PY'
import socket
import sys

try:
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(0.5)
        client.connect(sys.argv[1])
        client.sendall(sys.argv[2].encode("ascii"))
except OSError:
    # Quitting or crashing between the check and the send is a normal offline state.
    pass
PY
