---
name: cc-dm
description: Use cc-dm to send and receive direct messages between active Claude Code sessions on this machine
triggers:
  - "dm"
  - "direct message"
  - "message the"
  - "tell the"
  - "notify"
  - "broadcast"
  - "who is active"
  - "who is online"
  - "cc-dm"
---

# cc-dm — Claude Code Direct Message

cc-dm is a peer-to-peer message bus for Claude Code sessions running on
the same machine. Use it to coordinate between parallel sessions without
copy-pasting context manually.

## On startup

Always register this session when cc-dm is available:

  Use the register tool to register this session.
  Use the current session name as session_id and a short role description.
  Example: register(session_id="planner", role="orchestrator")

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
2. Act on the instruction if it is addressed to your session id
3. Optionally reply using the dm tool

## Broadcasting

When the user says "broadcast [message]" or "tell all sessions [message]":

  Use the broadcast tool.
  Example: broadcast(content="wrapping up in 10 minutes")

## Checking who is online

When the user asks "who is active" or "who is online" or "list sessions":

  Use the who tool.
  It returns all sessions with active heartbeats on this machine.

## Rules

- Never use console.log — you are inside an MCP stdio session
- Do not poll manually — messages arrive automatically via the channel
- Do not register more than once per session startup
- If a dm fails, report the error and move on — do not retry in a loop
- Messages to offline sessions are queued and delivered when they reconnect
