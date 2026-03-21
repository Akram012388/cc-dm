#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/Akram012388/cc-dm"
INSTALL_DIR="$HOME/.cc-dm/plugin"
CONFIG_FILE="$HOME/.claude/settings.json"

echo ""
echo "cc-dm — Claude Code Direct Message"
echo "===================================="
echo ""

# Check dependencies
if ! command -v bun &> /dev/null; then
  echo "ERROR: Bun is required but not installed."
  echo "Install it from: https://bun.sh"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo "ERROR: git is required but not installed."
  exit 1
fi

CLAUDE_VERSION=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "0.0.0")
REQUIRED_VERSION="2.1.80"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

if ! version_gte "$CLAUDE_VERSION" "$REQUIRED_VERSION"; then
  echo "ERROR: Claude Code v$REQUIRED_VERSION or later is required."
  echo "Your version: $CLAUDE_VERSION"
  echo "Update Claude Code and try again."
  exit 1
fi

echo "✓ Bun found: $(bun --version)"
echo "✓ Claude Code found: v$CLAUDE_VERSION"
echo ""

# Clone or update repo
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing installation..."
  git -C "$INSTALL_DIR" pull origin main --quiet
else
  echo "Installing cc-dm to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR" --quiet
fi

# Install dependencies
echo "Installing dependencies..."
bun install --cwd "$INSTALL_DIR" --quiet

# Inject MCP server config into ~/.claude/settings.json
echo "Configuring Claude Code..."

mkdir -p "$HOME/.claude"

bun -e "
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const path = '$CONFIG_FILE';
const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
if (!existing.mcpServers) existing.mcpServers = {};
existing.mcpServers['cc-dm'] = {
  command: 'bun',
  args: ['run', '$INSTALL_DIR/src/server.ts']
};
writeFileSync(path, JSON.stringify(existing, null, 2));
console.log('MCP server registered in $CONFIG_FILE');
"

echo ""
echo "===================================="
echo "cc-dm installed successfully."
echo ""
echo "To start a session:"
echo "  CC_DM_SESSION_ID=myname claude --dangerously-load-development-channels server:cc-dm"
echo ""
echo "Docs: $REPO"
echo "===================================="
echo ""
