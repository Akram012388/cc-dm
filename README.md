# cc-dm

[![npm version](https://img.shields.io/npm/v/cc-dm.svg)](https://www.npmjs.com/package/cc-dm)
[![license](https://img.shields.io/npm/l/cc-dm.svg)](https://github.com/Akram012388/cc-dm/blob/main/LICENSE)

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

## Quick Start

Start a new Claude Code session and enter the following commands:

```
/plugin marketplace add cc-dm-marketplace
/plugin install cc-dm
```

Restart Claude Code. The cc-dm tools and skills will be available in all sessions.

## Install (alternative methods)

**Via npm** (requires [Bun](https://bun.sh)):

```bash
npm install cc-dm
```

The npm package contains the full plugin source. After installing, follow the [Quick Start](#quick-start) above to register the plugin with Claude Code.

> **Note:** cc-dm is a Claude Code channel plugin, not a standalone library. The npm package exists for discoverability and as a distribution mirror — the primary install method is the plugin marketplace above.

**Via curl:**

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
CC_DM_SESSION_NAME=planner CC_DM_SESSION_ROLE=orchestrator CC_DM_SESSION_PROJECT=myapp cc-dm
```

Or just `cc-dm` and register interactively via `/cc-dm:register`.

> **Note:** `--dangerously-skip-permissions` bypasses all tool permission prompts for the session, not just cc-dm's. Use with awareness.

## Usage

Start a session without the alias:

```bash
CC_DM_SESSION_NAME=planner CC_DM_SESSION_ROLE=orchestrator CC_DM_SESSION_PROJECT=myapp \
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
CC_DM_SESSION_NAME=planner CC_DM_SESSION_ROLE=orchestrator CC_DM_SESSION_PROJECT=myapp claude --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace
```

**Terminal 2 — Backend:**
```bash
CC_DM_SESSION_NAME=backend CC_DM_SESSION_ROLE=worker CC_DM_SESSION_PROJECT=myapp claude --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace
```

Or skip the env vars and register interactively using `/cc-dm:register` after launch.

Sessions can now message each other directly, broadcast to all, and coordinate work across terminals.

## Session identity

Set these environment variables before launching:

- `CC_DM_SESSION_NAME` — your display name (e.g. `planner`, `backend`, `tests`)
- `CC_DM_SESSION_ROLE` — your role (e.g. `orchestrator`, `worker`, `reviewer`)
- `CC_DM_SESSION_PROJECT` — optional project tag (e.g. `myapp`, `api-server`)

See also: [Message metadata](#message-metadata), [Permission relay](#permission-relay), [Access control](#access-control) for optional env vars that enable advanced features.

If not set, Claude will ask you to register via the `/cc-dm:register` skill on first interaction. Each session gets an auto-generated internal ID (`session-<random hex>`) used for message routing. Sessions send a heartbeat every 30 seconds. A session with no heartbeat for 60 seconds is automatically deleted from the roster. Undelivered messages expire after 15 seconds. No manual cleanup needed.

> **Recommended naming convention:** Use `[project]-[name]` for session names, e.g. `myapp-planner`, `myapp-backend`, `myapp-tests`. Keep the prefix consistent across all workers in the same project and ensure it matches the `CC_DM_SESSION_PROJECT` value. This makes `who` output immediately scannable and helps Claude associate sessions with their project context at a glance.

## Project-scoped messaging

When working across multiple projects or worktrees, both broadcasts and DMs can be scoped to a project. Sessions with a `project` tag can only message other sessions with the same tag. Sessions without a project can message anyone (global, the default).

```bash
# Terminal 1 — frontend worker on myapp
CC_DM_SESSION_NAME=frontend CC_DM_SESSION_ROLE=worker CC_DM_SESSION_PROJECT=myapp cc-dm

# Terminal 2 — backend worker on myapp
CC_DM_SESSION_NAME=backend CC_DM_SESSION_ROLE=worker CC_DM_SESSION_PROJECT=myapp cc-dm

# Terminal 3 — worker on a different project
CC_DM_SESSION_NAME=api-dev CC_DM_SESSION_ROLE=worker CC_DM_SESSION_PROJECT=api-server cc-dm
```

A broadcast from `frontend` reaches `backend` but not `api-dev`. A DM from `frontend` can reach `backend` (same project) but not `api-dev` (different project). A session without a project tag can broadcast and DM any active session — project scoping only restricts outbound messages from sessions that have a tag set.

You can also set the project interactively via `/cc-dm:register` — the skill shows active project tags so you can pick an existing one.

> **Note:** Project scoping is an opinionated default designed for structured multi-project workflows. You can override it at any time — use `/cc-dm:register` or say "register" to change a session's project tag, clear it for global access, or scope it to a different project. This lets you mix isolation styles: keep most workers scoped to their project while leaving a coordinator session global, or temporarily remove a session's project tag when it needs to reach across boundaries.

## Message metadata

The `dm` and `broadcast` tools accept optional metadata fields that are delivered as attributes on the `<channel>` tag:

- **`priority`** — `urgent`, `normal`, or `low`
- **`message_type`** — `task`, `question`, `status`, or `review`
- **`thread_id`** — any string (max 64 chars) to group related messages into a conversation thread

These are purely informational — they don't change delivery behavior. The receiving session's Claude uses them to prioritize, filter, or group messages contextually. If omitted, messages work exactly as before.

> **Example:** `dm(to="backend", content="deploy is broken", priority="urgent", message_type="status")` delivers with `priority="urgent"` and `message_type="status"` visible in the channel event attributes.

## Permission relay

Enables one session to remotely approve or deny tool calls for another session, using the Claude Code Channels `claude/channel/permission` protocol capability. Completely opt-in — off by default.

**Setup:** Add these env vars when launching a worker session that needs remote approval:

```bash
CC_DM_PERMISSION_RELAY=1 \
CC_DM_PERMISSION_APPROVER=orchestrator \
CC_DM_SESSION_NAME=worker CC_DM_SESSION_ROLE=worker CC_DM_SESSION_PROJECT=myapp \
claude --dangerously-load-development-channels plugin:cc-dm@cc-dm-marketplace
```

**How it works:**
1. Worker wants to run a tool (e.g., `Bash rm -rf dist/`)
2. Instead of showing a local approval dialog, cc-dm relays the request to the `orchestrator` session
3. Orchestrator sees: *"Session worker wants to use Bash... Reply with `yes abcde` or `no abcde`"*
4. Orchestrator replies with the verdict — worker's tool call is approved or denied

If `CC_DM_PERMISSION_APPROVER` is not set, the request broadcasts to all project sessions — first response wins. The local terminal approval dialog is always available as a fallback.

| Env var | Required? | Purpose |
|---------|-----------|---------|
| `CC_DM_PERMISSION_RELAY=1` | Yes | Enables the relay; without this, nothing changes |
| `CC_DM_PERMISSION_APPROVER` | No | Name of the session that approves (omit for broadcast) |

## Access control

Optional sender-side restrictions on who can broadcast and who you can DM. All env vars are parsed at session startup — no runtime changes.

```bash
# Only orchestrators and architects can broadcast from this session
CC_DM_BROADCAST_ALLOWED_ROLES=orchestrator,architect

# This session can only DM these specific sessions
CC_DM_DM_ALLOWLIST=planner,reviewer

# OR: this session can DM anyone EXCEPT these (mutually exclusive with allowlist)
CC_DM_DM_BLOCKLIST=intern
```

| Env var | Purpose |
|---------|---------|
| `CC_DM_BROADCAST_ALLOWED_ROLES` | Comma-separated roles allowed to broadcast. Empty = no restriction. |
| `CC_DM_DM_ALLOWLIST` | Comma-separated session names this session can DM. Empty = no restriction. |
| `CC_DM_DM_BLOCKLIST` | Comma-separated session names this session cannot DM. Empty = no restriction. |

`CC_DM_DM_ALLOWLIST` and `CC_DM_DM_BLOCKLIST` are mutually exclusive — setting both causes a fatal error at startup. If neither is set, the session can DM anyone in its project (the default behavior).

> **Note:** Access control is sender-side only. It restricts what THIS session can send, not what it can receive. A session blocked by your allowlist can still DM you.

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
| [v1.3.0](https://github.com/Akram012388/cc-dm/releases/tag/v1.3.0) | 2026-03-27 | Message metadata, permission relay, role-based access control |
| [v1.2.0](https://github.com/Akram012388/cc-dm/releases/tag/v1.2.0) | 2026-03-27 | Compaction resilience, heartbeat self-heal |
| [v1.1.0](https://github.com/Akram012388/cc-dm/releases/tag/v1.1.0) | 2026-03-24 | Project-scoped messaging, [npm package](https://www.npmjs.com/package/cc-dm) published |
| [v1.0.0](https://github.com/Akram012388/cc-dm/releases/tag/v1.0.0) | 2026-03-22 | Production release — duplicate delivery guard, same-name protection, stronger session IDs |
| [v0.3.0](https://github.com/Akram012388/cc-dm/releases/tag/v0.3.0) | 2026-03-22 | Fix MCP server path resolution for plugin marketplace installs |
| [v0.2.0](https://github.com/Akram012388/cc-dm/releases/tag/v0.2.0) | 2026-03-21 | 44-test suite, clean shutdown, bus hardening |
| [v0.1.0](https://github.com/Akram012388/cc-dm/releases/tag/v0.1.0) | 2026-03-21 | Initial release |

See [CHANGELOG.md](CHANGELOG.md) for full details.

## Known limitations

**System sleep recovery:** When a laptop sleeps for more than 60 seconds, all cc-dm sessions are marked stale and deleted from the bus by the next cleanup cycle. The heartbeat self-heals automatically — each session re-registers within ~30 seconds of waking. During that window, the session is unreachable via DM or broadcast but the MCP server process continues running. No manual intervention is needed.

## Development status

Built on Claude Code Channels (research preview, v2.1.80+). The `--dangerously-load-development-channels` flag is required until cc-dm is submitted to and approved by the official Channels marketplace. Breaking changes possible as the Channels protocol matures toward GA. Track: https://code.claude.com/docs/en/channels-reference

## Built by

Shaikh Akram Ahmed — architect turned builder, Muscat, Oman.
https://github.com/Akram012388

## Privacy

cc-dm operates entirely on your local machine. All data is stored in a local SQLite file (`~/.cc-dm/bus.db`). No data is transmitted over the network, no telemetry is collected, and no external services are contacted.

## License

MIT
