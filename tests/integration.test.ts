import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  initBus,
  closeBus,
  registerSession,
  writeMessage,
  readMessages,
  listActiveSessions,
  expireStaleSessions,
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

describe("integration", () => {
  test("full DM flow", () => {
    handleRegister("alice", "worker");
    handleRegister("bob", "worker");

    const dm = handleDm("alice", "bob", "hey bob");
    expect(dm.success).toBe(true);

    const msgs = readMessages("bob");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_session).toBe("alice");
    expect(msgs[0].content).toBe("hey bob");

    // Marked as delivered
    const again = readMessages("bob");
    expect(again).toHaveLength(0);
  });

  test("broadcast delivery", () => {
    handleRegister("alice", "worker");
    handleRegister("bob", "worker");
    handleRegister("charlie", "worker");

    const bc = handleBroadcast("alice", "hello everyone");
    expect(bc.success).toBe(true);
    expect(bc.recipientCount).toBe(2);

    const bobMsgs = readMessages("bob");
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].content).toBe("hello everyone");

    const charlieMsgs = readMessages("charlie");
    expect(charlieMsgs).toHaveLength(1);

    const aliceMsgs = readMessages("alice");
    expect(aliceMsgs).toHaveLength(0);
  });

  test("broadcast per-recipient isolation", () => {
    handleRegister("alice", "worker");
    handleRegister("bob", "worker");

    handleBroadcast("alice", "isolated msg");

    // Bob reads his copy
    const bobMsgs = readMessages("bob");
    expect(bobMsgs).toHaveLength(1);

    // Alice should still have no messages (she's the sender)
    // But let's add another recipient to verify isolation
    handleRegister("charlie", "worker");
    // Charlie was registered after broadcast, so no message for charlie
    // Re-broadcast to test isolation
    handleBroadcast("alice", "second msg");

    const bobMsgs2 = readMessages("bob");
    expect(bobMsgs2).toHaveLength(1);
    expect(bobMsgs2[0].content).toBe("second msg");

    // Charlie's copy still undelivered until charlie reads
    const charlieMsgs = readMessages("charlie");
    expect(charlieMsgs).toHaveLength(1);
    expect(charlieMsgs[0].content).toBe("second msg");
  });

  test("session expiry cuts off delivery", () => {
    handleRegister("alice", "worker");

    // Manually set alice's last_seen to old timestamp
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run("UPDATE sessions SET last_seen = ? WHERE id = ?", [old, "alice"]);
    db.close();

    expireStaleSessions();

    const who = handleWho();
    const ids = who.sessions.map((s) => s.id);
    expect(ids).not.toContain("alice");
  });

  test("re-registration recovers session", () => {
    handleRegister("alice", "worker");

    // Send a message to alice
    writeMessage("bob", "alice", "queued msg");

    // Expire alice
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run("UPDATE sessions SET last_seen = ? WHERE id = ?", [old, "alice"]);
    db.close();
    expireStaleSessions();

    // Re-register
    handleRegister("alice", "worker");

    // Alice should still receive the queued message
    const msgs = readMessages("alice");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("queued msg");
  });

  test("message ordering across senders", () => {
    handleRegister("alice", "worker");
    handleRegister("bob", "worker");
    handleRegister("charlie", "worker");

    writeMessage("alice", "charlie", "a1");
    writeMessage("alice", "charlie", "a2");
    writeMessage("bob", "charlie", "b1");
    writeMessage("alice", "charlie", "a3");
    writeMessage("bob", "charlie", "b2");

    const msgs = readMessages("charlie");
    expect(msgs).toHaveLength(5);
    expect(msgs.map((m) => m.content)).toEqual(["a1", "a2", "b1", "a3", "b2"]);

    // Verify strict id ordering
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].id).toBeGreaterThan(msgs[i - 1].id);
    }
  });

  test("sanitization consistency", () => {
    handleRegister("planner", "orchestrator");

    const dm = handleDm("someone", "  PLANNER  ", "hello planner");
    expect(dm.success).toBe(true);
    expect(dm.to).toBe("planner");

    const msgs = readMessages("planner");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hello planner");
  });

  test("second read returns empty after delivery", () => {
    writeMessage("a", "target", "unique msg");

    // Both reads happen synchronously (SQLite serializes), but this tests
    // that the transaction properly marks delivered
    const r1 = readMessages("target");
    const r2 = readMessages("target");

    expect(r1.length + r2.length).toBe(1);
  });

  test("large content boundary", () => {
    handleRegister("sender", "worker");

    // Exactly 10,000 chars should succeed
    const ok = handleDm("sender", "receiver", "x".repeat(10_000));
    expect(ok.success).toBe(true);

    // 10,001 chars should fail
    const fail = handleDm("sender", "receiver", "x".repeat(10_001));
    expect(fail.success).toBe(false);
    expect(fail.error).toContain("under 10000");
  });

  test("self-message", () => {
    handleRegister("alice", "worker");

    const dm = handleDm("alice", "alice", "note to self");
    expect(dm.success).toBe(true);

    const msgs = readMessages("alice");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_session).toBe("alice");
    expect(msgs[0].content).toBe("note to self");
  });
});
