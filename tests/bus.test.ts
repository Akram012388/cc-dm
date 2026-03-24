import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  initBus,
  closeBus,
  registerSession,
  deregisterSession,
  updateHeartbeat,
  expireStaleSessions,
  writeMessage,
  readPendingMessages,
  deleteDeliveredMessage,
  listActiveSessions,
  findSessionsByName,
} from "../src/bus.js";

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

describe("initBus", () => {
  test("creates sessions and messages tables", () => {
    const db = new Database(tmpDbPath, { readonly: true });
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    db.close();
    expect(tables).toContain("sessions");
    expect(tables).toContain("messages");
  });

  test("throws on fatal error", () => {
    closeBus();
    expect(() => initBus("/nonexistent/deeply/nested/path/bus.db")).toThrow();
  });
});

describe("registerSession", () => {
  test("inserts new session", () => {
    registerSession("alpha", "alpha-name", "worker", "/tmp");
    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ id: string; name: string; role: string; cwd: string; status: string }, [string]>(
      "SELECT id, name, role, cwd, status FROM sessions WHERE id = ?"
    ).get("alpha");
    db.close();
    expect(row).not.toBeNull();
    expect(row!.id).toBe("alpha");
    expect(row!.name).toBe("alpha-name");
    expect(row!.role).toBe("worker");
    expect(row!.cwd).toBe("/tmp");
    expect(row!.status).toBe("active");
  });

  test("upserts on conflict", () => {
    registerSession("alpha", "alpha", "worker", "/tmp");
    registerSession("alpha", "alpha-renamed", "orchestrator", "/home");
    const db2 = new Database(tmpDbPath, { readonly: true });
    const second = db2.query<{ role: string; name: string; cwd: string }, [string]>(
      "SELECT role, name, cwd FROM sessions WHERE id = ?"
    ).get("alpha");
    db2.close();
    expect(second!.role).toBe("orchestrator");
    expect(second!.name).toBe("alpha-renamed");
    expect(second!.cwd).toBe("/home");
  });

  test("stores project field", () => {
    registerSession("alpha", "alpha-name", "worker", "/tmp", "myapp");
    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ project: string }, [string]>(
      "SELECT project FROM sessions WHERE id = ?"
    ).get("alpha");
    db.close();
    expect(row!.project).toBe("myapp");
  });

  test("defaults project to empty string", () => {
    registerSession("alpha", "alpha-name", "worker", "/tmp");
    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ project: string }, [string]>(
      "SELECT project FROM sessions WHERE id = ?"
    ).get("alpha");
    db.close();
    expect(row!.project).toBe("");
  });

  test("upserts project on conflict", () => {
    registerSession("alpha", "alpha", "worker", "/tmp", "old-project");
    registerSession("alpha", "alpha", "worker", "/tmp", "new-project");
    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ project: string }, [string]>(
      "SELECT project FROM sessions WHERE id = ?"
    ).get("alpha");
    db.close();
    expect(row!.project).toBe("new-project");
  });

  test("throws on DB error", () => {
    closeBus();
    expect(() => registerSession("x", "x", "w", "/")).toThrow();
    initBus(tmpDbPath);
  });
});

describe("deregisterSession", () => {
  test("removes session from DB", () => {
    registerSession("alpha", "alpha", "worker", "/tmp");
    deregisterSession("alpha");
    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ id: string }, [string]>(
      "SELECT id FROM sessions WHERE id = ?"
    ).get("alpha");
    db.close();
    expect(row).toBeNull();
  });

  test("no-op for nonexistent session", () => {
    deregisterSession("nonexistent");
  });

  test("does not affect other sessions", () => {
    registerSession("a", "a", "w", "/");
    registerSession("b", "b", "w", "/");
    deregisterSession("a");
    const sessions = listActiveSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("b");
  });
});

describe("updateHeartbeat", () => {
  test("updates last_seen", () => {
    registerSession("alpha", "alpha", "worker", "/tmp");
    const db1 = new Database(tmpDbPath, { readonly: true });
    const before = db1.query<{ last_seen: string }, [string]>(
      "SELECT last_seen FROM sessions WHERE id = ?"
    ).get("alpha")!.last_seen;
    db1.close();

    updateHeartbeat("alpha");
    const db2 = new Database(tmpDbPath, { readonly: true });
    const after = db2.query<{ last_seen: string }, [string]>(
      "SELECT last_seen FROM sessions WHERE id = ?"
    ).get("alpha")!.last_seen;
    db2.close();
    expect(after >= before).toBe(true);
  });
});

describe("expireStaleSessions", () => {
  test("deletes stale sessions after 60s inactivity", () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO sessions (id, name, role, cwd, status, last_seen, registered_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      ["stale-one", "stale", "worker", "/tmp", old, old]
    );
    db.close();

    expireStaleSessions();

    const db2 = new Database(tmpDbPath, { readonly: true });
    const row = db2.query<{ status: string }, [string]>(
      "SELECT status FROM sessions WHERE id = ?"
    ).get("stale-one");
    db2.close();
    expect(row).toBeNull();
  });

  test("cleans undelivered messages older than 15s", () => {
    const old = new Date(Date.now() - 30_000).toISOString();
    const recent = new Date().toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO messages (from_session, to_session, content, delivered, created_at) VALUES (?, ?, ?, 0, ?)",
      ["a", "b", "stale msg", old]
    );
    db.run(
      "INSERT INTO messages (from_session, to_session, content, delivered, created_at) VALUES (?, ?, ?, 0, ?)",
      ["a", "b", "fresh msg", recent]
    );
    db.close();

    expireStaleSessions();

    const db2 = new Database(tmpDbPath, { readonly: true });
    const rows = db2.query<{ content: string }, []>("SELECT content FROM messages").all();
    db2.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("fresh msg");
  });
});

describe("writeMessage", () => {
  test("returns true on success", () => {
    const ok = writeMessage("sender-name", "target-id", "hello");
    expect(ok).toBe(true);

    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ from_session: string; content: string }, [string]>(
      "SELECT from_session, content FROM messages WHERE to_session = ?"
    ).get("target-id");
    db.close();
    expect(row!.from_session).toBe("sender-name");
    expect(row!.content).toBe("hello");
  });

  test("returns false on error", () => {
    closeBus();
    const ok = writeMessage("a", "b", "hello");
    expect(ok).toBe(false);
    initBus(tmpDbPath);
  });
});

describe("readPendingMessages", () => {
  test("returns undelivered messages", () => {
    writeMessage("sender", "target-id", "msg1");
    writeMessage("sender", "target-id", "msg2");
    const msgs = readPendingMessages("target-id");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("msg1");
    expect(msgs[1].content).toBe("msg2");
  });

  test("does NOT mark messages as delivered", () => {
    writeMessage("sender", "target-id", "msg1");
    readPendingMessages("target-id");
    const msgs = readPendingMessages("target-id");
    expect(msgs).toHaveLength(1);
  });

  test("orders by id ASC", () => {
    writeMessage("x", "target-id", "first");
    writeMessage("y", "target-id", "second");
    writeMessage("z", "target-id", "third");
    const msgs = readPendingMessages("target-id");
    expect(msgs[0].content).toBe("first");
    expect(msgs[2].content).toBe("third");
    expect(msgs[0].id).toBeLessThan(msgs[1].id);
  });

  test("returns empty array on DB error", () => {
    closeBus();
    const msgs = readPendingMessages("target-id");
    expect(msgs).toHaveLength(0);
    initBus(tmpDbPath);
  });
});

describe("deleteDeliveredMessage", () => {
  test("deletes the message row", () => {
    writeMessage("sender", "target-id", "msg1");
    const msgs = readPendingMessages("target-id");
    deleteDeliveredMessage(msgs[0].id);

    const remaining = readPendingMessages("target-id");
    expect(remaining).toHaveLength(0);
  });

  test("only deletes the specified message", () => {
    writeMessage("sender", "target-id", "msg1");
    writeMessage("sender", "target-id", "msg2");
    const msgs = readPendingMessages("target-id");
    deleteDeliveredMessage(msgs[0].id);

    const remaining = readPendingMessages("target-id");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("msg2");
  });

  test("throws on DB error", () => {
    closeBus();
    expect(() => deleteDeliveredMessage(999)).toThrow();
    initBus(tmpDbPath);
  });
});

describe("findSessionsByName", () => {
  test("finds sessions by name", () => {
    registerSession("id-1", "planner", "worker", "/tmp");
    const results = findSessionsByName("planner");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
    expect(results[0].name).toBe("planner");
  });

  test("returns multiple matches for same name", () => {
    registerSession("id-1", "worker", "dev", "/tmp");
    registerSession("id-2", "worker", "dev", "/home");
    const results = findSessionsByName("worker");
    expect(results).toHaveLength(2);
  });

  test("returns empty for unknown name", () => {
    const results = findSessionsByName("nonexistent");
    expect(results).toHaveLength(0);
  });

  test("excludes inactive sessions", () => {
    registerSession("id-1", "planner", "worker", "/tmp");
    const db = new Database(tmpDbPath);
    db.run("UPDATE sessions SET status = 'inactive' WHERE id = 'id-1'");
    db.close();
    const results = findSessionsByName("planner");
    expect(results).toHaveLength(0);
  });

  test("throws on DB error", () => {
    closeBus();
    expect(() => findSessionsByName("x")).toThrow();
    initBus(tmpDbPath);
  });
});

describe("listActiveSessions", () => {
  test("returns only active sessions with all fields", () => {
    registerSession("active-one", "planner", "worker", "/project", "myapp");
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO sessions (id, name, role, cwd, status, last_seen, registered_at) VALUES (?, ?, ?, ?, 'inactive', ?, ?)",
      ["dead-one", "dead", "worker", "/tmp", old, old]
    );
    db.close();

    const sessions = listActiveSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("active-one");
    expect(sessions[0].name).toBe("planner");
    expect(sessions[0].role).toBe("worker");
    expect(sessions[0].cwd).toBe("/project");
    expect(sessions[0].project).toBe("myapp");
  });

  test("throws on DB error", () => {
    closeBus();
    expect(() => listActiveSessions()).toThrow();
    initBus(tmpDbPath);
  });
});
