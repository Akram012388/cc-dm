#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/Akram012388/cc-dm"
INSTALL_DIR="$HOME/.cc-dm/plugin"
CONFIG_FILE="$HOME/.claude.json"

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

# Inject MCP server config into ~/.claude.json
echo "Configuring Claude Code..."

MCP_ENTRY=$(cat <<EOF
{
  "command": "bun",
  "args": ["run", "$INSTALL_DIR/src/server.ts"]
}
EOF
)

if [ ! -f "$CONFIG_FILE" ]; then
  echo '{}' > "$CONFIG_FILE"
fi

# Use bun to safely merge the config
bun -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers['cc-dm'] = $MCP_ENTRY;
fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
console.log('MCP server registered in ~/.claude.json');
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
