# cc-dm

Peer-to-peer direct messaging between Claude Code sessions.

## What it does

Running multiple Claude Code sessions in parallel — a planner, a backend worker, a test runner — means context constantly needs to move between terminals. The default workflow is copy-paste: pull text from one session, switch windows, paste into another, lose formatting, lose thread.

cc-dm lets any session DM any other session on the same machine. Messages are delivered as native `<channel>` events within 500ms via the Claude Code Channels protocol, landing directly in the receiving session's context window.

## How it works

```
  Session A (planner)  ──┐
  Session B (backend)  ──┼──→  ~/.cc-dm/bus.db  (SQLite WAL)
  Session C (tests)    ──┘          ↑
                               500ms poll per session
                               → <channel> event pushed into context
```

Each session spawns a cc-dm channel server via stdio. The server connects to a shared SQLite database at `~/.cc-dm/bus.db`. When a session sends a message, it writes a row to the bus. Every other session's server polls the bus every 500ms, picks up messages addressed to it, and pushes them as `<channel>` events into its parent session. No daemon, no ports, no network. Just a shared file and a poll loop.

## Requirements

- **Claude Code** v2.1.80 or later
- **claude.ai login** — Channels requires cloud authentication, not API key auth
- **Bun** runtime ([bun.sh](https://bun.sh))
- **macOS** — primary supported platform

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Akram012388/cc-dm/main/install.sh | bash
```

## Quick alias

Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
alias cc-dm='claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace'
```

Then launch sessions with:

```bash
CC_DM_SESSION_NAME=planner CC_DM_SESSION_ROLE=orchestrator cc-dm
```

Or just `cc-dm` and register interactively via `/cc-dm:register`.

> **Note:** `--dangerously-skip-permissions` bypasses all tool permission prompts for the session, not just cc-dm's. Use with awareness.

## Usage

Start a session without the alias:

```bash
CC_DM_SESSION_NAME=planner CC_DM_SESSION_ROLE=orchestrator \
claude --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace
```

Once inside, use natural language:

> "Register this session as planner"

> "DM the backend session: auth spec is ready"

> "Who is active in cc-dm?"

> "Broadcast to all sessions: wrapping up in 10"

## Multi-session orchestration

Open two or more terminals and launch Claude Code with different session identities:

**Terminal 1 — Planner:**
```bash
CC_DM_SESSION_NAME=planner CC_DM_SESSION_ROLE=orchestrator claude --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace
```

**Terminal 2 — Backend:**
```bash
CC_DM_SESSION_NAME=backend CC_DM_SESSION_ROLE=worker claude --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace
```

Or skip the env vars and register interactively using `/cc-dm:register` after launch.

Sessions can now message each other directly, broadcast to all, and coordinate work across terminals.

## Session identity

Set these environment variables before launching:

- `CC_DM_SESSION_NAME` — your display name (e.g. `planner`, `backend`, `tests`)
- `CC_DM_SESSION_ROLE` — your role (e.g. `orchestrator`, `worker`, `reviewer`)

If not set, Claude will ask you to register via the `/cc-dm:register` skill on first interaction. Each session gets an auto-generated internal ID (`session-<random hex>`) used for message routing. Sessions send a heartbeat every 30 seconds. A session with no heartbeat for 60 seconds is automatically deleted from the roster. Undelivered messages expire after 15 seconds. No manual cleanup needed.

## Remote access

Claude Code has a built-in `/remote-control` feature that lets you access any session from the Claude iOS app. This pairs naturally with cc-dm — run multiple named sessions locally, drop into any one from your phone, and use cc-dm to coordinate between them.

## Bus inspection

Inspect the SQLite bus directly at any time:

```bash
bun -e "
  import { Database } from 'bun:sqlite';
  const db = new Database(process.env.HOME + '/.cc-dm/bus.db');
  console.log(db.query('SELECT * FROM sessions').all());
  console.log(db.query('SELECT * FROM messages').all());
"
```

## Releases

| Version | Date | Highlights |
|---------|------|------------|
| [v1.0.0](https://github.com/Akram012388/cc-dm/releases/tag/v1.0.0) | 2026-03-22 | Production release — duplicate delivery guard, same-name protection, stronger session IDs |
| [v0.3.0](https://github.com/Akram012388/cc-dm/releases/tag/v0.3.0) | 2026-03-22 | Fix MCP server path resolution for plugin marketplace installs |
| [v0.2.0](https://github.com/Akram012388/cc-dm/releases/tag/v0.2.0) | 2026-03-21 | 44-test suite, clean shutdown, bus hardening |
| [v0.1.0](https://github.com/Akram012388/cc-dm/releases/tag/v0.1.0) | 2026-03-21 | Initial release |

See [CHANGELOG.md](CHANGELOG.md) for full details.

## Development status

Built on Claude Code Channels (research preview, v2.1.80+). The `--dangerously-load-development-channels` flag is required until cc-dm is submitted to and approved by the official Channels marketplace. Breaking changes possible as the Channels protocol matures toward GA. Track: https://code.claude.com/docs/en/channels-reference

## Built by

Shaikh Akram Ahmed — architect turned builder, Muscat, Oman.
https://github.com/Akram012388

## Privacy

cc-dm operates entirely on your local machine. All data is stored in a local SQLite file (`~/.cc-dm/bus.db`). No data is transmitted over the network, no telemetry is collected, and no external services are contacted.

## License

MIT
