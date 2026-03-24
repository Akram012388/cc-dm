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
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err;
    }
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN cwd TEXT NOT NULL DEFAULT ''`);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err;
    }
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN project TEXT NOT NULL DEFAULT ''`);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err;
    }

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

// Throws on failure so callers (handleRegister) can report accurate success/failure.
export function registerSession(sessionId: string, name: string, role: string, cwd: string, project: string = ""): void {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO sessions (id, name, role, cwd, project, status, last_seen, registered_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role = excluded.role,
       cwd = excluded.cwd,
       project = excluded.project,
       status = 'active',
       last_seen = excluded.last_seen`,
    [sessionId, name, role, cwd, project, now, now]
  );
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
  } catch (err) {
    console.error("[cc-dm/bus] expireStaleSessions (sessions) failed:", err);
  }

  try {
    db.run(
      `DELETE FROM messages WHERE delivered = 0 AND created_at < ?`,
      [new Date(Date.now() - 15_000).toISOString()]
    );
  } catch (err) {
    console.error("[cc-dm/bus] expireStaleSessions (messages) failed:", err);
  }
}

// Note: fromName is a display name stored in the from_session column for
// historical reasons. It is NOT a session ID — do not JOIN against sessions.id.
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

// Deletes the message row after successful notification delivery.
// Throws on failure so the poll loop can avoid infinite re-delivery.
export function deleteDeliveredMessage(messageId: number): void {
  db.run(`DELETE FROM messages WHERE id = ?`, [messageId]);
}

// Throws on failure so handleDm can report accurate errors.
export function findSessionsByName(name: string): Array<{ id: string; name: string; role: string }> {
  return db.query<{ id: string; name: string; role: string }, [string]>(
    `SELECT id, name, role FROM sessions
     WHERE name = ? AND status = 'active'`
  ).all(name);
}

// Throws on failure so handleWho/handleBroadcast can report accurate errors.
export function listActiveSessions(): Array<{ id: string; name: string; role: string; cwd: string; project: string; last_seen: string }> {
  return db.query<{ id: string; name: string; role: string; cwd: string; project: string; last_seen: string }, []>(
    `SELECT id, name, role, cwd, project, last_seen FROM sessions
     WHERE status = 'active'
     ORDER BY registered_at ASC`
  ).all();
}

// Smoke test — only runs when executed directly: bun run src/bus.ts
if (import.meta.main) {
  initBus();
  registerSession("test-id", "test-session", "worker", "/tmp", "demo");
  writeMessage("test-session", "test-id", "hello from smoke test");
  const msgs = readPendingMessages("test-id");
  console.error("messages:", msgs);
  const sessions = listActiveSessions();
  console.error("sessions:", sessions);
}
