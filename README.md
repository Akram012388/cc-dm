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

## Usage

Start a session with cc-dm:

```bash
CC_DM_SESSION_ID=planner CC_DM_SESSION_ROLE=orchestrator \
claude --dangerously-load-development-channels server:cc-dm
```

Once inside, use natural language:

> "Register this session as planner"

> "DM the backend session: auth spec is ready"

> "Who is active in cc-dm?"

> "Broadcast to all sessions: wrapping up in 10"

## Session identity

Set these environment variables before launching:

- `CC_DM_SESSION_ID` — your session name (e.g. `planner`, `backend`, `tests`)
- `CC_DM_SESSION_ROLE` — your role (e.g. `orchestrator`, `worker`, `reviewer`)

If not set, the session ID defaults to `session-<random hex>` and the role defaults to `worker`. Sessions send a heartbeat every 30 seconds. A session with no heartbeat for 60 seconds is automatically marked inactive and removed from the roster. No manual cleanup needed.

## Remote access

Use `/remote-control` in any session to access it from the Claude iOS app. cc-dm session names map directly to remote control targets. Run multiple sessions locally, drop into any one from your phone.

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

## Development status

Built on Claude Code Channels (research preview, v2.1.80+). The `--dangerously-load-development-channels` flag is required until cc-dm is submitted to and approved by the official Channels marketplace. Breaking changes possible as the Channels protocol matures toward GA. Track: https://code.claude.com/docs/en/channels-reference

## Built by

Shaikh Akram Ahmed — architect turned builder, Muscat, Oman.
https://github.com/Akram012388

## License

MIT
