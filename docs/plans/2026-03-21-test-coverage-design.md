# Test Coverage Design — cc-dm

**Date:** 2026-03-21
**Scope:** Unit + Integration tests
**Framework:** `bun:test` (built-in, zero config)
**Branch:** `feat/test-coverage`

## Structure

```
tests/
  bus.test.ts          # Unit tests for bus.ts
  tools.test.ts        # Unit tests for tools.ts
  heartbeat.test.ts    # Unit tests for heartbeat.ts
  integration.test.ts  # Multi-session integration tests
```

- Each test file uses a temp DB, not `~/.cc-dm/bus.db`
- `beforeEach` creates a fresh SQLite DB
- `afterEach` cleans up
- No mocks for DB — real SQLite throughout
- Add `"test": "bun test"` to package.json scripts

## Unit Tests

### bus.test.ts — Data layer (14 tests)

| Test | Verifies |
|------|----------|
| initBus creates tables | sessions + messages tables exist after init |
| initBus throws on fatal error | Corrupt/invalid path causes throw, not silent swallow |
| registerSession inserts new session | Session appears in DB with correct fields |
| registerSession upserts on conflict | Re-register updates role and last_seen |
| updateHeartbeat updates last_seen | Timestamp advances after heartbeat |
| expireStaleSessions marks old sessions inactive | Sessions with last_seen > 60s ago become inactive |
| expireStaleSessions cleans delivered messages > 1hr | Old delivered messages are deleted |
| writeMessage returns true on success | Message row created, returns true |
| writeMessage returns false on error | DB error returns false, doesn't throw |
| readMessages returns undelivered messages | Only delivered=0 messages for target session |
| readMessages marks messages as delivered | After read, same query returns empty |
| readMessages is transactional | Concurrent reads don't duplicate messages |
| readMessages orders by id ASC | Insertion order preserved |
| listActiveSessions returns only active | Inactive sessions excluded |

### tools.test.ts — Business logic (13 tests)

| Test | Verifies |
|------|----------|
| handleRegister validates empty sessionId | Returns error |
| handleRegister validates >64 char sessionId | Returns error |
| handleRegister sanitizes input | Uppercase/spaces become lowercase-hyphenated |
| handleRegister succeeds | Returns success with clean id and role |
| handleDm validates empty fields | from, to, content each checked |
| handleDm validates >10K content | Returns error |
| handleDm sanitizes `to` param | "  PLANNER  " becomes "planner" |
| handleDm reports writeMessage failure | Returns success:false when DB write fails |
| handleWho returns active sessions | Lists registered sessions |
| handleWho returns error field on failure | Distinguishes empty vs failed |
| handleBroadcast excludes sender | Sender not in recipient list |
| handleBroadcast reports partial failures | Tracks failure count |
| handleBroadcast validates empty content | Returns error |

### heartbeat.test.ts — Lifecycle (5 tests)

| Test | Verifies |
|------|----------|
| startHeartbeat rejects empty sessionId | Logs error, returns early |
| startHeartbeat writes initial heartbeat | last_seen updated immediately |
| startHeartbeat runs initial cleanup | expireStaleSessions called on start |
| stopHeartbeat clears all timers | No more heartbeat writes after stop |
| startHeartbeat is idempotent | Calling twice stops previous timers first |

## Integration Tests

### integration.test.ts — Multi-session flows (10 tests)

| Test | Verifies |
|------|----------|
| Full DM flow | Register 2 sessions, send DM, recipient reads, marked delivered |
| Broadcast delivery | Register 3 sessions, broadcast from one, other 2 receive, sender doesn't |
| Broadcast per-recipient isolation | Session A reads its broadcast, Session B's copy still undelivered |
| Session expiry cuts off delivery | Expired session not in `who`, DM sits undelivered |
| Re-registration recovers session | Expired session re-registers, picks up queued messages |
| Message ordering across senders | Multiple senders to one recipient, read in insertion order |
| Sanitization consistency | Register "planner", DM to "  PLANNER  ", message arrives |
| Concurrent reads don't duplicate | Parallel reads deliver each message exactly once |
| Large content boundary | 10,000 chars succeeds, 10,001 fails |
| Self-message | Session DMs itself, message is readable |

## Totals

- **42 test cases** (14 + 13 + 5 + 10)
- **0 external dependencies** — bun:test + bun:sqlite only
- **0 mocks** for DB — real SQLite in temp files
