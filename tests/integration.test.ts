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
  readPendingMessages,
  deleteDeliveredMessage,
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
  test("full DM flow with two-step delivery", () => {
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");

    const dm = handleDm("alice", "bob", "hey bob");
    expect(dm.success).toBe(true);

    // Step 1: read pending (does not consume)
    const msgs = readPendingMessages("id-bob");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_session).toBe("alice");
    expect(msgs[0].content).toBe("hey bob");

    // Still pending — second read returns same messages
    const stillPending = readPendingMessages("id-bob");
    expect(stillPending).toHaveLength(1);

    // Step 2: delete after delivery
    deleteDeliveredMessage(msgs[0].id);

    // Now consumed
    const empty = readPendingMessages("id-bob");
    expect(empty).toHaveLength(0);
  });

  test("broadcast delivery", () => {
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");
    handleRegister("id-charlie", "charlie", "worker");

    const bc = handleBroadcast("id-alice", "alice", "hello everyone");
    expect(bc.success).toBe(true);
    expect(bc.recipientCount).toBe(2);

    const bobMsgs = readPendingMessages("id-bob");
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].content).toBe("hello everyone");

    const charlieMsgs = readPendingMessages("id-charlie");
    expect(charlieMsgs).toHaveLength(1);

    const aliceMsgs = readPendingMessages("id-alice");
    expect(aliceMsgs).toHaveLength(0);
  });

  test("broadcast per-recipient isolation", () => {
    handleRegister("id-alice", "alice", "worker");
    handleRegister("id-bob", "bob", "worker");

    handleBroadcast("id-alice", "alice", "isolated msg");

    const bobMsgs = readPendingMessages("id-bob");
    expect(bobMsgs).toHaveLength(1);
    // Consume bob's copy
    deleteDeliveredMessage(bobMsgs[0].id);

    handleRegister("id-charlie", "charlie", "worker");
    handleBroadcast("id-alice", "alice", "second msg");

    const bobMsgs2 = readPendingMessages("id-bob");
    expect(bobMsgs2).toHaveLength(1);
    expect(bobMsgs2[0].content).toBe("second msg");

    const charlieMsgs = readPendingMessages("id-charlie");
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

    writeMessage("bob", "id-alice", "queued msg");

    const old = new Date(Date.now() - 120_000).toISOString();
    const db = new Database(tmpDbPath);
    db.run("UPDATE sessions SET last_seen = ? WHERE id = ?", [old, "id-alice"]);
    db.close();
    expireStaleSessions();

    handleRegister("id-alice", "alice", "worker");

    // Message is still in DB (written < 15s ago)
    const msgs = readPendingMessages("id-alice");
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

    const msgs = readPendingMessages("id-charlie");
    expect(msgs).toHaveLength(5);
    expect(msgs.map((m) => m.content)).toEqual(["a1", "a2", "b1", "a3", "b2"]);

    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].id).toBeGreaterThan(msgs[i - 1].id);
    }
  });

  test("sanitization consistency", () => {
    handleRegister("id-planner", "planner", "orchestrator");

    const dm = handleDm("someone", "  PLANNER  ", "hello planner");
    expect(dm.success).toBe(true);
    expect(dm.to).toBe("planner");

    const msgs = readPendingMessages("id-planner");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hello planner");
  });

  test("large content boundary", () => {
    handleRegister("id-sender", "sender", "worker");
    handleRegister("id-receiver", "receiver", "worker");

    const ok = handleDm("sender", "receiver", "x".repeat(10_000));
    expect(ok.success).toBe(true);

    const fail = handleDm("sender", "receiver", "x".repeat(10_001));
    expect(fail.success).toBe(false);
    expect(fail.error).toContain("under 10000");
  });

  test("self-message", () => {
    handleRegister("id-alice", "alice", "worker");

    const dm = handleDm("alice", "alice", "note to self");
    expect(dm.success).toBe(true);

    const msgs = readPendingMessages("id-alice");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_session).toBe("alice");
    expect(msgs[0].content).toBe("note to self");
  });

  test("DM fan-out to multiple sessions with same name", () => {
    handleRegister("id-worker-1", "worker", "dev");
    handleRegister("id-worker-2", "worker", "dev");

    const dm = handleDm("planner", "worker", "task for all workers");
    expect(dm.success).toBe(true);

    const w1 = readPendingMessages("id-worker-1");
    expect(w1).toHaveLength(1);
    expect(w1[0].content).toBe("task for all workers");

    const w2 = readPendingMessages("id-worker-2");
    expect(w2).toHaveLength(1);
    expect(w2[0].content).toBe("task for all workers");
  });
});
