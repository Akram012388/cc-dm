# CLAUDE.md

cc-dm is a Claude Code Channel plugin that enables direct peer-to-peer messaging between active Claude Code CLI sessions on the same machine via a shared SQLite bus.

## Stack

- **Runtime:** Bun (never use `node` to run anything in this project)
- **Language:** TypeScript, strict mode
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Database:** `bun:sqlite` (built-in, zero external dependencies)
- **Protocol:** Claude Code Channels (research preview) — [reference doc](https://code.claude.com/docs/en/channels-reference)

## Project structure

```
src/server.ts          MCP server entry point, declares claude/channel capability
src/bus.ts             SQLite WAL layer, sessions and messages tables
src/tools.ts           Tool handlers: dm, who, register, broadcast
src/heartbeat.ts       30s pulse writer, 60s session expiry cleanup
plugin.json            Plugin manifest
.mcp.json              MCP server config for Claude Code
skills/cc-dm/SKILL.md  Skill that teaches Claude how to use cc-dm naturally
install.sh             curl | bash installer
README.md
CLAUDE.md
```

## Channel contract

This must be followed exactly.

The server must declare the channel capability:

```ts
capabilities.experimental['claude/channel']: {}
```

Push events into the target session's context via:

```ts
mcp.notification({
  method: 'notifications/claude/channel',
  params: { content, meta }
})
```

`meta` fields become attributes on the `<channel>` tag that Claude sees in context.

Transport is stdio only. Claude Code spawns the server as a subprocess — no ports, no HTTP.

The `instructions` field in the `Server` constructor is injected into Claude's system prompt. Keep it clear, actionable, and under 100 words.

## SQLite rules

Bus file: `~/.cc-dm/bus.db`

Always set on connection:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
```

Two tables only: `sessions` and `messages`. No others.

Poll interval: 500ms per session instance.

## Do's

- Use `bun:sqlite` for all database access
- Use `@modelcontextprotocol/sdk` `Server` and `StdioServerTransport`
- Keep tool count at 4 maximum: `dm`, `who`, `register`, `broadcast`
- Write TypeScript with strict mode enabled
- Handle SQLite errors gracefully — bus corruption must not crash the server
- Ensure the poll loop does not block the stdio transport

## Don'ts

- Do not use Node.js APIs — this is a Bun project
- Do not use any ORM or query builder — raw SQL only
- Do not add external dependencies beyond `@modelcontextprotocol/sdk`
- Do not expose any network port — stdio only, local machine only
- Do not implement pairing codes or allowlists — all local sessions are trusted by default
- Do not use HTTP transport — stdio only
- Do not bloat the `instructions` string passed to Claude — keep it under 100 words

## Testing

Test with:

```bash
claude --dangerously-load-development-channels server:cc-dm
```

Open 2+ terminal sessions to verify message delivery end-to-end. Use `fakechat` as reference for channel behavior if needed.

---

**Note:** Channels is a research preview feature. The notification protocol contract may change. If something breaks, check the [channels reference](https://code.claude.com/docs/en/channels-reference) first before debugging the code.
