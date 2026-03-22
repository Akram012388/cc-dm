---
name: register
description: Register this session with cc-dm — sets your session name and role. Auto-invoked on first interaction if session name or role is missing.
---

# Register Session

Register this session with a user-chosen name and role.

## Pre-check (gate)

Before prompting the user, determine if registration is needed:

1. Read your session id from the MCP server instructions (the `"Your session id is ..."` line).
2. Call the `who` tool to list active sessions.
3. Find your session id in the results.
   - If your session's `name` is different from your session id (i.e. not `session-XXXXXX`), registration was already done. **Stop here silently — do not prompt the user.**
   - If your session is not found or its name still equals the auto-generated id, proceed to registration.

## Registration steps

1. Ask the user: **"What session name would you like to use?"** (e.g., planner, backend, reviewer, tests)
2. Wait for their response.
3. Ask the user: **"What role should this session have?"** (e.g., orchestrator, worker, reviewer, specialist)
4. Wait for their response.
5. Call the `register` tool with the provided `name` and `role`.
6. Confirm success: "Registered as **{name}** with role **{role}**."

If registration fails, report the error clearly.
