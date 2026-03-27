---
name: cc-dm
description: Send and receive direct messages between active Claude Code sessions on this machine. Use when the user asks to dm, message, notify, broadcast, check who is active, or manage project-scoped messaging across sessions.
---

# cc-dm — Claude Code Direct Message

cc-dm is a peer-to-peer message bus for Claude Code sessions running on
the same machine. Use it to coordinate between parallel sessions without
copy-pasting context manually.

## On startup

Session registration is handled automatically from environment variables
(CC_DM_SESSION_NAME, CC_DM_SESSION_ROLE, CC_DM_SESSION_PROJECT). Check
the MCP instructions to see if name, role, and project are already configured:

- **Name and role configured:** Do nothing. Registration is complete.
- **Either missing:** Invoke the /cc-dm:register skill on first interaction
  to ask the user for the missing value(s). Never guess or self-assign.

## Sending a direct message

When the user says "dm [session] [message]" or "tell [session] [message]":

  Use the dm tool.
  Example: dm(to="backend", content="auth spec is ready")
  With metadata: dm(to="backend", content="deploy broken", priority="urgent", message_type="status")

Optional metadata fields on dm and broadcast:
- priority: "urgent", "normal", or "low"
- message_type: "task", "question", "status", or "review"
- thread_id: string (max 64 chars) for grouping related messages

These appear as attributes on the <channel> tag the receiver sees.

If this session has a project tag set, DMs can only reach sessions in the
same project. A DM to a session outside the project will return an error.
The message is delivered to the target session within 500ms.
You do not need to wait for a reply — continue your work.

## Receiving a message

Incoming messages arrive as a <channel> event in your context:

  <channel source="cc-dm" from_session="planner" to_session="backend">
    auth spec is ready
  </channel>

When you receive a <channel> event:
1. Acknowledge it briefly in your response
2. Act on the instruction if it is addressed to your session name
3. Optionally reply using the dm tool

## Broadcasting

When the user says "broadcast [message]" or "tell all sessions [message]":

  Use the broadcast tool.
  Example: broadcast(content="wrapping up in 10 minutes")

If this session has a project tag set, both broadcasts and DMs are
automatically scoped to sessions with the same project tag. Sessions
without a project tag can broadcast and DM any active session.

## Checking who is online

When the user asks "who is active" or "who is online" or "list sessions":

  Use the who tool.
  It returns all sessions with active heartbeats on this machine.

## After compaction

When `/compact` or auto-compaction occurs, you may lose awareness of your
session identity. Your MCP server process survives compaction — the session
ID, DB registration, and heartbeat all persist. Every tool response includes
an `_identity` field with your current name, role, and project, so the first
cc-dm tool call after compaction restores your identity. Do NOT re-register.

If you are unsure of your identity, call the `who` tool and match your
session ID (from the MCP instructions) against the results.

## Permission relay

If this session has `CC_DM_PERMISSION_RELAY=1` enabled, tool approval
requests are relayed to other sessions instead of showing a local dialog.
When you receive a permission request from another session, it will look like:

  [Permission Request] Session "worker" wants to use Bash:
    Execute a shell command
    Request ID: abcde

  Reply with "yes abcde" to approve or "no abcde" to deny.

To approve or deny, use the dm tool with the exact verdict format:
  dm(to="worker", content="yes abcde")  — to approve
  dm(to="worker", content="no abcde")   — to deny

## Access control

DMs and broadcasts may be restricted by env var configuration:
- If a DM fails with "not in this session's DM allowlist", the target
  is not on this session's allowed list. Ask the user to check env vars.
- If a broadcast fails with "not permitted to broadcast", this session's
  role is not in the allowed broadcast roles.

## Troubleshooting

If messages aren't arriving:
1. Call `who` — verify your session is listed and last_seen is recent
2. If not listed, call `register` to re-register
3. If listed but messages still missing, check project scoping — you may be
   in a different project from the sender
4. Messages expire after 15 seconds — if the sender sent the message more
   than 15s ago, it's gone
5. If your session name shows as your session ID (session-XXXXXX) after
   waking from sleep, your name may have been taken during the ghost window.
   Call `register` to pick a new name.

If you get "not configured" after compaction, call `who` to recover your
identity.

## Rules

- Never use console.log — you are inside an MCP stdio session
- Do not poll manually — messages arrive automatically via the channel
- Do not register more than once — registration persists across compaction
- If a dm fails, report the error and move on — do not retry in a loop
- Messages to offline sessions expire after 15 seconds if undelivered
