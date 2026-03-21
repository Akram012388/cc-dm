import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  initBus,
  closeBus,
  registerSession,
  updateHeartbeat,
  expireStaleSessions,
  writeMessage,
  readMessages,
  listActiveSessions,
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
    registerSession("alpha", "worker");
    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ id: string; role: string; status: string }, [string]>(
      "SELECT id, role, status FROM sessions WHERE id = ?"
    ).get("alpha");
    db.close();
    expect(row).not.toBeNull();
    expect(row!.id).toBe("alpha");
    expect(row!.role).toBe("worker");
    expect(row!.status).toBe("active");
  });

  test("upserts on conflict", () => {
    registerSession("alpha", "worker");
    const db1 = new Database(tmpDbPath, { readonly: true });
    const first = db1.query<{ last_seen: string; role: string }, [string]>(
      "SELECT last_seen, role FROM sessions WHERE id = ?"
    ).get("alpha");
    db1.close();

    registerSession("alpha", "orchestrator");
    const db2 = new Database(tmpDbPath, { readonly: true });
    const second = db2.query<{ last_seen: string; role: string }, [string]>(
      "SELECT last_seen, role FROM sessions WHERE id = ?"
    ).get("alpha");
    db2.close();

    expect(second!.role).toBe("orchestrator");
    expect(second!.last_seen >= first!.last_seen).toBe(true);
  });
});

describe("updateHeartbeat", () => {
  test("updates last_seen", () => {
    registerSession("alpha", "worker");
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
  test("marks old sessions inactive", () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO sessions (id, role, status, last_seen, registered_at) VALUES (?, ?, 'active', ?, ?)",
      ["stale-one", "worker", old, old]
    );
    db.close();

    expireStaleSessions();

    const db2 = new Database(tmpDbPath, { readonly: true });
    const row = db2.query<{ status: string }, [string]>(
      "SELECT status FROM sessions WHERE id = ?"
    ).get("stale-one");
    db2.close();
    expect(row!.status).toBe("inactive");
  });

  test("cleans delivered messages older than 1hr", () => {
    const old = new Date(Date.now() - 7_200_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO messages (from_session, to_session, content, delivered, created_at) VALUES (?, ?, ?, 1, ?)",
      ["a", "b", "old msg", old]
    );
    db.close();

    expireStaleSessions();

    const db2 = new Database(tmpDbPath, { readonly: true });
    const count = db2.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM messages").get()!.cnt;
    db2.close();
    expect(count).toBe(0);
  });
});

describe("writeMessage", () => {
  test("returns true on success", () => {
    const ok = writeMessage("a", "b", "hello");
    expect(ok).toBe(true);

    const db = new Database(tmpDbPath, { readonly: true });
    const row = db.query<{ content: string }, [string]>(
      "SELECT content FROM messages WHERE to_session = ?"
    ).get("b");
    db.close();
    expect(row!.content).toBe("hello");
  });

  test("returns false on error", () => {
    closeBus();
    const ok = writeMessage("a", "b", "hello");
    expect(ok).toBe(false);
    // Re-init for afterEach cleanup
    initBus(tmpDbPath);
  });
});

describe("readMessages", () => {
  test("returns undelivered messages", () => {
    writeMessage("a", "b", "msg1");
    writeMessage("a", "b", "msg2");
    const msgs = readMessages("b");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("msg1");
    expect(msgs[1].content).toBe("msg2");
  });

  test("marks messages as delivered", () => {
    writeMessage("a", "b", "msg1");
    readMessages("b");
    const msgs = readMessages("b");
    expect(msgs).toHaveLength(0);
  });

  test("is transactional — no duplicates", () => {
    writeMessage("a", "b", "msg1");
    const [r1, r2] = [readMessages("b"), readMessages("b")];
    const total = r1.length + r2.length;
    expect(total).toBe(1);
  });

  test("orders by id ASC", () => {
    writeMessage("x", "target", "first");
    writeMessage("y", "target", "second");
    writeMessage("z", "target", "third");
    const msgs = readMessages("target");
    expect(msgs[0].content).toBe("first");
    expect(msgs[1].content).toBe("second");
    expect(msgs[2].content).toBe("third");
    expect(msgs[0].id).toBeLessThan(msgs[1].id);
    expect(msgs[1].id).toBeLessThan(msgs[2].id);
  });
});

describe("listActiveSessions", () => {
  test("returns only active sessions", () => {
    registerSession("active-one", "worker");
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO sessions (id, role, status, last_seen, registered_at) VALUES (?, ?, 'inactive', ?, ?)",
      ["dead-one", "worker", old, old]
    );
    db.close();

    const sessions = listActiveSessions();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("active-one");
    expect(ids).not.toContain("dead-one");
  });
});
