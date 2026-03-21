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
src/bus.ts              SQLite WAL bus, sessions + messages tables
src/tools.ts            Four tool handlers: dm, who, register, broadcast
src/heartbeat.ts        30s heartbeat writer, 60s expiry cleanup
src/server.ts           MCP entry point, claude/channel capability, poll loop
skills/cc-dm/SKILL.md   Skill for natural language usage
plugin.json             Plugin manifest
.mcp.json               MCP server config
install.sh              curl | bash installer
```

## Key implementation details

Channel capability declared via:

```ts
capabilities.experimental['claude/channel']: {}
```

SDK notification type extended via `Server<never, ChannelNotification>` generic to support the custom `notifications/claude/channel` method.

Poll loop: `setInterval` at 500ms with async inner callback, awaits each `server.notification()` call individually.

Broadcast writes one row per recipient with their specific session ID as `to_session`. Do not use `to_session='all'` — this causes a delivered-flag race condition across concurrent poll loops where whichever session polls first marks the message delivered, preventing other sessions from seeing it.

All logging via `console.error` — stdout is reserved for MCP stdio protocol.

Session identity: `CC_DM_SESSION_ID` env var, falls back to `session-<random hex>`.

Bus path: `~/.cc-dm/bus.db`

## Do's

- Use `bun:sqlite` for all database access — raw SQL only, no ORM
- Use `console.error` for all logging
- Keep tool count at 4: `dm`, `who`, `register`, `broadcast`
- Wrap all DB calls and notification sends in try/catch
- Use `.js` extensions on local imports (ESNext module resolution)

## Don'ts

- Do not use Node.js APIs — Bun project only
- Do not add external dependencies beyond `@modelcontextprotocol/sdk`
- Do not expose any network port — stdio only
- Do not use `console.log` anywhere in `src/`
- Do not revert broadcast to `to_session='all'` — the race condition is real
- Do not hardcode `CC_DM_SESSION_ID` in `.mcp.json`

## Testing

```bash
bun run typecheck          # must pass before any commit
bun run src/bus.ts         # bus smoke test
bun run src/tools.ts       # tools smoke test
bun run src/heartbeat.ts   # heartbeat smoke test
```

Live e2e test: open two terminals with different `CC_DM_SESSION_ID` values and verify message delivery end-to-end.

---

**Note:** The `--dangerously-load-development-channels` flag is required for local development. If the notification contract changes, check the [channels reference](https://code.claude.com/docs/en/channels-reference) first before debugging the code.
