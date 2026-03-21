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
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");

    const dm = handleDm("alice", "bob", "hey bob");
    expect(dm.success).toBe(true);

    const msgs = readMessages("id-bob");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_session).toBe("alice");
    expect(msgs[0].content).toBe("hey bob");

    // Marked as delivered
    const again = readMessages("id-bob");
    expect(again).toHaveLength(0);
  });

  test("broadcast delivery", () => {
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");
    handleRegister("id-charlie", "charlie", "worker");

    const bc = handleBroadcast("id-alice", "alice", "hello everyone");
    expect(bc.success).toBe(true);
    expect(bc.recipientCount).toBe(2);

    const bobMsgs = readMessages("id-bob");
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].content).toBe("hello everyone");

    const charlieMsgs = readMessages("id-charlie");
    expect(charlieMsgs).toHaveLength(1);

    const aliceMsgs = readMessages("id-alice");
    expect(aliceMsgs).toHaveLength(0);
  });

  test("broadcast per-recipient isolation", () => {
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");

    handleBroadcast("id-alice", "alice", "isolated msg");

    // Bob reads his copy
    const bobMsgs = readMessages("id-bob");
    expect(bobMsgs).toHaveLength(1);

    // Alice should still have no messages (she's the sender)
    handleRegister("id-charlie", "charlie", "worker");
    handleBroadcast("id-alice", "alice", "second msg");

    const bobMsgs2 = readMessages("id-bob");
    expect(bobMsgs2).toHaveLength(1);
    expect(bobMsgs2[0].content).toBe("second msg");

    const charlieMsgs = readMessages("id-charlie");
    expect(charlieMsgs).toHaveLength(1);
    expect(charlieMsgs[0].content).toBe("second msg");
  });

  test("session expiry cuts off delivery", () => {
    handleRegister("id-alice", "alice", "worker");

    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run("UPDATE sessions SET last_seen = ? WHERE id = ?", [old, "id-alice"]);
    db.close();

    expireStaleSessions();

    const who = handleWho();
    const names = who.sessions.map((s) => s.name);
    expect(names).not.toContain("alice");
  });

  test("re-registration recovers session", () => {
    handleRegister("id-alice", "alice", "worker");

    // Send a message to alice's ID
    writeMessage("bob", "id-alice", "queued msg");

    // Expire alice
    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run("UPDATE sessions SET last_seen = ? WHERE id = ?", [old, "id-alice"]);
    db.close();
    expireStaleSessions();

    // Re-register
    handleRegister("id-alice", "alice", "worker");

    // Alice should still receive the queued message
    const msgs = readMessages("id-alice");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("queued msg");
  });

  test("message ordering across senders", () => {
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");
    handleRegister("id-charlie", "charlie", "worker");

    writeMessage("alice", "id-charlie", "a1");
    writeMessage("alice", "id-charlie", "a2");
    writeMessage("bob", "id-charlie", "b1");
    writeMessage("alice", "id-charlie", "a3");
    writeMessage("bob", "id-charlie", "b2");

    const msgs = readMessages("id-charlie");
    expect(msgs).toHaveLength(5);
    expect(msgs.map((m) => m.content)).toEqual(["a1", "a2", "b1", "a3", "b2"]);

    // Verify strict id ordering
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].id).toBeGreaterThan(msgs[i - 1].id);
    }
  });

  test("sanitization consistency", () => {
    handleRegister("id-planner", "planner", "orchestrator");

    const dm = handleDm("someone", "  PLANNER  ", "hello planner");
    expect(dm.success).toBe(true);
    expect(dm.to).toBe("planner");

    const msgs = readMessages("id-planner");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hello planner");
  });

  test("second read returns empty after delivery", () => {
    writeMessage("sender", "target-id", "unique msg");

    const r1 = readMessages("target-id");
    const r2 = readMessages("target-id");

    expect(r1.length + r2.length).toBe(1);
  });

  test("large content boundary", () => {
    handleRegister("id-sender", "sender", "worker");
    handleRegister("id-receiver", "receiver", "worker");

    // Exactly 10,000 chars should succeed
    const ok = handleDm("sender", "receiver", "x".repeat(10_000));
    expect(ok.success).toBe(true);

    // 10,001 chars should fail
    const fail = handleDm("sender", "receiver", "x".repeat(10_001));
    expect(fail.success).toBe(false);
    expect(fail.error).toContain("under 10000");
  });

  test("self-message", () => {
    handleRegister("id-alice", "alice", "worker");

    const dm = handleDm("alice", "alice", "note to self");
    expect(dm.success).toBe(true);

    const msgs = readMessages("id-alice");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_session).toBe("alice");
    expect(msgs[0].content).toBe("note to self");
  });
});
