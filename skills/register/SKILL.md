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
3. Before proceeding, check the `who` results from the pre-check. If the requested name is already taken by another session, tell the user: **"That name is already in use."** Show the active session list and ask them to pick a different name. Repeat until available.
4. Ask the user: **"What role should this session have?"** (e.g., orchestrator, worker, reviewer, specialist)
5. Wait for their response.
6. Call the `register` tool with the provided `name` and `role`.
7. If the tool returns an error about the name being in use, show the error and ask the user to pick another name.
8. Confirm success: "Registered as **{name}** with role **{role}**."

If registration fails for any other reason, report the error clearly.
