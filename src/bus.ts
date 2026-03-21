// SQLite WAL message bus. Shared across all cc-dm session instances via ~/.cc-dm/bus.db

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const BUS_DIR = join(homedir(), ".cc-dm");
const BUS_PATH = join(BUS_DIR, "bus.db");

let db: Database;

export function initBus(dbPath?: string): void {
  try {
    const resolvedPath = dbPath ?? BUS_PATH;
    const resolvedDir = dbPath ? dirname(resolvedPath) : BUS_DIR;

    if (!existsSync(resolvedDir)) {
      mkdirSync(resolvedDir, { recursive: true });
    }

    db = new Database(resolvedPath, { create: true });

    db.run("PRAGMA journal_mode=WAL;");
    db.run("PRAGMA synchronous=NORMAL;");
    db.run("PRAGMA foreign_keys=ON;");

    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL DEFAULT '',
        role          TEXT NOT NULL DEFAULT 'worker',
        cwd           TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'active',
        last_seen     TEXT NOT NULL,
        registered_at TEXT NOT NULL
      );
    `);

    // Migration: add columns for existing DBs created before this schema
    try { db.run(`ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT ''`); } catch {}
    try { db.run(`ALTER TABLE sessions ADD COLUMN cwd TEXT NOT NULL DEFAULT ''`); } catch {}

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

export function closeBus(): void {
  if (db) {
    db.close();
  }
}

export function registerSession(sessionId: string, name: string, role: string, cwd: string): void {
  try {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO sessions (id, name, role, cwd, status, last_seen, registered_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         role = excluded.role,
         cwd = excluded.cwd,
         status = 'active',
         last_seen = excluded.last_seen`,
      [sessionId, name, role, cwd, now, now]
    );
  } catch (err) {
    console.error("[cc-dm/bus] registerSession failed:", err);
  }
}

export function deregisterSession(sessionId: string): void {
  try {
    db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
  } catch (err) {
    console.error("[cc-dm/bus] deregisterSession failed:", err);
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
      `DELETE FROM sessions WHERE last_seen < ?`,
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

export function writeMessage(fromName: string, toSessionId: string, content: string): boolean {
  try {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO messages (from_session, to_session, content, delivered, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      [fromName, toSessionId, content, now]
    );
    return true;
  } catch (err) {
    console.error("[cc-dm/bus] writeMessage failed:", err);
    return false;
  }
}

export function readPendingMessages(sessionId: string): Array<{ id: number; from_session: string; content: string; created_at: string }> {
  try {
    return db.query<{ id: number; from_session: string; content: string; created_at: string }, [string]>(
      `SELECT id, from_session, content, created_at FROM messages
       WHERE to_session = ? AND delivered = 0
       ORDER BY id ASC`
    ).all(sessionId);
  } catch (err) {
    console.error("[cc-dm/bus] readPendingMessages failed:", err);
    return [];
  }
}

export function markDelivered(messageId: number): void {
  try {
    db.run(`UPDATE messages SET delivered = 1 WHERE id = ?`, [messageId]);
  } catch (err) {
    console.error("[cc-dm/bus] markDelivered failed:", err);
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

export function findSessionsByName(name: string): Array<{ id: string; name: string; role: string }> {
  try {
    return db.query<{ id: string; name: string; role: string }, [string]>(
      `SELECT id, name, role FROM sessions
       WHERE name = ? AND status = 'active'`
    ).all(name);
  } catch (err) {
    console.error("[cc-dm/bus] findSessionsByName failed:", err);
    return [];
  }
}

export function listActiveSessions(): Array<{ id: string; name: string; role: string; cwd: string; last_seen: string }> {
  try {
    return db.query<{ id: string; name: string; role: string; cwd: string; last_seen: string }, []>(
      `SELECT id, name, role, cwd, last_seen FROM sessions
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
  registerSession("test-id", "test-session", "worker", "/tmp");
  writeMessage("test-session", "test-id", "hello from smoke test");
  const msgs = readMessages("test-id");
  console.log("messages:", msgs);
  const sessions = listActiveSessions();
  console.log("sessions:", sessions);
}
