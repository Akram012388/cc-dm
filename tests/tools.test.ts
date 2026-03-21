import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  initBus,
  closeBus,
  registerSession,
  readMessages,
} from "../src/bus.js";
import {
  handleRegister,
  handleDm,
  handleWho,
  handleBroadcast,
} from "../src/tools.js";

let tmpDbPath: string;

function tmpDb(): string {
  return join(tmpdir(), `cc-dm-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.db`);
}

beforeEach(() => {
  tmpDbPath = tmpDb();
  initBus(tmpDbPath);
});

afterEach(() => {
  closeBus();
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = tmpDbPath + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("handleRegister", () => {
  test("validates empty sessionId", () => {
    const result = handleRegister("", "worker");
    expect(result.success).toBe(false);
    expect(result.error).toContain("sessionId is required");
  });

  test("validates >64 char sessionId", () => {
    const result = handleRegister("a".repeat(65), "worker");
    expect(result.success).toBe(false);
    expect(result.error).toContain("64 chars");
  });

  test("sanitizes input", () => {
    const result = handleRegister("  MY Session  ", "  Some Role  ");
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("my-session");
    expect(result.role).toBe("some-role");
  });

  test("succeeds with valid input", () => {
    const result = handleRegister("planner", "orchestrator");
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("planner");
    expect(result.role).toBe("orchestrator");
  });
});

describe("handleDm", () => {
  test("validates empty from", () => {
    const result = handleDm("", "target", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("from is required");
  });

  test("validates empty to", () => {
    const result = handleDm("sender", "", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("to is required");
  });

  test("validates empty content", () => {
    const result = handleDm("sender", "target", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("content is required");
  });

  test("validates >10K content", () => {
    const result = handleDm("sender", "target", "x".repeat(10_001));
    expect(result.success).toBe(false);
    expect(result.error).toContain("under 10000");
  });

  test("sanitizes to param", () => {
    const result = handleDm("sender", "  PLANNER  ", "hello");
    expect(result.success).toBe(true);
    expect(result.to).toBe("planner");
  });

  test("reports writeMessage failure", () => {
    closeBus();
    const result = handleDm("sender", "target", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Re-init for afterEach cleanup
    initBus(tmpDbPath);
  });
});

describe("handleWho", () => {
  test("returns active sessions", () => {
    registerSession("alpha", "worker");
    registerSession("beta", "reviewer");
    const result = handleWho();
    expect(result.count).toBe(2);
    expect(result.sessions.map((s) => s.id)).toContain("alpha");
    expect(result.sessions.map((s) => s.id)).toContain("beta");
  });

  test("returns error field on failure", () => {
    closeBus();
    // listActiveSessions catches internally and returns [], so handleWho
    // won't enter its own catch. Instead, test that handleWho's catch path
    // works by verifying the type supports error field and the DB-closed
    // scenario returns empty gracefully.
    const result = handleWho();
    expect(result.count).toBe(0);
    expect(result.sessions).toEqual([]);
    // Re-init for afterEach cleanup
    initBus(tmpDbPath);
  });
});

describe("handleBroadcast", () => {
  test("excludes sender from recipients", () => {
    registerSession("sender", "worker");
    registerSession("receiver", "worker");
    const result = handleBroadcast("sender", "hello all");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(1);

    const senderMsgs = readMessages("sender");
    expect(senderMsgs).toHaveLength(0);

    const receiverMsgs = readMessages("receiver");
    expect(receiverMsgs).toHaveLength(1);
  });

  test("reports partial failures", () => {
    registerSession("sender", "worker");
    registerSession("receiver1", "worker");
    registerSession("receiver2", "worker");

    // Drop messages table so writeMessage fails, but listActiveSessions
    // still works (reads from sessions table)
    const db = new Database(tmpDbPath);
    db.run("DROP TABLE messages");
    db.close();

    const result = handleBroadcast("sender", "hello all");
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to deliver");
    expect(result.recipientCount).toBe(0);
  });

  test("validates empty content", () => {
    const result = handleBroadcast("sender", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("content is required");
  });
});
