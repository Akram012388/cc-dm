import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  initBus,
  closeBus,
  registerSession,
  readPendingMessages,
  deleteDeliveredMessage,
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
  test("validates empty name", () => {
    const result = handleRegister("test-id", "", "worker");
    expect(result.success).toBe(false);
    expect(result.error).toContain("name is required");
  });

  test("validates >64 char name", () => {
    const result = handleRegister("test-id", "a".repeat(65), "worker");
    expect(result.success).toBe(false);
    expect(result.error).toContain("64 chars");
  });

  test("sanitizes input", () => {
    const result = handleRegister("test-id", "  MY Session  ", "  Some Role  ");
    expect(result.success).toBe(true);
    expect(result.name).toBe("my-session");
    expect(result.role).toBe("some-role");
  });

  test("succeeds with valid input", () => {
    const result = handleRegister("test-id", "planner", "orchestrator");
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("test-id");
    expect(result.name).toBe("planner");
    expect(result.role).toBe("orchestrator");
    expect(result.project).toBe("");
  });

  test("accepts optional project", () => {
    const result = handleRegister("test-id", "planner", "orchestrator", "myapp");
    expect(result.success).toBe(true);
    expect(result.project).toBe("myapp");
  });

  test("sanitizes project", () => {
    const result = handleRegister("test-id", "planner", "orchestrator", "  MY App  ");
    expect(result.success).toBe(true);
    expect(result.project).toBe("my-app");
  });

  test("validates >64 char project", () => {
    const result = handleRegister("test-id", "planner", "worker", "a".repeat(65));
    expect(result.success).toBe(false);
    expect(result.error).toContain("project must be 64 chars");
  });

  test("error results include empty project field", () => {
    const emptyName = handleRegister("id", "", "worker", "myapp");
    expect(emptyName.project).toBe("");

    const emptyRole = handleRegister("id", "name", "", "myapp");
    expect(emptyRole.project).toBe("");
  });

  test("empty string project treated same as omitted", () => {
    const omitted = handleRegister("id-1", "alice", "worker");
    const empty = handleRegister("id-2", "bob", "worker", "");
    expect(omitted.project).toBe("");
    expect(empty.project).toBe("");
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

  test("resolves target by name and sanitizes", () => {
    registerSession("id-planner", "planner", "worker", "/tmp");
    const result = handleDm("sender", "  PLANNER  ", "hello");
    expect(result.success).toBe(true);
    expect(result.to).toBe("planner");
  });

  test("fails when target name not found", () => {
    const result = handleDm("sender", "nonexistent", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("no active session with that name");
  });

  test("reports error on closed bus", () => {
    closeBus();
    const result = handleDm("sender", "target", "hello");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Re-init for afterEach cleanup
    initBus(tmpDbPath);
  });
});

describe("handleWho", () => {
  test("returns active sessions with all fields", () => {
    registerSession("id-alpha", "alpha", "worker", "/project-a");
    registerSession("id-beta", "beta", "reviewer", "/project-b");
    const result = handleWho();
    expect(result.count).toBe(2);
    expect(result.sessions.map((s) => s.name)).toContain("alpha");
    expect(result.sessions.map((s) => s.name)).toContain("beta");
    const alpha = result.sessions.find((s) => s.name === "alpha")!;
    expect(alpha.id).toBe("id-alpha");
    expect(alpha.cwd).toBe("/project-a");
  });

  test("returns error field on failure", () => {
    closeBus();
    const result = handleWho();
    expect(result.count).toBe(0);
    expect(result.sessions).toEqual([]);
    // Re-init for afterEach cleanup
    initBus(tmpDbPath);
  });
});

describe("handleBroadcast", () => {
  test("excludes sender from recipients", () => {
    registerSession("id-sender", "sender", "worker", "/tmp");
    registerSession("id-receiver", "receiver", "worker", "/tmp");
    const result = handleBroadcast("id-sender", "sender", "hello all");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(1);

    const senderMsgs = readPendingMessages("id-sender");
    expect(senderMsgs).toHaveLength(0);

    const receiverMsgs = readPendingMessages("id-receiver");
    expect(receiverMsgs).toHaveLength(1);
    expect(receiverMsgs[0].from_session).toBe("sender");
  });

  test("reports partial failures", () => {
    registerSession("id-sender", "sender", "worker", "/tmp");
    registerSession("id-r1", "receiver1", "worker", "/tmp");
    registerSession("id-r2", "receiver2", "worker", "/tmp");

    // Drop messages table so writeMessage fails, but listActiveSessions
    // still works (reads from sessions table)
    const db = new Database(tmpDbPath);
    db.run("DROP TABLE messages");
    db.close();

    const result = handleBroadcast("id-sender", "sender", "hello all");
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to deliver");
    expect(result.recipientCount).toBe(0);
  });

  test("validates empty content", () => {
    const result = handleBroadcast("id-sender", "sender", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("content is required");
  });

  test("project-scoped broadcast only reaches same-project sessions", () => {
    registerSession("id-a", "alice", "worker", "/tmp", "myapp");
    registerSession("id-b", "bob", "worker", "/tmp", "myapp");
    registerSession("id-c", "charlie", "worker", "/tmp", "other");
    registerSession("id-d", "dave", "worker", "/tmp");

    const result = handleBroadcast("id-a", "alice", "myapp update", "myapp");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(1); // only bob

    const bobMsgs = readPendingMessages("id-b");
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].content).toBe("myapp update");

    const charlieMsgs = readPendingMessages("id-c");
    expect(charlieMsgs).toHaveLength(0);

    const daveMsgs = readPendingMessages("id-d");
    expect(daveMsgs).toHaveLength(0);
  });

  test("global broadcast (no project) reaches all sessions", () => {
    registerSession("id-a", "alice", "worker", "/tmp");
    registerSession("id-b", "bob", "worker", "/tmp", "myapp");
    registerSession("id-c", "charlie", "worker", "/tmp", "other");

    const result = handleBroadcast("id-a", "alice", "hello everyone", "");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(2);

    expect(readPendingMessages("id-b")).toHaveLength(1);
    expect(readPendingMessages("id-c")).toHaveLength(1);
  });

  test("default senderProject parameter broadcasts globally", () => {
    registerSession("id-a", "alice", "worker", "/tmp", "myapp");
    registerSession("id-b", "bob", "worker", "/tmp", "other");

    // Call without 4th argument — should default to global
    const result = handleBroadcast("id-a", "alice", "hello");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(1);
    expect(readPendingMessages("id-b")).toHaveLength(1);
  });

  test("project-scoped broadcast with no same-project peers returns zero recipients", () => {
    registerSession("id-a", "alice", "worker", "/tmp", "myapp");
    registerSession("id-b", "bob", "worker", "/tmp", "other");

    const result = handleBroadcast("id-a", "alice", "anyone here?", "myapp");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(0);
  });

  test("project-scoped broadcast does NOT reach sessions with no project", () => {
    registerSession("id-a", "alice", "worker", "/tmp", "myapp");
    registerSession("id-b", "bob", "worker", "/tmp");

    const result = handleBroadcast("id-a", "alice", "myapp only", "myapp");
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(0);
    expect(readPendingMessages("id-b")).toHaveLength(0);
  });
});
