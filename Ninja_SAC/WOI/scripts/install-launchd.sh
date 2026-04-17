#!/usr/bin/env bash
# Instala los launchd agents del Mac Mini para analyzer (8pm) + reporter (9pm) + healthcheck (c/15min).
# Correr una sola vez después de tener .venv instalados en analyzer y reporter.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$REPO_ROOT/logs"

for plist in "$SCRIPT_DIR/launchd"/*.plist; do
  name="$(basename "$plist")"
  target="$LAUNCH_AGENTS_DIR/$name"
  echo "Installing $name → $target"
  cp "$plist" "$target"
  chmod 644 "$target"

  launchctl unload "$target" 2>/dev/null || true
  launchctl load "$target"
done

echo ""
echo "Installed launchd agents:"
launchctl list | grep -E "com\.woi\." || echo "  (none detected)"
echo ""
echo "Para verificar cuándo correrán:"
echo "  launchctl list | grep com.woi"
echo ""
echo "Para ver logs en vivo:"
echo "  tail -f $REPO_ROOT/logs/*.log"
