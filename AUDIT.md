# cc-dm v0.1.0 — Codebase Audit

Audited against:
- https://code.claude.com/docs/en/channels-reference
- https://code.claude.com/docs/en/channels
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/plugins-reference

## CRITICAL

1. **plugin.json location is wrong** — The official plugin spec requires the manifest at `.claude-plugin/plugin.json`, not `plugin.json` at the repo root. The plugins reference states: "The `.claude-plugin/plugin.json` file defines your plugin's metadata and configuration." Components (commands, agents, skills, hooks) go at the root, but the manifest goes inside `.claude-plugin/`. Current location will cause Claude Code to not recognize the plugin manifest during plugin installation.

2. **plugin.json uses non-standard fields** — The fields `minClaudeCodeVersion` and `channelCapable` do not appear in the official plugin manifest schema. The documented fields are: `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `commands`, `agents`, `skills`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`. Unknown fields are harmless but misleading — they suggest validation that does not exist. The `author` field should be an object (`{"name": "...", "email": "..."}`) per the schema, not a plain string.

3. **meta keys use hyphens — will be silently dropped** — The channels reference explicitly states: "Keys must be identifiers: letters, digits, and underscores only. Keys containing hyphens or other characters are silently dropped." The meta keys `from_session`, `to_session`, `message_id`, `sent_at` in `server.ts:146-150` use underscores and are fine. However, the SKILL.md documents `from_session` and `to_session` as hyphenated attributes in the example `<channel>` tag — this is correct as rendered. No actual issue here on re-inspection, but worth noting the constraint for future meta keys.

## IMPORTANT

1. **readMessages read+update is not atomic** — In `bus.ts:102-111`, the SELECT and UPDATE are two separate operations. If the process crashes between them, messages are read but never marked delivered, causing re-delivery on next poll. This is acceptable for a local-only tool (re-delivery is better than message loss), but wrapping both in a transaction would be more robust: `db.transaction(() => { ... })()`.

2. **readMessages SQL injection via string interpolation** — In `bus.ts:109`, message IDs are joined into a string and interpolated directly into SQL: `` db.run(`UPDATE messages SET delivered = 1 WHERE id IN (${ids})`) ``. The IDs come from a prior SELECT and are integers from SQLite, so this is safe in practice. However, it bypasses parameterized queries. A safer pattern: use a prepared statement with a parameterized list or run individual updates inside a transaction.

3. **INSERT OR REPLACE in registerSession overwrites registered_at** — In `bus.ts:53-56`, re-registering a session replaces the entire row including `registered_at`. This means if a session re-registers (e.g., after a reconnect), its original registration timestamp is lost. An `INSERT ... ON CONFLICT(id) DO UPDATE SET role=?, last_seen=?, status='active'` would preserve `registered_at`.

4. **Poll loop calls readMessages before transport is ready** — In `server.ts:168-169`, `startHeartbeat` and `startPollLoop` are called immediately after `server.connect()`. If the transport hasn't fully initialized, the first `server.notification()` call could fail. The try/catch in the poll loop handles this, but the first few messages could be read from the bus, marked delivered, and then fail to push — losing them silently.

5. **SIGINT/SIGTERM handlers in heartbeat may conflict with MCP transport** — The `StdioServerTransport` likely registers its own signal handlers for graceful shutdown. The handlers in `heartbeat.ts:49-56` call `process.exit(0)` directly, which could bypass the transport's cleanup. Consider removing the `process.exit(0)` calls and letting the transport handle shutdown, or calling `stopHeartbeat()` from a server close handler instead.

6. **install.sh writes to ~/.claude.json — wrong config file for MCP** — The official MCP docs show MCP servers configured in `.mcp.json` (project-level) or in Claude Code's settings files, not `~/.claude.json`. The installer should either write to `~/.claude/settings.json` (user-level settings) or instruct the user to add the MCP config to their project's `.mcp.json`. Writing to `~/.claude.json` may not be recognized by current Claude Code versions.

## SUGGESTIONS

1. **Add an index on messages(to_session, delivered)** — The poll loop runs a SELECT on `messages WHERE (to_session = ? OR to_session = 'all') AND delivered = 0` every 500ms across all sessions. An index on `(to_session, delivered)` would keep this fast as the messages table grows.

2. **Prune delivered messages periodically** — The messages table grows indefinitely. Old delivered messages serve no purpose. Consider adding a cleanup step in `expireStaleSessions()` that deletes messages older than e.g. 1 hour with `delivered = 1`.

3. ~~**Use `${CLAUDE_PLUGIN_ROOT}` in MCP server paths**~~ — **RESOLVED in 36b2af9.** The `.mcp.json` now uses `"args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "--silent", "start"]` which sets the working directory to the plugin root and invokes the `start` script from `package.json`, matching the pattern used by official plugins (e.g. telegram).

4. **Consider `server.sendNotification` for related-message context** — The SDK exposes both `notification()` and `sendNotification()`. The latter associates the notification with the current request being handled, which could be useful if Claude Code tracks message provenance. For standalone push events (not in response to a request), `notification()` is correct.

5. **SKILL.md `triggers` field is not in the official skill schema** — The plugins reference shows skills with `name` and `description` in frontmatter. The `triggers` field may not be recognized by Claude Code's skill discovery system. Skills are automatically discovered based on task context and the `description` field. The triggers may be silently ignored.

6. **install.sh uses `require()` syntax in bun -e block** — Line 73-80 uses `const fs = require('fs')` which is CJS syntax. Bun supports this, but since the project is ESM (`"type": "module"` in package.json), using `import fs from 'fs'` with `--smol` or a top-level await pattern would be more consistent.

7. **Session identity mismatch between env var and register tool** — The server auto-registers with `CC_DM_SESSION_ID` on startup (`server.ts:163`), but the `register` tool lets Claude register with a different `session_id`. This means the session could have two identities: the one from the env var (used by the poll loop and heartbeat) and the one registered via the tool. Messages addressed to the tool-registered name would be delivered, but the poll loop reads messages for the env var name. Consider using the tool-registered name for polling, or preventing re-registration with a different ID.

## Summary

The core implementation is solid and spec-compliant where it matters most. The channel capability declaration, notification format, and stdio transport all match the official Channels reference exactly. The four-tool MCP interface is clean and well-structured. The broadcast race condition fix (per-session writes instead of `to_session='all'`) was the right call.

The most impactful issue is the plugin.json location — it should be at `.claude-plugin/plugin.json` per the official spec if the plugin is to be installable via the plugin system. The non-standard fields and string `author` format should also be corrected. The SQL atomicity and signal handler issues are real but low-severity for a local-only tool. The session identity mismatch between env var registration and tool registration is a design question worth resolving before v0.2.0.
