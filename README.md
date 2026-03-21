# cc-dm

Direct peer-to-peer messaging between active Claude Code CLI sessions.

## What it does

If you run multiple Claude Code sessions in parallel — a planner, a backend worker, a frontend worker, a reviewer — you already know the pain. Context lives in one session but is needed in another. The workaround is copy-paste: pull text from one terminal, paste it into another, lose formatting, lose thread, lose flow.

cc-dm eliminates this. It lets any Claude Code session send a direct message to any other session on the same machine. Messages are delivered as native `<channel>` events through Anthropic's Claude Code Channels protocol, which means they land directly in the receiving session's context window — no clipboard, no manual relay, no context loss.

## How it works

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │  Session A   │   │  Session B   │   │  Session C   │
 │  "planner"   │   │  "backend"   │   │  "frontend"  │
 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
        │                  │                   │
        │    stdio         │    stdio          │    stdio
        │                  │                   │
 ┌──────▼───────┐   ┌──────▼───────┐   ┌──────▼───────┐
 │  cc-dm       │   │  cc-dm       │   │  cc-dm       │
 │  channel     │   │  channel     │   │  channel     │
 │  server      │   │  server      │   │  server      │
 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
        │                  │                   │
        └──────────────────┼───────────────────┘
                           │
                    ┌──────▼───────┐
                    │              │
                    │   bus.db     │
                    │              │
                    │ ~/.cc-dm/    │
                    └──────────────┘
```

Each Claude Code session launches a cc-dm channel server as a subprocess via stdio. The channel server connects to a shared SQLite database at `~/.cc-dm/bus.db`. When a session sends a message, it writes a row to the bus. Every other session's channel server polls the bus every 500ms, picks up new messages addressed to it, and pushes them into its parent session as `<channel>` events. The receiving Claude sees the message appear in context as if it arrived from any other channel source.

No daemon. No port allocation. No network stack. Just a shared file and a poll loop.

## Requirements

- **Claude Code** v2.1.80 or later (Channels protocol support)
- **claude.ai login** — Channels requires cloud authentication, not API key auth
- **Bun** runtime
- **macOS** — primary supported platform; Linux is untested but may work

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Akram012388/cc-dm/main/install.sh | bash
```

## Usage

### Start a session with cc-dm

```bash
claude --dangerously-load-development-channels server:cc-dm
```

### Register a session name

Once inside a session, tell Claude naturally:

> "Register this session as 'planner' in cc-dm."

### Send a direct message

> "DM the backend session: the auth spec is ready, you can start implementation."

### Broadcast to all sessions

> "Broadcast to all sessions: standup in 5 minutes."

### Check who's online

> "Who's active in cc-dm?"

## Session lifecycle

Sessions register themselves with the bus on startup, claiming a human-readable name. Each session sends a heartbeat every 30 seconds to signal that it is still alive. If a session goes 60 seconds without a heartbeat — because the terminal was closed, the process was killed, or the machine went to sleep — it is automatically marked as expired and removed from the active roster. There is no manual cleanup. Start sessions, use them, close them. The bus takes care of the rest.

## Remote access

Any cc-dm session can be accessed remotely from the Claude iOS app using the `/remote-control` command. Run `/remote-control` inside a session to make it available as a remote control target. Session names registered in cc-dm map one-to-one to remote control targets, so you can address sessions by name from your phone.

## Development status

cc-dm is a research preview. It is built on Claude Code Channels, which is itself a research preview introduced in Claude Code v2.1.80. The Channels protocol may change, and cc-dm will change with it. Expect breaking changes. Pin versions if stability matters to you.

## Built by

Akram Al-Balushi — architect turned builder, Muscat, Oman.

## License

MIT
