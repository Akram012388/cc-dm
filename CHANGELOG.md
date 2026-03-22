# Changelog

All notable changes to cc-dm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-03-22

### Changed
- Session identity: separate auto-generated `id` from user-provided `name` and `cwd`
- Session IDs now use `crypto.randomUUID()` (48-bit entropy) instead of `Math.random()` (24-bit)
- `CC_DM_SESSION_NAME` replaces `CC_DM_SESSION_ID` as primary env var (backward compat kept)
- Session names sanitized at server startup, not just at tool invocation
- DM routing resolves targets by display name via `findSessionsByName`
- Message delivery: instant DELETE on delivery (was UPDATE `delivered = 1`)
- Stale sessions: DELETE after 60s inactivity (was UPDATE `status = 'inactive'`)
- Undelivered messages expire after 15 seconds (was 1 hour for delivered messages)
- MCP config moved from `.mcp.json` to inline in `plugin.json` (avoids project-level conflict)
- Registration: detect-then-act — auto-register from env vars, invoke skill only when missing
- Renamed `markDelivered` to `deleteDeliveredMessage` for clarity
- Bus functions (`registerSession`, `findSessionsByName`, `listActiveSessions`, `deleteDeliveredMessage`) now throw on failure instead of silently returning defaults
- Validate name/role length after sanitize, not before
- Heartbeat uses `process.once("exit")` instead of `process.on("exit")` to prevent listener accumulation
- `install.sh` uses marketplace install instead of injecting MCP config into settings.json

### Added
- Duplicate delivery guard — local `Set<number>` in poll loop prevents re-delivery on delete failure
- Same-name registration guard — `handleRegister` rejects names taken by other sessions
- `deregisterSession` — clean session removal on shutdown
- `readPendingMessages` — read without marking delivered (poll loop uses this)
- `deleteDeliveredMessage` — instant row deletion after notification
- `findSessionsByName` — name-based session lookup for DM routing
- Stdin close detection (`process.stdin.on('end')`) to prevent zombie processes
- GitHub-hosted marketplace via `.claude-plugin/marketplace.json`
- `bun install --no-summary` in start script for GitHub-hosted installs
- Schema migration for `name` and `cwd` columns on existing DBs
- Register skill: name-availability check before prompting, with active session list on conflict

### Removed
- `.mcp.json` — replaced by inline `mcpServers` in `plugin.json`
- `readMessages` — replaced by `readPendingMessages` + `deleteDeliveredMessage`
- MCP server injection from `install.sh` — prevents dual-instance conflict with marketplace installs

### Fixed
- Zombie processes: stdin close triggers clean shutdown
- Message loss: delivery confirmation (delete) only after notification succeeds
- Stale sessions: old session entry cleaned up immediately on re-registration
- Empty catch blocks in schema migration now check for specific "duplicate column" error
- Duplicate message delivery on transient DB write failure in poll loop

## [0.3.0] - 2026-03-22

### Added
- Interactive `/cc-dm:register` skill for session registration
- Plugin manifest updated for official Anthropic marketplace submission
- MIT LICENSE file added
- CHANGELOG.md added

### Fixed
- MCP server failed to start when installed as a plugin — `.mcp.json` used a relative path (`src/server.ts`) instead of `--cwd ${CLAUDE_PLUGIN_ROOT}` with the `start` script, causing bun to resolve from the user's working directory instead of the plugin root

### Changed
- Version bumped to 1.0.0 (pending release)
- Removed redundant mcpServers/skills fields from plugin.json (auto-discovery handles defaults)

## [0.2.0] - 2026-03-21

### Added
- Unit and integration test suite — 44 tests using bun:test
- Optional `dbPath` parameter on `initBus()` for test DB isolation
- `closeBus()` export for test cleanup
- `stopPollLoop()` export for clean shutdown
- `error` field on `WhoResult` type for distinguishing empty vs failed queries

### Fixed
- `initBus()` now fails fast by re-throwing on fatal errors instead of leaving db undefined
- SIGINT/SIGTERM handlers call `process.exit(0)` to prevent zombie MCP server processes
- Removed dead `OR to_session='all'` clause from `readMessages()`
- Replaced unsafe `as string` casts with `String()` coercion
- `writeMessage()` returns boolean; `handleDm()` and `handleBroadcast()` report failures accurately
- `handleDm()` sanitizes `to` parameter and returns sanitized value for consistency
- `handleWho()` logs errors instead of silently discarding
- Centralized shutdown in `server.ts` via single `shutdown()` function
- Message ordering uses `id ASC` instead of `created_at ASC` for strict insertion order

## [0.1.0] - 2026-03-21

### Added
- Initial release
- SQLite WAL message bus at `~/.cc-dm/bus.db`
- Four MCP tools: `register`, `dm`, `who`, `broadcast`
- 30s heartbeat writer with 60s session expiry
- Channels protocol support via `claude/channel` capability
- 500ms poll loop for message delivery
- Per-recipient broadcast to avoid delivered-flag race condition
- SKILL.md for natural language usage
- `install.sh` for curl-based installation
