---
name: register
description: Register this session with cc-dm — sets your session name and role
disable-model-invocation: true
---

# Register Session

Walk the user through registering their session with cc-dm.

## Steps

1. Ask the user: **"What session name would you like to use?"** (e.g., planner, backend, reviewer, tests)
2. Wait for their response.
3. Ask the user: **"What role should this session have?"** (e.g., orchestrator, worker, reviewer, specialist)
4. Wait for their response.
5. Call the `register` tool with the provided `session_id` and `role`.
6. Confirm success: "Registered as **{session_id}** with role **{role}**."

If registration fails, report the error clearly.
