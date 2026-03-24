---
name: cc-dm
description: Send and receive direct messages between active Claude Code sessions on this machine. Use when the user asks to dm, message, notify, broadcast, or check who is active across sessions.
---

# cc-dm — Claude Code Direct Message

cc-dm is a peer-to-peer message bus for Claude Code sessions running on
the same machine. Use it to coordinate between parallel sessions without
copy-pasting context manually.

## On startup

Session registration is handled automatically from environment variables
(CC_DM_SESSION_NAME, CC_DM_SESSION_ROLE, CC_DM_SESSION_PROJECT). Check
the MCP instructions to see if name, role, and project are already configured:

- **Both configured:** Do nothing. Registration is complete.
- **Either missing:** Invoke the /cc-dm:register skill on first interaction
  to ask the user for the missing value(s). Never guess or self-assign.

## Sending a direct message

When the user says "dm [session] [message]" or "tell [session] [message]":

  Use the dm tool.
  Example: dm(to="backend", content="auth spec is ready")

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

If this session has a project tag set, broadcasts are automatically scoped
to sessions with the same project tag. Sessions without a project tag
broadcast to all active sessions.

## Checking who is online

When the user asks "who is active" or "who is online" or "list sessions":

  Use the who tool.
  It returns all sessions with active heartbeats on this machine.

## Rules

- Never use console.log — you are inside an MCP stdio session
- Do not poll manually — messages arrive automatically via the channel
- Do not register more than once per session startup
- If a dm fails, report the error and move on — do not retry in a loop
- Messages to offline sessions expire after 15 seconds if undelivered
