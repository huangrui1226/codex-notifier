#!/bin/sh
# Called by the running desktop app with its active settings and a fixed event name.
settings=$2
title='Codex CLI'
group='codex-cli-attention'
kind=attention
case "$3" in
  completed) kind=completed; group='codex-cli-completion'; message='回答已完成' ;;
  approval) message='需要你审核授权请求' ;;
  input) message='需要你回答或选择' ;;
  reply) message='等待你回复' ;;
  *) exit 2 ;;
esac
if [ "$1" = '--test' ]; then
  title='Codex 提醒'
  group='icon-app-reminder-test'
  case "$kind" in
    completed) message='测试提醒：回答已完成' ;;
    attention) message='测试提醒：需要你参与' ;;
  esac
fi

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
glow_pid=
if [ "$edge_glow" = true ]; then
  glow="$(dirname "$0")/icon-app-edge-glow"
  if [ ! -x "$glow" ]; then
    result=1
  else
    "$glow" "$kind" </dev/null &
    glow_pid=$!
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
  case "$kind" in
    completed) tone=/System/Library/Sounds/Glass.aiff ;;
    attention) tone="$(dirname "$0")/attention.wav" ;;
  esac
  /usr/bin/afplay "$tone" || result=1
fi
if [ -n "$glow_pid" ]; then
  wait "$glow_pid" || result=1
fi
exit "$result"
