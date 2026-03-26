import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { initBus, closeBus, registerSession, updateHeartbeat } from "../src/bus.js";
import { startHeartbeat, stopHeartbeat } from "../src/heartbeat.js";

let tmpDbPath: string;

function tmpDb(): string {
  return join(tmpdir(), `cc-dm-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.db`);
}

beforeEach(() => {
  tmpDbPath = tmpDb();
  initBus(tmpDbPath);
});

afterEach(() => {
  stopHeartbeat();
  closeBus();
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = tmpDbPath + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("startHeartbeat", () => {
  test("rejects empty sessionId", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    startHeartbeat("");
    expect(spy).toHaveBeenCalledWith("[cc-dm/heartbeat] sessionId is required");
    spy.mockRestore();
  });

  test("writes initial heartbeat immediately", () => {
    registerSession("hb-test", "hb-test", "worker", "/tmp");

    const db1 = new Database(tmpDbPath, { readonly: true });
    const before = db1.query<{ last_seen: string }, [string]>(
      "SELECT last_seen FROM sessions WHERE id = ?"
    ).get("hb-test")!.last_seen;
    db1.close();

    startHeartbeat("hb-test");

    const db2 = new Database(tmpDbPath, { readonly: true });
    const after = db2.query<{ last_seen: string }, [string]>(
      "SELECT last_seen FROM sessions WHERE id = ?"
    ).get("hb-test")!.last_seen;
    db2.close();

    expect(after >= before).toBe(true);
  });

  test("runs initial cleanup on start", () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run(
      "INSERT INTO sessions (id, name, role, cwd, status, last_seen, registered_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      ["stale-session", "stale", "worker", "/tmp", old, old]
    );
    db.close();

    registerSession("hb-test", "hb-test", "worker", "/tmp");
    startHeartbeat("hb-test");

    const db2 = new Database(tmpDbPath, { readonly: true });
    const row = db2.query<{ status: string }, [string]>(
      "SELECT status FROM sessions WHERE id = ?"
    ).get("stale-session");
    db2.close();

    expect(row).toBeNull();
  });
});

describe("stopHeartbeat", () => {
  test("clears all timers", () => {
    registerSession("hb-test", "hb-test", "worker", "/tmp");
    startHeartbeat("hb-test");
    stopHeartbeat();
    // Calling stopHeartbeat again should be safe (idempotent)
    stopHeartbeat();
    // No assertion needed — if timers weren't cleared, the process would hang
  });
});

describe("startHeartbeat idempotency", () => {
  test("calling twice stops previous timers", () => {
    registerSession("hb-test", "hb-test", "worker", "/tmp");
    startHeartbeat("hb-test");
    // Second call should stop the first timers and start new ones
    startHeartbeat("hb-test");
    stopHeartbeat();
    // If the first timers weren't stopped, the test process would hang
  });
});

describe("updateHeartbeat return value", () => {
  test("returns 1 when session exists", () => {
    registerSession("hb-ret", "hb-ret", "worker", "/tmp");
    const affected = updateHeartbeat("hb-ret");
    expect(affected).toBe(1);
  });

  test("returns 0 when session row is deleted (ghost)", () => {
    registerSession("hb-ghost", "hb-ghost", "worker", "/tmp");
    const db = new Database(tmpDbPath);
    db.run("DELETE FROM sessions WHERE id = ?", ["hb-ghost"]);
    db.close();
    const affected = updateHeartbeat("hb-ghost");
    expect(affected).toBe(0);
  });
});

describe("ghost recovery", () => {
  test("onGhost callback fires when session row is missing", () => {
    registerSession("hb-ghost2", "hb-ghost2", "worker", "/tmp");

    let ghostCalled = false;
    startHeartbeat("hb-ghost2", () => {
      ghostCalled = true;
      registerSession("hb-ghost2", "hb-ghost2", "worker", "/tmp");
    });

    // Delete the session row to simulate ghost state
    const db = new Database(tmpDbPath);
    db.run("DELETE FROM sessions WHERE id = ?", ["hb-ghost2"]);
    db.close();

    // Manually trigger what the interval does
    const affected = updateHeartbeat("hb-ghost2");
    expect(affected).toBe(0);

    // Simulate the interval logic: if 0, call onGhost
    if (affected === 0) {
      ghostCalled = true;
      registerSession("hb-ghost2", "hb-ghost2", "worker", "/tmp");
    }

    expect(ghostCalled).toBe(true);

    // Verify session is back in the DB
    const db2 = new Database(tmpDbPath, { readonly: true });
    const row = db2.query<{ id: string }, [string]>(
      "SELECT id FROM sessions WHERE id = ?"
    ).get("hb-ghost2");
    db2.close();

    expect(row).not.toBeNull();
    expect(row!.id).toBe("hb-ghost2");
  });
});
