#!/bin/sh
# Codex appends a JSON event argument. No conversation content is needed here.
settings="${HOME}/Library/Application Support/icon-app/reminders.json"
kind=completed
title='Codex CLI'
message='回答已完成'
group='codex-cli-completion'
case "$1" in
  --hook)
    # Hook input may contain tool arguments. Discard it and return without an approval decision.
    /bin/cat >/dev/null
    /bin/sh "$0" --attention "$2" </dev/null >/dev/null 2>&1 &
    exit 0
    ;;
  --attention)
    kind=attention
    group='codex-cli-attention'
    case "$2" in
      approval) message='需要你审核授权请求' ;;
      input) message='需要你回答或选择' ;;
      *) exit 2 ;;
    esac
    ;;
  --test)
    settings=$2
    kind=${3:-completed}
    title='Codex 提醒'
    group='icon-app-reminder-test'
    case "$kind" in
      completed) message='测试提醒：回答已完成' ;;
      attention) message='测试提醒：需要你参与' ;;
      *) exit 2 ;;
    esac
    ;;
  *)
    # The legacy notify callback passes one JSON argument.
    event=$(printf '%s' "$1" | /usr/bin/python3 "$(dirname "$0")/classify-codex-turn.py") || exit 1
    case "$event" in
      completed) ;;
      input) kind=attention; group='codex-cli-attention'; message='等待你回复' ;;
      *) exit 0 ;;
    esac
    ;;
esac

popup=true
sound=true
edge_glow=true
if [ -f "$settings" ]; then
  popup=$(/usr/bin/plutil -extract popup raw -expect bool -o - "$settings") || exit 1
  sound=$(/usr/bin/plutil -extract sound raw -expect bool -o - "$settings") || exit 1
  if ! edge_glow=$(/usr/bin/plutil -extract edgeGlow raw -expect bool -o - "$settings" 2>/dev/null); then
    # Older settings only have popup and sound. Preserve an explicitly muted setup.
    edge_glow=$popup
    if [ "$sound" = true ]; then edge_glow=true; fi
  fi
fi

result=0
settings_dir=$(dirname "$settings")
if [ -f "$settings_dir/iphone-enabled" ]; then
  # Route only the fixed event kind through the local socket of the running Mac app.
  /usr/bin/python3 - "$settings_dir/iphone-route" "$kind" <<'PHONE' || {
import socket, sys
try:
    with open(sys.argv[1]) as f, socket.socket(socket.AF_UNIX) as client:
        client.settimeout(0.75)
        client.connect(f.read())
        client.sendall(sys.argv[2].encode('ascii'))
        client.shutdown(socket.SHUT_WR)
        ok = client.recv(16) == b'ok'
except OSError:
    ok = False
sys.exit(0 if ok else 1)
PHONE
    if [ "$1" = '--test' ]; then result=2; fi
  }
fi
glow_pid=
if [ "$edge_glow" = true ]; then
  glow="$(dirname "$0")/icon-app-edge-glow"
  if [ ! -x "$glow" ]; then
    result=1
  elif [ "$1" = '--test' ]; then
    "$glow" "$kind" </dev/null &
    glow_pid=$!
  else
    # Let the CLI finish its other callbacks while the border is pulsing.
    "$glow" "$kind" </dev/null >/dev/null 2>&1 &
  fi
fi
if [ "$popup" = true ]; then
  if [ -x /opt/homebrew/bin/terminal-notifier ]; then
    notifier=/opt/homebrew/bin/terminal-notifier
  else
    notifier=$(command -v terminal-notifier)
  fi
  if [ -n "$notifier" ]; then
    "$notifier" -title "$title" -message "$message" -group "$group" || result=1
  else
    /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT' || result=1
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
APPLESCRIPT
  fi
fi
if [ "$sound" = true ]; then
  /usr/bin/afplay /System/Library/Sounds/Glass.aiff || result=1
fi
if [ -n "$glow_pid" ]; then
  wait "$glow_pid" || result=1
fi
exit "$result"
