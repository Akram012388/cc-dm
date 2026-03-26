# CLAUDE.md

cc-dm is a Claude Code Channel plugin that enables direct peer-to-peer messaging between active Claude Code sessions on the same machine via a shared SQLite bus.

## Stack

- **Runtime:** Bun — never use `node` to run anything in this project
- **Language:** TypeScript, strict mode
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Database:** `bun:sqlite` (built-in, zero external deps)
- **Channel protocol ref:** https://code.claude.com/docs/en/channels-reference

## Architecture

```
.claude-plugin/plugin.json       Plugin manifest + inline mcpServers config
.claude-plugin/marketplace.json  GitHub-hosted marketplace definition
src/bus.ts                       SQLite WAL bus, sessions + messages tables
src/tools.ts                     Four tool handlers: dm, who, register, broadcast
src/sanitize.ts                  Shared string sanitizer (trim, lowercase, spaces→hyphens)
src/heartbeat.ts                 30s heartbeat writer, 60s session expiry + 15s message expiry
src/server.ts                    MCP entry point, claude/channel capability, poll loop, shutdown
skills/cc-dm/SKILL.md            Skill for natural language usage
skills/register/SKILL.md         Interactive session registration skill
tests/                           Unit + integration tests (88 tests, bun:test)
CHANGELOG.md                     Version history
LICENSE                          MIT license
install.sh                       curl | bash installer
```

## Key implementation details

Channel capability declared via:

```ts
capabilities.experimental['claude/channel']: {}
```

SDK notification type extended via `Server<never, ChannelNotification>` generic to support the custom `notifications/claude/channel` method.

Poll loop: `setInterval` at 500ms with async inner callback. Uses `readPendingMessages` to read, `server.notification()` to deliver, then `deleteDeliveredMessage` to remove the row. Each message has its own try/catch so one failure doesn't block the batch.

Broadcast writes one row per recipient with their specific session ID as `to_session`. Do not use `to_session='all'` — this causes a race condition across concurrent poll loops where whichever session polls first deletes the message, preventing other sessions from seeing it.

All logging via `console.error` — stdout is reserved for MCP stdio protocol.

Session identity: `id` is always auto-generated as `session-<12 hex chars>` using `crypto.randomUUID()`. Display `name` comes from `CC_DM_SESSION_NAME` env var (falls back to `CC_DM_SESSION_ID` for backward compat, then to the auto-generated id). All names and project tags are sanitized (lowercase, trimmed, spaces→hyphens) at both server startup and tool invocation. `role` comes from `CC_DM_SESSION_ROLE` (defaults to `worker`). `project` comes from `CC_DM_SESSION_PROJECT` (defaults to `''`). `cwd` is captured from `process.cwd()` at registration. Session names are unique — `handleRegister` rejects names already taken by a different session ID.

Project-scoped messaging: If a session has a non-empty `project` tag, both `handleBroadcast` and `handleDm` only deliver messages to sessions with the same `project` value. Sessions without a project (empty string) can broadcast and DM any active session — the original global behavior. This is sender-side filtering only; no receive-side filtering is needed because message rows are never written for out-of-scope recipients.

**Important:** The `from_session` column in the `messages` table stores the sender's **display name**, not their session ID. This is a historical naming choice. Do not JOIN `messages.from_session` against `sessions.id` — they are different namespaces.

Compaction resilience: MCP stdio servers survive `/compact` and auto-compaction — the process keeps running with the same session ID, in-memory state, and DB registration. The only failure mode is context-level: the static MCP `instructions` string (set once at server construction) still says "not configured" after interactive registration, and compaction compresses away the conversation context that recorded registration. Two layers address this: (1) every tool response includes `_identity: { name, role, project }` via `withIdentity()` so the first tool call after compaction restores identity awareness, and (2) a `PreCompact` prompt hook in `plugin.json` nudges Claude to call `who` to recover identity on next interaction. Incoming channel messages also carry `meta.to_session = sessionName`, providing a free identity reminder on message delivery.

Bus path: `~/.cc-dm/bus.db`

`initBus(dbPath?: string)` — optional param for test DB isolation. `closeBus()` — closes DB connection (used by tests). `shutdown()` — centralized cleanup in server.ts (stopPollLoop + stopHeartbeat + deregisterSession + process.exit). `stopPollLoop()` — exported for clean shutdown. Process listens for SIGINT, SIGTERM, and stdin close to trigger shutdown.

MCP server config is inline in `.claude-plugin/plugin.json` (not a separate `.mcp.json`) to avoid Claude Code reading it as a project-level MCP config where `${CLAUDE_PLUGIN_ROOT}` is unavailable.

## Do's

- Use `bun:sqlite` for all database access — raw SQL only, no ORM
- Use `console.error` for all logging
- Keep tool count at 4: `dm`, `who`, `register`, `broadcast`
- Wrap DB calls in try/catch in timer/shutdown contexts; let them throw in tool handlers
- Use `.js` extensions on local imports (ESNext module resolution)
- Use `process.once("exit", ...)` not `process.on("exit", ...)` to avoid listener accumulation

## Don'ts

- Do not use Node.js APIs — Bun project only
- Do not add external dependencies beyond `@modelcontextprotocol/sdk`
- Do not expose any network port — stdio only
- Do not use `console.log` anywhere in `src/`
- Do not revert broadcast to `to_session='all'` — the race condition is real
- Do not hardcode session identity env vars in plugin config
- Do not create a `.mcp.json` in the project root — use plugin.json mcpServers

## Testing

```bash
bun test                   # 88 unit + integration tests
bun run typecheck          # must pass before any commit
bun run src/bus.ts         # bus smoke test
bun run src/tools.ts       # tools smoke test
bun run src/heartbeat.ts   # heartbeat smoke test
```

Live e2e test: open two terminals with different `CC_DM_SESSION_NAME` values and verify message delivery end-to-end.

---

**Note:** The `--dangerously-load-development-channels` flag is required for local development. If the notification contract changes, check the [channels reference](https://code.claude.com/docs/en/channels-reference) first before debugging the code.
