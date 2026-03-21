# Changelog

All notable changes to cc-dm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Interactive `/cc-dm:register` skill for session registration
- Plugin manifest updated for official Anthropic marketplace submission
- MIT LICENSE file added
- CHANGELOG.md added

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
