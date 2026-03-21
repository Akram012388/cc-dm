// SQLite WAL message bus. Shared across all cc-dm session instances via ~/.cc-dm/bus.db

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BUS_DIR = join(homedir(), ".cc-dm");
const BUS_PATH = join(BUS_DIR, "bus.db");

let db: Database;

export function initBus(): void {
  try {
    if (!existsSync(BUS_DIR)) {
      mkdirSync(BUS_DIR, { recursive: true });
    }

    db = new Database(BUS_PATH, { create: true });

    db.run("PRAGMA journal_mode=WAL;");
    db.run("PRAGMA synchronous=NORMAL;");
    db.run("PRAGMA foreign_keys=ON;");

    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        role          TEXT NOT NULL DEFAULT 'worker',
        status        TEXT NOT NULL DEFAULT 'active',
        last_seen     TEXT NOT NULL,
        registered_at TEXT NOT NULL
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        from_session  TEXT NOT NULL,
        to_session    TEXT NOT NULL,
        content       TEXT NOT NULL,
        delivered     INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_to_delivered
      ON messages(to_session, delivered);
    `);
  } catch (err) {
    console.error("[cc-dm/bus] initBus failed:", err);
    throw err;
  }
}

export function registerSession(sessionId: string, role: string): void {
  try {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO sessions (id, role, status, last_seen, registered_at)
       VALUES (?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         role = excluded.role,
         status = 'active',
         last_seen = excluded.last_seen`,
      [sessionId, role, now, now]
    );
  } catch (err) {
    console.error("[cc-dm/bus] registerSession failed:", err);
  }
}

export function updateHeartbeat(sessionId: string): void {
  try {
    const now = new Date().toISOString();
    db.run(
      `UPDATE sessions SET last_seen = ?, status = 'active' WHERE id = ?`,
      [now, sessionId]
    );
  } catch (err) {
    console.error("[cc-dm/bus] updateHeartbeat failed:", err);
  }
}

export function expireStaleSessions(): void {
  try {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    db.run(
      `UPDATE sessions SET status = 'inactive' WHERE last_seen < ?`,
      [cutoff]
    );
    db.run(
      `DELETE FROM messages WHERE delivered = 1 AND created_at < ?`,
      [new Date(Date.now() - 3_600_000).toISOString()]
    );
  } catch (err) {
    console.error("[cc-dm/bus] expireStaleSessions failed:", err);
  }
}

export function writeMessage(fromSession: string, toSession: string, content: string): boolean {
  try {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO messages (from_session, to_session, content, delivered, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      [fromSession, toSession, content, now]
    );
    return true;
  } catch (err) {
    console.error("[cc-dm/bus] writeMessage failed:", err);
    return false;
  }
}

export function readMessages(sessionId: string): Array<{ id: number; from_session: string; content: string; created_at: string }> {
  try {
    const readAndDeliver = db.transaction((sid: string) => {
      const messages = db.query<{ id: number; from_session: string; content: string; created_at: string }, [string]>(
        `SELECT id, from_session, content, created_at FROM messages
         WHERE to_session = ? AND delivered = 0
         ORDER BY id ASC`
      ).all(sid);

      if (messages.length === 0) return [];

      const stmt = db.prepare(`UPDATE messages SET delivered = 1 WHERE id = ?`);
      for (const msg of messages) {
        stmt.run(msg.id);
      }

      return messages;
    });

    return readAndDeliver(sessionId);
  } catch (err) {
    console.error("[cc-dm/bus] readMessages failed:", err);
    return [];
  }
}

export function listActiveSessions(): Array<{ id: string; role: string; last_seen: string }> {
  try {
    return db.query<{ id: string; role: string; last_seen: string }, []>(
      `SELECT id, role, last_seen FROM sessions
       WHERE status = 'active'
       ORDER BY registered_at ASC`
    ).all();
  } catch (err) {
    console.error("[cc-dm/bus] listActiveSessions failed:", err);
    return [];
  }
}

// Smoke test — only runs when executed directly: bun run src/bus.ts
if (import.meta.main) {
  initBus();
  registerSession("test-session", "worker");
  writeMessage("test-session", "test-session", "hello from smoke test");
  const msgs = readMessages("test-session");
  console.log("messages:", msgs);
  const sessions = listActiveSessions();
  console.log("sessions:", sessions);
}
